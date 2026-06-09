// https://github.com/oven-sh/bun/issues/32004
//
// Under concurrency, a Bun.SQL postgres pool could permanently stall when
// sql.begin() transactions ran alongside pooled prepared-statement queries:
//
// 1. release() handed an idle connection to a waiting sql.begin() but did not
//    remove it from readyConnections, and flushConcurrentQueries() did not
//    filter reserved connections, so pooled queries kept getting distributed
//    onto the transaction's connection.
// 2. The native queue's pipelining fast path could then write a prepared
//    query's Bind+Execute to the wire while an earlier queued simple-protocol
//    request (e.g. the transaction's COMMIT) was still unwritten. Responses
//    are matched to requests in FIFO queue order, so the unwritten request
//    stole the pipelined query's result: the transaction "committed" without
//    COMMIT ever reaching the server (left "idle in transaction"), the
//    nonpipelinable request counter underflowed, and the connection wedged
//    forever while the stolen-from query waited for a connection that never
//    came back.
//
// The test runs a scripted mock postgres server so both sides of the race are
// deterministic: the mock holds one query's response until a control query on
// a second connection arrives, which forces the exact interleaving.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import net from "node:net";
import path from "node:path";

function pkt(type: string, body: Buffer = Buffer.alloc(0)): Buffer {
  const header = Buffer.alloc(5);
  header.write(type, 0);
  header.writeInt32BE(body.length + 4, 1);
  return Buffer.concat([header, body]);
}

function int16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeInt16BE(n, 0);
  return b;
}

function int32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n, 0);
  return b;
}

function cstr(s: string): Buffer {
  return Buffer.concat([Buffer.from(s), Buffer.from([0])]);
}

const authenticationOk = pkt("R", int32(0));
const readyForQuery = pkt("Z", Buffer.from("I"));
const parseComplete = pkt("1");
const bindComplete = pkt("2");
// zero result columns for every statement: no DataRow needed
const rowDescription = pkt("T", int16(0));
const commandComplete = (tag: string) => pkt("C", cstr(tag));
const parameterDescription = (oids: number[]) => pkt("t", Buffer.concat([int16(oids.length), ...oids.map(int32)]));

interface Frame {
  type: string;
  body: Buffer;
}

interface Conn {
  socket: net.Socket;
  buf: Buffer;
  sawStartup: boolean;
  frames: Frame[];
  busy: boolean;
  // prepared statement name -> { query text, declared param oids }
  statements: Map<string, { query: string; oids: number[] }>;
  // wire-order log of P/B/E/Q frames for assertions
  log: string[];
}

function readCStr(buf: Buffer, offset: number): [string, number] {
  const end = buf.indexOf(0, offset);
  return [buf.toString("utf8", offset, end), end + 1];
}

test("pool does not stall when sql.begin() runs concurrently with pooled prepared queries", async () => {
  const conns: Conn[] = [];
  const release = Promise.withResolvers<void>();
  let armed = false;
  let released = false;

  async function handleFrame(conn: Conn, frame: Frame) {
    const { type, body } = frame;
    switch (type) {
      case "P": {
        // Parse: name, query, nParams, oids
        const [name, afterName] = readCStr(body, 0);
        const [query, afterQuery] = readCStr(body, afterName);
        const nParams = body.readInt16BE(afterQuery);
        const oids: number[] = [];
        for (let i = 0; i < nParams; i++) {
          oids.push(body.readInt32BE(afterQuery + 2 + i * 4));
        }
        conn.statements.set(name, { query, oids });
        conn.log.push(`P:${query}`);
        conn.socket.write(parseComplete);
        break;
      }
      case "D": {
        // Describe statement: echo the Parse-declared param oids, zero columns
        const [name] = readCStr(body, 1);
        const stmt = conn.statements.get(name);
        conn.socket.write(Buffer.concat([parameterDescription(stmt ? stmt.oids : []), rowDescription]));
        break;
      }
      case "B": {
        // Bind: portal, statement name
        const [, afterPortal] = readCStr(body, 0);
        const [name] = readCStr(body, afterPortal);
        const stmt = conn.statements.get(name);
        const query = stmt ? stmt.query : "";
        conn.log.push(`B:${query}`);
        if (query.includes("hold_me") && armed && !released) {
          // act like a slow query: block this connection (and everything
          // queued after it) until the control query arrives
          await release.promise;
        }
        conn.socket.write(bindComplete);
        break;
      }
      case "E": {
        conn.log.push("E");
        conn.socket.write(commandComplete("SELECT 0"));
        break;
      }
      case "S": {
        conn.socket.write(readyForQuery);
        break;
      }
      case "Q": {
        const [query] = readCStr(body, 0);
        conn.log.push(`Q:${query}`);
        if (query.includes("ctl:arm_hold")) {
          armed = true;
        }
        if (query.includes("ctl:release_slow")) {
          released = true;
          release.resolve();
        }
        let tag = "SELECT 1";
        const first = query.trimStart().slice(0, 8).toUpperCase();
        if (first.startsWith("BEGIN")) tag = "BEGIN";
        else if (first.startsWith("COMMIT")) tag = "COMMIT";
        else if (first.startsWith("ROLLBACK")) tag = "ROLLBACK";
        conn.socket.write(Buffer.concat([commandComplete(tag), readyForQuery]));
        break;
      }
      case "H": // Flush: no response
      case "X": // Terminate
        break;
      default:
        break;
    }
  }

  async function pump(conn: Conn) {
    if (conn.busy) return;
    conn.busy = true;
    while (conn.frames.length > 0) {
      await handleFrame(conn, conn.frames.shift()!);
    }
    conn.busy = false;
  }

  const server = net.createServer(socket => {
    const conn: Conn = {
      socket,
      buf: Buffer.alloc(0),
      sawStartup: false,
      frames: [],
      busy: false,
      statements: new Map(),
      log: [],
    };
    conns.push(conn);
    socket.on("error", () => {});
    socket.on("data", data => {
      conn.buf = Buffer.concat([conn.buf, data]);
      while (true) {
        if (!conn.sawStartup) {
          if (conn.buf.length < 4) break;
          const len = conn.buf.readInt32BE(0);
          if (conn.buf.length < len) break;
          conn.buf = conn.buf.subarray(len);
          conn.sawStartup = true;
          socket.write(Buffer.concat([authenticationOk, readyForQuery]));
          continue;
        }
        if (conn.buf.length < 5) break;
        const len = conn.buf.readInt32BE(1);
        if (conn.buf.length < len + 1) break;
        conn.frames.push({
          type: conn.buf.toString("utf8", 0, 1),
          body: conn.buf.subarray(5, len + 1),
        });
        conn.buf = conn.buf.subarray(len + 1);
      }
      pump(conn).catch(() => {});
    });
  });

  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;

  try {
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(import.meta.dir, "postgres-pool-transaction-stall-fixture.ts")],
      env: {
        ...bunEnv,
        DATABASE_URL: `postgres://bun:bun@127.0.0.1:${port}/bun?sslmode=disable`,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // every stage of the fixture must have completed (sorted: the relative
    // order of "released" and "victim resolved" legitimately depends on
    // scheduling)
    expect({
      steps: stdout
        .split(/\r?\n/)
        .filter(line => line.startsWith("STEP ") || line === "DONE")
        .sort()
        .join("\n"),
      stderr: stderr.includes("WATCHDOG") ? "WATCHDOG" : "",
      exitCode,
    }).toEqual({
      steps: [
        "STEP prepared",
        "STEP armed",
        "STEP p0 done",
        "STEP body gate",
        "STEP released",
        "STEP victim resolved",
        "STEP fast resolved",
        "STEP slow resolved",
        "STEP tx resolved",
        "STEP pool alive",
        "DONE",
      ]
        .sort()
        .join("\n"),
      stderr: "",
      exitCode: 0,
    });

    // wire-order assertions on the transaction's connection: while the
    // transaction owns the connection, no pooled query may be written to it,
    // and COMMIT must actually reach the server
    const txConn = conns.find(c => c.log.some(entry => entry === "Q:BEGIN"));
    expect(txConn).toBeDefined();
    const log = txConn!.log;
    const beginIndex = log.indexOf("Q:BEGIN");
    const commitIndex = log.indexOf("Q:COMMIT");
    expect(commitIndex).toBeGreaterThan(beginIndex);
    expect(log.slice(beginIndex + 1, commitIndex)).toEqual(["Q:select 641 as victim_q"]);
  } finally {
    release.resolve();
    server.close();
  }
});
