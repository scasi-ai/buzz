import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  verifyEvent,
} from "nostr-tools/pure";
import type {
  MiCasaNostrSigner,
  SignedNostrEvent,
  UnsignedNostrEvent,
} from "@/features/micasa/realtime";

export class BrowserSignerVaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserSignerVaultError";
  }
}

export type BrowserSignerVaultRecord = {
  version: 1;
  bindingId: string;
  publicKey: string;
  wrappingKey: CryptoKey;
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
  createdAt: number;
};
export type BrowserSignerVaultStore = {
  read(bindingId: string): Promise<BrowserSignerVaultRecord | null>;
  write(record: BrowserSignerVaultRecord): Promise<void>;
  remove(bindingId: string): Promise<void>;
};
export type BrowserSignerHandle = MiCasaNostrSigner & {
  readonly bindingId: string;
  readonly publicKey: string;
  lock(): void;
};

const DATABASE = "micasa-browser-signer-v1";
const STORE = "signers";
const DATABASE_VERSION = 1;
const RECORD_VERSION = 1;
const REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const AES = "AES-GCM";
const IV_BYTES = 12;
const KEY_BYTES = 32;

function fail(message: string): never {
  throw new BrowserSignerVaultError(message);
}
function binding(value: string): string {
  if (!REF.test(value)) fail("The signer binding is invalid.");
  return value;
}
function additionalData(bindingId: string, publicKey: string): Uint8Array {
  return new TextEncoder().encode(
    `micasa.browser-signer.v1\0${bindingId}\0${publicKey}`,
  );
}
function cryptoProvider(value?: Crypto): Crypto {
  const provider = value ?? globalThis.crypto;
  if (!provider?.subtle || typeof provider.getRandomValues !== "function") {
    fail("Secure browser cryptography is unavailable.");
  }
  return provider;
}
function copyBuffer(value: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  const bytes =
    value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return bytes.slice().buffer;
}
function validateRecord(
  value: BrowserSignerVaultRecord,
  bindingId: string,
): BrowserSignerVaultRecord {
  if (
    typeof value !== "object" ||
    value === null ||
    value.version !== RECORD_VERSION ||
    value.bindingId !== bindingId ||
    !HEX64.test(value.publicKey) ||
    !(value.wrappingKey instanceof CryptoKey) ||
    value.wrappingKey.type !== "secret" ||
    value.wrappingKey.extractable ||
    value.wrappingKey.algorithm.name !== AES ||
    !(value.iv instanceof ArrayBuffer) ||
    value.iv.byteLength !== IV_BYTES ||
    !(value.ciphertext instanceof ArrayBuffer) ||
    value.ciphertext.byteLength <= KEY_BYTES ||
    !Number.isSafeInteger(value.createdAt) ||
    value.createdAt < 1
  ) {
    fail("The encrypted browser signer is invalid.");
  }
  return value;
}

function handle(
  bindingId: string,
  publicKey: string,
  secretSource: Uint8Array,
): BrowserSignerHandle {
  const secret = secretSource.slice();
  secretSource.fill(0);
  let locked = false;
  const requireSecret = () => {
    if (locked) fail("The browser signer is locked.");
    return secret;
  };
  return {
    bindingId,
    publicKey,
    async getPublicKey() {
      requireSecret();
      return publicKey;
    },
    async signEvent(event: UnsignedNostrEvent): Promise<SignedNostrEvent> {
      const signed = finalizeEvent(event, requireSecret());
      if (signed.pubkey !== publicKey || !verifyEvent(signed)) {
        fail("The browser signer could not verify its signature.");
      }
      return signed;
    },
    lock() {
      if (!locked) secret.fill(0);
      locked = true;
    },
  };
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(
      new BrowserSignerVaultError("Encrypted browser storage is unavailable."),
    );
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) {
        database.createObjectStore(STORE, { keyPath: "bindingId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        new BrowserSignerVaultError(
          "Encrypted browser storage is unavailable.",
        ),
      );
    request.onblocked = () =>
      reject(
        new BrowserSignerVaultError("Encrypted browser storage is blocked."),
      );
  });
}
async function transaction<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE, mode);
    const request = run(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new BrowserSignerVaultError("Encrypted browser storage failed."));
    tx.oncomplete = () => database.close();
    tx.onabort = () => {
      database.close();
      reject(new BrowserSignerVaultError("Encrypted browser storage failed."));
    };
  });
}

export const indexedDbBrowserSignerStore: BrowserSignerVaultStore = {
  async read(bindingId) {
    const result = await transaction("readonly", (store) =>
      store.get(binding(bindingId)),
    );
    return (result ?? null) as BrowserSignerVaultRecord | null;
  },
  async write(record) {
    await transaction("readwrite", (store) => store.put(record));
  },
  async remove(bindingId) {
    await transaction("readwrite", (store) => store.delete(binding(bindingId)));
  },
};

export async function createBrowserSigner(
  bindingId: string,
  store: BrowserSignerVaultStore = indexedDbBrowserSignerStore,
  provider?: Crypto,
  now: () => number = Date.now,
): Promise<BrowserSignerHandle> {
  const checkedBinding = binding(bindingId);
  const existing = await store.read(checkedBinding);
  if (existing !== null) {
    return unlockBrowserSigner(
      checkedBinding,
      existing.publicKey,
      store,
      provider,
    );
  }
  const crypto = cryptoProvider(provider);
  const secret = generateSecretKey();
  const publicKey = getPublicKey(secret);
  const wrappingKey = await crypto.subtle.generateKey(
    { name: AES, length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  let ciphertext: ArrayBuffer;
  try {
    ciphertext = await crypto.subtle.encrypt(
      {
        name: AES,
        iv,
        additionalData: copyBuffer(additionalData(checkedBinding, publicKey)),
        tagLength: 128,
      },
      wrappingKey,
      copyBuffer(secret),
    );
  } catch {
    secret.fill(0);
    fail("The browser signer could not be encrypted.");
  }
  const record: BrowserSignerVaultRecord = {
    version: RECORD_VERSION,
    bindingId: checkedBinding,
    publicKey,
    wrappingKey,
    iv: copyBuffer(iv),
    ciphertext: copyBuffer(ciphertext),
    createdAt: now(),
  };
  try {
    await store.write(record);
  } catch {
    secret.fill(0);
    fail("The encrypted browser signer could not be stored.");
  }
  return handle(checkedBinding, publicKey, secret);
}

export async function unlockBrowserSigner(
  bindingId: string,
  expectedPublicKey: string,
  store: BrowserSignerVaultStore = indexedDbBrowserSignerStore,
  provider?: Crypto,
): Promise<BrowserSignerHandle> {
  const checkedBinding = binding(bindingId);
  if (!HEX64.test(expectedPublicKey)) {
    fail("The Personal-Agent signer identity is invalid.");
  }
  const raw = await store.read(checkedBinding);
  if (raw === null) fail("This device does not have the bound signer.");
  const record = validateRecord(raw, checkedBinding);
  if (record.publicKey !== expectedPublicKey) {
    fail("This device holds a different signer identity.");
  }
  const crypto = cryptoProvider(provider);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      {
        name: AES,
        iv: new Uint8Array(record.iv),
        additionalData: copyBuffer(
          additionalData(record.bindingId, record.publicKey),
        ),
        tagLength: 128,
      },
      record.wrappingKey,
      record.ciphertext,
    );
  } catch {
    fail("The encrypted browser signer could not be unlocked.");
  }
  const secret = new Uint8Array(plaintext);
  if (
    secret.byteLength !== KEY_BYTES ||
    getPublicKey(secret) !== expectedPublicKey
  ) {
    secret.fill(0);
    fail("The encrypted browser signer does not match Personal-Agent.");
  }
  return handle(checkedBinding, expectedPublicKey, secret);
}

export async function removeBrowserSignerAfterRevocation(
  bindingId: string,
  expectedPublicKey: string,
  store: BrowserSignerVaultStore = indexedDbBrowserSignerStore,
): Promise<void> {
  const checkedBinding = binding(bindingId);
  const record = await store.read(checkedBinding);
  if (
    record === null ||
    validateRecord(record, checkedBinding).publicKey !== expectedPublicKey
  ) {
    fail("The revoked signer identity does not match this device.");
  }
  await store.remove(checkedBinding);
}
