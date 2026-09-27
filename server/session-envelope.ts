import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type { SourceBrowserSession } from "./browser/webview.js";

export type BrowserSessionState = SourceBrowserSession;

type Envelope = {
  key: string;
  expiresAt: number;
  state: BrowserSessionState;
};

export function createBrowserSessionCodec(secret: string) {
  const key = createHash("sha256")
    .update(`browser-session\0${secret}`)
    .digest();
  return {
    seal(sourceKey: string, state: BrowserSessionState) {
      const value: Envelope = {
        key: sourceKey,
        expiresAt: Date.now() + 7 * 24 * 60 * 60_000,
        state,
      };
      const plain = Buffer.from(JSON.stringify(value));
      if (plain.length > 384 * 1024) throw new Error("source_storage_limit");
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const body = Buffer.concat([cipher.update(plain), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]).toString(
        "base64url",
      );
    },
    open(token: string, expectedKey: string) {
      const bytes = Buffer.from(token, "base64url");
      if (bytes.length < 29 || bytes.length > 512 * 1024)
        throw new Error("source_session_expired");
      try {
        const decipher = createDecipheriv(
          "aes-256-gcm",
          key,
          bytes.subarray(0, 12),
        );
        decipher.setAuthTag(bytes.subarray(12, 28));
        const value = JSON.parse(
          Buffer.concat([
            decipher.update(bytes.subarray(28)),
            decipher.final(),
          ]).toString("utf8"),
        ) as Envelope;
        if (
          !value ||
          value.key !== expectedKey ||
          !Number.isSafeInteger(value.expiresAt) ||
          value.expiresAt < Date.now() ||
          !value.state ||
          !Array.isArray(value.state.cookies) ||
          !Array.isArray(value.state.origins)
        )
          throw new Error();
        return value.state;
      } catch {
        throw new Error("source_session_expired");
      }
    },
  };
}
