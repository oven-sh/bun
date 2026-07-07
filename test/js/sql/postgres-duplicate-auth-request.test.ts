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
import { expect, test } from "bun:test";
import {
  listeningServer,
  pgAuthenticationCleartextPassword,
  pgAuthenticationMD5Password,
  pgAuthenticationOk,
  pgAuthenticationSASL,
  pgReadyForQuery,
} from "./wire-frames";

/**
 * Answer the startup packet with `first`, then answer every subsequent client
 * message (PasswordMessage / SASLInitialResponse, type 'p') with `second`, up
 * to `limit` times. Resolves to the error the client surfaced and the number
 * of 'p' responses observed.
 */
async function duplicateAuthRequest(first: Buffer, second: Buffer, limit: number) {
  let responses = 0;
  const { port, server } = await listeningServer(socket => {
    let buf = Buffer.alloc(0);
    let sawStartup = false;
    socket.on("error", () => {});
    socket.on("data", chunk => {
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
    connectionTimeout: 2,
  });
  let err: any;
  try {
    await db.connect();
    err = new Error("expected connect() to reject");
  } catch (e) {
    err = e;
  } finally {
    await db.close({ timeout: 0 });
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
    connectionTimeout: 2,
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
