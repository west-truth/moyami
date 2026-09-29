import { createHash } from "node:crypto";
import type { MangayomiEntry } from "./contracts.js";
import { CatalogService } from "./catalog/repository.js";
import { compatibilityHttp } from "./network/http.js";
import {
  preferenceSchema,
  validatePreferenceState,
} from "./runtime/preferences.js";
import { novelHtmlText } from "./runtime/novel-content.js";
import type { ImageTicket } from "./tickets.js";
import { canRedirectImage, openImageStream, publicImageUrl } from "./network/image-stream.js";

const allowedActions = new Set([
  "metadata",
  "preferences",
  "list",
  "detail",
  "chapters",
  "pages",
  "html",
  "headers",
]);

export class SourceService {
  private sources = new Map<
    string,
    Promise<{ source: string; digest: string }>
  >();
  private sourceExpiry = new Map<string, number>();
  readonly catalogs: CatalogService;
  constructor(
    private readonly outboundProxy = process.env.SOURCE_OUTBOUND_PROXY,
  ) {
    this.catalogs = new CatalogService(outboundProxy);
  }

  private loadSource(entry: MangayomiEntry, signal: AbortSignal) {
    const key = `${entry.sourceCodeUrl}\n${entry.version}`;
    if ((this.sourceExpiry.get(key) ?? 0) <= Date.now()) this.sources.delete(key);
    if (!this.sources.has(key)) {
      if (this.sources.size >= 32) {
        const oldest = this.sources.keys().next().value!;
        this.sources.delete(oldest); this.sourceExpiry.delete(oldest);
      }
      // Catch repositories that replace code without bumping the version, too.
      this.sourceExpiry.set(key, Date.now() + 10 * 60_000);
      this.sources.set(
        key,
        compatibilityHttp(
          { url: entry.sourceCodeUrl },
          signal,
          [],
          1024 * 1024,
          this.outboundProxy,
        )
          .then((response) => {
            if (response.statusCode !== 200)
              throw new Error("source_unavailable");
            const digest = createHash("sha256")
              .update(response.bytes)
              .digest("hex");
            return { source: new TextDecoder().decode(response.bytes), digest };
          })
          .catch((error) => {
            this.sources.delete(key); this.sourceExpiry.delete(key);
            throw error;
          }),
      );
    }
    return this.sources.get(key)!;
  }

  async catalog(repositoryUrl: unknown, signal: AbortSignal) {
    const result = await this.catalogs.read(repositoryUrl, signal);
    return {
      ...result,
      sources: result.sources.map(
        ({ sourceCodeUrl: _hidden, ...entry }) => entry,
      ),
    };
  }

  async prepare(
    input: unknown,
    signal: AbortSignal,
  ) {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error("invalid_source_invocation");
    const row = input as Record<string, unknown>;
    if (
      typeof row.action !== "string" ||
      !allowedActions.has(row.action) ||
      (row.params !== undefined &&
        (!row.params ||
          typeof row.params !== "object" ||
          Array.isArray(row.params)))
    )
      throw new Error("invalid_source_invocation");
    const preferences = row.preferences ?? {};
    validatePreferenceState(preferences);
    if (
      typeof row.clientId !== "string" ||
      !/^[a-zA-Z0-9-]{16,80}$/.test(row.clientId)
    )
      throw new Error("invalid_source_invocation");
    if (
      row.codeDigest !== undefined &&
      (typeof row.codeDigest !== "string" ||
        !/^[a-f0-9]{64}$/.test(row.codeDigest))
    )
      throw new Error("invalid_source_invocation");
    if (row.cachedCodeDigest !== undefined && (typeof row.cachedCodeDigest !== "string" || !/^[a-f0-9]{64}$/.test(row.cachedCodeDigest)))
      throw new Error("invalid_source_invocation");
    const { entry, repositoryUrl } = await this.catalogs.resolve(
      row.repositoryUrl,
      row.sourceId,
      signal,
    );
    const loaded = await this.loadSource(entry, signal);
    if (row.codeDigest && row.codeDigest !== loaded.digest)
      throw new Error("source_digest_changed");
    return { entry, repositoryUrl, source: row.cachedCodeDigest === loaded.digest ? undefined : loaded.source, codeDigest: loaded.digest,
      action: row.action, params: row.params ?? {}, preferences };
  }

  finalize(action: string, sourceId: string, raw: unknown, seal: (value: ImageTicket) => string) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalid_source_result");
    const output = raw as { result: unknown; changes: unknown };
    validatePreferenceState(output.changes);
    if (action === "preferences") {
      output.result = preferenceSchema(output.result);
    } else if (action === "html") {
      output.result = { text: novelHtmlText(output.result) };
    } else if (action === "pages") {
      if (!Array.isArray(output.result) || output.result.length > 2048) throw new Error("invalid_source_result");
      output.result = output.result.map((page: unknown) => {
        if (!page || typeof page !== "object")
          throw new Error("invalid_source_result");
        const item = page as { url?: unknown; headers?: unknown };
        if (typeof item.url !== "string" || !/^https:\/\//i.test(item.url))
          throw new Error("invalid_source_result");
        const headers =
          item.headers &&
          typeof item.headers === "object" &&
          !Array.isArray(item.headers)
            ? (item.headers as Record<string, string>)
            : {};
        const ticket = seal({
          url: item.url,
          headers,
          expiresAt: Date.now() + 15 * 60_000,
          sourceId: sourceId,
        });
        return {
          ticket,
          imageUrl: `/api/image?ticket=${encodeURIComponent(ticket)}`,
          ...(!this.outboundProxy && canRedirectImage(headers) ? { directImageUrl: `/api/image?ticket=${encodeURIComponent(ticket)}&direct=1` } : {}),
        };
      });
    } else {
      output.result = this.decorateCovers(output.result, seal, sourceId);
    }
    return output;
  }

  private decorateCovers(
    value: unknown,
    seal: (value: ImageTicket) => string,
    sourceId: string,
    depth = 0,
  ): unknown {
    if (depth > 4 || value === null || value === undefined) return value;
    if (Array.isArray(value))
      return value.map((item) =>
        this.decorateCovers(item, seal, sourceId, depth + 1),
      );
    if (typeof value !== "object") return value;
    const output: Record<string, unknown> = {};
    const imageHeaders = (value as Record<string, unknown>).imageHeaders;
    for (const [key, item] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (
        key === "imageUrl" &&
        typeof item === "string" &&
        /^https:\/\//i.test(item)
      ) {
        const ticket = seal({
          url: item,
          headers: imageHeaders && typeof imageHeaders === "object" && !Array.isArray(imageHeaders) ? imageHeaders as Record<string, string> : {},
          expiresAt: Date.now() + 15 * 60_000,
          sourceId,
        });
        output[key] = `/api/image?ticket=${encodeURIComponent(ticket)}`;
      } else output[key] = this.decorateCovers(item, seal, sourceId, depth + 1);
    }
    return output;
  }

  async imageRedirect(ticket: ImageTicket, signal: AbortSignal) {
    if (this.outboundProxy || !canRedirectImage(ticket.headers)) return undefined;
    return publicImageUrl(ticket.url, signal);
  }

  async image(ticket: ImageTicket, signal: AbortSignal) {
    return openImageStream(
      { url: ticket.url, headers: ticket.headers },
      signal,
      this.outboundProxy,
    );
  }


}
