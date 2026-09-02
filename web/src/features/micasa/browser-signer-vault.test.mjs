import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { schnorr } from "@noble/curves/secp256k1.js";
import { verifyEvent } from "nostr-tools/pure";
import {
  BrowserSignerVaultError,
  createBrowserSigner,
  removeBrowserSignerAfterRevocation,
  unlockBrowserSigner,
} from "./browser-signer-vault.ts";

class MemoryStore {
  records = new Map();

  async read(bindingId) {
    return this.records.get(bindingId) ?? null;
  }

  async write(record) {
    this.records.set(record.bindingId, record);
  }

  async remove(bindingId) {
    this.records.delete(bindingId);
  }
}

function unsigned(content = "hello") {
  return {
    kind: 9,
    created_at: 2000,
    tags: [["h", "room-one"]],
    content,
  };
}

test("creates a stable encrypted non-extractable browser signer", async () => {
  const store = new MemoryStore();
  const signer = await createBrowserSigner(
    "binding-one",
    store,
    globalThis.crypto,
    () => 1000,
  );
  const publicKey = await signer.getPublicKey();
  assert.match(publicKey, /^[0-9a-f]{64}$/);
  const record = store.records.get("binding-one");
  assert.ok(record);
  assert.equal(record.publicKey, publicKey);
  assert.equal(record.wrappingKey.extractable, false);
  assert.equal(record.wrappingKey.algorithm.name, "AES-GCM");
  assert.equal(record.iv.byteLength, 12);
  assert.equal(record.ciphertext.byteLength, 48);
  assert.deepEqual(Object.keys(record).sort(), [
    "bindingId",
    "ciphertext",
    "createdAt",
    "iv",
    "publicKey",
    "version",
    "wrappingKey",
  ]);
});

test("reload unlocks the same PA-bound identity", async () => {
  const store = new MemoryStore();
  const first = await createBrowserSigner("binding-one", store);
  const publicKey = await first.getPublicKey();
  first.lock();
  const second = await unlockBrowserSigner("binding-one", publicKey, store);
  assert.equal(await second.getPublicKey(), publicKey);
  const event = await second.signEvent(unsigned());
  assert.equal(event.pubkey, publicKey);
  assert.equal(verifyEvent(event), true);
});

test("create never replaces an existing identity", async () => {
  const store = new MemoryStore();
  const first = await createBrowserSigner("binding-one", store);
  const publicKey = await first.getPublicKey();
  first.lock();
  const second = await createBrowserSigner("binding-one", store);
  assert.equal(await second.getPublicKey(), publicKey);
  assert.equal(store.records.size, 1);
});

test("separate PA bindings receive separate encrypted identities", async () => {
  const store = new MemoryStore();
  const first = await createBrowserSigner("binding-one", store);
  const second = await createBrowserSigner("binding-two", store);
  assert.notEqual(await first.getPublicKey(), await second.getPublicKey());
  assert.equal(store.records.size, 2);
});

test("expected PA public key mismatch fails without replacement", async () => {
  const store = new MemoryStore();
  await createBrowserSigner("binding-one", store);
  await assert.rejects(
    unlockBrowserSigner("binding-one", "0".repeat(64), store),
    BrowserSignerVaultError,
  );
  assert.equal(store.records.size, 1);
});

test("a locked handle cannot authenticate or sign", async () => {
  const store = new MemoryStore();
  const signer = await createBrowserSigner("binding-one", store);
  signer.lock();
  await assert.rejects(signer.getPublicKey(), BrowserSignerVaultError);
  await assert.rejects(signer.signEvent(unsigned()), BrowserSignerVaultError);
  await assert.rejects(
    signer.signAgentAuthorization("a".repeat(64), "kind=0"),
    BrowserSignerVaultError,
  );
});

test("signs only the fixed NIP-OA kind=0 Agent authorization", async () => {
  const store = new MemoryStore();
  const signer = await createBrowserSigner("binding-one", store);
  const ownerPublicKey = await signer.getPublicKey();
  const agentPublicKey = "a".repeat(64);
  const signature = await signer.signAgentAuthorization(
    agentPublicKey,
    "kind=0",
  );
  const digest = createHash("sha256")
    .update(`nostr:agent-auth:${agentPublicKey}:kind=0`, "utf8")
    .digest();
  assert.match(signature, /^[0-9a-f]{128}$/);
  assert.equal(
    schnorr.verify(
      Buffer.from(signature, "hex"),
      digest,
      Buffer.from(ownerPublicKey, "hex"),
    ),
    true,
  );
  await assert.rejects(
    signer.signAgentAuthorization("bad", "kind=0"),
    BrowserSignerVaultError,
  );
  await assert.rejects(
    signer.signAgentAuthorization(agentPublicKey, "kind=1"),
    BrowserSignerVaultError,
  );
});

test("ciphertext or binding tampering fails closed", async () => {
  const store = new MemoryStore();
  const signer = await createBrowserSigner("binding-one", store);
  const publicKey = await signer.getPublicKey();
  const record = store.records.get("binding-one");
  assert.ok(record);
  const corrupted = new Uint8Array(record.ciphertext.slice(0));
  corrupted[0] ^= 1;
  store.records.set("binding-one", {
    ...record,
    ciphertext: corrupted.buffer,
  });
  await assert.rejects(
    unlockBrowserSigner("binding-one", publicKey, store),
    BrowserSignerVaultError,
  );
  store.records.set("binding-one", {
    ...record,
    bindingId: "binding-two",
  });
  await assert.rejects(
    unlockBrowserSigner("binding-one", publicKey, store),
    BrowserSignerVaultError,
  );
});

test("missing secure storage or crypto fails closed", async () => {
  const store = new MemoryStore();
  await assert.rejects(
    unlockBrowserSigner("binding-one", "0".repeat(64), store),
    BrowserSignerVaultError,
  );
  const refusing = {
    read: async () => null,
    write: async () => {
      throw new Error("unavailable");
    },
    remove: async () => {},
  };
  await assert.rejects(
    createBrowserSigner("binding-one", refusing),
    BrowserSignerVaultError,
  );
});

test("local deletion requires an already-matching revoked identity", async () => {
  const store = new MemoryStore();
  const signer = await createBrowserSigner("binding-one", store);
  const publicKey = await signer.getPublicKey();
  await assert.rejects(
    removeBrowserSignerAfterRevocation("binding-one", "0".repeat(64), store),
    BrowserSignerVaultError,
  );
  assert.equal(store.records.size, 1);
  await removeBrowserSignerAfterRevocation("binding-one", publicKey, store);
  assert.equal(store.records.size, 0);
});
