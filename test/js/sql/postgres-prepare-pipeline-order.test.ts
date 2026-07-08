// Fault-injection test: a real Postgres answers Parse+Describe+Sync with
// ParseComplete / ParameterDescription / RowDescription / ReadyForQuery in one
// round trip, but TCP may split that reply across several recv() calls. When
// ParameterDescription and ReadyForQuery land in separate reads, the shared
// prepared statement is already marked Prepared while the originating query's
// Bind+Execute has not yet been written (that happens on ReadyForQuery).
// The connection's WAITING_TO_PREPARE flag must stay set through that window
// so a second query for the same statement does not take do_run()'s
// can_pipeline() fast path and put its Bind on the wire ahead of the first
// one; responses are attributed to the FIFO request queue, so an out-of-order
// Bind delivers one query's rows to another.
import { SQL } from "bun";
import { expect, test } from "bun:test";
import type net from "node:net";
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

// Read the first bound parameter value out of a Bind ('B') message body.
// PostgreSQL FE/BE protocol §55.7 Bind: String(portal) String(statement)
// Int16(nFormats) Int16[nFormats] Int16(nParams) (Int32(len) Byte[len])[nParams] ...
function pgBindFirstParam(body: Buffer): Buffer {
  let o = body.indexOf(0, 0) + 1; // portal name
  o = body.indexOf(0, o) + 1; // statement name
  const nFormats = body.readInt16BE(o);
  o += 2 + nFormats * 2;
  o += 2; // nParams
  const plen = body.readInt32BE(o);
  o += 4;
  return body.subarray(o, o + plen);
}

type PreparePipelineServer = {
  port: number;
  server: net.Server;
  /** Resolves once ParseComplete+ParameterDescription+RowDescription have been written. */
  wrotePrepareHead: Promise<void>;
  /** Call to release the delayed ReadyForQuery that completes the prepare round trip. */
  releasePrepare: () => void;
  /** Bound parameter of each Bind the server has seen, in wire order. */
  bindOrder: string[];
};

// A strictly serial fake server that answers one Parse+Describe+Sync and any
// number of Bind+Execute+Sync groups, echoing each Bind's parameter back as the
// single row. The prepare reply is deliberately split: the describe half is
// written immediately, ReadyForQuery is held until `releasePrepare()`.
async function preparePipelineServer(): Promise<PreparePipelineServer> {
  const wrotePrepareHead = Promise.withResolvers<void>();
  const releasePrepare = Promise.withResolvers<void>();
  const bindOrder: string[] = [];
  const rowDesc = pgRowDescription([{ name: "v", typeOid: 25 /* text */ }]);

  const { port, server } = await listeningServer(socket => {
    let startup = true;
    let buffered = Buffer.alloc(0);
    let parsePending = false;
    const pendingBinds: Buffer[] = [];
    let draining = false;

    const drain = async () => {
      if (draining) return;
      draining = true;
      try {
        while (buffered.length >= 5) {
          const len = 1 + buffered.readInt32BE(1);
          if (buffered.length < len) return;
          const tag = buffered[0];
          const body = buffered.subarray(5, len);
          buffered = buffered.subarray(len);

          if (tag === 0x50 /* 'P' */) {
            parsePending = true;
          } else if (tag === 0x42 /* 'B' */) {
            const v = pgBindFirstParam(body);
            pendingBinds.push(v);
            bindOrder.push(v.toString());
          } else if (tag === 0x53 /* 'S' (Sync) */) {
            if (parsePending) {
              parsePending = false;
              socket.write(Buffer.concat([pgParseComplete(), pgParameterDescription([25]), rowDesc]));
              wrotePrepareHead.resolve();
              await releasePrepare.promise;
              socket.write(pgReadyForQuery());
            } else {
              const v = pendingBinds.shift()!;
              socket.write(
                Buffer.concat([pgBindComplete(), pgDataRow([v]), pgCommandComplete("SELECT 1"), pgReadyForQuery()]),
              );
            }
          }
          // 'D' (Describe), 'E' (Execute), 'H' (Flush): no standalone reply.
        }
      } finally {
        draining = false;
      }
    };

    socket.on("error", () => {});
    socket.on("data", chunk => {
      if (startup) {
        startup = false;
        socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
        return;
      }
      buffered = Buffer.concat([buffered, chunk]);
      void drain();
    });
  });

  return {
    port,
    server,
    wrotePrepareHead: wrotePrepareHead.promise,
    releasePrepare: () => releasePrepare.resolve(),
    bindOrder,
  };
}

const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test("postgres: a query issued between ParameterDescription and ReadyForQuery does not overtake the preparing query", async () => {
  const srv = await preparePipelineServer();
  await using sql = new SQL({
    url: `postgres://u@127.0.0.1:${srv.port}/db`,
    max: 1,
    connectionTimeout: 5,
    idleTimeout: 5,
  });
  try {
    const a = sql`SELECT ${"AAAA"}::text AS v`;
    a.catch(() => {});

    // Let the client consume ParseComplete+ParameterDescription+RowDescription so
    // the shared statement is marked Prepared.
    await srv.wrotePrepareHead;
    await tick();
    await tick();

    // Second query, same text. With the bug, this writes Bind+Execute now,
    // before A has written its own, because WAITING_TO_PREPARE was cleared
    // early and can_pipeline() lets it through.
    const b = sql`SELECT ${"BBBB"}::text AS v`;
    b.catch(() => {});
    await tick();
    await tick();

    srv.releasePrepare();
    const [ra, rb] = await Promise.all([a, b]);

    // Each query must resolve with the value it bound, and the Binds must reach
    // the server in issue order. Before the fix:
    //   bindOrder = ["BBBB", "AAAA"], a = {v: "BBBB"}, b = {v: "AAAA"}.
    expect({ a: ra[0], b: rb[0], bindOrder: srv.bindOrder }).toEqual({
      a: { v: "AAAA" },
      b: { v: "BBBB" },
      bindOrder: ["AAAA", "BBBB"],
    });
  } finally {
    await sql.close({ timeout: 0 });
    await new Promise<void>(r => srv.server.close(() => r()));
  }
});

// Three queries sharing one statement, all issued inside the same window.
// Before the fix this is the "SELECT that fulfils with zero rows" shape from
// the report: the server answered three Binds but the rotation left one query
// with another's (possibly shorter) result set.
test("postgres: three same-statement queries issued during the prepare window keep issue order on the wire", async () => {
  const srv = await preparePipelineServer();
  await using sql = new SQL({
    url: `postgres://u@127.0.0.1:${srv.port}/db`,
    max: 1,
    connectionTimeout: 5,
    idleTimeout: 5,
  });
  try {
    const a = sql`SELECT ${"AAAA"}::text AS v`;
    a.catch(() => {});

    await srv.wrotePrepareHead;
    await tick();
    await tick();

    const b = sql`SELECT ${"BBBB"}::text AS v`;
    const c = sql`SELECT ${"CCCC"}::text AS v`;
    b.catch(() => {});
    c.catch(() => {});
    await tick();
    await tick();

    srv.releasePrepare();
    const [ra, rb, rc] = await Promise.all([a, b, c]);

    expect({ a: ra[0], b: rb[0], c: rc[0], bindOrder: srv.bindOrder }).toEqual({
      a: { v: "AAAA" },
      b: { v: "BBBB" },
      c: { v: "CCCC" },
      bindOrder: ["AAAA", "BBBB", "CCCC"],
    });
  } finally {
    await sql.close({ timeout: 0 });
    await new Promise<void>(r => srv.server.close(() => r()));
  }
});
