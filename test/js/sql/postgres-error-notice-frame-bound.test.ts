// Fault-injection test: requires a server that sends ErrorResponse /
// NoticeResponse bodies a healthy container will not produce on demand.
// DO NOT COPY THIS PATTERN — anything a real server can produce belongs in
// describeWithContainer. All wire-protocol bytes come from
// test/js/sql/wire-frames.ts; do not inline Buffer.alloc frame construction here.
//
// ErrorResponse / NoticeResponse bodies are a sequence of (Byte1 code, String
// value) pairs terminated by a zero byte (§55.7). The old decoder scanned the
// connection buffer for field terminators without bounding to the message's
// declared Int32 length, and additionally stopped early on an empty field
// value. Either way the reader was left mid-frame, so the next dispatch read
// body bytes as a new message type and the connection wedged.
import { SQL } from "bun";
import { afterAll, expect, test } from "bun:test";
import { listeningServer, pgAuthenticationOk, pgCString, pgRaw, pgReadyForQuery } from "./wire-frames";

// One mock server for the file; each test sets `current` before connecting.
let current!: { atStartup: Buffer[] };
const { port, server } = await listeningServer(socket => {
  const { atStartup } = current;
  socket.once("data", () => {
    socket.write(Buffer.concat([pgAuthenticationOk(), ...atStartup]));
  });
  socket.on("error", () => {});
});
afterAll(() => new Promise<void>(r => server.close(() => r())));

// Build an ErrorResponse/NoticeResponse body from (code, value) pairs. Values
// may be empty; the terminator is a single zero byte.
function fieldBody(fields: [string, string][]): Buffer {
  return Buffer.concat([
    ...fields.map(([k, v]) => Buffer.concat([Buffer.from(k, "latin1"), pgCString(v)])),
    Buffer.from([0]),
  ]);
}

// A NoticeResponse with an empty Hint ('H') field in the middle is protocol-
// legal. Previously the empty value ended parsing early, so the trailing
// "C00000\0Mmsg\0\0" bytes were dispatched as a CommandComplete ('C') and the
// connection desynced.
test("postgres: NoticeResponse with an empty field value does not desync the connection", async () => {
  current = {
    atStartup: [
      pgRaw(
        "N",
        fieldBody([
          ["S", "NOTICE"],
          ["H", ""],
          ["C", "00000"],
          ["M", "msg"],
        ]),
      ),
      pgReadyForQuery(),
    ],
  };
  const db = new SQL({ url: `postgres://postgres@127.0.0.1:${port}/postgres`, max: 1, connectionTimeout: 2 });
  try {
    await expect(db.connect()).resolves.toBeDefined();
  } finally {
    await db.close({ timeout: 0 });
  }
});

// A NoticeResponse whose declared length is longer than its field list (padding
// bytes after the terminator) must consume the whole frame so the following
// ReadyForQuery stays aligned.
test("postgres: NoticeResponse with trailing bytes after the field terminator is bounded to its declared length", async () => {
  const body = Buffer.concat([
    fieldBody([
      ["S", "NOTICE"],
      ["M", "msg"],
    ]),
    Buffer.from([0x7a, 0x7a, 0x7a]),
  ]);
  current = { atStartup: [pgRaw("N", body), pgReadyForQuery()] };
  const db = new SQL({ url: `postgres://postgres@127.0.0.1:${port}/postgres`, max: 1, connectionTimeout: 2 });
  try {
    await expect(db.connect()).resolves.toBeDefined();
  } finally {
    await db.close({ timeout: 0 });
  }
});
