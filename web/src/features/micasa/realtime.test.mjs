import assert from "node:assert/strict";
import test from "node:test";

import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  verifyEvent,
} from "nostr-tools/pure";

import { MiCasaRealtimeClient, MiCasaRealtimeError } from "./realtime.ts";

const ORIGIN = "https://micasa.mediaglyphics.com";
const CHANNEL = "room:household";
const NOW = 1_788_260_400_000;

class Signer {
  #secret = generateSecretKey();

  async getPublicKey() {
    return getPublicKey(this.#secret);
  }

  async signEvent(event) {
    return finalizeEvent(event, this.#secret);
  }
}

class FakeSocket {
  readyState = 1;
  listeners = new Map();
  sent = [];
  incomingSecret = generateSecretKey();
  channel = CHANNEL;

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  close() {
    this.readyState = 3;
  }

  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  send(payload) {
    const frame = JSON.parse(payload);
    this.sent.push(frame);
    if (frame[0] === "AUTH") {
      queueMicrotask(() => {
        this.emit("message", {
          data: JSON.stringify(["OK", frame[1].id, true, ""]),
        });
      });
      return;
    }
    if (frame[0] === "REQ") {
      const event = finalizeEvent(
        {
          kind: 9,
          created_at: Math.floor(NOW / 1000),
          tags: [["h", this.channel]],
          content: "A real signed household message",
        },
        this.incomingSecret,
      );
      queueMicrotask(() => {
        this.emit("message", {
          data: JSON.stringify(["EVENT", frame[1], event]),
        });
        this.emit("message", {
          data: JSON.stringify(["EOSE", frame[1]]),
        });
      });
      return;
    }
    if (frame[0] === "EVENT") {
      queueMicrotask(() => {
        this.emit("message", {
          data: JSON.stringify(["OK", frame[1].id, true, ""]),
        });
      });
    }
  }
}

function socketFactory(record) {
  return (url) => {
    const socket = new FakeSocket();
    record.push({ url, socket });
    queueMicrotask(() => {
      socket.emit("open");
      socket.emit("message", {
        data: JSON.stringify(["AUTH", "challenge-123"]),
      });
    });
    return socket;
  };
}

function client(record, overrides = {}) {
  return new MiCasaRealtimeClient({
    browserOrigin: ORIGIN,
    gatewayPath: "/api/micasa/v1/realtime",
    signer: new Signer(),
    socketFactory: socketFactory(record),
    now: () => NOW,
    ...overrides,
  });
}

test("history authenticates before REQ and verifies signed channel events", async () => {
  const sockets = [];
  const events = await client(sockets).queryChannelHistory(CHANNEL, 25);

  assert.equal(
    sockets[0].url,
    "wss://micasa.mediaglyphics.com/api/micasa/v1/realtime",
  );
  assert.deepEqual(
    sockets[0].socket.sent.map((frame) => frame[0]),
    ["AUTH", "REQ", "CLOSE"],
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].content, "A real signed household message");
  assert.equal(verifyEvent(events[0]), true);
});

test("publish signs the Buzz stream event after mandatory NIP-42 auth", async () => {
  const sockets = [];
  const mentionSecret = generateSecretKey();
  const mention = getPublicKey(mentionSecret);

  const event = await client(sockets).publishChannelMessage(
    CHANNEL,
    "  hello household  ",
    [mention, mention],
  );

  assert.deepEqual(
    sockets[0].socket.sent.map((frame) => frame[0]),
    ["AUTH", "EVENT"],
  );
  assert.equal(event.kind, 9);
  assert.equal(event.content, "hello household");
  assert.deepEqual(event.tags, [
    ["h", CHANNEL],
    ["p", mention],
  ]);
  assert.equal(verifyEvent(event), true);
});

test("a cross-origin or direct relay gateway is refused", () => {
  assert.throws(
    () =>
      new MiCasaRealtimeClient({
        browserOrigin: ORIGIN,
        gatewayPath: "wss://communities.buzz.xyz/household",
        signer: new Signer(),
      }),
    (error) =>
      error instanceof MiCasaRealtimeError &&
      error.code === "MICASA_REALTIME_GATEWAY_INVALID",
  );
});

test("NIP-07 and ephemeral fallback are not part of the signer contract", async () => {
  const sockets = [];
  const signer = new Signer();
  signer.getPublicKey = async () => "0".repeat(64);

  await assert.rejects(
    client(sockets, { signer }).queryChannelHistory(CHANNEL),
    (error) =>
      error instanceof MiCasaRealtimeError &&
      error.code === "MICASA_REALTIME_SIGNER_INVALID",
  );
  assert.deepEqual(
    sockets[0].socket.sent.map((frame) => frame[0]),
    [],
  );
});

test("an invalid or cross-channel inbound event fails closed", async () => {
  const sockets = [];
  const transport = client(sockets);
  const promise = transport.queryChannelHistory(CHANNEL);
  sockets[0].socket.channel = "room:other";

  await assert.rejects(
    promise,
    (error) =>
      error instanceof MiCasaRealtimeError &&
      error.code === "MICASA_REALTIME_CHANNEL_EVENT_INVALID",
  );
});

function flushMicrotasks() {
  return new Promise((resolve) => queueMicrotask(resolve));
}

test("live subscription authenticates, streams verified events, and closes exactly", async () => {
  const sockets = [];
  const events = [];
  const states = [];
  const subscription = await client(sockets).subscribeChannel(CHANNEL, {
    onEvent: (event) => events.push(event),
    onState: (state, error) => states.push([state, error?.code ?? null]),
  });
  await flushMicrotasks();
  await flushMicrotasks();

  const socket = sockets[0].socket;
  const request = socket.sent.find((frame) => frame[0] === "REQ");
  assert.ok(request);
  assert.deepEqual(
    socket.sent.map((frame) => frame[0]),
    ["AUTH", "REQ"],
  );
  assert.deepEqual(states, [
    ["CONNECTING", null],
    ["LIVE", null],
  ]);
  assert.equal(events.length, 1);
  assert.equal(verifyEvent(events[0]), true);

  const later = finalizeEvent(
    {
      kind: 9,
      created_at: Math.floor(NOW / 1000) + 1,
      tags: [["h", CHANNEL]],
      content: "A later signed household message",
    },
    socket.incomingSecret,
  );
  socket.emit("message", {
    data: JSON.stringify(["EVENT", request[1], later]),
  });
  assert.equal(events.length, 2);
  assert.equal(events[1].content, "A later signed household message");

  subscription.close();
  assert.deepEqual(
    socket.sent.map((frame) => frame[0]),
    ["AUTH", "REQ", "CLOSE"],
  );
  assert.deepEqual(states.at(-1), ["CLOSED", null]);
});

test("live subscription refuses a cross-room event before the observer", async () => {
  const sockets = [];
  const events = [];
  const states = [];
  const pending = client(sockets).subscribeChannel(CHANNEL, {
    onEvent: (event) => events.push(event),
    onState: (state, error) => states.push([state, error?.code ?? null]),
  });
  sockets[0].socket.channel = "room:other";
  await pending;
  await flushMicrotasks();
  await flushMicrotasks();

  assert.deepEqual(events, []);
  assert.deepEqual(states.at(-1), [
    "FAILED",
    "MICASA_REALTIME_CHANNEL_EVENT_INVALID",
  ]);
  assert.equal(sockets[0].socket.readyState, 3);
});

test("live subscription exposes relay disconnect without claiming live delivery", async () => {
  const sockets = [];
  const states = [];
  await client(sockets).subscribeChannel(CHANNEL, {
    onEvent: () => {},
    onState: (state, error) => states.push([state, error?.code ?? null]),
  });
  await flushMicrotasks();
  await flushMicrotasks();
  sockets[0].socket.emit("close");

  assert.deepEqual(states.at(-1), ["FAILED", "MICASA_REALTIME_UNAVAILABLE"]);
});
