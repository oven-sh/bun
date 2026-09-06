// Bind parameters are encoded straight into the connection's write buffer.
// When a parameter throws while it is encoded (a `toString` that throws, an
// array with a throwing getter), the query rejects with that error, but the
// partial Bind message (header with length 0, the portal and statement names,
// the format codes, the parameters before the bad one) stayed in the buffer.
// The next query's bytes followed it on the wire. A real server reads the
// zero length as a protocol violation and drops the connection, so every
// query pipelined behind the bad one failed too.
//
// The fix records the buffer offset before a Parse/Bind/Execute group is
// written and truncates back to it when any part of the group fails.
import { SQL } from "bun";
import { describe, expect, test } from "bun:test";
import { describeWithContainer } from "harness";
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

const throwingToString = {
  toString() {
    throw new Error("boom from toString");
  },
};

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  const url = () => `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`;

  test("a parameter that throws while encoded does not break the queries pipelined behind it", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1, idleTimeout: 5, connectionTimeout: 5 });

    await sql`SELECT ${"warm"}::text AS v`;

    const bad = sql`SELECT ${"a"}::text AS v, ${throwingToString}::text AS w`;
    const sibling1 = sql`SELECT ${"x"}::text AS v`;
    const sibling2 = sql`SELECT ${"y"}::text AS v`;

    const [badResult, s1, s2] = await Promise.all([
      bad.then(
        () => "resolved",
        e => e.message,
      ),
      sibling1,
      sibling2,
    ]);
    expect({ badResult, s1, s2 }).toEqual({
      badResult: "boom from toString",
      s1: [{ v: "x" }],
      s2: [{ v: "y" }],
    });

    // The connection is still usable afterwards.
    expect(await sql`SELECT ${"after"}::text AS v`).toEqual([{ v: "after" }]);
  });

  test("a throwing parameter on the first execution of a statement does not break the next query", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1, idleTimeout: 5, connectionTimeout: 5 });

    // No warm-up: the statement is prepared and bound in the same batch.
    const bad = sql`SELECT ${"a"}::text AS v, ${throwingToString}::text AS w, ${1}::int AS n`;
    const sibling = sql`SELECT ${"x"}::text AS v`;

    const [badResult, s] = await Promise.all([
      bad.then(
        () => "resolved",
        e => e.message,
      ),
      sibling,
    ]);
    expect({ badResult, s }).toEqual({ badResult: "boom from toString", s: [{ v: "x" }] });
  });
});

describe("postgres bind encode failure (mock server)", () => {
  // Records every frontend message bun sends as "<type>" or, when the length
  // field is not a valid message length, "<type>(len=<n>)". A partial Bind
  // shows up as "B(len=0)".
  async function mockServer(): Promise<{ port: number; server: import("node:net").Server; received: string[] }> {
    const received: string[] = [];
    const { port, server } = await listeningServer(socket => {
      let buffered = Buffer.alloc(0);
      let startup = true;
      let paramCount = 0;
      socket.on("data", (chunk: Buffer) => {
        buffered = Buffer.concat([buffered, chunk]);
        const out: Buffer[] = [];
        for (;;) {
          if (startup) {
            if (buffered.length < 4 || buffered.length < buffered.readInt32BE(0)) break;
            buffered = buffered.subarray(buffered.readInt32BE(0));
            startup = false;
            out.push(pgAuthenticationOk(), pgReadyForQuery());
            continue;
          }
          if (buffered.length < 5) break;
          const type = String.fromCharCode(buffered[0]);
          const len = buffered.readInt32BE(1);
          if (len < 4) {
            received.push(`${type}(len=${len})`);
            buffered = buffered.subarray(5);
            continue;
          }
          if (buffered.length < 1 + len) break;
          const body = buffered.subarray(5, 1 + len);
          buffered = buffered.subarray(1 + len);
          received.push(type);
          switch (type) {
            case "P":
              paramCount = (body.toString("latin1").match(/\$\d+/g) ?? []).length;
              out.push(pgParseComplete());
              break;
            case "D":
              out.push(
                pgParameterDescription(Array(paramCount).fill(25)),
                pgRowDescription([{ name: "v", typeOid: 25 }]),
              );
              break;
            case "B":
              out.push(pgBindComplete());
              break;
            case "E":
              out.push(pgDataRow([Buffer.from("1")]), pgCommandComplete("SELECT 1"));
              break;
            case "S":
              out.push(pgReadyForQuery());
              break;
          }
        }
        if (out.length) socket.write(Buffer.concat(out));
      });
      socket.on("error", () => {});
    });
    return { port, server, received };
  }

  test("no partial Bind reaches the wire when a parameter throws", async () => {
    const { port, server, received } = await mockServer();
    try {
      await using sql = new SQL({
        url: `postgres://user@127.0.0.1:${port}/db`,
        max: 1,
        idleTimeout: 2,
        connectionTimeout: 5,
      });
      await sql`select ${"w"}`;
      const bad = sql`select ${"a"}, ${throwingToString}`.then(
        () => "resolved",
        e => e.message,
      );
      const s1 = sql`select ${"x"}`.then(
        () => "ok",
        e => e.message,
      );
      const s2 = sql`select ${"y"}`.then(
        () => "ok",
        e => e.message,
      );
      expect(await Promise.all([bad, s1, s2])).toEqual(["boom from toString", "ok", "ok"]);
    } finally {
      server.close();
    }
    expect(received.filter(m => m.includes("len="))).toEqual([]);
    // warm-up: Parse Describe Sync, Bind Execute Flush Sync.
    // bad: Parse Describe Sync, then nothing (its Bind is discarded).
    // siblings: Bind Execute Flush Sync, twice.
    expect(received).toEqual([
      ...["P", "D", "S", "B", "E", "H", "S"],
      ...["P", "D", "S"],
      ...["B", "E", "H", "S"],
      ...["B", "E", "H", "S"],
    ]);
  });
});
