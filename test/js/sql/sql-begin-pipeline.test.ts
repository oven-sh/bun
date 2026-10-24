// BEGIN, COMMIT and SAVEPOINT go out as the unnamed prepared statement, in one write with their Bind, so they are
// pipelined like any other statement. begin() does not wait for the answer to BEGIN before it calls its callback:
// the first statements of the callback share BEGIN's write. COMMIT still goes out once every result is read.
// A BEGIN with options, or the BEGIN of a distributed transaction, can be refused, so the callback waits for it.
import { SQL, randomUUIDv7 } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";
import { once } from "node:events";
import net from "node:net";

/**
 * A proxy to the server that logs every write of the client as the messages in it. A read can end inside a message:
 * `frame` gives the length of the message at the start of `bytes`, or 0 when the bytes are short of it, and what is
 * left waits for the next read, which then belongs to the same write.
 */
async function loggingProxy(
  host: string,
  port: number,
  frame: (bytes: Buffer, first: boolean) => { length: number; type: string },
) {
  const writes: string[] = [];
  const server = net.createServer(client => {
    const upstream = net.connect(port, host);
    let buffered = Buffer.alloc(0);
    let first = true;
    let types = "";
    client.on("data", (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      for (;;) {
        const { length, type } = frame(buffered, first);
        if (length === 0 || buffered.length < length) break;
        first = false;
        types += type;
        buffered = buffered.subarray(length);
      }
      if (buffered.length === 0) {
        writes.push(types);
        types = "";
      }
      upstream.write(chunk);
    });
    upstream.on("data", data => client.write(data));
    client.on("close", () => upstream.destroy());
    upstream.on("close", () => client.destroy());
    client.on("error", () => {});
    upstream.on("error", () => {});
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    port: (server.address() as net.AddressInfo).port,
    /** The writes since the last call. */
    take: () => writes.splice(0),
    [Symbol.dispose]: () => server.close(),
  };
}

/** The type byte of a message. The StartupMessage has none, and its URL asks for no SSLRequest. */
function pgFrame(bytes: Buffer, first: boolean) {
  if (first) return bytes.length < 4 ? { length: 0, type: "" } : { length: bytes.readInt32BE(0), type: "" };
  if (bytes.length < 5) return { length: 0, type: "" };
  return { length: 1 + bytes.readInt32BE(1), type: String.fromCharCode(bytes[0]) };
}

/** The command byte of a packet, in hex: 03 COM_QUERY, 16 COM_STMT_PREPARE, 17 COM_STMT_EXECUTE. */
function mysqlFrame(bytes: Buffer, first: boolean) {
  if (bytes.length < 5) return { length: 0, type: "" };
  const length = 4 + bytes.readUIntLE(0, 3);
  return { length, type: first ? "" : bytes[4].toString(16).padStart(2, "0") };
}

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  async function connect() {
    await container.ready;
    const proxy = await loggingProxy(container.host, container.port, pgFrame);
    const sql = new SQL({
      url: `postgres://bun_sql_test@127.0.0.1:${proxy.port}/bun_sql_test?sslmode=disable`,
      max: 1,
    });
    await sql`SELECT 1`;
    return { sql, proxy };
  }

  test("the array form of begin() sends BEGIN and the statements in one write, and COMMIT in one more", async () => {
    const { sql, proxy } = await connect();
    await using _sql = sql;
    using _proxy = proxy;
    const run = () =>
      sql.begin(tx => [
        tx`SELECT set_config('app.tenant', ${"t1"}, true)`,
        tx`SELECT current_setting('app.tenant') AS t`,
      ]);
    await run();
    proxy.take();
    expect(await run()).toEqual([[{ set_config: "t1" }], [{ t: "t1" }]]);
    // BEGIN: Parse, Bind, Execute, Sync. Each statement: Bind, Execute, Sync. COMMIT as BEGIN.
    expect(proxy.take()).toEqual(["PBESBESBES", "PBES"]);
  });

  test("the first statements of a callback share BEGIN's write", async () => {
    const { sql, proxy } = await connect();
    await using _sql = sql;
    using _proxy = proxy;
    const run = () =>
      sql.begin(async tx => {
        const [row] = await tx`SELECT 2 AS n`;
        return row.n;
      });
    await run();
    proxy.take();
    expect(await run()).toBe(2);
    expect(proxy.take()).toEqual(["PBESBES", "PBES"]);
  });

  test("BEGIN goes out as the unnamed statement: the server cannot have forgotten it", async () => {
    const { sql, proxy } = await connect();
    await using _sql = sql;
    using _proxy = proxy;
    await sql.begin(tx => [tx`SELECT 3 AS n`]);
    // The named statements of this connection are gone, BEGIN and COMMIT are not among them.
    await sql.unsafe("DEALLOCATE ALL");
    proxy.take();
    expect(await sql.begin(tx => [tx`SELECT ${4}::int AS n`])).toEqual([[{ n: 4 }]]);
    expect(proxy.take()).toEqual(["PBES", "PDS", "BES", "PBES"]);
  });

  test("savepoint() pipelines SAVEPOINT with the statements of its callback", async () => {
    const { sql, proxy } = await connect();
    await using _sql = sql;
    using _proxy = proxy;
    const run = () => sql.begin(tx => tx.savepoint(sp => [sp`SELECT 5 AS n`]));
    await run();
    proxy.take();
    expect(await run()).toEqual([[{ n: 5 }]]);
    expect(proxy.take()).toEqual(["PBESPBESBES", "PBES", "PBES"]);
  });

  test("a statement that fails in the array form rolls the transaction back", async () => {
    const { sql, proxy } = await connect();
    await using _sql = sql;
    using _proxy = proxy;
    await sql`CREATE TEMPORARY TABLE pipelined_begin (n int)`;
    const outcome = await sql
      .begin(tx => [
        tx`INSERT INTO pipelined_begin VALUES (${1})`,
        tx`SELECT * FROM no_such_table_${"x"}`,
        tx`INSERT INTO pipelined_begin VALUES (${2})`,
      ])
      .then(
        value => ({ resolved: value }),
        error => ({ rejected: error.code }),
      );
    expect(outcome).toEqual({ rejected: "ERR_POSTGRES_SERVER_ERROR" });
    expect(await sql`SELECT n FROM pipelined_begin`).toEqual([]);
    // The connection is idle again: the next transaction runs.
    expect(await sql.begin(tx => [tx`SELECT count(*)::int AS c FROM pipelined_begin`])).toEqual([[{ c: 0 }]]);
  });

  test("COMMIT waits for the results of a statement that nothing awaited", async () => {
    const { sql, proxy } = await connect();
    await using _sql = sql;
    using _proxy = proxy;
    const run = () =>
      sql.begin(tx => {
        tx`SELECT 10 AS n`.execute();
      });
    await run();
    proxy.take();
    await run();
    expect(proxy.take()).toEqual(["PBESBES", "PBES"]);
  });

  test("BEGIN waits for a statement of the reservation that is in flight", async () => {
    const { sql, proxy } = await connect();
    await using _sql = sql;
    using _proxy = proxy;
    await using reserved = await sql.reserve();
    const run = () => {
      const ahead = reserved`SELECT 11 AS n`.execute();
      return Promise.all([ahead, reserved.begin(tx => [tx`SELECT 12 AS n`])]);
    };
    await run();
    proxy.take();
    expect(await run()).toEqual([[{ n: 11 }], [[{ n: 12 }]]]);
    expect(proxy.take()).toEqual(["BES", "PBESBES", "PBES"]);
  });

  test("the BEGIN of a distributed transaction is a plain BEGIN: it is pipelined too", async () => {
    const { sql, proxy } = await connect();
    await using _sql = sql;
    using _proxy = proxy;
    const name = `pipelined_${randomUUIDv7("hex")}`;
    const run = () => sql.beginDistributed(name, tx => [tx`SELECT 9 AS n`]);
    await run();
    await sql.commitDistributed(name);
    proxy.take();
    expect(await run()).toEqual([[{ n: 9 }]]);
    // PREPARE TRANSACTION ends it.
    expect(proxy.take()).toEqual(["PBESBES", "PBES"]);
    await sql.rollbackDistributed(name);
  });

  test("a BEGIN with options is answered before the callback runs", async () => {
    const { sql, proxy } = await connect();
    await using _sql = sql;
    using _proxy = proxy;
    const run = () => sql.begin("isolation level serializable", tx => [tx`SELECT 6 AS n`]);
    await run();
    proxy.take();
    expect(await run()).toEqual([[{ n: 6 }]]);
    expect(proxy.take()).toEqual(["PBES", "BES", "PBES"]);

    let entered = false;
    const refused = await sql
      .begin("no such option", tx => {
        entered = true;
        return [tx`SELECT 7`];
      })
      .then(
        () => null,
        error => error.code,
      );
    expect({ refused, entered }).toEqual({ refused: "ERR_POSTGRES_SYNTAX_ERROR", entered: false });
  });
});

describeWithContainer("mysql", { image: "mysql_plain" }, container => {
  test("the statements of the array form share START TRANSACTION's write", async () => {
    await container.ready;
    using proxy = await loggingProxy(container.host, container.port, mysqlFrame);
    await using sql = new SQL({ url: `mysql://root@127.0.0.1:${proxy.port}/bun_sql_test`, max: 1 });
    await sql`SELECT 1`;
    const run = () => sql.begin(tx => [tx`SELECT ${8} AS n`]);
    await run();
    proxy.take();
    expect(await run()).toEqual([[{ n: 8 }]]);
    // START TRANSACTION is a text query, the statement is prepared: one write. COMMIT is one more.
    expect(proxy.take()).toEqual(["0317", "03"]);
  });
});
