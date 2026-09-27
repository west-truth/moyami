import { createHash, randomBytes } from "node:crypto";
import { createReadStream, statSync } from "node:fs";
import {
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { BrowserBroker } from "./runtime/browser-broker.js";
import { SourceService } from "./service.js";
import { createTicketCodec } from "./tickets.js";
import { Readable } from "node:stream";
import { SharedBrowserBroker } from "./runtime/shared-browser-broker.js";
import { RedisJobs, redisRestEvaluator } from "./runtime/redis-jobs.js";
import { AuthService } from "./auth/service.js";
import { FileAuthStore, RedisAuthStore } from "./auth/store.js";

export function createApplication(options: { serverless?: boolean } = {}) {
const bootstrapKey = process.env.BOOTSTRAP_KEY ?? "";
const useRedis = options.serverless || process.env.BROKER_STORE === "redis";
const redisUrl = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
const missing = [
  ...(bootstrapKey.length < 32 ? ["BOOTSTRAP_KEY (32자 이상)"] : []),
  ...(useRedis && (!redisUrl || !redisToken) ? ["Upstash Redis 연결"] : []),
];
const secret = process.env.APP_SECRET || (bootstrapKey ? createHash("sha256").update("moyami-tickets:" + bootstrapKey).digest("hex") : randomBytes(32).toString("hex"));
const secureCookie = options.serverless || process.env.COOKIE_SECURE === "1";
const tickets = createTicketCodec(secret);
const service = new SourceService(process.env.SOURCE_OUTBOUND_PROXY);
const evaluate = redisUrl && redisToken ? redisRestEvaluator(redisUrl, redisToken) : undefined;
const auth = new AuthService(useRedis && evaluate
  ? new RedisAuthStore(evaluate, process.env.AUTH_NAMESPACE || "moyami")
  : new FileAuthStore(process.env.AUTH_FILE || "data/auth.json"), bootstrapKey, secret);
const broker = useRedis
  ? evaluate ? new SharedBrowserBroker(service, new RedisJobs(evaluate, secret), process.env.SOURCE_OUTBOUND_PROXY) : null
  : new BrowserBroker(service, process.env.SOURCE_OUTBOUND_PROXY);
const publicRoot = fileURLToPath(new URL("../public", import.meta.url));
const mime: Record<string, string> = {
  ".webmanifest": "application/manifest+json",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

async function json(res: ServerResponse, status: number, value: unknown) {
  const bytes = Buffer.from(JSON.stringify(value));
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  await pipeline(Readable.from((function* () {
    for (let offset = 0; offset < bytes.length; offset += 64 * 1024) yield bytes.subarray(offset, offset + 64 * 1024);
  })()), res);
}
function cookies(req: IncomingMessage) {
  return Object.fromEntries(
    (req.headers.cookie ?? "").split(";").flatMap((part) => {
      const at = part.indexOf("=");
      return at > 0
        ? [[part.slice(0, at).trim(), part.slice(at + 1).trim()]]
        : [];
    }),
  );
}
const sessionToken = (req: IncomingMessage) => cookies(req).moyami_session ?? "";
function setSession(res: ServerResponse, token: string) {
  res.setHeader("set-cookie", `moyami_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token ? 604800 : 0}${secureCookie ? "; Secure" : ""}`);
}
function checkMutation(req: IncomingMessage) {
  if (!req.headers["content-type"]?.startsWith("application/json") ||
      (req.headers["sec-fetch-site"] && !["same-origin", "none"].includes(req.headers["sec-fetch-site"]))) throw new Error("access_denied");
  if (req.headers.origin) {
    let origin: URL;
    try { origin = new URL(req.headers.origin); } catch { throw new Error("access_denied"); }
    if (origin.host !== req.headers.host || !["http:", "https:"].includes(origin.protocol)) throw new Error("access_denied");
  }
}
async function readJson(req: IncomingMessage) {
  const maximum = options.serverless ? 4_400_000 : 5 * 1024 * 1024;
  // Vercel may expose a lazily parsed body after consuming the IncomingMessage.
  if ("body" in req) {
    try {
      const body = (req as IncomingMessage & { body?: unknown }).body;
      if (body !== undefined) {
        const text = typeof body === "string" ? body : Buffer.isBuffer(body) ? body.toString("utf8") : JSON.stringify(body);
        if (Buffer.byteLength(text) > maximum) throw new Error("payload_limit");
        return JSON.parse(text);
      }
    } catch (error) { throw new Error((error as Error).message === "payload_limit" ? "payload_limit" : "invalid_request"); }
  }
  const parts: Buffer[] = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > maximum) throw new Error("payload_limit");
    parts.push(Buffer.from(part));
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString("utf8") || "{}") as unknown;
  } catch {
    throw new Error("invalid_request");
  }
}
function safeError(error: unknown) {
  const code = (error as Error).message;
  return /^[a-z][a-z0-9_]{2,80}$/.test(code) ? code : "source_failed";
}

const handle = async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(
    req.url ?? "/",
    `http://${req.headers.host ?? "localhost"}`,
  );
  const abort = new AbortController();
  req.once("aborted", () => abort.abort());
  req.once("error", () => abort.abort());
  res.once("close", () => {
    if (!res.writableFinished) abort.abort();
  });
  try {
    if (req.method === "GET" && url.pathname === "/api/health")
      return json(res, 200, { ready: !missing.length, maximumRequestBytes: options.serverless ? 4_400_000 : 5 * 1024 * 1024 });
    if (req.method === "GET" && url.pathname === "/api/auth/status")
      return json(res, 200, { configured: !missing.length, missing, name: process.env.SITE_NAME || "moyami", ...(missing.length ? { initialized: false, user: null } : { ...await auth.status(), user: await auth.authenticate(sessionToken(req)) || null }) });
    if (url.pathname.startsWith("/api/")) {
      if (missing.length) return json(res, 503, { error: "configuration_required" });
      if (req.method !== "GET" && req.method !== "HEAD") checkMutation(req);
      if (req.method === "POST" && ["/api/auth/login", "/api/auth/register"].includes(url.pathname)) {
        // Vercel overwrites this header. Local deployments use the actual peer address.
        const peer = options.serverless ? String(req.headers["x-vercel-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim() : req.socket.remoteAddress || "unknown";
        await auth.rate(peer, "credentials");
        const input = await readJson(req);
        const user = url.pathname.endsWith("/register") ? await auth.register(input) : await auth.login(input);
        await auth.logout(sessionToken(req));
        setSession(res, await auth.createSession(user));
        return json(res, 200, { user });
      }
      const user = await auth.authenticate(sessionToken(req));
      if (!user) return json(res, 401, { error: "access_denied" });
      if (req.method === "POST" && url.pathname === "/api/auth/logout") {
        await auth.logout(sessionToken(req)); setSession(res, "");
        return json(res, 200, { ok: true });
      }
      if (req.method === "POST" && url.pathname === "/api/auth/invites") {
        if (user.role !== "admin") return json(res, 403, { error: "admin_required" });
        await auth.rate(user.id, "invites", 30);
        return json(res, 200, await auth.invite());
      }
      if (req.method === "POST" && url.pathname === "/api/auth/invites/revoke") {
        if (user.role !== "admin") return json(res, 403, { error: "admin_required" });
        const input = await readJson(req) as { id?: unknown };
        await auth.revokeInvite(input?.id); return json(res, 200, { ok: true });
      }
      if (url.pathname.startsWith("/api/auth/")) return json(res, 404, { error: "not_found" });
    }
    if (req.method === "GET" && url.pathname === "/api/catalog")
      return json(
        res,
        200,
        await service.catalog(url.searchParams.get("repository"), abort.signal),
      );
    if (req.method === "POST" && url.pathname === "/api/catalog") {
      const input = (await readJson(req)) as { repositoryUrl?: unknown };
      return json(
        res,
        200,
        await service.catalog(input.repositoryUrl, abort.signal),
      );
    }
    if (req.method === "POST" && url.pathname.startsWith("/api/runtime/")) {
      // No cross-origin form requests may use the authenticated relay.
      if (!req.headers["content-type"]?.startsWith("application/json") ||
          (req.headers["sec-fetch-site"] && !["same-origin", "none"].includes(req.headers["sec-fetch-site"])))
        throw new Error("access_denied");
      const input = await readJson(req);
      if (url.pathname === "/api/runtime/prepare")
        return json(res, 200, await broker!.prepare(input, abort.signal));
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid_source_invocation");
      const row = input as Record<string, any>;
      if (url.pathname === "/api/runtime/http")
        return json(res, 200, await broker!.http(row.token, row.request, abort.signal));
      if (url.pathname === "/api/runtime/finish")
        return json(res, 200, await broker!.finish(row.token, row.value, tickets.seal));
      if (url.pathname === "/api/runtime/cancel") {
        await broker!.cancel(row.token);
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: "not_found" });
    }
    if (req.method === "GET" && url.pathname === "/api/image") {
      const image = await service.image(
        tickets.open(url.searchParams.get("ticket") ?? ""),
        abort.signal,
      );
      res.writeHead(200, {
        "x-content-type-options": "nosniff",
        "content-security-policy": "sandbox; default-src 'none'",
        "content-type": image.contentType,
        ...(image.contentLength
          ? { "content-length": String(image.contentLength) }
          : {}),
        ...(image.contentEncoding
          ? { "content-encoding": image.contentEncoding }
          : {}),
        "cache-control": "private, max-age=300",
      });
      await pipeline(image.stream, res, { signal: abort.signal });
      return;
    }
    if (options.serverless) return json(res, 404, { error: "not_found" });
    if (req.method !== "GET" && req.method !== "HEAD")
      return json(res, 405, { error: "method_not_allowed" });
    const relative =
      url.pathname === "/"
        ? "index.html"
        : normalize(url.pathname).replace(/^[/\\]+/, "");
    const target = join(publicRoot, relative);
    if (
      !target.startsWith(publicRoot) ||
      !statSync(target, { throwIfNoEntry: false })?.isFile()
    )
      return json(res, 404, { error: "not_found" });
    res.writeHead(200, {
      "x-content-type-options": "nosniff",
      ...(relative.startsWith("runtime/") ? { "content-security-policy": "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'" } : {}),
      "content-type": mime[extname(target)] ?? "application/octet-stream",
      "cache-control": "no-cache",
    });
    if (req.method === "HEAD") return res.end();
    createReadStream(target).pipe(res);
  } catch (error) {
    if (!res.headersSent)
      await json(res, ["access_denied", "login_failed", "signup_key_invalid"].includes(safeError(error)) ? 401 : safeError(error) === "auth_rate_limited" ? 429 : safeError(error) === "runtime_store_unavailable" ? 503 : 422, {
        error: safeError(error),
      });
    else res.destroy();
  }
};
return { handle, close: () => broker?.close() };
}
