// Under ordinary send-side backpressure (a partial send() return), a query
// enqueued while HAS_BACKPRESSURE is set stays Pending in the connection's
// request queue with no bytes in write_buffer yet. When backpressure clears,
// do_run() for a *later* query can observe can_pipeline() == true and write
// its Bind straight into the buffer, overtaking the Pending entry on the wire.
// Responses are matched to current() (queue head), so the Pending query is
// resolved with the later query's row and its own Bind is never sent. A
// try/catch, a server, and a proxy all see a clean stream; only the returned
// row is wrong.
//
// Fault-injection test: a healthy container does not hand back 17-byte sends on
// demand, so the short-send is produced with socketFaultInjection in a
// subprocess. DO NOT COPY THIS PATTERN for anything a real server can produce;
// that belongs in describeWithContainer.

import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { join } from "node:path";
import {
  listeningServer,
  pgAuthenticationOk,
  pgBindComplete,
  pgCommandComplete,
  pgDataRow,
  pgParameterDescription,
  pgParseComplete,
  pgReadyForQuery,
  pgRowDescription,
} from "./wire-frames";

const skip = !fault.available() || isWindows;

// PostgreSQL frontend messages are Byte1(type) Int32(len) body[len-4]; the
// StartupMessage (first thing on the connection) has no type byte.
function readFrontend(buf: Buffer, expectStartup: boolean) {
  const msgs: { type: string; body: Buffer }[] = [];
  let i = 0;
  while (i < buf.length) {
    if (expectStartup) {
      if (buf.length - i < 4) break;
      const len = buf.readInt32BE(i);
      if (buf.length - i < len) break;
      msgs.push({ type: "startup", body: buf.subarray(i + 4, i + len) });
      i += len;
      expectStartup = false;
      continue;
    }
    if (buf.length - i < 5) break;
    const type = String.fromCharCode(buf[i]);
    const len = buf.readInt32BE(i + 1);
    if (len < 4 || buf.length - i - 1 < len) break;
    msgs.push({ type, body: buf.subarray(i + 5, i + 1 + len) });
    i += 1 + len;
  }
  return { msgs, rest: buf.subarray(i), expectStartup };
}

// Bind body: portal\0 stmt\0 Int16(nFmt) Int16[nFmt] Int16(nParams)
// then per param: Int32(len) bytes[len]. We only need the first param.
function firstBindParam(body: Buffer): string {
  let p = body.indexOf(0) + 1;
  p = body.indexOf(0, p) + 1;
  const nFmt = body.readInt16BE(p);
  p += 2 + 2 * nFmt;
  const nParams = body.readInt16BE(p);
  p += 2;
  if (nParams === 0) return "";
  const l = body.readInt32BE(p);
  p += 4;
  return body.subarray(p, p + l).toString("utf-8");
}

// Minimal extended-protocol backend: answers Parse/Describe once, then echoes
// each Bind's first parameter back as a one-column text DataRow.
async function startEchoBackend() {
  return listeningServer(socket => {
    socket.on("error", () => {});
    let buffered = Buffer.alloc(0);
    let expectStartup = true;
    let lastParam = "";
    socket.on("data", chunk => {
      buffered = Buffer.concat([buffered, chunk]);
      const r = readFrontend(buffered, expectStartup);
      buffered = r.rest;
      expectStartup = r.expectStartup;
      const reply: Buffer[] = [];
      for (const m of r.msgs) {
        if (m.type === "startup") {
          reply.push(pgAuthenticationOk(), pgReadyForQuery());
        } else if (m.type === "P") {
          reply.push(pgParseComplete());
        } else if (m.type === "D") {
          reply.push(
            pgParameterDescription([25]),
            pgRowDescription([{ name: "v", typeOid: 25 }]),
          );
        } else if (m.type === "B") {
          lastParam = firstBindParam(m.body);
          reply.push(pgBindComplete());
        } else if (m.type === "E") {
          reply.push(pgDataRow([Buffer.from(lastParam)]), pgCommandComplete("SELECT 1"));
        } else if (m.type === "S") {
          reply.push(pgReadyForQuery());
        }
      }
      if (reply.length) socket.write(Buffer.concat(reply));
    });
  });
}

test.skipIf(skip)(
  "postgres: pipelined queries are not reordered past a Pending entry after a short send()",
  async () => {
    const { port, server } = await startEchoBackend();
    try {
      await using proc = Bun.spawn({
        cmd: [bunExe(), join(import.meta.dir, "postgres-pipeline-short-send-fixture.ts")],
        env: { ...bunEnv, MOCK_PG_PORT: String(port) },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        proc.stdout.text(),
        proc.stderr.text(),
        proc.exited,
      ]);
      expect({
        stdout: stdout.trim(),
        signalCode: proc.signalCode,
        exitCode,
        stderrTail: exitCode === 0 ? "" : stderr.slice(-2000),
      }).toEqual({ stdout: "OK", signalCode: null, exitCode: 0, stderrTail: "" });
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  },
  180_000,
);
