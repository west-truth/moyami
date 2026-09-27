import assert from "node:assert/strict";
import test from "node:test";
import { createBrowserSessionCodec } from "../server/session-envelope.js";

test("browser session envelope is encrypted and bound to one client source", () => {
  const codec = createBrowserSessionCodec("test-secret");
  const state = {
    cookies: [
      {
        name: "session",
        value: "private-value",
        domain: "example.com",
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: "Lax" as const,
      },
    ],
    origins: [],
    userAgents: { "https://example.com": "browser" },
  };
  const token = codec.seal("source:a:client", state);
  assert.equal(token.includes("private-value"), false);
  assert.deepEqual(codec.open(token, "source:a:client"), state);
  assert.throws(
    () => codec.open(token, "source:a:other-client"),
    /source_session_expired/,
  );
});

test("browser session envelope rejects tampering", () => {
  const codec = createBrowserSessionCodec("test-secret");
  const token = codec.seal("source:a:client", { cookies: [], origins: [] });
  assert.throws(
    () =>
      codec.open(
        (token.startsWith("a") ? "b" : "a") + token.slice(1),
        "source:a:client",
      ),
    /source_session_expired/,
  );
});
