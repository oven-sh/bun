// Bind parameters are encoded straight into the connection's write buffer.
// When a parameter throws while it is encoded (a `toString` that throws, an
// array with a throwing getter), the query rejects with that error, but the
// partial Bind message (header with length 0, the portal and statement names,
// the format codes, the parameters before the bad one) stayed in the buffer.
// It went out with the next flush, alone or ahead of the next query's bytes.
// A real server reads the zero length as a protocol violation and drops the
// connection, so the next query and every query pipelined behind the bad one
// failed too.
//
// The fix records the buffer offset before a Parse/Bind/Execute group is
// written and truncates back to it when any part of the group fails.
import { SQL } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, describeWithContainer } from "harness";
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

  test("with prepare: false, a throwing parameter does not break the query queued behind it", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1, prepare: false, idleTimeout: 5, connectionTimeout: 5 });

    // prepare: false writes Parse, Describe, Bind and Execute as one batch, so
    // the Parse and Describe have to be discarded together with the partial Bind.
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

  // The rejected query sends nothing, so no reply comes back to release the
  // event loop ref that the query took. The connection must release it itself.
  test.each([false, true])("a script whose last query was rejected exits on its own (prepare: %p)", async prepare => {
    await container.ready;
    const script = `
      const sql = new Bun.SQL({ url: process.env.DATABASE_URL, max: 1, prepare: ${prepare} });
      await sql.connect();
      // A later tick: the idle connection does not hold the process any more.
      await new Promise(resolve => setImmediate(resolve));
      const param = { toString() { throw new Error("boom from toString"); } };
      console.log(await sql\`SELECT \${param}::text AS v\`.then(() => "resolved", e => e.message));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: { ...bunEnv, DATABASE_URL: url() },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // stderr is here so that a failure shows it. A sanitizer build can write to it.
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "boom from toString\n",
      stderr: expect.any(String),
      exitCode: 0,
    });
  });

  test("a query dispatched from inside a conversion that then fails gets its own row", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1, idleTimeout: 5, connectionTimeout: 5 });
    const settled = (query: Promise<unknown>) =>
      query.then(
        rows => [...(rows as unknown[])],
        e => e.code ?? e.message,
      );

    // Prepare both statements first, so each Bind is written at query time.
    await sql`SELECT ${{ toString: () => "warm" }}::text AS outer_q`;
    await sql`SELECT ${"warm"}::text AS nested`;

    let nested!: Promise<unknown>;
    const dispatchesThenThrows = {
      toString() {
        // execute() starts the query synchronously, while the outer Bind is encoded.
        const query = sql`SELECT ${"nested value"}::text AS nested`;
        query.execute();
        nested = settled(query);
        throw new Error("boom after dispatch");
      },
    };
    const outer = await settled(sql`SELECT ${dispatchesThenThrows}::text AS outer_q`);
    const later = sql`SELECT ${"later value"}::text AS nested`;
    later.execute();
    const [nestedResult, laterResult] = await Promise.all([nested, settled(later)]);

    expect({ outer, nested: nestedResult, later: laterResult }).toEqual({
      outer: "boom after dispatch",
      nested: [{ nested: "nested value" }],
      later: [{ nested: "later value" }],
    });
  });
});

describe("postgres bind encode failure (mock server)", () => {
  // Records every frontend message bun sends as "<type>". A length field that
  // is not a valid message length is recorded as "<type>(len=<n>)", and the
  // mock then drops the connection like a real server. A partial Bind shows up
  // as "B(len=0)".
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
            socket.destroy();
            return;
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

  const outcome = (query: Promise<unknown>) =>
    query.then(
      () => "ok",
      e => e.message,
    );

  test("no partial Bind reaches the wire when a parameter throws", async () => {
    const { port, server, received } = await mockServer();
    let outcomes: string[];
    try {
      await using sql = new SQL({
        url: `postgres://user@127.0.0.1:${port}/db`,
        max: 1,
        idleTimeout: 2,
        connectionTimeout: 5,
      });
      await sql`select ${"w"}`;
      outcomes = await Promise.all([
        outcome(sql`select ${"a"}, ${throwingToString}`),
        outcome(sql`select ${"x"}`),
        outcome(sql`select ${"y"}`),
      ]);
    } finally {
      server.close();
    }
    expect(received.filter(m => m.includes("len="))).toEqual([]);
    expect({ outcomes, received }).toEqual({
      outcomes: ["boom from toString", "ok", "ok"],
      // warm-up: Parse Describe Sync, Bind Execute Flush Sync.
      // bad: Parse Describe Sync, then nothing (its Bind is discarded).
      // siblings: Bind Execute Flush Sync, twice.
      received: [
        ...["P", "D", "S", "B", "E", "H", "S"],
        ...["P", "D", "S"],
        ...["B", "E", "H", "S"],
        ...["B", "E", "H", "S"],
      ],
    });
  });

  test("with prepare: false, no Parse, Describe or partial Bind of the rejected query reaches the wire", async () => {
    const { port, server, received } = await mockServer();
    let outcomes: Record<string, string>;
    try {
      await using sql = new SQL({
        url: `postgres://user@127.0.0.1:${port}/db`,
        max: 1,
        prepare: false,
        idleTimeout: 2,
        connectionTimeout: 5,
      });
      // Nothing is queued behind the first rejected query.
      const lone = await outcome(sql`select ${"a"}, ${throwingToString}`);
      const after = await outcome(sql`select ${"x"}`);
      // A query is queued behind the second rejected query.
      const [bad, queued] = await Promise.all([
        outcome(sql`select ${"b"}, ${throwingToString}`),
        outcome(sql`select ${"y"}`),
      ]);
      outcomes = { lone, after, bad, queued };
    } finally {
      server.close();
    }
    expect(received.filter(m => m.includes("len="))).toEqual([]);
    expect({ outcomes, received }).toEqual({
      outcomes: { lone: "boom from toString", after: "ok", bad: "boom from toString", queued: "ok" },
      // prepare: false writes Parse Describe Bind Execute Flush Sync as one
      // batch. A rejected query writes nothing: a Parse or Describe without its
      // Sync would leave replies that the next query reads as its own.
      received: [...["P", "D", "B", "E", "H", "S"], ...["P", "D", "B", "E", "H", "S"]],
    });
  });
});
