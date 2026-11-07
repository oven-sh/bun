// Fault-injection test: requires a server that refuses / drops / sends malformed
// frames, which a healthy container will not do on demand. DO NOT COPY THIS
// PATTERN — anything a real server can produce belongs in describeWithContainer.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.
//
// A server (or MITM) that answers the client's password / SASLInitialResponse
// with another Authentication{SASL,CleartextPassword,MD5Password} request
// drove the client into an unbounded authentication loop at 100% CPU, and
// connectionTimeout never fired because every arriving packet reset the
// connect-phase timer. libpq rejects a second AuthenticationSASL with
// "duplicate SASL authentication request".
import { SQL } from "bun";
import { describe, expect, test } from "bun:test";
import { isASAN, isDebug } from "harness";
import {
  listeningServer,
  pgAuthenticationCleartextPassword,
  pgAuthenticationMD5Password,
  pgAuthenticationOk,
  pgAuthenticationSASL,
  pgAuthenticationSASLContinue,
  pgErrorResponse,
  pgInt32,
  pgParseSASLInitialResponse,
  pgParseStartupMessage,
  pgRaw,
  pgReadFrontendMessages,
  pgReadyForQuery,
  pgScramServer,
} from "./wire-frames";

/**
 * Answer the startup packet with `first`, then answer every subsequent client
 * message (PasswordMessage / SASLInitialResponse, type 'p') with `second`, up
 * to `limit` times. Resolves to the error the client surfaced and the number
 * of 'p' responses observed.
 */
async function duplicateAuthRequest(first: Buffer, second: Buffer, limit: number) {
  let responses = 0;
  const sockets = new Set<import("node:net").Socket>();
  const { port, server } = await listeningServer(socket => {
    sockets.add(socket);
    let buf = Buffer.alloc(0);
    let sawStartup = false;
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    socket.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        if (!sawStartup) {
          // StartupMessage: Int32(len) Int32(protocol) ...; no leading type byte.
          if (buf.length < 4) return;
          const len = buf.readInt32BE(0);
          if (buf.length < len) return;
          sawStartup = true;
          buf = buf.subarray(len);
          socket.write(first);
          continue;
        }
        if (buf.length < 5) return;
        const len = buf.readInt32BE(1);
        if (buf.length < 1 + len) return;
        const type = String.fromCharCode(buf[0]);
        buf = buf.subarray(1 + len);
        if (type !== "p") continue;
        responses++;
        if (responses >= limit) {
          socket.destroy();
          return;
        }
        socket.write(second);
      }
    });
  });

  const db = new SQL({
    url: `postgres://u:pw@127.0.0.1:${port}/db?sslmode=disable`,
    max: 1,
    connectionTimeout: 30,
  });
  let err: any;
  try {
    await db.connect();
    err = new Error("expected connect() to reject");
  } catch (e) {
    err = e;
  } finally {
    await db.close({ timeout: 0 });
    for (const s of sockets) s.destroy();
    await new Promise<void>(r => server.close(() => r()));
  }
  return { err, responses };
}

const methods = [
  { name: "AuthenticationSASL", frame: pgAuthenticationSASL() },
  { name: "AuthenticationCleartextPassword", frame: pgAuthenticationCleartextPassword() },
  { name: "AuthenticationMD5Password", frame: pgAuthenticationMD5Password() },
];

test.each(methods)("postgres: duplicate $name is rejected, not answered again", async ({ frame }) => {
  const { err, responses } = await duplicateAuthRequest(frame, frame, 50);
  // The client must answer the first request (responses == 1) and then error
  // on the duplicate without answering it. Before the fix `responses` hit the
  // limit in a few milliseconds.
  expect({ code: err.code, responses }).toEqual({
    code: "ERR_POSTGRES_UNEXPECTED_MESSAGE",
    responses: 1,
  });
});

// Mixed sequences: a second authentication-start message of any kind after
// a first of a different kind is equally a protocol violation.
const mixed = [
  { name: "SASL after CleartextPassword", first: pgAuthenticationCleartextPassword(), second: pgAuthenticationSASL() },
  { name: "CleartextPassword after SASL", first: pgAuthenticationSASL(), second: pgAuthenticationCleartextPassword() },
  { name: "MD5Password after SASL", first: pgAuthenticationSASL(), second: pgAuthenticationMD5Password() },
];

test.each(mixed)("postgres: $name is rejected", async ({ first, second }) => {
  const { err, responses } = await duplicateAuthRequest(first, second, 50);
  expect({ code: err.code, responses }).toEqual({
    code: "ERR_POSTGRES_UNEXPECTED_MESSAGE",
    responses: 1,
  });
});

// Boundary: the normal single-request flow for each method still connects.
async function singleRequestConnects(request: Buffer) {
  const { port, server } = await listeningServer(socket => {
    let sawStartup = false;
    socket.on("error", () => {});
    socket.on("data", () => {
      if (!sawStartup) {
        sawStartup = true;
        socket.write(request);
        return;
      }
      socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
    });
  });
  const db = new SQL({
    url: `postgres://u:pw@127.0.0.1:${port}/db?sslmode=disable`,
    max: 1,
    connectionTimeout: 30,
  });
  try {
    await expect(db.connect()).resolves.toBeDefined();
  } finally {
    await db.close({ timeout: 0 });
    await new Promise<void>(r => server.close(() => r()));
  }
}

test("postgres: a single AuthenticationCleartextPassword still connects", async () => {
  await singleRequestConnects(pgAuthenticationCleartextPassword());
});

test("postgres: a single AuthenticationMD5Password still connects", async () => {
  await singleRequestConnects(pgAuthenticationMD5Password());
});

test("postgres: connectionTimeout bounds the whole handshake, not per packet", async () => {
  // Server that answers the startup packet with AuthenticationCleartextPassword,
  // then trickles the next response one byte at a time, each well under
  // connectionTimeout, never completing a message. Before the fix each byte
  // re-armed the connect timer so the client waited indefinitely; now it fails
  // once the overall deadline passes.
  const sockets = new Set<import("node:net").Socket>();
  const { port, server } = await listeningServer(socket => {
    sockets.add(socket);
    let phase = 0;
    let id: ReturnType<typeof setInterval> | undefined;
    socket.on("error", () => {});
    socket.on("close", () => {
      if (id) clearInterval(id);
      sockets.delete(socket);
    });
    socket.on("data", () => {
      if (phase === 0) {
        phase = 1;
        socket.write(pgAuthenticationCleartextPassword());
      } else if (phase === 1) {
        phase = 2;
        // Announce an Authentication ('R') message with a huge body so the
        // client buffers indefinitely awaiting bytes that never complete.
        socket.write(pgRaw("R", Buffer.alloc(0), 1 << 20));
        id = setInterval(() => {
          if (!socket.destroyed) socket.write(Buffer.from([0]));
        }, 200);
      }
    });
  });

  const t0 = performance.now();
  const db = new SQL({
    url: `postgres://u:pw@127.0.0.1:${port}/db?sslmode=disable`,
    max: 1,
    connectionTimeout: 1,
  });
  try {
    const err = await db.connect().then(
      () => ({ code: "UNEXPECTED_SUCCESS" }),
      (e: any) => ({ code: e?.code ?? String(e) }),
    );
    const elapsed = performance.now() - t0;
    expect(err).toEqual({ code: "ERR_POSTGRES_CONNECTION_TIMEOUT" });
    expect(elapsed).toBeLessThan(8000);
  } finally {
    await db.close({ timeout: 0 });
    for (const s of sockets) s.destroy();
    await new Promise<void>(r => server.close(() => r()));
  }
});

/** Connects to a `pgScramServer`. Resolves to what connect() rejected with and whether the client sent a proof. */
async function handshake(options: Parameters<typeof pgScramServer>[0]) {
  await using server = await pgScramServer(options);
  const db = new SQL({
    url: `postgres://u:${options.password}@127.0.0.1:${server.port}/db?sslmode=disable`,
    max: 1,
    connectionTimeout: 30,
  });
  try {
    const error = await db.connect().then(
      () => null,
      (e: any) => ({ name: e.name, code: e.code, message: e.message }),
    );
    return { error, proofOk: server.exchanges[0].proofOk };
  } finally {
    await db.close({ timeout: 0 });
  }
}

// The server picks the iteration count.
describe.concurrent("postgres: SCRAM-SHA-256 iteration count", () => {
  test("4096 is accepted", async () => {
    expect(await handshake({ password: "pw", iterations: 4096 })).toEqual({ error: null, proofOk: true });
  });

  test.each([0, 1, 4095, 10_000_001])("%d is refused before any proof is computed", async iterations => {
    expect(await handshake({ password: "pw", iterations })).toEqual({
      error: {
        name: "PostgresError",
        code: "ERR_POSTGRES_SASL_ITERATION_COUNT_OUT_OF_RANGE",
        message: `SCRAM-SHA-256 iteration count ${iterations} is out of range: it must be between 4096 and 10000000`,
      },
      proofOk: null,
    });
  });
});

// PBKDF2 with 10,000,000 iterations holds the thread for over a second on a release build and for half a minute on a
// debug one, so nothing runs next to this test and the mock does not compute the proof a second time to check it.
test.skipIf(isDebug || isASAN)("postgres: SCRAM-SHA-256 iteration count 10000000 is accepted", async () => {
  const proof = Promise.withResolvers<string>();
  const { port, server } = await listeningServer(socket => {
    let buffered = Buffer.alloc(0);
    let state: "startup" | "first" | "final" = "startup";
    socket.on("error", () => {});
    socket.on("data", chunk => {
      buffered = Buffer.concat([buffered, chunk]);
      if (state === "startup") {
        const startup = pgParseStartupMessage(buffered);
        if (!startup) return;
        buffered = startup.rest;
        state = "first";
        socket.write(pgAuthenticationSASL());
      }
      buffered = pgReadFrontendMessages(buffered, (type, body) => {
        if (type !== 0x70 /* 'p' */) return;
        if (state === "final") {
          proof.resolve(body.toString());
          socket.end(pgErrorResponse({ S: "FATAL", C: "28P01", M: "the mock verifies nothing" }));
          return;
        }
        state = "final";
        const nonce = pgParseSASLInitialResponse(body)
          .clientFirstMessage.split(",")
          .find(attribute => attribute.startsWith("r="));
        socket.write(pgAuthenticationSASLContinue(`${nonce}server,s=${btoa("salt")},i=10000000`));
      });
    });
  });
  const db = new SQL({ url: `postgres://u:pw@127.0.0.1:${port}/db?sslmode=disable`, max: 1, connectionTimeout: 30 });
  try {
    db.connect().catch(() => {});
    expect(await proof.promise).toMatch(/,p=[A-Za-z0-9+/]{43}=$/);
  } finally {
    await db.close({ timeout: 0 });
    server.close();
  }
});

// §55.7: AuthenticationKerberosV5 is Int32(2), AuthenticationGSS Int32(7), AuthenticationSSPI Int32(9).
test.concurrent.each([
  [2, "Kerberos V5"],
  [7, "GSSAPI"],
  [9, "SSPI"],
])("postgres: the error for authentication request %d names the method", async (request, method) => {
  expect(await handshake({ password: "pw", first: pgRaw("R", pgInt32(request)) })).toEqual({
    error: {
      name: "PostgresError",
      code: "ERR_POSTGRES_UNSUPPORTED_AUTHENTICATION_METHOD",
      message: `${method} authentication is not supported`,
    },
    proofOk: null,
  });
});
