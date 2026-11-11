import { randomUUIDv7, SQL } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, describeWithContainer, isLinux, isWindows } from "harness";
import { once } from "node:events";
import net from "node:net";
import {
  listeningServer,
  loopbackFence,
  MYSQL_SERVER_MORE_RESULTS_EXISTS,
  mysqlAckSessionSetup,
  mysqlErrPacket,
  mysqlHandshakeV10,
  mysqlOkPacket,
  mysqlRawPacket,
  mysqlReadPackets,
  mysqlTextResultSet,
} from "./wire-frames";

const COM_QUIT = 0x01;
const COM_QUERY = 0x03;

/** An SQL instance, a reservation or a transaction. */
type Tag = (strings: TemplateStringsArray, ...values: unknown[]) => PromiseLike<any>;

const outcome = (query: PromiseLike<unknown>) =>
  Promise.resolve(query).then(
    rows => rows,
    reason => ({ rejected: reason?.code ?? reason }),
  );

// A simple query reads the counters, so the read does not count.
async function statementCounters(sql: SQL) {
  const rows = await sql
    .unsafe("SHOW SESSION STATUS WHERE Variable_name IN ('Com_stmt_prepare', 'Com_stmt_close', 'Com_stmt_execute')")
    .simple();
  const { Com_stmt_prepare, Com_stmt_close, Com_stmt_execute } = Object.fromEntries(
    rows.map((row: { Variable_name: string; Value: string }) => [row.Variable_name, Number(row.Value)]),
  );
  return { prepare: Com_stmt_prepare, close: Com_stmt_close, execute: Com_stmt_execute };
}

async function counted(sql: SQL, run: () => Promise<unknown>) {
  const before = await statementCounters(sql);
  await run();
  const after = await statementCounters(sql);
  return {
    prepare: after.prepare - before.prepare,
    close: after.close - before.close,
    execute: after.execute - before.execute,
  };
}

for (const image of ["mysql_plain", "mariadb_plain"] as const) {
  describeWithContainer(image, { image, concurrent: true }, container => {
    const url = () => `mysql://root@${container.host}:${container.port}/bun_sql_test`;
    async function connect(options: Record<string, unknown> = {}) {
      await container.ready;
      return new SQL({ url: url(), max: 1, ...options });
    }
    const connectionId = async (sql: Tag) => (await sql`SELECT CONNECTION_ID() AS id`)[0].id;

    async function runScript(script: string, env: Record<string, string> = {}) {
      await container.ready;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env: { ...bunEnv, MYSQL_URL: url(), ...env },
        stdout: "pipe",
        stderr: "pipe",
        // Ends a child that hangs. No test waits for it.
        timeout: 60_000,
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      // stderr is here so that a failure shows it. No test expects it: a sanitizer build can write to it.
      return { stdout, stderr, exitCode };
    }

    describe("queue", () => {
      test("a query started while the parameters of another one are read is written behind it", async () => {
        await using sql = await connect();
        const outerText = "SELECT 'OUTER' AS outer_col, ? IS NOT NULL AS bound";
        const innerText = "SELECT 'INNER' AS inner_col, ? AS extra";
        // Both statements are prepared, so each query is one COM_STMT_EXECUTE.
        await sql.unsafe(outerText, [{}]);
        await sql.unsafe(innerText, [2]);

        // `outer` waits in the queue while the statement of `blocker` is prepared, so its parameter is read later.
        const blocker = sql`SELECT SLEEP(0.05) AS s`.execute();
        let inner: Promise<unknown> | undefined;
        const parameter = {
          toJSON() {
            inner ??= sql.unsafe(innerText, [2]).execute();
            return "x";
          },
        };
        const outer = sql.unsafe(outerText, [parameter]).execute();
        await blocker;

        expect({ outer: await outer, inner: await inner }).toEqual({
          outer: [{ outer_col: "OUTER", bound: 1 }],
          inner: [{ inner_col: "INNER", extra: 2 }],
        });
      });

      test("a parameter that closes the connection rejects its query and the queries around it", async () => {
        await using sql = await connect();
        const text = "SELECT ? IS NOT NULL AS bound";
        await sql.unsafe(text, [{}]);

        let closed: Promise<void> | undefined;
        const parameter = {
          toJSON() {
            closed ??= sql.close({ timeout: 0 });
            return "x";
          },
        };
        // The statement of the first one is new: the other two wait in the queue, and the parameter is read in
        // the read that brings the reply to its COM_STMT_PREPARE, behind its COM_STMT_EXECUTE.
        const queries = [
          sql`SELECT SLEEP(0.05) AS slept`.execute(),
          sql.unsafe(text, [parameter]).execute(),
          sql.unsafe(text, [{}]).execute(),
        ];
        expect(await Promise.all(queries.map(outcome))).toEqual(
          Array(3).fill({ rejected: "ERR_MYSQL_CONNECTION_CLOSED" }),
        );
        await closed;
      });
    });

    describe("pipelining", () => {
      const commands: Record<number, string> = { 0x03: "QUERY", 0x16: "PREPARE", 0x17: "EXECUTE", 0x19: "CLOSE" };

      // Forwards to the server. `wire` is what passed: each command of the client, and "reply" where the server spoke.
      async function watchingProxy() {
        await container.ready;
        const wire: string[] = [];
        const { port, server } = await listeningServer(client => {
          const upstream = net.connect(container.port, container.host);
          let buffered: Buffer = Buffer.alloc(0);
          client.on("data", chunk => {
            buffered = mysqlReadPackets(Buffer.concat([buffered, chunk]), (_, payload) => {
              wire.push(commands[payload[0]] ?? "other");
            });
            upstream.write(chunk);
          });
          upstream.on("data", chunk => {
            if (wire.at(-1) !== "reply") wire.push("reply");
            client.write(chunk);
          });
          client.on("end", () => upstream.end());
          upstream.on("end", () => client.end());
          client.on("error", () => {});
          upstream.on("error", () => {});
        });
        return {
          url: `mysql://root@127.0.0.1:${port}/bun_sql_test`,
          wire,
          [Symbol.dispose]: () => void server.close(),
        };
      }
      const rowsOrErrno = (query: PromiseLike<unknown>) =>
        Promise.resolve(query).then(
          rows => rows,
          reason => reason.errno,
        );

      test("commands that wait for no reply go out together", async () => {
        using proxy = await watchingProxy();
        await using sql = new SQL({ url: proxy.url, max: 1 });
        const select = (v: string) => sql`SELECT ${v} AS v`;
        await select("warm");
        proxy.wire.length = 0;
        const rows = await Promise.all([select("a"), select("b"), sql`SELECT 'c' AS v`.simple(), select("d")]);
        expect({ rows, wire: proxy.wire }).toEqual({
          rows: [[{ v: "a" }], [{ v: "b" }], [{ v: "c" }], [{ v: "d" }]],
          wire: ["EXECUTE", "EXECUTE", "QUERY", "EXECUTE", "reply"],
        });
      });

      test("a statement that has to be prepared holds back what is behind it", async () => {
        using proxy = await watchingProxy();
        await using sql = new SQL({ url: proxy.url, max: 1 });
        const select = (v: string) => sql`SELECT ${v} AS v`;
        await select("warm");
        proxy.wire.length = 0;
        const rows = await Promise.all([select("a"), sql`SELECT ${"b"} AS fresh`, select("c")]);
        expect({ rows, wire: proxy.wire }).toEqual({
          rows: [[{ v: "a" }], [{ fresh: "b" }], [{ v: "c" }]],
          wire: ["EXECUTE", "PREPARE", "reply", "EXECUTE", "EXECUTE", "reply"],
        });
      });

      test("an error fails its own query, and a query with several results keeps its place", async () => {
        using proxy = await watchingProxy();
        await using sql = new SQL({ url: proxy.url, max: 1 });
        await sql`CREATE TEMPORARY TABLE pipelined (id INT PRIMARY KEY)`.simple();
        const insert = (id: number) => sql`INSERT INTO pipelined (id) VALUES (${id})`;
        const select = (v: string) => sql`SELECT ${v} AS v`;
        await insert(0);
        await select("warm");
        proxy.wire.length = 0;
        const outcomes = await Promise.all(
          [
            select("a"),
            insert(1),
            insert(1),
            sql`SELECT no_such_column`.simple(),
            sql`SELECT 1 AS a; SELECT 2 AS b`.simple(),
            select("b"),
            sql`SELECT id FROM pipelined ORDER BY id`.simple(),
          ].map(rowsOrErrno),
        );
        expect({ outcomes, wire: proxy.wire }).toEqual({
          outcomes: [[{ v: "a" }], [], 1062, 1054, [[{ a: 1 }], [{ b: 2 }]], [{ v: "b" }], [{ id: 0 }, { id: 1 }]],
          wire: ["EXECUTE", "EXECUTE", "EXECUTE", "QUERY", "QUERY", "reply", "EXECUTE", "QUERY", "reply"],
        });
      });

      test("nothing is written behind a simple query whose text has a ';' until it has ended", async () => {
        using proxy = await watchingProxy();
        await using sql = new SQL({ url: proxy.url, max: 1 });
        const prepared = () => sql.unsafe("SELECT ';' AS a, ? AS b", ["b"]);
        await prepared();
        const wireOf = async (first: () => PromiseLike<unknown>) => {
          proxy.wire.length = 0;
          await Promise.all([first(), sql`SELECT 'behind' AS v`.simple()]);
          return proxy.wire.join(" ");
        };
        expect({
          oneStatement: await wireOf(() => sql.unsafe("SELECT 1 AS a").simple()),
          twoStatements: await wireOf(() => sql.unsafe("SELECT 1 AS a; SELECT 2 AS b").simple()),
          inALiteral: await wireOf(() => sql.unsafe("SELECT ';' AS a").simple()),
          prepared: await wireOf(prepared),
        }).toEqual({
          oneStatement: "QUERY QUERY reply",
          twoStatements: "QUERY reply QUERY reply",
          inALiteral: "QUERY reply QUERY reply",
          prepared: "EXECUTE QUERY reply",
        });
      });

      test("an error among the queries of a transaction leaves the others to the COMMIT", async () => {
        await using sql = await connect();
        await sql`CREATE TEMPORARY TABLE pipelined (id INT PRIMARY KEY)`.simple();
        const insert = (on: Tag, id: number) => on`INSERT INTO pipelined (id) VALUES (${id})`;
        await insert(sql, 0);
        const outcomes = await sql.begin(tx => Promise.all([1, 1, 2].map(id => rowsOrErrno(insert(tx, id)))));
        expect({ outcomes, stored: await sql`SELECT id FROM pipelined ORDER BY id`.simple() }).toEqual({
          outcomes: [[], 1062, []],
          stored: [{ id: 0 }, { id: 1 }, { id: 2 }],
        });
      });

      test("replies that come while the socket cannot take the rest of a command find their queries", async () => {
        await using sql = await connect();
        const small = (n: number) => sql`SELECT ${n} AS n`;
        const length = (text: string) => sql`SELECT LENGTH(${text}) AS length`;
        await small(0);
        await length("");
        // More than the socket buffers of both ends hold, less than MariaDB's max_allowed_packet.
        const text = Buffer.alloc(12 * 1024 * 1024, "a").toString();
        const queries = [...[1, 2, 3, 4].map(small), length(text), small(5)];
        expect(await Promise.all(queries.map(outcome))).toEqual([
          ...[1, 2, 3, 4].map(n => [{ n }]),
          [{ length: text.length }],
          [{ n: 5 }],
        ]);
      });

      test("BUN_FEATURE_FLAG_DISABLE_SQL_AUTO_PIPELINING sends one command at a time and holds none back", async () => {
        using proxy = await watchingProxy();
        const script = `
          const sql = new Bun.SQL({ url: process.env.MYSQL_URL, max: 1 });
          const rows = await Promise.all([
            sql\`SELECT \${"a"} AS v\`,
            sql\`SELECT 'b' AS v\`.simple(),
            sql\`SELECT \${"c"} AS v\`,
          ]);
          console.log(JSON.stringify(rows));
          process.exit(0);
        `;
        const env = { MYSQL_URL: proxy.url, BUN_FEATURE_FLAG_DISABLE_SQL_AUTO_PIPELINING: "1" };
        expect(await runScript(script, env)).toMatchObject({
          stdout: JSON.stringify([[{ v: "a" }], [{ v: "b" }], [{ v: "c" }]]) + "\n",
          exitCode: 0,
        });
        expect(proxy.wire.slice(proxy.wire.indexOf("PREPARE")).join(" ")).toBe(
          "PREPARE reply EXECUTE reply QUERY reply EXECUTE reply",
        );
      });
    });

    describe("statement cache", () => {
      // A string parameter: for a number, MySQL 8.4 prepares `SELECT ?` again at its first execute and counts that.
      const select = (sql: SQL, n: number) => sql.unsafe(`SELECT ${n} AS n, ? AS v`, ["v"]);
      const row = (n: number) => [{ n, v: "v" }];
      const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);

      test("holds 256 statements and closes the one that was used longest ago", async () => {
        await using sql = await connect();
        const steps = {
          fill: await counted(sql, () => Promise.all(range(0, 256).map(n => select(sql, n)))),
          // 0 is now the newest, 1 the oldest.
          touch: await counted(sql, () => select(sql, 0)),
          overflow: await counted(sql, () => select(sql, 256)),
          kept: await counted(sql, async () => expect(await select(sql, 0)).toEqual(row(0))),
          evicted: await counted(sql, async () => expect(await select(sql, 1)).toEqual(row(1))),
        };
        expect(steps).toEqual({
          fill: { prepare: 256, close: 0, execute: 256 },
          touch: { prepare: 0, close: 0, execute: 1 },
          overflow: { prepare: 1, close: 1, execute: 1 },
          kept: { prepare: 0, close: 0, execute: 1 },
          evicted: { prepare: 1, close: 1, execute: 1 },
        });
      });

      test("more texts than it holds, started in one tick, all run", async () => {
        await using sql = await connect();
        let rows: unknown;
        const added = await counted(sql, async () => {
          rows = await Promise.all(range(0, 300).map(n => select(sql, n)));
        });
        expect({ rows, added }).toEqual({
          rows: range(0, 300).map(row),
          added: { prepare: 300, close: 44, execute: 300 },
        });
      });

      test("one text is one statement, whichever of its parameters are null", async () => {
        await using sql = await connect();
        await sql`CREATE TEMPORARY TABLE null_patterns (id INT, a INT NULL, b VARCHAR(8) NULL, c DOUBLE NULL, d BIGINT NULL)`.simple();
        const patterns = range(0, 16).map(id => ({
          id,
          a: id & 1 ? 7 : null,
          b: id & 2 ? "text" : null,
          c: id & 4 ? 1.5 : null,
          d: id & 8 ? 9 : null,
        }));

        const added = await counted(sql, async () => {
          // All null first: a type remembered from that execution would store null for ever.
          for (const { id, a, b, c, d } of patterns) {
            await sql`INSERT INTO null_patterns (id, a, b, c, d) VALUES (${id}, ${a}, ${b}, ${c}, ${d})`;
          }
        });
        expect({ added, stored: await sql`SELECT * FROM null_patterns ORDER BY id`.simple() }).toEqual({
          added: { prepare: 1, close: 0, execute: 16 },
          stored: patterns,
        });
      });

      test("as many parameters as the protocol counts run, and one more gets the server's error", async () => {
        await using sql = await connect();
        const run = (count: number) =>
          sql
            .unsafe(`SELECT 1 AS one FROM DUAL WHERE 1 IN (${Array(count).fill("?").join(",")})`, Array(count).fill(1))
            .catch(err => err.errno);
        expect([await run(65535), await run(65536)]).toEqual([[{ one: 1 }], 1390]);
      });

      // MySQL 8 settles the type of a parameter at its first value and converts every later value to it. On one
      // statement, "bob" after 5 would compare as the number 0 and match every name that is not a number.
      test("one text has a statement for each type of its parameters", async () => {
        await using sql = await connect();
        await sql`CREATE TEMPORARY TABLE typed (id INT, name VARCHAR(16))`.simple();
        await sql`INSERT INTO typed VALUES (1, 'bob'), (2, 'alice'), (3, '5'), (4, '0')`.simple();
        const names: unknown[] = [];
        for (const name of ["bob", 5, "bob", "nobody", null, "alice", 0]) {
          names.push((await sql`SELECT name FROM typed WHERE name = ${name} ORDER BY id`).map(row => row.name));
        }
        expect(names).toEqual([["bob"], ["5"], ["bob"], [], [], ["alice"], ["bob", "alice", "0"]]);

        const values = ["text", 1, 1.5, null, true, 2n ** 40n, -5, "again"];
        const results: unknown[] = [];
        const added = await counted(sql, async () => {
          for (const value of values) results.push((await sql`SELECT ${value} AS v`)[0].v);
        });
        expect(results).toEqual(["text", 1, 1.5, null, 1, "1099511627776", -5, "again"]);
        // Five types; null runs on a statement that is there. MySQL 8.4 prepares again by itself at the first
        // value of a parameter, and counts that.
        if (image === "mariadb_plain") expect(added).toEqual({ prepare: 5, close: 0, execute: values.length });
      });
    });

    describe("event loop", () => {
      // The work is in main(), not under a top-level await: whether the process stays alive is up to what the loop holds.
      const script = (between: string) => `
        async function main() {
          const sql = new Bun.SQL({ url: process.env.MYSQL_URL, max: 2 });
          await Promise.all([sql\`SELECT 1\`, sql\`SELECT 2\`]);
          console.log("first done");
          ${between}
          await sql\`SELECT SLEEP(0.1)\`;
          console.log("second done");
        }
        main();
      `;
      test.each([
        ["a turn of the loop later", "await new Promise(resolve => setImmediate(resolve));"],
        ["after a transaction", "await sql.begin(tx => tx`SELECT 1`);"],
        [
          "after a reservation",
          "{ const reserved = await sql.reserve(); await reserved`SELECT 1`; reserved.release(); }",
        ],
        ["after a reservation that ran nothing", "(await sql.reserve()).release();"],
        ["after another client ran one", "await new Bun.SQL({ url: process.env.MYSQL_URL, max: 1 })`SELECT 1`;"],
      ])("a query that an idle connection gets %s keeps the process alive", async (_, between) => {
        expect(await runScript(script(between))).toMatchObject({ stdout: "first done\nsecond done\n", exitCode: 0 });
      });

      test("waiting for a reply under a top-level await does not spin", async () => {
        const { stdout, ...rest } = await runScript(`
          const sql = new Bun.SQL({ url: process.env.MYSQL_URL, max: 1 });
          const sleep = seconds => sql\`SELECT SLEEP(\${seconds})\`;
          // The statement is prepared: the next one is a single command, with no reply before the one it waits for.
          await sleep(0.001);
          // The connection has gone idle.
          await new Promise(resolve => setImmediate(resolve));
          const cpu = process.cpuUsage(), start = performance.now();
          await sleep(0.5);
          const { user, system } = process.cpuUsage(cpu);
          console.log((user + system) / 1000 / (performance.now() - start));
          await sql.close();
        `);
        // A loop that polls with no timeout burns most of a core. Blocked in the poll, this is a few milliseconds.
        expect({ busy: Number(stdout) < 0.3 || stdout, ...rest }).toMatchObject({ busy: true, exitCode: 0 });
      });
    });

    describe("timers", () => {
      const timers = [
        ["idleTimeout", "ERR_MYSQL_IDLE_TIMEOUT"],
        ["maxLifetime", "ERR_MYSQL_LIFETIME_TIMEOUT"],
      ] as const;

      async function connectWithTimer(timer: string) {
        const closed = Promise.withResolvers<string>();
        const sql = await connect({ [timer]: 0.2, onclose: (err: any) => closed.resolve(err?.code) });
        return { sql, closed: closed.promise };
      }

      // Resolves when `timer` has closed a connection that was established and last used after the call. A timer
      // of the same length that was started before the call has run out by then.
      async function timerRunsOut(timer: string) {
        const { sql, closed } = await connectWithTimer(timer);
        await using _ = sql;
        await sql`SELECT 1`.simple();
        await closed;
      }

      test.each(timers)("%s leaves a query in flight alone", async (timer, code) => {
        const { sql, closed } = await connectWithTimer(timer);
        await using _ = sql;
        await using holder = await connect();
        const lock = randomUUIDv7("hex");
        await holder.unsafe(`SELECT GET_LOCK('${lock}', 0)`).simple();
        await sql`SELECT 1`.simple();
        const waiting = outcome(sql`SELECT GET_LOCK(${lock}, 60) AS locked`.execute());
        await timerRunsOut(timer);
        await holder.unsafe(`SELECT RELEASE_LOCK('${lock}')`).simple();
        expect(await waiting).toEqual([{ locked: 1 }]);
        expect(await closed).toBe(code);
      });

      test.each(timers)("%s leaves a reservation that sends nothing alone", async (timer, code) => {
        const { sql, closed } = await connectWithTimer(timer);
        await using _ = sql;
        const reserved = await sql.reserve();
        const id = await connectionId(reserved);
        await timerRunsOut(timer);
        expect(await outcome(reserved`SELECT CONNECTION_ID() AS id`)).toEqual([{ id }]);
        reserved.release();
        expect(await closed).toBe(code);
      });

      test.each(timers)("%s leaves a transaction that sends nothing alone", async (timer, code) => {
        const { sql, closed } = await connectWithTimer(timer);
        await using _ = sql;
        const ids = sql.begin(async tx => {
          const before = await connectionId(tx);
          await timerRunsOut(timer);
          return [before, await connectionId(tx)];
        });
        expect(await outcome(ids.then(([before, after]) => before === after))).toBe(true);
        expect(await closed).toBe(code);
      });

      test("maxLifetime starts when the connection is established", async () => {
        await container.ready;
        const dialed = Promise.withResolvers<() => void>();
        const { port, server } = await listeningServer(client => {
          const upstream = net.connect(container.port, container.host);
          client.pipe(upstream).on("error", () => {});
          client.on("error", () => {});
          dialed.resolve(() => void upstream.pipe(client));
        });
        try {
          await using sql = new SQL({ url: `mysql://root@127.0.0.1:${port}/bun_sql_test`, max: 1, maxLifetime: 0.2 });
          const query = outcome(sql`SELECT 1 AS x`.execute());
          // The server's greeting takes longer than maxLifetime.
          const greet = await dialed.promise;
          await timerRunsOut("maxLifetime");
          greet();
          expect(await query).toEqual([{ x: 1 }]);
        } finally {
          server.close();
        }
      });

      test("queries that follow each other across maxLifetime all run, and the next one gets a new connection", async () => {
        let code: string | undefined;
        await using sql = await connect({ maxLifetime: 0.2, onclose: (err: any) => void (code ??= err?.code) });
        const first = await connectionId(sql);
        const outcomes = new Set<unknown>();
        do {
          outcomes.add(JSON.stringify(await outcome(sql`SELECT 1 AS x`)));
        } while (code === undefined);
        expect({ outcomes: [...outcomes], code }).toEqual({
          outcomes: [JSON.stringify([{ x: 1 }])],
          code: "ERR_MYSQL_LIFETIME_TIMEOUT",
        });
        expect(await connectionId(sql)).not.toBe(first);
      });
    });

    describe("close", () => {
      // Forwards to the server and keeps what the client sent.
      async function recordingProxy() {
        await container.ready;
        const sent: Buffer[] = [];
        const clientLeft = Promise.withResolvers<void>();
        const { port, server } = await listeningServer(client => {
          const upstream = net.connect(container.port, container.host);
          client.on("data", chunk => void (sent.push(chunk), upstream.write(chunk)));
          upstream.on("data", chunk => void client.write(chunk));
          client.on("end", () => upstream.end());
          upstream.on("end", () => client.end());
          // A client that hangs up before it has read the server's last bytes leaves with a reset.
          client.on("error", () => {});
          client.on("close", () => clientLeft.resolve());
          upstream.on("error", () => {});
        });
        return {
          url: `mysql://root@127.0.0.1:${port}/bun_sql_test`,
          server,
          async lastPacket() {
            await clientLeft.promise;
            let last: number[] = [];
            mysqlReadPackets(Buffer.concat(sent), (seq, payload) => void (last = [seq, ...payload]));
            return last;
          },
        };
      }

      test.each<[string, Record<string, unknown>, (sql: SQL) => Promise<unknown>]>([
        ["close()", {}, sql => sql.close()],
        ["idleTimeout", { idleTimeout: 0.1 }, async () => {}],
        ["maxLifetime", { maxLifetime: 0.5 }, async () => {}],
      ])("a connection that %s ends says COM_QUIT first", async (_, options, end) => {
        const proxy = await recordingProxy();
        try {
          await using sql = new SQL({ url: proxy.url, max: 1, ...options });
          await sql`SELECT 1`;
          await end(sql);
          expect(await proxy.lastPacket()).toEqual([0, COM_QUIT]);
        } finally {
          proxy.server.close();
        }
      });

      test("the server does not count a closed connection as an aborted client", async () => {
        await using observer = await connect();
        const aborted = async () =>
          Number((await observer.unsafe("SHOW GLOBAL STATUS LIKE 'Aborted_clients'").simple())[0].Value);

        // The counter is the server's: somebody else's client can add to it, so a clean round is looked for.
        let added = Infinity;
        for (let attempt = 0; attempt < 20 && added !== 0; attempt++) {
          const before = await aborted();
          for (let i = 0; i < 3; i++) {
            const sql = await connect();
            await sql`SELECT 1`;
            await sql.close();
          }
          added = (await aborted()) - before;
        }
        expect(added).toBe(0);
      });

      test("a command over max_allowed_packet gets the server's error, and the connection is gone with it", async () => {
        let closed = 0;
        await using sql = await connect({ onclose: () => void closed++ });
        const length = (text: string) => sql`SELECT LENGTH(${text}) AS length`;
        await length("");
        const [{ id, max }] = await sql`SELECT CONNECTION_ID() AS id, @@max_allowed_packet AS max`.simple();
        // The server hangs up behind the error: the pool has let go of the connection when the caller hears of it.
        const refused = length(Buffer.alloc(Number(max), "a").toString()).catch(err => ({ errno: err.errno, closed }));
        const behind = outcome(length("behind"));
        expect({ refused: await refused, behind: await behind, next: (await connectionId(sql)) !== id }).toEqual({
          refused: { errno: 1153, closed: 1 },
          behind: { rejected: "ERR_MYSQL_CONNECTION_CLOSED" },
          next: true,
        });
      });
    });

    describe("cancel", () => {
      const cancelled = { rejected: "ERR_MYSQL_QUERY_CANCELLED" };

      // The table is this connection's alone: its rows are the INSERTs that the server ran.
      async function connectWithTable() {
        const sql = await connect();
        await sql`CREATE TEMPORARY TABLE cancel_rows (id INT PRIMARY KEY)`.simple();
        const insert = (id: number, on: SQL = sql) => on`INSERT INTO cancel_rows (id) VALUES (${id})`;
        await insert(0);
        const ids = async () =>
          (await sql`SELECT id FROM cancel_rows ORDER BY id`.simple()).map((row: { id: number }) => row.id);
        return { sql, insert, ids };
      }
      // The statement is new: the connection writes COM_STMT_PREPARE, and nothing more until that is answered.
      const preparing = (sql: SQL) => sql`SELECT ${"x"} AS in_front`;

      const kinds: [string, (sql: SQL) => SQL.Query<any>][] = [
        ["a simple query", sql => sql`INSERT INTO cancel_rows (id) VALUES (1)`.simple()],
        ["a query whose statement is prepared", sql => sql`INSERT INTO cancel_rows (id) VALUES (${1})`],
        ["a query whose statement is not prepared", sql => sql`INSERT INTO cancel_rows (id) VALUES (${1} + 0)`],
      ];

      test.each(kinds)("%s that is not written is rejected at once and never sent", async (_, start) => {
        const { sql, insert, ids } = await connectWithTable();
        await using _sql = sql;
        const order: string[] = [];
        const inFront = preparing(sql).execute();
        const query = start(sql).execute();
        const behind = insert(2).execute();
        inFront.then(() => order.push("in front"));
        query.catch(() => order.push("cancelled"));
        expect(query.cancel()).toBe(query);

        expect({
          query: await outcome(query),
          inFront: await outcome(inFront),
          behind: (await outcome(behind)) instanceof Array,
          ids: await ids(),
          order,
        }).toEqual({
          query: cancelled,
          inFront: [{ in_front: "x" }],
          behind: true,
          ids: [0, 2],
          order: ["cancelled", "in front"],
        });
      });

      test.each<[string, (sql: SQL) => SQL.Query<any>, object, number[]]>([
        [kinds[0][0], kinds[0][1], { affectedRows: 1 }, [0, 1]],
        [kinds[1][0], kinds[1][1], { affectedRows: 1 }, [0, 1]],
        ["a query that fails", sql => sql`INSERT INTO cancel_rows (id) VALUES (${0})`, { errno: 1062 }, [0]],
      ])("%s that is written runs to its end and settles with what the server said", async (_, start, said, stored) => {
        const { sql, ids } = await connectWithTable();
        await using _sql = sql;
        const query = start(sql).execute();
        query.cancel();
        const settled = await query.then(
          ({ affectedRows }) => ({ affectedRows }),
          ({ errno }) => ({ errno }),
        );
        expect({ settled, cancelled: query.cancelled, ids: await ids() }).toEqual({
          settled: said,
          cancelled: true,
          ids: stored,
        });
      });

      test("a cancelled query that runs on stays alive until it has its reply", async () => {
        await using sql = await connect();
        const sleep = (seconds: number) => sql`SELECT SLEEP(${seconds}) AS slept`;
        await sleep(0.001);
        const query = sleep(0.2).execute();
        query.cancel();
        // While this function waits, only the connection's request leads to the query and to this function.
        setImmediate(() => Bun.gc(true));
        expect(await outcome(query)).toEqual([{ slept: 0 }]);
      });

      test("a query whose statement is being prepared is rejected at once and never executed", async () => {
        const { sql, ids } = await connectWithTable();
        await using _sql = sql;
        const insert = (id: string) => sql`INSERT INTO cancel_rows (id) VALUES (${id})`;
        let first: unknown;
        const sent = await counted(sql, async () => {
          const query = insert("1").execute();
          query.cancel();
          first = await outcome(query);
          // The reply to the COM_STMT_PREPARE is still read, and the statement it made is used.
          await insert("2");
        });
        expect({ first, sent, ids: await ids() }).toEqual({
          first: cancelled,
          sent: { prepare: 1, close: 0, execute: 1 },
          ids: [0, 2],
        });
      });

      test("the statement of a cancelled query that has too many values is not kept for the next one", async () => {
        await using sql = await connect();
        const run = () => sql.unsafe("SELECT ? AS one_placeholder", [1, 2]);
        const query = run().execute();
        query.cancel();
        expect([await outcome(query), await outcome(run())]).toEqual([
          cancelled,
          { rejected: "ERR_MYSQL_WRONG_NUMBER_OF_PARAMETERS_PROVIDED" },
        ]);
      });

      test("a query cancelled while its parameters are read is rejected and never sent", async () => {
        await using sql = await connect();
        const select = (parameter: object) => sql`SELECT ${parameter} IS NOT NULL AS bound`;
        await select({});
        let first: unknown;
        const sent = await counted(sql, async () => {
          const query: SQL.Query<any> = select({
            toJSON() {
              query.cancel();
              return "x";
            },
          });
          first = await outcome(query);
        });
        expect({ first, sent, next: await select({}) }).toEqual({
          first: cancelled,
          sent: { prepare: 0, close: 0, execute: 0 },
          next: [{ bound: 1 }],
        });
      });

      test("a cancelled query of a transaction does not run and the others are committed", async () => {
        const { sql, insert, ids } = await connectWithTable();
        await using _sql = sql;
        const outcomes = await sql.begin(async tx => {
          const inFront = preparing(tx).execute();
          const first = insert(1, tx).execute();
          const second = insert(2, tx).execute();
          const outcomes = Promise.all([outcome(inFront), outcome(first), outcome(second)]);
          second.cancel();
          return (await outcomes).map(result => (result instanceof Array ? "ran" : result));
        });
        expect({ outcomes, ids: await ids() }).toEqual({ outcomes: ["ran", "ran", cancelled], ids: [0, 1] });
      });
    });

    describe("transaction status", () => {
      // The pool asks the native connection. A test reaches it as the first argument of a native query's run().
      async function nativeConnection(sql: Tag) {
        const warm: any = sql`SELECT 1`;
        await warm;
        const prototype = Object.getPrototypeOf(
          warm[Object.getOwnPropertySymbols(warm).find(symbol => symbol.description === "handle")!],
        );
        const run = prototype.run;
        const query: any = sql`SELECT 1`;
        let connection: { inTransaction: boolean } | undefined;
        prototype.run = function (...args: unknown[]) {
          connection = args[0] as typeof connection;
          return run.apply(this, args);
        };
        try {
          // A reservation has its connection, so this call is the one that runs the handle.
          query.execute();
        } finally {
          prototype.run = run;
        }
        await query;
        return connection!;
      }

      test("inTransaction is what the server said in its last reply", async () => {
        await using sql = await connect();
        await using reserved = await sql.reserve();
        const connection = await nativeConnection(reserved);
        const seen: Record<string, boolean> = { connected: connection.inTransaction };
        const branch = `status_${randomUUIDv7("hex")}`;
        for (const [step, text] of [
          ["begin", "BEGIN"],
          ["query", "SELECT 1"],
          ["error", "SELECT no_such_column"],
          ["commit", "COMMIT"],
          ["start", "START TRANSACTION"],
          ["rollback", "ROLLBACK"],
          ["xaStart", `XA START '${branch}'`],
          ["xaEnd", `XA END '${branch}'`],
          ["xaPrepare", `XA PREPARE '${branch}'`],
          ["xaCommit", `XA COMMIT '${branch}'`],
        ]) {
          await outcome(reserved.unsafe(text).simple());
          seen[step] = connection.inTransaction;
        }
        await reserved`BEGIN`.simple();
        await reserved`SELECT ${1} AS x`;
        seen.prepared = connection.inTransaction;
        await reserved`ROLLBACK`.simple();
        expect(seen).toEqual({
          connected: false,
          begin: true,
          query: true,
          error: true,
          commit: false,
          start: true,
          rollback: false,
          xaStart: true,
          xaEnd: true,
          // On MariaDB a prepared branch is its session's until that commits it or ends. MySQL 8 detaches it.
          xaPrepare: image === "mariadb_plain",
          xaCommit: false,
          prepared: true,
        });
      });
    });

    describe("results", () => {
      test.each<[string, Record<string, unknown>, string, number]>([
        ["none by default", {}, "", 0],
        ["none with foundRows: false", { foundRows: false }, "", 0],
        ["the rows it matched with foundRows: true", { foundRows: true }, "", 2],
        ["the rows it matched with ?foundRows=true", {}, "?foundRows=true", 2],
      ])("an UPDATE that changes nothing affects %s", async (_, options, query, affected) => {
        await container.ready;
        await using sql = new SQL({ url: url() + query, max: 1, ...options });
        await sql`CREATE TEMPORARY TABLE found_rows (id INT PRIMARY KEY, v INT)`.simple();
        await sql`INSERT INTO found_rows VALUES (1, 1), (2, 1), (3, 1)`.simple();
        const prepared = await sql`UPDATE found_rows SET v = ${1} WHERE id <= ${2}`;
        const simple = await sql`UPDATE found_rows SET v = 1 WHERE id <= 2`.simple();
        const changed = await sql`UPDATE found_rows SET v = ${2} WHERE id <= ${2}`;
        expect({
          prepared: prepared.affectedRows,
          simple: simple.affectedRows,
          changed: changed.affectedRows,
        }).toEqual({ prepared: affected, simple: affected, changed: 2 });
      });

      const keys: [key: string, plain: unknown, withBigint: unknown][] = [
        ["5", 5, 5],
        ["4294967296", 4294967296, 4294967296],
        ["9007199254740991", 9007199254740991, 9007199254740991],
        ["9007199254740992", "9007199254740992", 9007199254740992n],
        ["9007199254740993", "9007199254740993", 9007199254740993n],
        ["18446744073709551614", "18446744073709551614", 18446744073709551614n],
      ];
      test.each([false, true])("lastInsertRowid is exact with bigint: %p", async bigint => {
        await using sql = await connect({ bigint });
        await sql`CREATE TEMPORARY TABLE big_keys (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, k INT)`.simple();
        const got: unknown[] = [];
        for (const [key] of keys) {
          const prepared = await sql`INSERT INTO big_keys (id, k) VALUES (${key}, ${1})`;
          await sql`DELETE FROM big_keys`.simple();
          const simple = await sql.unsafe(`INSERT INTO big_keys (id, k) VALUES (${key}, 1)`).simple();
          got.push([key, prepared.lastInsertRowid, simple.lastInsertRowid]);
        }
        expect(got).toEqual(
          keys.map(([key, plain, withBigint]) => [key, ...Array(2).fill(bigint ? withBigint : plain)]),
        );
      });
    });
  });
}

// What follows needs a packet at an exact place in the stream, or the client's end of the socket.
describe("scripted server", () => {
  /** Answers the handshake and the session setup; `onCommand` gets what comes after. `atSessionSetup` replaces the reply to the setup. */
  function mysqlServer(script: {
    atSessionSetup?: (socket: net.Socket, connection: number) => boolean;
    onCommand?: (socket: net.Socket, payload: Buffer) => void;
    onSocket?: (socket: net.Socket) => void;
  }) {
    let connections = 0;
    return listeningServer(socket => {
      const connection = ++connections;
      let buffered: Buffer = Buffer.alloc(0);
      let state: "auth" | "setup" | "ready" = "auth";
      script.onSocket?.(socket);
      socket.on("error", () => {});
      socket.write(mysqlHandshakeV10());
      socket.on("data", chunk => {
        buffered = mysqlReadPackets(Buffer.concat([buffered, chunk]), (seq, payload) => {
          if (state === "auth") {
            state = "setup";
            socket.write(mysqlOkPacket(seq + 1));
          } else if (state === "setup") {
            state = "ready";
            if (!script.atSessionSetup?.(socket, connection)) mysqlAckSessionSetup(socket, payload);
          } else {
            script.onCommand?.(socket, payload);
          }
        });
      });
    });
  }

  // Before the handshake no capability is agreed on, so a server leaves out the '#' and the SQLSTATE.
  test.each([
    ["as a server writes it", mysqlRawPacket(0, Buffer.from("\xff\x10\x04Too many connections", "latin1")), undefined],
    ["with an SQLSTATE", mysqlErrPacket(0, 1040, "08004", "Too many connections"), "08004"],
  ])("an ERR packet in the place of the greeting, %s, is the server's error", async (_, refusal, sqlState) => {
    let connections = 0;
    const closed = Promise.withResolvers<any>();
    const { port, server } = await listeningServer(socket => {
      connections++;
      socket.on("error", () => {});
      socket.end(refusal);
    });
    try {
      await using sql = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1, onclose: closed.resolve });
      const err: any = await sql`SELECT 1`.catch(err => err);
      expect(err).toBeInstanceOf(SQL.MySQLError);
      expect({ code: err.code, errno: err.errno, sqlState: err.sqlState, message: err.message, connections }).toEqual({
        code: "ERR_MYSQL_SERVER_ERROR",
        errno: 1040,
        sqlState,
        message: "Too many connections",
        connections: 1,
      });
      expect(await closed.promise).toBe(err);
    } finally {
      server.close();
    }
  });

  test("a connection that the server ends in the read that established it is not given to a query", async () => {
    let connected = 0;
    const { port, server } = await mysqlServer({
      // The first connection only: the OK that completes the setup and the ERR that ends the session, in one write.
      atSessionSetup(socket, connection) {
        if (connection > 1) return false;
        socket.end(Buffer.concat([mysqlOkPacket(1), mysqlErrPacket(0, 1053, "08S01", "Server shutdown in progress")]));
        return true;
      },
      onCommand: socket => void socket.write(mysqlOkPacket(1)),
    });
    try {
      const sql = new SQL({
        url: `mysql://root@127.0.0.1:${port}/db`,
        max: 1,
        onconnect: err => void (err || connected++),
      });
      const first: any = await sql`SELECT 1`.simple().catch(err => err);
      const second = await outcome(sql`SELECT 1`.simple());
      await sql.close();
      expect({ first: [first.code, first.errno, first.message], second, connected }).toEqual({
        first: ["ERR_MYSQL_SERVER_ERROR", 1053, "Server shutdown in progress"],
        second: [],
        connected: 1,
      });
    } finally {
      server.close();
    }
  });

  test("an ERR packet that answers no query closes the connection with the server's error", async () => {
    const closed = Promise.withResolvers<any>();
    let socket!: net.Socket;
    const { port, server } = await mysqlServer({
      onSocket: accepted => void (socket = accepted),
      onCommand: socket => void socket.write(mysqlOkPacket(1)),
    });
    try {
      await using sql = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1, onclose: closed.resolve });
      await sql`SELECT 1`.simple();
      socket.write(
        mysqlErrPacket(0, 4031, "HY000", "The client was disconnected by the server because of inactivity."),
      );
      const err = await closed.promise;
      expect([err.code, err.errno, err.message]).toEqual([
        "ERR_MYSQL_SERVER_ERROR",
        4031,
        "The client was disconnected by the server because of inactivity.",
      ]);
    } finally {
      server.close();
    }
  });

  test("a request for a local file fails the connection, and gets no answer", async () => {
    const commands: number[] = [];
    const left = Promise.withResolvers<void>();
    const { port, server } = await mysqlServer({
      onSocket: socket => void socket.on("close", () => left.resolve()),
      onCommand(socket, payload) {
        commands.push(payload[0]);
        // The ERR settles the query of a client that reads on.
        socket.write(
          Buffer.concat([
            mysqlRawPacket(1, Buffer.from("\xfb/etc/hostname", "latin1")),
            mysqlErrPacket(2, 1064, "42000", "read on"),
          ]),
        );
      },
    });
    try {
      await using sql = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1 });
      expect(await outcome(sql`SELECT 1`.simple())).toEqual({ rejected: "ERR_MYSQL_UNEXPECTED_PACKET" });
      await left.promise;
      expect(commands).toEqual([COM_QUERY]);
    } finally {
      server.close();
    }
  });

  /** A result of one row, which names the query that it answers. */
  const owner = (name: string, startSeq: number, statusFlags?: number) =>
    mysqlTextResultSet(startSeq, [{ name: "owner", type: 0xfd }], [[name]], statusFlags);

  test("a text whose further result does not come has nothing written behind it", async () => {
    const commands: string[] = [];
    const promised = Promise.withResolvers<net.Socket>();
    const { port, server } = await mysqlServer({
      onCommand(socket, payload) {
        const text = payload.toString("latin1", 1);
        commands.push(text);
        if (text.includes(";")) {
          socket.write(mysqlOkPacket(1, 0x00, MYSQL_SERVER_MORE_RESULTS_EXISTS));
          promised.resolve(socket);
        } else {
          socket.write(owner(text, 1));
        }
      },
    });
    try {
      await using sql = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1 });
      const queries = ["DO 1; DO 2", "A", "B"].map(text => outcome(sql.unsafe(text).simple()));
      const socket = await promised.promise;
      await loopbackFence();
      const whileItWaits = [...commands];
      socket.write(mysqlOkPacket(2));
      expect({ whileItWaits, outcomes: await Promise.all(queries), commands }).toEqual({
        whileItWaits: ["DO 1; DO 2"],
        outcomes: [[[], []], [{ owner: "A" }], [{ owner: "B" }]],
        commands: ["DO 1; DO 2", "A", "B"],
      });
    } finally {
      server.close();
    }
  });

  test("a packet that is not the next one of the reply fails the connection, and nobody gets its rows", async () => {
    const { port, server } = await mysqlServer({
      onCommand(socket, payload) {
        const text = payload.toString("latin1", 1);
        // The first command is promised a further result. What comes is the reply to the second one, which starts at 1.
        if (text === "A") socket.write(owner(text, 1, MYSQL_SERVER_MORE_RESULTS_EXISTS));
        else socket.end(owner(text, 1));
      },
    });
    try {
      await using sql = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1 });
      expect(await Promise.all(["A", "B", "C"].map(text => outcome(sql.unsafe(text).simple())))).toEqual(
        Array(3).fill({ rejected: "ERR_MYSQL_UNEXPECTED_PACKET" }),
      );
    } finally {
      server.close();
    }
  });

  test("an ERR packet in the place of a promised result, with an id of its own, is why the connection ends", async () => {
    const { port, server } = await mysqlServer({
      onCommand(socket) {
        socket.end(
          Buffer.concat([
            mysqlOkPacket(1, 0x00, MYSQL_SERVER_MORE_RESULTS_EXISTS),
            mysqlErrPacket(0, 4031, "HY000", "The client was disconnected by the server because of inactivity."),
          ]),
        );
      },
    });
    try {
      await using sql = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1 });
      const errno = (text: string) =>
        sql
          .unsafe(text)
          .simple()
          .then(
            () => "resolved",
            reason => reason.errno,
          );
      expect(await Promise.all(["DO 1; DO 2", "DO 3"].map(errno))).toEqual([4031, 4031]);
    } finally {
      server.close();
    }
  });

  test.skipIf(isWindows)("a unix socket that is not there rejects with its path", async () => {
    const path = "/nonexistent/dir/mysql.sock";
    await using sql = new SQL({ adapter: "mysql", path, username: "root", database: "db", max: 1 });
    const err: any = await sql`SELECT 1`.catch(err => err);
    expect(err).toBeInstanceOf(SQL.MySQLError);
    expect({ code: err.code, message: err.message }).toEqual({
      code: "ERR_MYSQL_CONNECTION_REFUSED",
      message: `Failed to connect to ${path}`,
    });
  });

  // The kernel's view of the client's socket, as in fetch-tcp-keepalive.test.ts: "02" is the keepalive timer.
  test.skipIf(!isLinux)("a TCP connection has keepalive on", async () => {
    const { port, server } = await mysqlServer({ onCommand: socket => void socket.write(mysqlOkPacket(1)) });
    try {
      await using sql = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1 });
      // Its reply acknowledges everything the client sent, so no retransmit timer hides the keepalive timer.
      await sql`SELECT 1`.simple();
      const remote = ":" + port.toString(16).toUpperCase().padStart(4, "0");
      const timers = (await Bun.file("/proc/self/net/tcp").text())
        .split("\n")
        .map(line => line.trim().split(/\s+/))
        .filter(columns => columns[2]?.endsWith(remote) && columns[3] === "01")
        .map(columns => columns[5].split(":")[0]);
      expect(timers).toEqual(["02"]);
    } finally {
      server.close();
      await once(server, "close");
    }
  });
});
