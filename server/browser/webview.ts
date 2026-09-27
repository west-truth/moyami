import { chromium, type Browser, type BrowserContext } from "playwright-core";
import {
  validSourceWebViewRequest,
  type SourceWebViewRequest,
} from "../contracts.js";
import { openSourceBrowserProxy } from "./proxy.js";
import { launchSourceBrowser } from "./launch.js";

export type SourceWebViewScope = {
  key: string;
  origins?: readonly string[];
  privateOrigins?: readonly string[];
  outboundProxy?: string;
  purpose?: "image-pages";
};

type Storage = Awaited<ReturnType<BrowserContext["storageState"]>>;
export type SourceBrowserSession = Storage & {
  userAgents?: Record<string, string>;
};

export class SourceWebViewHost {
  private browser?: Promise<Browser>;
  private sessions = new Map<string, SourceBrowserSession>();

  restore(key: string, state: SourceBrowserSession) {
    if (!this.sessions.has(key)) this.sessions.set(key, state);
  }

  snapshot(key: string) {
    return this.sessions.get(key);
  }

  private async launch() {
    this.browser ??= launchSourceBrowser(chromium, [
      "--disable-quic",
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    ]).catch((error) => {
      this.browser = undefined;
      throw new Error("source_browser_unavailable", { cause: error });
    });
    return this.browser;
  }

  async evaluate(
    input: SourceWebViewRequest,
    scope: SourceWebViewScope,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (!validSourceWebViewRequest(input))
      throw new Error("invalid_source_invocation");
    const permitted = (raw: string) => {
      const url = new URL(raw);
      if (
        !["https:", "http:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        (scope.origins &&
          !scope.origins.includes(url.origin) &&
          !scope.privateOrigins?.includes(url.origin))
      )
        throw new Error("source_url_denied");
      return url;
    };
    const initial = permitted(input.url);
    const deadline = AbortSignal.any([
      signal,
      AbortSignal.timeout(input.timeoutMs ?? 60000),
    ]);
    const proxy = await openSourceBrowserProxy(scope, deadline);
    let context: BrowserContext | undefined;
    try {
      const browser = await this.launch();
      const saved = this.sessions.get(scope.key) ?? {
        cookies: [],
        origins: [],
      };
      const suppliedHeaders = Object.fromEntries(
        Object.entries(input.headers ?? {}).map(([key, value]) => [
          key.toLowerCase(),
          value,
        ]),
      );
      context = await browser.newContext({
        serviceWorkers: "block",
        acceptDownloads: false,
        viewport: { width: 390, height: 844 },
        storageState: { cookies: saved.cookies, origins: saved.origins },
        ...(saved.userAgents?.[initial.origin]
          ? { userAgent: saved.userAgents[initial.origin] }
          : {}),
        proxy: proxy.proxy,
      });
      if (suppliedHeaders.cookie) {
        const cookies = suppliedHeaders.cookie.split(";").flatMap((part) => {
          const index = part.indexOf("=");
          return index > 0
            ? [
                {
                  name: part.slice(0, index).trim(),
                  value: part.slice(index + 1).trim(),
                  url: initial.origin + "/",
                },
              ]
            : [];
        });
        await context.addCookies(cookies);
        delete suppliedHeaders.cookie;
      }
      const close = () => void context?.close().catch(() => undefined);
      deadline.addEventListener("abort", close, { once: true });
      try {
        await context.routeWebSocket("**/*", (socket) => socket.close());
        await context.route("**/*", async (route) => {
          try {
            const target = permitted(route.request().url());
            const headers = await route.request().allHeaders();
            delete headers.host;
            delete headers["content-length"];
            delete headers.connection;
            if (target.origin === initial.origin)
              Object.assign(headers, suppliedHeaders);
            await route.continue({ headers });
          } catch {
            await route.abort("blockedbyclient").catch(() => undefined);
          }
        });
        const page = await context.newPage();
        page.on("popup", (popup) => void popup.close().catch(() => undefined));
        const response = await page.goto(input.url, {
          waitUntil: input.waitUntil ?? "domcontentloaded",
          timeout: 0,
        });
        if (!response?.ok())
          throw new Error(
            [401, 403].includes(response?.status() ?? 0)
              ? "source_access_denied"
              : "source_http_failed",
          );
        const result = await page.evaluate(input.script);
        deadline.throwIfAborted();
        if (
          Buffer.byteLength(JSON.stringify(result) ?? "null") >
          2 * 1024 * 1024
        )
          throw new Error("source_body_limit");
        const state = await context.storageState();
        const userAgent = await page.evaluate(() => navigator.userAgent);
        this.sessions.set(scope.key, {
          ...state,
          userAgents: { ...saved.userAgents, [initial.origin]: userAgent },
        });
        if (proxy.failure) throw new Error(proxy.failure);
        return result ?? null;
      } finally {
        deadline.removeEventListener("abort", close);
      }
    } catch (error) {
      if (deadline.aborted)
        throw new Error(
          signal.aborted ? "cancelled" : "source_request_timeout",
          { cause: error },
        );
      const safe = (error as Error).message;
      throw new Error(
        /^source_[a-z_]+$/.test(safe) ? safe : "source_browser_failed",
        { cause: error },
      );
    } finally {
      await context?.close().catch(() => undefined);
      proxy.close();
    }
  }

  async close() {
    const browser = this.browser;
    this.browser = undefined;
    await browser?.then((value) => value.close()).catch(() => undefined);
  }
}
