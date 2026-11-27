// The counts of sql.stats, on scripted servers: what a real server does with a pool is in sql-pool.test.ts.
import { SQL } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { once } from "node:events";
import net from "node:net";
import {
  listeningServer,
  mysqlAckSessionSetup,
  mysqlHandshakeV10,
  mysqlOkPacket,
  mysqlReadPackets,
  pgAuthenticationOk,
  pgCommandComplete,
  pgReadyForQuery,
} from "./wire-frames";

/** "resolved", or the code it was rejected with. Calls then() itself, so a lazy query starts in this call. */
const outcome = (promise: PromiseLike<unknown>): PromiseLike<string> =>
  promise.then(
    () => "resolved",
    err => err?.code ?? `${err}`,
  );

const nextTurn = () => new Promise<void>(resolve => setImmediate(resolve));

class Calls {
  count = 0;
  #waiting = new Map<number, PromiseWithResolvers<void>>();
  hit = () => void this.#waiting.get(++this.count)?.resolve();
  reached(n: number) {
    if (this.count >= n) return Promise.resolve();
    let waiting = this.#waiting.get(n);
    if (!waiting) this.#waiting.set(n, (waiting = Promise.withResolvers<void>()));
    return waiting.promise;
  }
}

const scripted = [
  {
    adapter: "postgres",
    url: (port: number) => `postgres://u@127.0.0.1:${port}/db`,
    prefix: "ERR_POSTGRES_",
    ready(socket: net.Socket, answers = false) {
      socket.once("data", () => {
        socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
        if (answers) socket.on("data", () => this.answer(socket));
      });
    },
    answer: (socket: net.Socket) => socket.write(Buffer.concat([pgCommandComplete("SELECT 0"), pgReadyForQuery()])),
  },
  {
    adapter: "mysql",
    url: (port: number) => `mysql://u@127.0.0.1:${port}/db`,
    prefix: "ERR_MYSQL_",
    ready(socket: net.Socket, answers = false) {
      let buffered: Buffer = Buffer.alloc(0);
      let authenticated = false;
      socket.write(mysqlHandshakeV10());
      socket.on("data", chunk => {
        buffered = mysqlReadPackets(Buffer.concat([buffered, chunk]), (seq, payload) => {
          if (authenticated) return void (mysqlAckSessionSetup(socket, payload) || (answers && this.answer(socket)));
          authenticated = true;
          socket.write(mysqlOkPacket(seq + 1));
        });
      });
    },
    answer: (socket: net.Socket) => socket.write(mysqlOkPacket(1)),
  },
];

describe.each(scripted)("$adapter", script => {
  const { url, prefix } = script;
  /** It logs in, and answers no query. */
  const ready = (socket: net.Socket) => script.ready(socket);
  /** It also answers each simple query. */
  const serving = (socket: net.Socket) => script.ready(socket, true);
  async function serverOf(onSocket: (socket: net.Socket, nth: number) => void) {
    const sockets: net.Socket[] = [];
    let probes = 0;
    const { port, server } = await listeningServer(socket => {
      socket.on("error", () => {});
      onSocket(socket, sockets.push(socket));
    });
    return {
      port,
      sockets,
      /** How many connections the pool has dialed. One of our own is accepted after them. */
      async dials() {
        const probe = net.connect(port, "127.0.0.1");
        await once(probe, "connect");
        while (!sockets.some(socket => socket.remotePort === probe.localPort)) await nextTurn();
        probe.destroy();
        return sockets.length - ++probes;
      },
      async [Symbol.asyncDispose]() {
        for (const socket of sockets) socket.destroy();
        server.close();
        await once(server, "close");
      },
    };
  }

  /** close() would wait for a query that the server does not answer. */
  const unanswered = (sql: SQL) => ({ [Symbol.asyncDispose]: () => sql.close({ timeout: 0 }) });

  const stats = (counts: Partial<SQL.PoolStats>) => ({
    connections: 0,
    opening: 0,
    idle: 0,
    leased: 0,
    waiting: 0,
    ...counts,
  });

  test.concurrent("is a read-only own accessor, and a read of it dials nothing", async () => {
    await using server = await serverOf(ready);
    await using sql = new SQL({ url: url(server.port), max: 3 });
    expect(Object.getOwnPropertyDescriptor(sql, "stats")).toEqual({
      get: expect.any(Function),
      set: undefined,
      enumerable: true,
      configurable: false,
    });
    expect(Object.keys(sql)).toContain("stats");
    const first = sql.stats;
    expect(first).toEqual(stats({}));
    expect(Object.getPrototypeOf(first)).toBe(Object.prototype);
    expect(sql.stats).not.toBe(first);
    expect(() => {
      (sql as { stats: unknown }).stats = first;
    }).toThrow(TypeError);
    expect(await server.dials()).toBe(0);
  });

  test.concurrent("counts what opens, what is leased, what is busy and who waits", async () => {
    await using server = await serverOf(ready);
    const connected = new Calls();
    const sql = new SQL({ url: url(server.port), max: 2, onconnect: connected.hit });
    await using _ = unanswered(sql);

    // A cold pool opens `max` connections for its first caller.
    const first = sql.reserve();
    expect(sql.stats).toEqual(stats({ opening: 2, waiting: 1 }));
    const holder = await first;
    await connected.reached(2);
    expect(sql.stats).toEqual(stats({ connections: 2, idle: 1, leased: 1 }));

    // The server does not answer it: the connection that was idle stays busy.
    outcome(sql.unsafe("select 1").simple().execute());
    expect(sql.stats).toEqual(stats({ connections: 2, leased: 1 }));

    const second = sql.reserve();
    expect(sql.stats).toEqual(stats({ connections: 2, leased: 1, waiting: 1 }));
    await holder.release();
    await using _second = await second;
    expect(sql.stats).toEqual(stats({ connections: 2, leased: 1 }));
  });

  test.concurrent("counts a query that waits for the pool to open, and none on a full pool that shares", async () => {
    await using server = await serverOf(ready);
    const connected = new Calls();
    const sql = new SQL({ url: url(server.port), max: 2, onconnect: connected.hit });
    await using _ = unanswered(sql);
    const query = () => void outcome(sql.unsafe("select 1").simple().execute());

    query();
    expect(sql.stats).toEqual(stats({ opening: 2, waiting: 1 }));
    await connected.reached(2);
    // Nothing is answered: five queries share two connections, and none of them waits.
    for (let i = 0; i < 4; i++) query();
    expect(sql.stats).toEqual(stats({ connections: sql.options.max }));
  });

  test.concurrent("counts a query that waits because every connection is leased", async () => {
    await using server = await serverOf(ready);
    const sql = new SQL({ url: url(server.port), max: 2 });
    await using _ = unanswered(sql);
    await using _first = await sql.reserve();
    await using _second = await sql.reserve();
    outcome(sql.unsafe("select 1").simple().execute());
    expect(sql.stats).toEqual(stats({ connections: 2, leased: 2, waiting: 1 }));
  });

  test.concurrent("counts the connection of a query as idle once the query has settled", async () => {
    await using server = await serverOf(serving);
    await using sql = new SQL({ url: url(server.port), max: 1 });
    const query = sql.unsafe("select 1").simple().execute();
    expect(sql.stats).toEqual(stats({ opening: 1, waiting: 1 }));
    // The first reaction of the caller already sees it.
    expect(await query.then(() => sql.stats)).toEqual(stats({ connections: 1, idle: 1 }));
    await sql.unsafe("select 1").simple();
    expect(sql.stats).toEqual(stats({ connections: 1, idle: 1 }));
  });

  test.concurrent("counts a connection that Bun closes at idleTimeout", async () => {
    await using server = await serverOf(ready);
    const closed = new Calls();
    const inOnClose: SQL.PoolStats[] = [];
    await using sql = new SQL({
      url: url(server.port),
      max: 1,
      idleTimeout: 0.01,
      onclose() {
        inOnClose.push(sql.stats!);
        closed.hit();
      },
    });
    await sql.connect();
    await closed.reached(1);
    expect(inOnClose).toEqual([stats({})]);
    expect(sql.stats).toEqual(stats({}));
  });

  test.concurrent("counts the connection of a transaction as leased, until the transaction ends", async () => {
    await using server = await serverOf(serving);
    await using sql = new SQL({ url: url(server.port), max: 1 });
    const inside = await sql.begin(async tx => {
      await tx.unsafe("select 1").simple();
      return sql.stats;
    });
    expect(inside).toEqual(stats({ connections: 1, leased: 1 }));
    expect(sql.stats).toEqual(stats({ connections: 1, idle: 1 }));
  });

  test.concurrent("only the client of the pool has it", async () => {
    await using server = await serverOf(serving);
    await using sql = new SQL({ url: url(server.port), max: 2 });
    const has: Record<string, boolean> = { sql: "stats" in sql };
    {
      await using reserved = await sql.reserve();
      has.reserved = "stats" in reserved;
    }
    await sql.begin(async tx => {
      has.tx = "stats" in tx;
      await tx.savepoint(sp => void (has.sp = "stats" in sp));
    });
    expect(has).toEqual({ sql: true, reserved: false, tx: false, sp: false });
  });

  test.concurrent("counts a connection as opening while it waits to dial again", async () => {
    const connected = new Calls();
    // The first dial is accepted and closed before the handshake: the pool dials again after a pause.
    await using server = await serverOf((socket, nth) => (nth === 1 ? socket.destroy() : ready(socket)));
    await using sql = new SQL({ url: url(server.port), max: 1, onconnect: connected.hit });
    const connecting = sql.connect();
    const seen = new Set<string>();
    while (connected.count === 0) {
      seen.add(JSON.stringify(sql.stats));
      await nextTurn();
    }
    await connecting;
    expect(Array.from(seen)).toEqual([JSON.stringify(stats({ opening: 1, waiting: 1 }))]);
    expect(server.sockets.length).toBe(2);
    expect(sql.stats).toEqual(stats({ connections: 1, idle: 1 }));
  });

  test.concurrent("counts while close() waits, and counts nothing once the pool is closed", async () => {
    await using server = await serverOf(ready);
    const sql = new SQL({ url: url(server.port), max: 1 });
    const busy = outcome(sql.unsafe("select 1").simple().execute());
    await sql.connect();
    const closing = sql.close({ timeout: 60 });
    expect(sql.stats).toEqual(stats({ connections: 1 }));
    await sql.close({ timeout: 0 });
    await closing;
    expect(await busy).toBe(prefix + "CONNECTION_CLOSED");
    expect(sql.stats).toEqual(stats({}));
  });

  if (script.adapter === "postgres") {
    test.concurrent("does not count the connection of listen()", async () => {
      await using server = await serverOf(serving);
      await using sql = new SQL({ url: url(server.port), max: 2 });
      await using _ = await sql.listen("channel", () => {});
      expect(server.sockets.length).toBe(1);
      expect(sql.stats).toEqual(stats({}));
    });
  }
});

describe.concurrent("where there is no pool", () => {
  test("a SQLite client, its transaction and its savepoint have none", async () => {
    await using sql = new SQL("sqlite://:memory:");
    const has: Record<string, boolean> = { sql: "stats" in sql };
    await sql.begin(async tx => {
      has.tx = "stats" in tx;
      await tx.savepoint(sp => void (has.sp = "stats" in sp));
    });
    expect(has).toEqual({ sql: false, tx: false, sp: false });
    expect(sql.stats).toBeUndefined();
  });

  test("Bun.sql.stats is the same accessor, whatever Object.prototype has", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        Object.prototype.configurable = true;
        const { get, ...rest } = Object.getOwnPropertyDescriptor(Bun.sql, "stats");
        delete Object.prototype.configurable;
        console.log(JSON.stringify({ get: typeof get, ...rest }));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ get: "function", enumerable: true, configurable: false });
    expect(exitCode).toBe(0);
  });

  // `made`: Bun.sql.options makes the default client, as any use of Bun.sql does.
  test.each([
    ["a pool", "postgres://u@127.0.0.1:1/db", true, { connections: 0, opening: 0, idle: 0, leased: 0, waiting: 0 }],
    ["SQLite", "sqlite://app.db", true, null],
    ["nothing that Bun.sql can open", "gopher://127.0.0.1/db", false, null],
  ])("Bun.sql.stats does not make the default client, which has %s", async (_, url, made, after) => {
    using dir = tempDir("sql-default-stats", {});
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { existsSync } = require("node:fs");
        const read = () => [Bun.sql.stats ?? null, { ...Bun.sql }.stats ?? null];
        const result = { keys: Object.keys(Bun.sql).includes("stats"), before: read(), opened: existsSync("app.db") };
        try {
          Bun.sql.options;
          result.made = true;
        } catch {
          result.made = false;
        }
        result.after = read();
        console.log(JSON.stringify(result));
        `,
      ],
      env: { ...bunEnv, DATABASE_URL: url },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      keys: true,
      before: [null, null],
      opened: false,
      made,
      after: [after, after],
    });
    expect(exitCode).toBe(0);
  });
});
