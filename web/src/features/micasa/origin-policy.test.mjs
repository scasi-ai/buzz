import assert from "node:assert/strict";
import test from "node:test";

import { isAllowedMiCasaOrigin } from "./origin-policy.ts";

test("production accepts HTTPS origins", () => {
  assert.equal(
    isAllowedMiCasaOrigin(new URL("https://micasa.mediaglyphics.com"), true),
    true,
  );
});

test("production preview accepts exact HTTP loopback hosts", () => {
  for (const value of [
    "http://127.0.0.1:4173",
    "http://localhost:4173",
    "http://[::1]:4173",
  ]) {
    assert.equal(isAllowedMiCasaOrigin(new URL(value), true), true);
  }
});

test("production refuses external and lookalike HTTP hosts", () => {
  for (const value of [
    "http://micasa.mediaglyphics.com",
    "http://localhost.example.com",
    "http://127.0.0.1.example.com",
  ]) {
    assert.equal(isAllowedMiCasaOrigin(new URL(value), true), false);
  }
});

test("development may use an HTTP integration origin", () => {
  assert.equal(
    isAllowedMiCasaOrigin(new URL("http://integration.test"), false),
    true,
  );
});
