/**
 * Browser-native MiCasa Nostr transport.
 *
 * Adapted from upstream Buzz's browser NIP-42 client, but intentionally removes
 * NIP-07 and ephemeral identities. MiCasa accepts only a PA-bound durable signer
 * and a same-origin WebSocket gateway. The gateway selects the authenticated
 * Household's internal Builderlab relay; this client never receives or renders
 * that internal hostname.
 */

import { makeAuthEvent } from "nostr-tools/nip42";
import { verifyEvent } from "nostr-tools/pure";
import { isAllowedMiCasaOrigin } from "./origin-policy.ts";

const AUTH_KIND = 22242;
const STREAM_MESSAGE_KIND = 9;
const TIMELINE_KINDS = new Set([9, 40002, 40008, 40099]);
const AUTH_TIMEOUT_MS = 10_000;
const OPERATION_TIMEOUT_MS = 15_000;
const MAX_FRAME_BYTES = 1_048_576;
const MAX_MESSAGE_BYTES = 32_768;
const PUBLIC_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const HEX_64 = /^[0-9a-f]{64}$/;
const HEX_128 = /^[0-9a-f]{128}$/;

export type UnsignedNostrEvent = {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
};

export type SignedNostrEvent = UnsignedNostrEvent & {
  id: string;
  pubkey: string;
  sig: string;
};

export type MiCasaNostrSigner = {
  getPublicKey(): Promise<string>;
  signEvent(event: UnsignedNostrEvent): Promise<SignedNostrEvent>;
};

type SocketEvent = { data: unknown };
type SocketListener = (event: SocketEvent) => void;
type EmptyListener = () => void;

export type MiCasaWebSocket = {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: "open" | "error" | "close",
    listener: EmptyListener,
  ): void;
  addEventListener(type: "message", listener: SocketListener): void;
  removeEventListener(
    type: "open" | "error" | "close",
    listener: EmptyListener,
  ): void;
  removeEventListener(type: "message", listener: SocketListener): void;
};

export type MiCasaSocketFactory = (url: string) => MiCasaWebSocket;

export type MiCasaRealtimeOptions = {
  browserOrigin: string;
  gatewayPath: "/api/micasa/v1/realtime";
  signer: MiCasaNostrSigner;
  socketFactory?: MiCasaSocketFactory;
  now?: () => number;
};

export type MiCasaChannelSubscriptionState =
  | "CONNECTING"
  | "LIVE"
  | "FAILED"
  | "CLOSED";

export type MiCasaChannelSubscriptionCallbacks = {
  onEvent(event: SignedNostrEvent): void;
  onState?(
    state: MiCasaChannelSubscriptionState,
    error: MiCasaRealtimeError | null,
  ): void;
};

export type MiCasaChannelSubscription = {
  close(): void;
};

export class MiCasaRealtimeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MiCasaRealtimeError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new MiCasaRealtimeError(code, message);
}

function publicReference(value: unknown, label: string): string {
  if (typeof value !== "string" || !PUBLIC_REF.test(value)) {
    fail("MICASA_REALTIME_REFERENCE_INVALID", `${label} is invalid.`);
  }
  return value;
}

function publicKey(value: unknown): string {
  if (typeof value !== "string" || !HEX_64.test(value)) {
    fail("MICASA_REALTIME_SIGNER_INVALID", "The MiCasa signer is unavailable.");
  }
  return value;
}

function gatewayUrl(options: MiCasaRealtimeOptions): string {
  let origin: URL;
  let gateway: URL;
  try {
    origin = new URL(options.browserOrigin);
    gateway = new URL(options.gatewayPath, origin);
  } catch {
    fail("MICASA_REALTIME_GATEWAY_INVALID", "The realtime gateway is invalid.");
  }
  if (
    !["https:", "http:"].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    gateway.origin !== origin.origin ||
    gateway.pathname !== "/api/micasa/v1/realtime" ||
    gateway.search ||
    gateway.hash
  ) {
    fail("MICASA_REALTIME_GATEWAY_INVALID", "The realtime gateway is invalid.");
  }
  if (!isAllowedMiCasaOrigin(origin, Boolean(import.meta.env?.PROD))) {
    fail(
      "MICASA_REALTIME_GATEWAY_INVALID",
      "Production realtime requires HTTPS.",
    );
  }
  gateway.protocol = origin.protocol === "https:" ? "wss:" : "ws:";
  return gateway.toString();
}

function defaultSocketFactory(url: string): MiCasaWebSocket {
  return new WebSocket(url) as unknown as MiCasaWebSocket;
}

function parseFrame(value: unknown): unknown[] {
  if (typeof value !== "string" || value.length > MAX_FRAME_BYTES) {
    fail(
      "MICASA_REALTIME_FRAME_INVALID",
      "The relay returned an invalid frame.",
    );
  }
  let frame: unknown;
  try {
    frame = JSON.parse(value);
  } catch {
    fail(
      "MICASA_REALTIME_FRAME_INVALID",
      "The relay returned an invalid frame.",
    );
  }
  if (!Array.isArray(frame) || typeof frame[0] !== "string") {
    fail(
      "MICASA_REALTIME_FRAME_INVALID",
      "The relay returned an invalid frame.",
    );
  }
  return frame;
}

function sameUnsigned(
  expected: UnsignedNostrEvent,
  actual: SignedNostrEvent,
): boolean {
  return (
    actual.kind === expected.kind &&
    actual.created_at === expected.created_at &&
    actual.content === expected.content &&
    JSON.stringify(actual.tags) === JSON.stringify(expected.tags)
  );
}

function signedEvent(
  value: unknown,
  {
    expected,
    expectedPubkey,
  }: {
    expected: UnsignedNostrEvent | null;
    expectedPubkey: string | null;
  },
): SignedNostrEvent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("MICASA_REALTIME_EVENT_INVALID", "A signed event is invalid.");
  }
  const event = value as Record<string, unknown>;
  if (
    typeof event.id !== "string" ||
    !HEX_64.test(event.id) ||
    typeof event.pubkey !== "string" ||
    !HEX_64.test(event.pubkey) ||
    typeof event.sig !== "string" ||
    !HEX_128.test(event.sig) ||
    typeof event.kind !== "number" ||
    !Number.isSafeInteger(event.kind) ||
    typeof event.created_at !== "number" ||
    !Number.isSafeInteger(event.created_at) ||
    typeof event.content !== "string" ||
    !Array.isArray(event.tags) ||
    event.tags.some(
      (tag) =>
        !Array.isArray(tag) ||
        tag.length === 0 ||
        tag.some((part) => typeof part !== "string"),
    )
  ) {
    fail("MICASA_REALTIME_EVENT_INVALID", "A signed event is invalid.");
  }
  const checked = event as unknown as SignedNostrEvent;
  if (expectedPubkey !== null && checked.pubkey !== expectedPubkey) {
    fail("MICASA_REALTIME_SIGNER_INVALID", "The signer identity changed.");
  }
  if (expected !== null && !sameUnsigned(expected, checked)) {
    fail(
      "MICASA_REALTIME_SIGNER_INVALID",
      "The signer changed the requested event.",
    );
  }
  if (!verifyEvent(checked)) {
    fail("MICASA_REALTIME_EVENT_INVALID", "A signed event is invalid.");
  }
  return checked;
}

async function sign(
  signer: MiCasaNostrSigner,
  template: UnsignedNostrEvent,
): Promise<SignedNostrEvent> {
  let expectedPubkey: string;
  let result: SignedNostrEvent;
  try {
    expectedPubkey = publicKey(await signer.getPublicKey());
    result = await signer.signEvent(template);
  } catch (error) {
    if (error instanceof MiCasaRealtimeError) throw error;
    fail(
      "MICASA_REALTIME_SIGNER_UNAVAILABLE",
      "The MiCasa signer is unavailable.",
    );
  }
  return signedEvent(result, {
    expected: template,
    expectedPubkey,
  });
}

function socketFactory(options: MiCasaRealtimeOptions): MiCasaSocketFactory {
  return options.socketFactory ?? defaultSocketFactory;
}

async function authenticatedSocket(
  options: MiCasaRealtimeOptions,
): Promise<MiCasaWebSocket> {
  const wsUrl = gatewayUrl(options);
  let socket: MiCasaWebSocket;
  try {
    socket = socketFactory(options)(wsUrl);
  } catch {
    fail("MICASA_REALTIME_UNAVAILABLE", "Realtime is temporarily unavailable.");
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let authEventId: string | null = null;
    let challengeReceived = false;

    const finishError = (error: MiCasaRealtimeError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      cleanup();
      try {
        socket.close(1008, "authentication failed");
      } catch {
        // The socket is already unavailable.
      }
      reject(error);
    };
    const onOpen = () => {
      // Mandatory NIP-42: do not send a REQ or EVENT before AUTH succeeds.
    };
    const onError = () => {
      finishError(
        new MiCasaRealtimeError(
          "MICASA_REALTIME_UNAVAILABLE",
          "Realtime is temporarily unavailable.",
        ),
      );
    };
    const onClose = () => {
      finishError(
        new MiCasaRealtimeError(
          "MICASA_REALTIME_UNAVAILABLE",
          "Realtime disconnected before authentication.",
        ),
      );
    };
    const onMessage: SocketListener = (message) => {
      let frame: unknown[];
      try {
        frame = parseFrame(String(message.data));
      } catch (error) {
        finishError(
          error instanceof MiCasaRealtimeError
            ? error
            : new MiCasaRealtimeError(
                "MICASA_REALTIME_FRAME_INVALID",
                "The relay returned an invalid frame.",
              ),
        );
        return;
      }
      if (
        frame[0] === "AUTH" &&
        typeof frame[1] === "string" &&
        !challengeReceived
      ) {
        const challenge = frame[1];
        if (!challenge || challenge.length > 512) {
          finishError(
            new MiCasaRealtimeError(
              "MICASA_REALTIME_AUTH_INVALID",
              "Relay authentication failed.",
            ),
          );
          return;
        }
        challengeReceived = true;
        void (async () => {
          try {
            const template = makeAuthEvent(wsUrl, challenge);
            if (template.kind !== AUTH_KIND) {
              fail(
                "MICASA_REALTIME_AUTH_INVALID",
                "Relay authentication failed.",
              );
            }
            const event = await sign(options.signer, template);
            if (settled) return;
            authEventId = event.id;
            socket.send(JSON.stringify(["AUTH", event]));
          } catch (error) {
            finishError(
              error instanceof MiCasaRealtimeError
                ? error
                : new MiCasaRealtimeError(
                    "MICASA_REALTIME_AUTH_INVALID",
                    "Relay authentication failed.",
                  ),
            );
          }
        })();
        return;
      }
      if (
        frame[0] === "OK" &&
        typeof frame[1] === "string" &&
        frame[1] === authEventId
      ) {
        if (frame[2] !== true) {
          finishError(
            new MiCasaRealtimeError(
              "MICASA_REALTIME_AUTH_REFUSED",
              "Relay authentication was refused.",
            ),
          );
          return;
        }
        settled = true;
        clearTimeout(timeout);
        cleanup();
        resolve(socket);
        return;
      }
      if (frame[0] !== "NOTICE") {
        finishError(
          new MiCasaRealtimeError(
            "MICASA_REALTIME_AUTH_INVALID",
            "Relay authentication failed.",
          ),
        );
      }
    };
    const cleanup = () => {
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
      socket.removeEventListener("message", onMessage);
    };
    const timeout = setTimeout(() => {
      finishError(
        new MiCasaRealtimeError(
          "MICASA_REALTIME_AUTH_TIMEOUT",
          "Relay authentication timed out.",
        ),
      );
    }, AUTH_TIMEOUT_MS);

    socket.addEventListener("open", onOpen);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
    socket.addEventListener("message", onMessage);
  });
}

function channelEvent(value: unknown, channelId: string): SignedNostrEvent {
  const event = signedEvent(value, {
    expected: null,
    expectedPubkey: null,
  });
  if (
    !TIMELINE_KINDS.has(event.kind) ||
    !event.tags.some(
      (tag) => tag.length === 2 && tag[0] === "h" && tag[1] === channelId,
    )
  ) {
    fail(
      "MICASA_REALTIME_CHANNEL_EVENT_INVALID",
      "The relay returned an unauthorized channel event.",
    );
  }
  return event;
}

function closeQuietly(socket: MiCasaWebSocket): void {
  try {
    socket.close(1000, "complete");
  } catch {
    // The operation is already settled.
  }
}

export class MiCasaRealtimeClient {
  readonly #options: MiCasaRealtimeOptions;

  constructor(options: MiCasaRealtimeOptions) {
    if (
      typeof options !== "object" ||
      options === null ||
      typeof options.signer?.getPublicKey !== "function" ||
      typeof options.signer?.signEvent !== "function"
    ) {
      fail("MICASA_REALTIME_CONFIGURATION_INVALID", "Realtime is unavailable.");
    }
    gatewayUrl(options);
    this.#options = options;
  }

  async queryChannelHistory(
    channelId: string,
    limit = 50,
  ): Promise<SignedNostrEvent[]> {
    const checkedChannel = publicReference(channelId, "Channel");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
      fail("MICASA_REALTIME_LIMIT_INVALID", "The history limit is invalid.");
    }
    const socket = await authenticatedSocket(this.#options);
    return new Promise((resolve, reject) => {
      const events = new Map<string, SignedNostrEvent>();
      const subscriptionId = `micasa-${crypto.randomUUID().replace(/-/g, "")}`;
      let settled = false;

      const finishError = (error: MiCasaRealtimeError) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        cleanup();
        closeQuietly(socket);
        reject(error);
      };
      const onError = () => {
        finishError(
          new MiCasaRealtimeError(
            "MICASA_REALTIME_UNAVAILABLE",
            "Realtime is temporarily unavailable.",
          ),
        );
      };
      const onClose = () => {
        finishError(
          new MiCasaRealtimeError(
            "MICASA_REALTIME_UNAVAILABLE",
            "Realtime disconnected before history completed.",
          ),
        );
      };
      const onMessage: SocketListener = (message) => {
        try {
          const frame = parseFrame(String(message.data));
          if (frame[0] === "EVENT" && frame[1] === subscriptionId) {
            const event = channelEvent(frame[2], checkedChannel);
            events.set(event.id, event);
            return;
          }
          if (frame[0] === "EOSE" && frame[1] === subscriptionId) {
            settled = true;
            clearTimeout(timeout);
            cleanup();
            socket.send(JSON.stringify(["CLOSE", subscriptionId]));
            closeQuietly(socket);
            resolve(
              [...events.values()].sort(
                (left, right) =>
                  left.created_at - right.created_at ||
                  left.id.localeCompare(right.id),
              ),
            );
            return;
          }
          if (frame[0] === "CLOSED" && frame[1] === subscriptionId) {
            finishError(
              new MiCasaRealtimeError(
                "MICASA_REALTIME_SUBSCRIPTION_REFUSED",
                "Channel history was refused.",
              ),
            );
          }
        } catch (error) {
          finishError(
            error instanceof MiCasaRealtimeError
              ? error
              : new MiCasaRealtimeError(
                  "MICASA_REALTIME_FRAME_INVALID",
                  "The relay returned an invalid frame.",
                ),
          );
        }
      };
      const cleanup = () => {
        socket.removeEventListener("error", onError);
        socket.removeEventListener("close", onClose);
        socket.removeEventListener("message", onMessage);
      };
      const timeout = setTimeout(() => {
        finishError(
          new MiCasaRealtimeError(
            "MICASA_REALTIME_HISTORY_TIMEOUT",
            "Channel history timed out.",
          ),
        );
      }, OPERATION_TIMEOUT_MS);

      socket.addEventListener("error", onError);
      socket.addEventListener("close", onClose);
      socket.addEventListener("message", onMessage);
      socket.send(
        JSON.stringify([
          "REQ",
          subscriptionId,
          {
            kinds: [...TIMELINE_KINDS],
            "#h": [checkedChannel],
            limit,
          },
        ]),
      );
    });
  }

  async subscribeChannel(
    channelId: string,
    callbacks: MiCasaChannelSubscriptionCallbacks,
  ): Promise<MiCasaChannelSubscription> {
    const checkedChannel = publicReference(channelId, "Channel");
    if (
      typeof callbacks !== "object" ||
      callbacks === null ||
      typeof callbacks.onEvent !== "function" ||
      (callbacks.onState !== undefined &&
        typeof callbacks.onState !== "function")
    ) {
      fail(
        "MICASA_REALTIME_SUBSCRIPTION_INVALID",
        "The live subscription is invalid.",
      );
    }

    const notify = (
      state: MiCasaChannelSubscriptionState,
      error: MiCasaRealtimeError | null,
    ) => {
      try {
        callbacks.onState?.(state, error);
      } catch {
        // Observer failures cannot weaken or mutate the transport policy.
      }
    };
    notify("CONNECTING", null);

    let socket: MiCasaWebSocket;
    try {
      socket = await authenticatedSocket(this.#options);
    } catch (error) {
      const checked =
        error instanceof MiCasaRealtimeError
          ? error
          : new MiCasaRealtimeError(
              "MICASA_REALTIME_UNAVAILABLE",
              "Realtime is temporarily unavailable.",
            );
      notify("FAILED", checked);
      throw checked;
    }

    const subscriptionId = `micasa-live-${crypto.randomUUID().replace(/-/g, "")}`;
    let active = true;
    let live = false;

    const cleanup = () => {
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
      socket.removeEventListener("message", onMessage);
    };
    const finish = (
      state: "FAILED" | "CLOSED",
      error: MiCasaRealtimeError | null,
    ) => {
      if (!active) return;
      active = false;
      clearTimeout(startupTimeout);
      cleanup();
      closeQuietly(socket);
      notify(state, error);
    };
    const finishError = (error: MiCasaRealtimeError) => {
      finish("FAILED", error);
    };
    const onError = () => {
      finishError(
        new MiCasaRealtimeError(
          "MICASA_REALTIME_UNAVAILABLE",
          "Live updates are temporarily unavailable.",
        ),
      );
    };
    const onClose = () => {
      finishError(
        new MiCasaRealtimeError(
          "MICASA_REALTIME_UNAVAILABLE",
          "Live updates disconnected.",
        ),
      );
    };
    const onMessage: SocketListener = (message) => {
      if (!active) return;
      try {
        const frame = parseFrame(String(message.data));
        if (frame[0] === "EVENT" && frame[1] === subscriptionId) {
          const event = channelEvent(frame[2], checkedChannel);
          try {
            callbacks.onEvent(event);
          } catch {
            finishError(
              new MiCasaRealtimeError(
                "MICASA_REALTIME_SUBSCRIBER_FAILED",
                "Live updates could not be applied.",
              ),
            );
          }
          return;
        }
        if (frame[0] === "EOSE" && frame[1] === subscriptionId) {
          if (!live) {
            live = true;
            clearTimeout(startupTimeout);
            notify("LIVE", null);
          }
          return;
        }
        if (frame[0] === "CLOSED" && frame[1] === subscriptionId) {
          finishError(
            new MiCasaRealtimeError(
              "MICASA_REALTIME_SUBSCRIPTION_REFUSED",
              "Live updates were refused.",
            ),
          );
        }
      } catch (error) {
        finishError(
          error instanceof MiCasaRealtimeError
            ? error
            : new MiCasaRealtimeError(
                "MICASA_REALTIME_FRAME_INVALID",
                "The relay returned an invalid frame.",
              ),
        );
      }
    };
    const startupTimeout = setTimeout(() => {
      finishError(
        new MiCasaRealtimeError(
          "MICASA_REALTIME_SUBSCRIPTION_TIMEOUT",
          "Live updates timed out.",
        ),
      );
    }, OPERATION_TIMEOUT_MS);

    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
    socket.addEventListener("message", onMessage);
    try {
      socket.send(
        JSON.stringify([
          "REQ",
          subscriptionId,
          {
            kinds: [...TIMELINE_KINDS],
            "#h": [checkedChannel],
            limit: 100,
          },
        ]),
      );
    } catch {
      const error = new MiCasaRealtimeError(
        "MICASA_REALTIME_UNAVAILABLE",
        "Live updates are temporarily unavailable.",
      );
      finishError(error);
      throw error;
    }

    return {
      close: () => {
        if (!active) return;
        try {
          socket.send(JSON.stringify(["CLOSE", subscriptionId]));
        } catch {
          // Closing locally remains authoritative when the peer disappeared.
        }
        finish("CLOSED", null);
      },
    };
  }

  async publishChannelMessage(
    channelId: string,
    content: string,
    mentionPubkeys: readonly string[] = [],
  ): Promise<SignedNostrEvent> {
    const checkedChannel = publicReference(channelId, "Channel");
    const normalized = content.trim();
    if (
      !normalized ||
      new TextEncoder().encode(normalized).length > MAX_MESSAGE_BYTES
    ) {
      fail("MICASA_REALTIME_MESSAGE_INVALID", "The message is invalid.");
    }
    const mentions = [...new Set(mentionPubkeys)];
    if (mentions.length > 64 || mentions.some((value) => !HEX_64.test(value))) {
      fail("MICASA_REALTIME_MENTION_INVALID", "A message mention is invalid.");
    }
    const socket = await authenticatedSocket(this.#options);
    const template: UnsignedNostrEvent = {
      kind: STREAM_MESSAGE_KIND,
      created_at: Math.floor((this.#options.now?.() ?? Date.now()) / 1_000),
      tags: [["h", checkedChannel], ...mentions.map((pubkey) => ["p", pubkey])],
      content: normalized,
    };
    let event: SignedNostrEvent;
    try {
      event = await sign(this.#options.signer, template);
    } catch (error) {
      closeQuietly(socket);
      throw error;
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const finishError = (error: MiCasaRealtimeError) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        cleanup();
        closeQuietly(socket);
        reject(error);
      };
      const onError = () => {
        finishError(
          new MiCasaRealtimeError(
            "MICASA_REALTIME_UNAVAILABLE",
            "Realtime is temporarily unavailable.",
          ),
        );
      };
      const onClose = () => {
        finishError(
          new MiCasaRealtimeError(
            "MICASA_REALTIME_UNAVAILABLE",
            "Realtime disconnected before publish completed.",
          ),
        );
      };
      const onMessage: SocketListener = (message) => {
        try {
          const frame = parseFrame(String(message.data));
          if (frame[0] === "OK" && frame[1] === event.id) {
            if (frame[2] !== true) {
              finishError(
                new MiCasaRealtimeError(
                  "MICASA_REALTIME_PUBLISH_REFUSED",
                  "The message was refused.",
                ),
              );
              return;
            }
            settled = true;
            clearTimeout(timeout);
            cleanup();
            closeQuietly(socket);
            resolve(event);
          }
        } catch (error) {
          finishError(
            error instanceof MiCasaRealtimeError
              ? error
              : new MiCasaRealtimeError(
                  "MICASA_REALTIME_FRAME_INVALID",
                  "The relay returned an invalid frame.",
                ),
          );
        }
      };
      const cleanup = () => {
        socket.removeEventListener("error", onError);
        socket.removeEventListener("close", onClose);
        socket.removeEventListener("message", onMessage);
      };
      const timeout = setTimeout(() => {
        finishError(
          new MiCasaRealtimeError(
            "MICASA_REALTIME_PUBLISH_TIMEOUT",
            "Message publishing timed out.",
          ),
        );
      }, OPERATION_TIMEOUT_MS);

      socket.addEventListener("error", onError);
      socket.addEventListener("close", onClose);
      socket.addEventListener("message", onMessage);
      socket.send(JSON.stringify(["EVENT", event]));
    });
  }
}
