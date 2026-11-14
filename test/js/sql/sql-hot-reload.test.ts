import { SQL } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, describeWithContainer, tempDir } from "harness";
import { randomBytes } from "node:crypto";
import { renameSync, writeFileSync } from "node:fs";
import path from "node:path";

const prelude = /* ts */ `
import { SQL } from "bun";
const url = process.env.SQL_URL;
const sessionId = async sql => Number((await sql.unsafe(process.env.SQL_SESSION_ID))[0].id);
// Two reservations at a time cannot share a connection.
const sessions = async sql => {
  const reserved = await Promise.all([sql.reserve(), sql.reserve()]);
  const ids = await Promise.all(reserved.map(sessionId));
  await Promise.all(reserved.map(one => one.release()));
  return ids.sort((a, b) => a - b);
};
const report = value => console.log(JSON.stringify({ load, ...value }));
// It runs until the test closes the pipe, or is gone.
globalThis.parent ??= process.stdin.on("end", () => process.exit()).resume();
globalThis.closed ??= [];
const onclose = err => void globalThis.closed.push(err.code);
// sql.listen(channel, hear(name)) notes "<name> <payload>". heard(count): the notes, once there are that many.
const channel = process.env.SQL_CHANNEL;
globalThis.notes ??= [];
const hear = name => payload => {
  globalThis.notes.push(name + " " + payload);
  globalThis.wake?.();
};
const heard = async count => {
  while (globalThis.notes.length < count) await new Promise(resolve => (globalThis.wake = resolve));
  return globalThis.notes.splice(0).sort();
};
const notify = (sql, payload) => sql.unsafe("select pg_notify('" + channel + "', '" + payload + "')");
`;

class HotProgram {
  #dir = tempDir("sql-hot-reload", {});
  #env: Record<string, string>;
  #loads = 0;
  #proc: Bun.Subprocess<"pipe", "pipe", "inherit"> | undefined;
  #reader: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>> | undefined;
  #buffered = "";
  #decoder = new TextDecoder();

  constructor(env: Record<string, string>) {
    this.#env = env;
  }

  /** Saves the file and resolves with what that load of it reports: `{ error }` when it throws. */
  async load(body: string, imports = ""): Promise<any> {
    const load = this.#loads++;
    const file = path.join(String(this.#dir), "program.ts");
    writeFileSync(
      file + ".next",
      `const load = ${load};${prelude}${imports}\ntry {${body}} catch (err) { report({ error: String(err) }); }\n`,
    );
    renameSync(file + ".next", file);
    // --hot does not see a file outside of the working directory being replaced.
    this.#proc ??= Bun.spawn({
      cmd: [bunExe(), "--hot", "--no-clear-screen", file],
      cwd: String(this.#dir),
      env: { ...bunEnv, ...this.#env },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
    });
    this.#reader ??= this.#proc.stdout.getReader();
    for (;;) {
      const newline = this.#buffered.indexOf("\n");
      if (newline === -1) {
        const { value, done } = await this.#reader.read();
        if (done) throw new Error(`the program exited with ${await this.#proc.exited} before load ${load} reported`);
        this.#buffered += this.#decoder.decode(value, { stream: true });
        continue;
      }
      const line = this.#buffered.slice(0, newline);
      this.#buffered = this.#buffered.slice(newline + 1);
      if (!line.startsWith("{")) continue;
      const { load: reportedBy, ...report } = JSON.parse(line);
      if (reportedBy === load) return report;
    }
  }

  async stop() {
    this.#proc?.kill();
    await this.#proc?.exited;
    this.#dir[Symbol.dispose]();
  }
}

/** `tag` tells the sessions of one program from everybody else's on the server. */
const servers = [
  {
    image: "postgres_plain",
    url: (host: string, port: number, tag: string) =>
      `postgres://bun_sql_test@${host}:${port}/bun_sql_test?application_name=${tag}`,
    otherDatabase: (host: string, port: number, tag: string) =>
      `postgres://bun_sql_test@${host}:${port}/postgres?application_name=${tag}`,
    create: (_tag: string): string[] => [],
    drop: (_tag: string): string[] => [],
    sessionId: "select pg_backend_pid() as id",
    count: (tag: string) => `select count(*)::int as n from pg_stat_activity where application_name = '${tag}'`,
    lock: (tag: string) => `select pg_advisory_lock(hashtext('${tag}'))`,
    unlock: (tag: string) => `select pg_advisory_unlock(hashtext('${tag}'))`,
    waitForLock: (tag: string) => `select pg_advisory_xact_lock(hashtext('${tag}'))`,
    closed: "ERR_POSTGRES_CONNECTION_CLOSED",
  },
  {
    image: "mysql_plain",
    url: (host: string, port: number, tag: string) => `mysql://root@${host}:${port}/${tag}`,
    otherDatabase: (host: string, port: number, tag: string) => `mysql://root@${host}:${port}/${tag}_other`,
    create: (tag: string) => [`create database ${tag}`, `create database ${tag}_other`],
    drop: (tag: string) => [`drop database if exists ${tag}`, `drop database if exists ${tag}_other`],
    sessionId: "select connection_id() as id",
    count: (tag: string) =>
      `select count(*) as n from information_schema.processlist where db in ('${tag}', '${tag}_other')`,
    lock: (tag: string) => `select get_lock('${tag}', 60)`,
    unlock: (tag: string) => `select release_lock('${tag}')`,
    waitForLock: (tag: string) => `select get_lock('${tag}', 60), release_lock('${tag}')`,
    closed: "ERR_MYSQL_CONNECTION_CLOSED",
  },
];

for (const server of servers) {
  describeWithContainer(server.image, { image: server.image, concurrent: true }, container => {
    let admin: SQL;
    const running = new Set<AsyncDisposable>();

    beforeAll(() => {
      admin = new SQL(server.url(container.host, container.port, "bun_sql_test"), { max: 1 });
    });
    afterAll(async () => {
      // A row that timed out never gets to the end of its `await using`.
      for (const program of running) await program[Symbol.asyncDispose]();
      await admin.close();
    });

    async function start() {
      const tag = `bun_hot_${randomBytes(6).toString("hex")}`;
      const { host, port } = container;
      const defaultClient = new URL(server.url(host, port, tag));
      defaultClient.searchParams.set("max", "2");
      const program = new HotProgram({
        SQL_URL: server.url(host, port, tag),
        SQL_OTHER_URL: server.otherDatabase(host, port, tag),
        DATABASE_URL: defaultClient.href,
        SQL_SESSION_ID: server.sessionId,
        SQL_WAIT_FOR_LOCK: server.waitForLock(tag),
        SQL_CHANNEL: tag,
      });
      const open = async () => Number((await admin.unsafe(server.count(tag)))[0].n);
      const row = {
        load: program.load.bind(program),
        /** How many sessions the program has on the server. */
        open,
        /** The same once it is `expected`: the server ends a session some time after the client closed the socket. */
        async settlesAt(expected: number) {
          const deadline = Date.now() + 10_000;
          let n: number;
          while ((n = await open()) !== expected && Date.now() < deadline);
          return n;
        },
        /** The server answers SQL_WAIT_FOR_LOCK after `unlock()`. */
        lock: () => admin.unsafe(server.lock(tag)),
        unlock: () => admin.unsafe(server.unlock(tag)),
        endListenSession: () =>
          admin.unsafe(
            `select pg_terminate_backend(pid) from pg_stat_activity where application_name = '${tag}' and query ~ '^(UN)?LISTEN '`,
          ),
        async [Symbol.asyncDispose]() {
          running.delete(row);
          await program.stop();
          for (const statement of server.drop(tag)) await admin.unsafe(statement);
        },
      };
      running.add(row);
      for (const statement of server.create(tag)) await admin.unsafe(statement);
      return row;
    }

    const sameSettings = /* ts */ `
      let connected = 0;
      const sql = new SQL(url, { max: 2, onconnect: () => void connected++, onclose });
      report({ ids: await sessions(sql), connected, closed: globalThis.closed });
    `;

    test("a pool with the same settings takes over the connections of the load before", async () => {
      await using program = await start();
      const first = await program.load(sameSettings);
      expect(first).toEqual({ ids: [expect.any(Number), expect.any(Number)], connected: 2, closed: [] });
      for (let i = 0; i < 3; i++) {
        // The instance of this load hears of its two connections, the one before of no close.
        expect(await program.load(sameSettings)).toEqual(first);
        expect(await program.open()).toBe(2);
      }
      // `max` is the pool's and `bigint` the queries', not the connections'. The third one is dialed.
      expect(
        await program.load(`
          const sql = new SQL(url, { max: 3, bigint: true });
          report({ ids: await sessions(sql) });
        `),
      ).toEqual({ ids: first.ids });
      expect(await program.settlesAt(3)).toBe(3);
    });

    test("the first query of a load takes over the whole pool", async () => {
      await using program = await start();
      const body = /* ts */ `
        let connected = 0;
        const all = Promise.withResolvers();
        const sql = new SQL(url, { max: 3, onconnect: () => void (++connected === 3 && all.resolve()), onclose });
        const query = sql.unsafe("select 1").execute();
        const inTheCall = connected;
        await query;
        await all.promise;
        report({ inTheCall, closed: globalThis.closed });
      `;
      expect(await program.load(body)).toEqual({ inTheCall: 0, closed: [] });
      for (let i = 0; i < 2; i++) {
        expect(await program.load(body)).toEqual({ inTheCall: 3, closed: [] });
        expect(await program.open()).toBe(3);
      }
    });

    test("also when the first query of a load comes from a Bun.serve() handler", async () => {
      await using program = await start();
      const serve = /* ts */ `
        const sql = new SQL(url, { max: 2 });
        const server = Bun.serve({ port: 0, fetch: async () => Response.json(await sessions(sql)) });
        report({ url: server.url });
      `;
      const ids: unknown[] = [];
      for (let i = 0; i < 3; i++) {
        const { url } = await program.load(serve);
        ids.push(await (await fetch(url)).json());
      }
      expect(ids[0]).toEqual([expect.any(Number), expect.any(Number)]);
      expect(ids).toEqual([ids[0], ids[0], ids[0]]);
      expect(await program.open()).toBe(2);
    });

    // A pool that nobody asks for a connection during a whole load is one that the program did not keep.
    test.each<[string, string, number]>([
      ["database", `url: process.env.SQL_OTHER_URL`, 2],
      ["maxLifetime", `url, maxLifetime: 3600`, 2],
      // Never the same settings, so the load before has two of its own.
      ["password, now a function", `url, password: () => ""`, 4],
    ])("other settings (%s) close them at the load after", async (_, options, left) => {
      await using program = await start();
      const before = await program.load(sameSettings);
      const changed = /* ts */ `
        const sql = new SQL({ ${options}, max: 2 });
        report({ ids: await sessions(sql), closed: globalThis.closed });
      `;
      const after = await program.load(changed);
      expect(after).toEqual({ ids: [expect.any(Number), expect.any(Number)], closed: [] });
      expect(after.ids.filter((id: number) => before.ids.includes(id))).toEqual([]);
      expect(await program.open()).toBe(4);
      expect((await program.load(changed)).closed).toEqual([server.closed, server.closed]);
      expect(await program.settlesAt(left)).toBe(left);
    });

    test.each<[string, string]>([
      ["a password that is a function, even the same one,", `password: (globalThis.password ??= () => "")`],
      ["a transform.column.from of this load", `transform: { column: { from: name => name } }`],
    ])("%s is never the same settings", async (_, option) => {
      await using program = await start();
      const seen: number[] = [];
      for (let i = 0; i < 4; i++) {
        const report = await program.load(`
          const sql = new SQL(url, { max: 2, ${option} });
          report({ ids: await sessions(sql) });
        `);
        expect(report).toEqual({ ids: [expect.any(Number), expect.any(Number)] });
        seen.push(...report.ids);
        // Those of this load and of the one before.
        const open = i === 0 ? 2 : 4;
        expect(await program.settlesAt(open)).toBe(open);
      }
      expect(new Set(seen).size).toBe(8);
    });

    /** Its transaction is open until `commit.resolve()`. `transaction` resolves with the session that committed. */
    const heldTransaction = /* ts */ `
      const sql = new SQL(url, { max: 1 });
      const held = Promise.withResolvers();
      globalThis.commit = Promise.withResolvers();
      globalThis.transaction = sql.begin(async tx => {
        held.resolve(await sessionId(tx));
        await globalThis.commit.promise;
        return await sessionId(tx);
      });
      report({ id: await held.promise });
    `;

    test("other settings close a connection that is busy when it is idle", async () => {
      await using program = await start();
      const { id } = await program.load(heldTransaction);
      const changed = /* ts */ `
        const sql = new SQL({ url, maxLifetime: 3600, max: 1 });
        await sessionId(sql);
      `;
      expect(await program.load(`${changed} report({});`)).toEqual({});
      expect(await program.open()).toBe(2);
      expect(
        await program.load(`${changed}
          globalThis.commit.resolve();
          report({ committedOn: await globalThis.transaction });
        `),
      ).toEqual({ committedOn: id });
      expect(await program.settlesAt(1)).toBe(1);
    });

    test("a connection that runs a query of the load before stays with it", async () => {
      await using program = await start();
      await program.lock();
      const { id } = await program.load(`
        const sql = new SQL(url, { max: 1 });
        const id = await sessionId(sql);
        globalThis.answered = sql.unsafe(process.env.SQL_WAIT_FOR_LOCK).execute();
        report({ id });
      `);
      const next = await program.load(`
        const sql = new SQL(url, { max: 1 });
        report({ mine: await sessionId(sql) });
      `);
      expect(next).toEqual({ mine: expect.any(Number) });
      expect(next.mine).not.toBe(id);
      await program.unlock();
      expect(await program.load(`report({ answered: (await globalThis.answered).length });`)).toEqual({ answered: 1 });
    });

    test("a connection that a transaction of the load before holds stays with it", async () => {
      await using program = await start();
      const { id } = await program.load(heldTransaction);
      const next = await program.load(`
        const sql = new SQL(url, { max: 1 });
        const mine = await sessionId(sql);
        globalThis.commit.resolve();
        report({ mine, committedOn: await globalThis.transaction });
      `);
      expect(next).toEqual({ mine: expect.any(Number), committedOn: id });
      expect(next.mine).not.toBe(id);
    });

    test("an idle connection that the load before left in a transaction stays with it", async () => {
      await using program = await start();
      const { id } = await program.load(`
        const sql = new SQL(url, { max: 1 });
        await sql.unsafe("begin");
        globalThis.rollback = async () => {
          await sql.unsafe("rollback");
          return await sessionId(sql);
        };
        report({ id: await sessionId(sql) });
      `);
      const next = await program.load(`
        const sql = new SQL(url, { max: 1 });
        report({ mine: await sessionId(sql), rolledBackOn: await globalThis.rollback() });
      `);
      expect(next).toEqual({ mine: expect.any(Number), rolledBackOn: id });
      expect(next.mine).not.toBe(id);
    });

    test("a pool that lost its last connection and dialed again is taken over like any other", async () => {
      await using program = await start();
      const first = await program.load(`
        const sql = new SQL(url, { max: 1 });
        await (await sql.reserve()).close();
        report({ id: await sessionId(sql) });
      `);
      expect(first).toEqual({ id: expect.any(Number) });
      expect(
        await program.load(`
          const sql = new SQL(url, { max: 1 });
          report({ id: await sessionId(sql) });
        `),
      ).toEqual(first);
    });

    test("code of the load before goes on", async () => {
      await using program = await start();
      const first = await program.load(`
        const sql = new SQL(url, { max: 2 });
        globalThis.before = () => sessions(sql);
        report({ ids: await sessions(sql) });
      `);
      const second = await program.load(`
        const sql = new SQL(url, { max: 2 });
        const ids = await sessions(sql);
        report({ ids, before: (await globalThis.before()).length });
      `);
      expect(second).toEqual({ ids: first.ids, before: 2 });
    });

    test.each<[string, string, string]>([
      ["globalThis.sql ??= new SQL()", "", `globalThis.sql ??= new SQL(url, { max: 2, onclose });`],
      ['import { sql } from "bun"', `import { sql } from "bun";`, ``],
    ])("%s keeps its connections", async (_, imports, declaration) => {
      await using program = await start();
      // Another pool comes and goes with every load.
      const body = /* ts */ `
        ${declaration}
        const other = new SQL(url, { max: 1, idleTimeout: 3600 });
        const others = await sessionId(other);
        report({ ids: await sessions(sql), others, closed: globalThis.closed });
      `;
      const first = await program.load(body, imports);
      expect(first).toEqual({ ids: [expect.any(Number), expect.any(Number)], others: expect.any(Number), closed: [] });
      for (let i = 0; i < 2; i++) {
        expect(await program.load(body, imports)).toEqual(first);
      }
      expect(await program.open()).toBe(3);
    });

    test("a pool that the program keeps and uses is left alone when every load has a pool with other settings", async () => {
      await using program = await start();
      const body = /* ts */ `
        globalThis.sql ??= new SQL(url, { max: 2, onclose });
        const other = new SQL(url, { max: 1, password: () => "" });
        await sessionId(other);
        report({ ids: await sessions(sql), closed: globalThis.closed });
      `;
      const first = await program.load(body);
      expect(first).toEqual({ ids: [expect.any(Number), expect.any(Number)], closed: [] });
      for (let i = 0; i < 3; i++) {
        expect(await program.load(body)).toEqual(first);
      }
      // Its two, and the other pool's of this load and of the one before.
      expect(await program.settlesAt(4)).toBe(4);
    });

    test("a pool that the program keeps is left alone by one with the same settings that every load makes", async () => {
      await using program = await start();
      const body = /* ts */ `
        globalThis.sql ??= new SQL(url, { max: 2 });
        const mine = new SQL(url, { max: 2 });
        report({ mine: await sessions(mine), kept: await sessions(sql) });
      `;
      const first = await program.load(body);
      expect(new Set([...first.mine, ...first.kept]).size).toBe(4);
      for (let i = 0; i < 3; i++) {
        expect(await program.load(body)).toEqual(first);
      }
      expect(await program.open()).toBe(4);
    });

    if (server.image !== "postgres_plain") return;

    test("sql.listen() of every load is on the connection of the first, which goes on hearing", async () => {
      await using program = await start();
      for (let load = 0; load < 6; load++) {
        expect(
          await program.load(`
            const sql = new SQL(url, { max: 1 });
            await sql.listen(channel, hear(load));
            await notify(sql, "x");
            report({ heard: await heard(load + 1) });
          `),
        ).toEqual({ heard: Array.from({ length: load + 1 }, (_, earlier) => `${earlier} x`) });
        // That connection, and the one of the pool.
        expect(await program.open()).toBe(2);
      }
    });

    test("sql.listen() with other settings has a connection of its own", async () => {
      await using program = await start();
      for (const [options, open] of [
        ["url", 1],
        ["url, maxLifetime: 3600", 2],
      ]) {
        expect(
          await program.load(`
            const sql = new SQL({ ${options}, max: 1 });
            await sql.listen(channel, hear(load));
            report({});
          `),
        ).toEqual({});
        expect(await program.open()).toBe(open);
      }
    });

    test("close() of a pool leaves what another pool listens to on the same connection", async () => {
      await using program = await start();
      for (let i = 0; i < 3; i++) {
        expect(
          await program.load(`
            globalThis.sql ??= new SQL(url, { max: 1 });
            globalThis.kept ??= await sql.listen(channel, hear("kept"));
            const mine = new SQL(url, { max: 1 });
            await mine.listen(channel, hear("mine"));
            await notify(sql, "both");
            const both = await heard(2);
            const late = mine.listen(channel, hear("late")).then(() => "resolved", err => err.code);
            await mine.close();
            await notify(sql, "one");
            report({ both, late: await late, one: await heard(1) });
          `),
        ).toEqual({ both: ["kept both", "mine both"], late: server.closed, one: ["kept one"] });
        expect(await program.settlesAt(2)).toBe(2);
      }
    });

    test("a connection that drops is dialed again for every pool that still listens on it", async () => {
      await using program = await start();
      const listen = (name: string, on: string) => /* ts */ `
        globalThis.${name} = new SQL(url, { max: 1 });
        await ${name}.listen(${on}, hear("${name}"), () => hear("${name}")("listens"));
        report({ heard: await heard(1) });
      `;
      expect(await program.load(listen("first", "channel"))).toEqual({ heard: ["first listens"] });
      expect(await program.load(listen("second", `channel + "_2"`))).toEqual({ heard: ["second listens"] });
      expect(await program.open()).toBe(1);

      await program.endListenSession();
      expect(await program.load(`report({ heard: await heard(2) });`)).toEqual({
        heard: ["first listens", "second listens"],
      });

      // The pool that joined last, which would dial, is gone.
      expect(await program.load(`await second.close(); report({});`)).toEqual({});
      await program.endListenSession();
      expect(
        await program.load(`
          const again = await heard(1);
          await notify(first, "x");
          report({ again, heard: await heard(1) });
        `),
      ).toEqual({ again: ["first listens"], heard: ["first x"] });
      expect(await program.open()).toBe(2);
    });
  });
}
