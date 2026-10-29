// COPY ... FROM STDIN through query.writable() and COPY ... TO STDOUT through query.readable().
import { SQL } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, describeWithContainer, tempDir, withoutAsanQuarantine } from "harness";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import {
  pgCommandComplete,
  pgCopyBothResponse,
  pgCopyData,
  pgCopyDone,
  pgCopyInResponse,
  pgCopyOutResponse,
  pgDataRow,
  pgErrorResponse,
  pgHold,
  pgMockServer,
  pgReadyForQuery,
  pgRowDescription,
} from "./wire-frames";

const MiB = 1024 * 1024;
/** One row of a one-column table in text format. */
const rowOfOneMiB = Buffer.alloc(MiB, "x");
rowOfOneMiB[MiB - 1] = 0x0a;

const outcome = (promise: PromiseLike<unknown>) =>
  promise.then(
    () => "fulfilled",
    e => e,
  );
const failure = (e: any) => ({ code: e.code, errno: e.errno, message: e.message });
const summary = (result: any) => ({ command: result.command, count: result.count, rows: [...result] });
const copied = (count: number) => ({ command: "COPY", count, rows: [] });
const withoutStream = {
  code: "ERR_POSTGRES_COPY_NOT_SUPPORTED",
  errno: undefined,
  message: "COPY ... FROM STDIN needs query.writable() and COPY ... TO STDOUT needs query.readable()",
};

async function byteLength(stream: ReadableStream<Uint8Array>) {
  let length = 0;
  for await (const chunk of stream) length += chunk.byteLength;
  return length;
}

const pidOf = async (sql: SQL) => (await sql`select pg_backend_pid() as pid`)[0].pid as number;
const rowsOf = async (sql: SQL) => [...(await sql`select a, b from copied order by a`.values())];

const copyOutOfMiB = (rows: number) =>
  `copy (select repeat('x', ${MiB - 1}) from generate_series(1, ${rows})) to stdout`;
/** In MiB. Linux lets the two sockets of a connection hold 10 MiB, and a port proxy doubles that. */
const moreThanTheSocketsHold = 32;

/** A COPY TO STDOUT whose consumer has taken one chunk and stopped. Returns once the server has stopped too. */
async function aConsumerThatStopped(sql: SQL, monitor: SQL) {
  const pid = await pidOf(sql);
  const query = sql.unsafe(copyOutOfMiB(moreThanTheSocketsHold));
  const stream = query.readable();
  const reader = stream.getReader();
  const received = (await reader.read()).value!.byteLength;

  // The backend says that it waits for room in its socket, at the same row, ten times in a row. Each question is a
  // round trip, so the event loop runs in between: a client that still read would let the backend go on, to the end
  // of the COPY, where the row of the progress view is gone.
  let rowsSent = -1;
  for (let times = 0; times < 10;) {
    const [backend] = await monitor`
      select tuples_processed::int as rows, wait_event
      from pg_stat_progress_copy join pg_stat_activity using (pid) where pid = ${pid}`;
    expect(backend).toBeDefined();
    times = backend.wait_event === "ClientWrite" && backend.rows === rowsSent ? times + 1 : 0;
    rowsSent = backend.rows;
  }
  expect(rowsSent).toBeLessThan(moreThanTheSocketsHold);

  reader.releaseLock();
  return { query, stream, received };
}

async function eightMiB(from: SQL, to: SQL) {
  await to`create temporary table big (a text)`;
  const target = to`copy big from stdin`;
  await from.unsafe(copyOutOfMiB(8)).readable().pipeTo(target.writable());
  expect(summary(await target)).toEqual(copied(8));
  expect(await to`select sum(length(a))::int as length from big`).toEqual([{ length: 8 * (MiB - 1) }]);
}

type Container = { host: string; port: number; ready: Promise<void> };
const urlOf = (container: Container) => `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`;
const connectTo = (container: Container) =>
  async function connect(options: SQL.Options = {}) {
    await container.ready;
    return new SQL(urlOf(container), { max: 1, ...options });
  };

describeWithContainer("postgres", { image: "postgres_plain", concurrent: true }, container => {
  const connect = connectTo(container);
  /** One session with the temporary table `copied (a int, b text)`. */
  const session = async (options?: SQL.Options) => {
    const sql = await connect(options);
    await sql`create temporary table copied (a int, b text)`;
    return sql;
  };

  describe.each<[string, SQL.Options, (sql: SQL) => [SQL.Query<any>, SQL.Query<any>]]>([
    ["a tagged template", {}, sql => [sql`copy copied from stdin`, sql`copy copied to stdout`]],
    ["prepare: false", { prepare: false }, sql => [sql`copy copied from stdin`, sql`copy copied to stdout`]],
    [".simple()", {}, sql => [sql`copy copied from stdin`.simple(), sql`copy copied to stdout`.simple()]],
    ["sql.unsafe()", {}, sql => [sql.unsafe("copy copied from stdin"), sql.unsafe("copy copied to stdout")]],
  ])("%s", (_, options, queries) => {
    test("a row goes in and comes out, twice", async () => {
      await using sql = await session(options);
      for (let run = 1; run <= 2; run++) {
        const [from, to] = queries(sql);
        const writer = from.writable().getWriter();
        await writer.write(`${run}\trow\n`);
        await writer.close();
        expect(summary(await from)).toEqual(copied(1));

        expect(await to.readable().text()).toBe("1\trow\n2\trow\n".slice(0, run * 6));
        expect(summary(await to)).toEqual(copied(run));
      }
    });
  });

  test.each(["text", "csv", "binary"])("format %s brings every value back", async format => {
    await using sql = await connect();
    await sql`create temporary table source (a int, b text, c bytea, d timestamptz)`;
    await sql`create temporary table target (like source)`;
    const rows = [
      { a: 1, b: "plain", c: Buffer.from([0, 255, 10, 13]), d: new Date("2024-01-02T03:04:05.678Z") },
      { a: 2, b: 'tab\t newline\n return\r quote" comma, backslash\\ \\N \\. é 😀', c: Buffer.alloc(0), d: null },
      { a: 3, b: "", c: null, d: null },
      { a: 4, b: null, c: null, d: null },
    ];
    await sql`insert into source ${sql(rows)}`;

    const bytes = await sql.unsafe(`copy source to stdout (format ${format})`).readable().bytes();
    if (format === "binary") {
      expect(Buffer.from(bytes.subarray(0, 11)).toString("latin1")).toBe("PGCOPY\n\xff\r\n\0");
    }
    // Where a chunk ends means nothing to the server.
    const writer = sql.unsafe(`copy target from stdin (format ${format})`).writable().getWriter();
    for (let i = 0; i < bytes.length; i += 7) writer.write(bytes.subarray(i, i + 7));
    await writer.close();

    expect([...(await sql`select * from target order by a`)]).toEqual(rows);
  });

  test("takes strings, views of every kind and buffers", async () => {
    await using sql = await session();
    const bytes = (text: string) => Uint8Array.from(Buffer.from(text));
    const writer = sql`copy copied from stdin`.writable().getWriter();
    for (const chunk of [
      "1\té 😀\n",
      bytes("2\ttwo\n"),
      Buffer.from("..3\tthree\n..").subarray(2, -2),
      bytes("4\tfour\n").buffer,
      new DataView(bytes(".5\tfive\n").buffer, 1),
      new Uint16Array(bytes("6\tsixes\n").buffer),
      "",
      new Uint8Array(0),
    ]) {
      await writer.write(chunk);
    }
    await writer.close();
    expect(await rowsOf(sql)).toEqual([
      [1, "é 😀"],
      [2, "two"],
      [3, "three"],
      [4, "four"],
      [5, "five"],
      [6, "sixes"],
    ]);
  });

  test.each([[1], [{}], [undefined]])("a chunk that is %p fails the write and the COPY", async chunk => {
    await using sql = await session();
    const pid = await pidOf(sql);
    const query = sql`copy copied from stdin`;
    const writer = query.writable().getWriter();
    await writer.write("1\tone\n");

    const err = await outcome(writer.write(chunk as any));
    expect(err).toBeInstanceOf(TypeError);
    expect(err.code).toBe("ERR_INVALID_ARG_TYPE");
    expect(await outcome(writer.closed)).toBe(err);
    expect(failure(await outcome(query))).toMatchObject({ code: "ERR_POSTGRES_SERVER_ERROR", errno: "57014" });
    expect([await pidOf(sql), await rowsOf(sql)]).toEqual([pid, []]);
  });

  test("from a file and to a file", async () => {
    const csv = '1,one\n2,"two, too"\n';
    using dir = tempDir("postgres-copy", { "in.csv": csv });
    await using sql = await session();
    await Bun.file(path.join(String(dir), "in.csv"))
      .stream()
      .pipeTo(sql`copy copied from stdin (format csv)`.writable());
    await Bun.write(
      path.join(String(dir), "out.csv"),
      new Response(sql`copy copied to stdout (format csv)`.readable()),
    );
    expect(await Bun.file(path.join(String(dir), "out.csv")).text()).toBe(csv);
  });

  test("stream.pipeline() takes both", async () => {
    await using from = await session();
    await using to = await session();
    await from`insert into copied values (1, 'one'), (2, 'two')`;
    // @types/node does not know that it takes a WritableStream.
    await pipeline(from`copy copied to stdout`.readable(), to`copy copied from stdin`.writable() as any);
    expect(await rowsOf(to)).toEqual([
      [1, "one"],
      [2, "two"],
    ]);
  });

  describe("a COPY FROM STDIN that fails", () => {
    const badInteger = {
      code: "ERR_POSTGRES_SERVER_ERROR",
      errno: "22P02",
      message: 'invalid input syntax for type integer: "x"',
    };

    test("bad data rejects pipeTo() and the query with the server's error", async () => {
      await using sql = await session();
      const pid = await pidOf(sql);
      const query = sql`copy copied from stdin`;
      const err = await outcome(new Response("1\tone\nx\ttwo\n3\tthree\n").body!.pipeTo(query.writable()));
      expect(err).toBeInstanceOf(SQL.PostgresError);
      expect(failure(err)).toEqual(badInteger);
      expect(await outcome(query)).toBe(err);
      expect([await pidOf(sql), await rowsOf(sql)]).toEqual([pid, []]);
    });

    // bun:test reports an unhandled rejection as a failure.
    test("the query needs no handler of its own", async () => {
      await using sql = await session();
      const err = await outcome(new Response("x\n").body!.pipeTo(sql`copy copied from stdin`.writable()));
      expect(failure(err)).toEqual(badInteger);
      expect(await rowsOf(sql)).toEqual([]);
    });

    test.each([
      ["an Error", new Error("enough"), "Error: enough"],
      ["a string", "enough", "enough"],
      ["nothing", undefined, "aborted"],
      [
        "what cannot be made a string",
        {
          toString() {
            throw new Error("no");
          },
        },
        "aborted",
      ],
      // The server ends the session for a CopyFail of more than 10,000 bytes.
      ["20,000 bytes", Buffer.alloc(20_000, "é").toString(), Buffer.alloc(9_994, "é").toString()],
    ])("abort() with %s", async (_, reason, message) => {
      await using sql = await session();
      const pid = await pidOf(sql);
      const query = sql`copy copied from stdin`;
      const writer = query.writable().getWriter();
      await writer.write("1\tone\n");
      await writer.abort(reason);
      // abort() has waited for the server's answer.
      expect(Bun.peek.status(query)).toBe("rejected");
      expect(failure(await outcome(query))).toEqual({
        code: "ERR_POSTGRES_SERVER_ERROR",
        errno: "57014",
        message: "COPY from stdin failed: " + message,
      });
      expect([await pidOf(sql), await rowsOf(sql)]).toEqual([pid, []]);
    });

    test("abort() before the server has asked for the data", async () => {
      await using sql = await session();
      const query = sql`copy copied from stdin`;
      await query.writable().abort("too early");
      expect(failure(await outcome(query))).toMatchObject({ errno: "57014" });
      expect(await rowsOf(sql)).toEqual([]);
    });

    // A backend that waits for CopyData does not look at a CancelRequest.
    test("query.cancel()", async () => {
      await using sql = await session();
      const pid = await pidOf(sql);
      const query = sql`copy copied from stdin`;
      const writer = query.writable().getWriter();
      await writer.write("1\tone\n");
      query.cancel();
      const err = await outcome(writer.closed);
      expect(failure(err)).toMatchObject({ code: "ERR_POSTGRES_SERVER_ERROR", errno: "57014" });
      expect(await outcome(query)).toBe(err);
      expect([await pidOf(sql), await rowsOf(sql)]).toEqual([pid, []]);
    });

    test("query.cancel() before the server has asked for the data", async () => {
      await using sql = await session();
      const pid = await pidOf(sql);
      const query = sql`copy copied from stdin`;
      const writer = query.writable().getWriter();
      query.cancel();
      const err = await outcome(writer.closed);
      expect(failure(err)).toMatchObject({ code: "ERR_POSTGRES_SERVER_ERROR", errno: "57014" });
      expect(await outcome(query)).toBe(err);
      expect([await pidOf(sql), await rowsOf(sql)]).toEqual([pid, []]);
    });

    test("a source that breaks", async () => {
      await using sql = await session();
      const broke = new Error("the source broke");
      let pulls = 0;
      const source = new ReadableStream<string>(
        {
          pull(controller) {
            if (pulls++ === 0) controller.enqueue("1\tone\n");
            else controller.error(broke);
          },
        },
        { highWaterMark: 0 },
      );
      const query = sql`copy copied from stdin`;
      expect(await outcome(source.pipeTo(query.writable()))).toBe(broke);
      expect(failure(await outcome(query))).toMatchObject({
        errno: "57014",
        message: "COPY from stdin failed: Error: the source broke",
      });
      expect(await rowsOf(sql)).toEqual([]);
    });

    // The server sends CopyInResponse, then the error, without reading a byte.
    test("a trigger that raises before the first row", async () => {
      await using sql = await session();
      await sql`
        create function pg_temp.refuse() returns trigger language plpgsql as 'begin raise exception ''refused''; end';
        create trigger refuse before insert on copied for each statement execute function pg_temp.refuse();
      `.simple();
      const query = sql`copy copied from stdin`;
      const err = await outcome(new Response("1\tone\n").body!.pipeTo(query.writable()));
      expect(failure(err)).toMatchObject({ errno: "P0001", message: "refused" });
      expect(await outcome(query)).toBe(err);
      expect(await rowsOf(sql)).toEqual([]);
    });
  });

  test("cancel() in the middle leaves the session usable", async () => {
    await using sql = await connect();
    const pid = await pidOf(sql);
    const query = sql.unsafe(copyOutOfMiB(moreThanTheSocketsHold));
    const reader = query.readable().getReader();
    expect((await reader.read()).done).toBe(false);
    await reader.cancel();
    expect((await reader.read()).done).toBe(true);
    // With the rows it did not read, or with the server's word that it stopped.
    await outcome(query);
    expect(await pidOf(sql)).toBe(pid);
  });

  describe("with the rest of the client", () => {
    test("begin(): the transaction sees the rows, its rollback takes them", async () => {
      await using sql = await session();
      const rollback = new Error("rollback");
      const transaction = sql.begin(async tx => {
        const writer = tx`copy copied from stdin`.writable().getWriter();
        await writer.write("1\tone\n");
        await writer.close();
        expect(await tx`copy copied to stdout`.readable().text()).toBe("1\tone\n");
        throw rollback;
      });
      expect(await outcome(transaction)).toBe(rollback);
      expect(await rowsOf(sql)).toEqual([]);
    });

    test("begin(): a COPY that fails rolls the transaction back", async () => {
      await using sql = await session();
      const transaction = sql.begin(async tx => {
        await tx`insert into copied values (1, 'one')`;
        await new Response("x\n").body!.pipeTo(tx`copy copied from stdin`.writable());
      });
      expect(failure(await outcome(transaction))).toMatchObject({ errno: "22P02" });
      expect(await rowsOf(sql)).toEqual([]);
    });

    test("reserve()", async () => {
      await using sql = await connect({ max: 2 });
      using reserved = await sql.reserve();
      await reserved`create temporary table copied (a int, b text)`;
      await new Response("1\tone\n").body!.pipeTo(reserved`copy copied from stdin`.writable());
      expect(await reserved`copy copied to stdout`.readable().text()).toBe("1\tone\n");
    });

    test("a query queued on the connection runs after the COPY", async () => {
      await using sql = await session();
      await sql`select count(*)::int as rows from copied where a > ${0}`;
      const writer = sql`copy copied from stdin`.writable().getWriter();
      const behind = [
        sql`select count(*)::int as rows from copied where a > ${0}`,
        sql`select count(*)::int as rows from copied`.simple(),
      ].map(query => query.execute());
      await writer.write("1\tone\n");
      await writer.write("2\ttwo\n");
      await writer.close();
      expect(await Promise.all(behind)).toEqual([[{ rows: 2 }], [{ rows: 2 }]]);
    });

    test("between the statements of one query", async () => {
      await using sql = await session();
      const query = sql`insert into copied values (1, 'one'); copy copied to stdout; copy copied to stdout (format csv); select 7 as x`;
      expect(await query.readable().text()).toBe("1\tone\n1,one\n");
      expect((await query).map(summary)).toEqual([
        { command: "INSERT", count: 1, rows: [] },
        copied(1),
        copied(1),
        { command: "SELECT", count: 1, rows: [{ x: 7 }] },
      ]);
    });

    test("an error after the COPY of one query reaches the stream", async () => {
      await using sql = await session();
      const query = sql`copy (select 1) to stdout; select 1 / 0`;
      expect(failure(await outcome(query.readable().text()))).toMatchObject({ errno: "22012" });
    });

    test("the stream feeds the first COPY FROM STDIN of one query only", async () => {
      await using sql = await session();
      const query = sql`copy copied from stdin; copy copied from stdin`;
      const err = await outcome(new Response("1\tone\n").body!.pipeTo(query.writable()));
      expect(failure(err)).toEqual(withoutStream);
      expect(await rowsOf(sql)).toEqual([]);
    });

    test("sql.file()", async () => {
      using dir = tempDir("postgres-copy", { "export.sql": "copy (select 1, 'one') to stdout" });
      await using sql = await connect();
      expect(
        await sql
          .file(path.join(String(dir), "export.sql"))
          .readable()
          .text(),
      ).toBe("1\tone\n");
    });

    test("close() waits for the COPY", async () => {
      const sql = await session();
      const query = sql`copy copied from stdin`;
      const writer = query.writable().getWriter();
      await writer.write("1\tone\n");
      const closing = sql.close();
      await writer.write("2\ttwo\n");
      await writer.close();
      expect(summary(await query)).toEqual(copied(2));
      await closing;
    });

    test.each(["writable", "readable"] as const)("close({ timeout: 0 }) ends a %s stream", async direction => {
      const sql = await session();
      const closed = { code: "ERR_POSTGRES_CONNECTION_CLOSED" };
      if (direction === "writable") {
        const query = sql`copy copied from stdin`;
        const writer = query.writable().getWriter();
        await writer.write("1\tone\n");
        await sql.close({ timeout: 0 });
        expect(await outcome(writer.closed)).toMatchObject(closed);
        expect(await outcome(query)).toMatchObject(closed);
      } else {
        const query = sql.unsafe(copyOutOfMiB(moreThanTheSocketsHold));
        const reader = query.readable().getReader();
        await reader.read();
        await sql.close({ timeout: 0 });
        expect(await outcome(reader.closed)).toMatchObject(closed);
        expect(await outcome(query)).toMatchObject(closed);
      }
    });

    test("a session that the server ends in the middle of a COPY FROM STDIN", async () => {
      await using sql = await session();
      await using other = await connect();
      const pid = await pidOf(sql);
      const query = sql`copy copied from stdin`;
      const writer = query.writable().getWriter();
      await writer.write("1\tone\n");
      await other`select pg_terminate_backend(${pid})`;
      const err = await outcome(writer.closed);
      expect(failure(err)).toMatchObject({ code: "ERR_POSTGRES_SERVER_ERROR", errno: "57P01" });
      expect(await outcome(query)).toBe(err);
      expect(await sql`select 1 as x`).toEqual([{ x: 1 }]);
    });
  });

  describe("a stream that is open when its scope ends", () => {
    const copyInFailed = (scope: string) => ({
      code: "ERR_POSTGRES_SERVER_ERROR",
      errno: "57014",
      message: `COPY from stdin failed: the ${scope} ended before the COPY stream did`,
    });
    const copyOutFailed = (scope: string) => ({
      code: "ERR_POSTGRES_QUERY_CANCELLED",
      errno: undefined,
      message: `COPY to stdout failed: the ${scope} ended before the COPY stream did`,
    });
    const write = async (sql: SQL) => {
      const writer = sql`copy copied from stdin`.writable().getWriter();
      await writer.write("1\tone\n");
      return writer;
    };

    test.each<[string, (tx: SQL) => unknown, (scope: string) => object]>([
      ["a writable() that was written to", write, copyInFailed],
      ["a writable() that the server has not answered", tx => void tx`copy copied from stdin`.writable(), copyInFailed],
      [
        "a pipeTo() that nobody awaits",
        tx => void new Response("1\tone\n").body!.pipeTo(tx`copy copied from stdin`.writable()).catch(() => {}),
        copyInFailed,
      ],
      [
        "a readable() that was read from",
        tx => tx.unsafe(copyOutOfMiB(moreThanTheSocketsHold)).readable().getReader().read(),
        copyOutFailed,
      ],
      ["a readable() that the server has not answered", tx => void tx`copy copied to stdout`.readable(), copyOutFailed],
    ])("begin() that leaves %s rejects with the error of the COPY and rolls back", async (_, leaveOpen, expected) => {
      await using sql = await session();
      const pid = await pidOf(sql);
      const transaction = sql.begin(async tx => {
        await tx`insert into copied values (0, 'zero')`;
        await leaveOpen(tx);
      });
      expect(failure(await outcome(transaction))).toEqual(expected("transaction"));
      expect([await pidOf(sql), await rowsOf(sql)]).toEqual([pid, []]);
    });

    test("the stream fails with what begin() rejects with", async () => {
      await using sql = await session();
      let writer!: WritableStreamDefaultWriter;
      const err = await outcome(sql.begin(async tx => void (writer = await write(tx))));
      expect(failure(err)).toEqual(copyInFailed("transaction"));
      expect(await outcome(writer.closed)).toBe(err);
    });

    test("begin() whose callback throws rejects with what it threw", async () => {
      await using sql = await session();
      const thrown = new Error("thrown");
      const transaction = sql.begin(async tx => {
        await write(tx);
        throw thrown;
      });
      expect(await outcome(transaction)).toBe(thrown);
      expect(await rowsOf(sql)).toEqual([]);
    });

    test("a close() that nobody awaits, after a write() that was awaited, is left alone", async () => {
      await using sql = await session();
      await sql.begin(async tx => void (await write(tx)).close());
      expect(await rowsOf(sql)).toEqual([[1, "one"]]);
    });

    test("savepoint(): the transaction goes on", async () => {
      await using sql = await session();
      const err = await sql.begin(async tx => {
        const err = await outcome(tx.savepoint(write));
        await tx`insert into copied values (2, 'two')`;
        return err;
      });
      expect(failure(err)).toEqual(copyInFailed("savepoint"));
      expect(await rowsOf(sql)).toEqual([[2, "two"]]);
    });

    test("release(): the connection goes back to the pool", async () => {
      await using sql = await session();
      const reserved = await sql.reserve();
      const writer = await write(reserved);
      reserved.release();
      expect(failure(await outcome(writer.closed))).toEqual(copyInFailed("reservation"));
      expect(await rowsOf(sql)).toEqual([]);
    });
  });

  // The server would take what is written behind it for its data.
  test.each([
    "copy copied from stdin",
    " /* a /* nested */ comment */ -- and a line\r\tCoPy copied from stdin",
    " ;; copy copied from stdin",
  ])("nothing is written behind %j that nobody feeds", async text => {
    await using sql = await session();
    const pid = await pidOf(sql);
    const count = () => sql`select count(*)::int as rows from copied where a > ${0}`;
    await count();
    // On the second run a statement is prepared, and what is prepared is pipelined.
    for (let run = 0; run < 2; run++) {
      // With values a text is a prepared statement, but not this one.
      for (const copy of [() => sql`${sql.unsafe(text)}`, () => sql.unsafe(text, [1])]) {
        const all = [copy(), count(), count()].map(query => query.then(rows => [...rows], failure));
        expect(await Promise.all(all)).toEqual([withoutStream, [{ rows: 0 }], [{ rows: 0 }]]);
      }
    }
    expect(await pidOf(sql)).toBe(pid);
  });

  describe("a stream that does not fit the statement", () => {
    test.each([
      ["readable", "copy copied from stdin", withoutStream],
      ["writable", "copy copied to stdout", withoutStream],
      ["readable", "select 1", { ...withoutStream, message: "readable() needs a COPY ... TO STDOUT statement" }],
      ["writable", "select 1", { ...withoutStream, message: "writable() needs a COPY ... FROM STDIN statement" }],
      ["readable", "copy nowhere to stdout", { code: "ERR_POSTGRES_SERVER_ERROR", errno: "42P01" }],
      ["writable", "copy nowhere from stdin", { code: "ERR_POSTGRES_SERVER_ERROR", errno: "42P01" }],
    ] as const)("%s() of `%s`", async (direction, text, expected) => {
      await using sql = await session();
      const pid = await pidOf(sql);
      const query = sql.unsafe(text);
      const err = await outcome(
        direction === "readable" ? query.readable().text() : query.writable().getWriter().write("1\tone\n"),
      );
      expect(err).toBeInstanceOf(SQL.PostgresError);
      expect(failure(err)).toMatchObject(expected);
      expect([await pidOf(sql), await rowsOf(sql)]).toEqual([pid, []]);
    });

    test("a parameter", async () => {
      await using sql = await connect();
      const err = await outcome(sql`copy (select ${1}::int) to stdout`.readable().text());
      expect(err.message).toBe("simple query cannot have parameters");
      expect(await sql`select 1 as x`).toEqual([{ x: 1 }]);
    });

    test("a query that has started", async () => {
      await using sql = await connect();
      const started = { code: "ERR_INVALID_STATE" };
      const awaited = sql`select 1 as x`;
      await awaited;
      expect(() => awaited.readable()).toThrow(expect.objectContaining(started));
      expect(() => awaited.writable()).toThrow(expect.objectContaining(started));

      const streamed = sql`copy (select 1) to stdout`;
      const stream = streamed.readable();
      expect(() => streamed.readable()).toThrow(expect.objectContaining(started));
      expect(await stream.text()).toBe("1\n");
    });

    test("a cancelled query", async () => {
      await using sql = await connect();
      const err = await outcome(sql`copy (select 1) to stdout`.cancel().readable().text());
      expect(err.code).toBe("ERR_POSTGRES_QUERY_CANCELLED");
    });

    test("a call that is not tagged", async () => {
      await using sql = await connect();
      expect(() => sql("copied").readable()).toThrow(expect.objectContaining({ code: "ERR_POSTGRES_NOT_TAGGED_CALL" }));
    });
  });
});

// START_REPLICATION on a replication connection. Physical replication needs no slot and no wal_level=logical: it
// streams every WAL record. The superuser has the REPLICATION privilege.
describeWithContainer("postgres, replication", { image: "postgres_plain", concurrent: true }, container => {
  const connect = connectTo(container);
  const replication = async () => {
    await container.ready;
    const url = `postgres://postgres@${container.host}:${container.port}/bun_sql_test`;
    return new SQL(url, { max: 1, connection: { replication: "database" } });
  };
  /** The `r` message that the server wants within wal_sender_timeout, with `lsn` received, flushed and applied. */
  const standbyStatusUpdate = (lsn: bigint) => {
    const message = Buffer.alloc(34);
    message.write("r");
    for (const offset of [1, 9, 17]) message.writeBigUInt64BE(lsn, offset);
    message.writeBigInt64BE(BigInt(Date.now() - Date.UTC(2000, 0, 1)) * 1000n, 25);
    return message;
  };
  const parseLsn = (text: string) => {
    const [hi, lo] = text.split("/");
    return (BigInt("0x" + hi) << 32n) | BigInt("0x" + lo);
  };
  /** The server sends nothing until wal_sender_timeout / 2 on its own, so a WAL record is made for it to stream. */
  const startReplication = async (sql: SQL, wal: SQL) => {
    const [system] = await sql.unsafe("IDENTIFY_SYSTEM").simple();
    const query = sql.unsafe(`START_REPLICATION ${system.xlogpos} TIMELINE ${system.timeline}`);
    const reader = query.readable().getReader();
    const writer = query.writable().getWriter();
    await wal`select pg_logical_emit_message(true, 'bun', 'a record')`;
    const message = (await reader.read()).value!;
    // XLogData: 'w', walStart, walEnd, sendTime, data
    expect(String.fromCharCode(message[0])).toBe("w");
    const walEnd = Buffer.from(message).readBigUInt64BE(9);
    expect(walEnd).toBeGreaterThan(parseLsn(system.xlogpos));
    await writer.write(standbyStatusUpdate(walEnd));
    return { query, reader, writer };
  };

  test("the writable ends the replication, and the connection runs the next query", async () => {
    await using sql = await replication();
    await using wal = await connect();
    const { query, reader, writer } = await startReplication(sql, wal);
    await writer.close();
    // What the server sent before its CopyDone is still in the stream.
    for (let next = await reader.read(); !next.done; next = await reader.read()) {
      expect("wk").toContain(String.fromCharCode(next.value[0]));
    }
    // Resolves with one empty result per CommandComplete: START_STREAMING for the session, START_REPLICATION after.
    expect([...(await query)].flat()).toEqual([]);
    expect(await sql`select 1 as x`.simple()).toEqual([{ x: 1 }]);
  });

  test("cancelling the readable ends the replication, and the connection runs the next query", async () => {
    await using sql = await replication();
    await using wal = await connect();
    const { query, reader, writer } = await startReplication(sql, wal);
    await reader.cancel();
    expect(failure(await outcome(query))).toMatchObject({ code: "ERR_POSTGRES_QUERY_CANCELLED" });
    expect(failure(await outcome(writer.closed))).toMatchObject({ code: "ERR_POSTGRES_QUERY_CANCELLED" });
    expect(await sql`select 1 as x`.simple()).toEqual([{ x: 1 }]);
  });

  test("without a stream", async () => {
    await using sql = await replication();
    const [system] = await sql.unsafe("IDENTIFY_SYSTEM").simple();
    const query = sql.unsafe(`START_REPLICATION ${system.xlogpos} TIMELINE ${system.timeline}`).simple();
    expect(failure(await outcome(query))).toMatchObject({
      code: "ERR_POSTGRES_COPY_NOT_SUPPORTED",
      message: "START_REPLICATION needs query.readable()",
    });
    expect(await sql`select 1 as x`.simple()).toEqual([{ x: 1 }]);
  });
});

// One at a time: each keeps the thread busy, and a slow build has five seconds for a test.
describeWithContainer("postgres, megabytes", { image: "postgres_plain" }, container => {
  const connect = connectTo(container);

  test("20,000 rows from one server session to another", async () => {
    await using from = await connect();
    await using to = await connect();
    await to`create temporary table copied (a int, b text)`;
    const source = from`copy (select i, 'row ' || i from generate_series(1, 20000) i) to stdout`;
    const target = to`copy copied from stdin`;
    await source.readable().pipeTo(target.writable());
    expect([summary(await source), summary(await target)]).toEqual([copied(20000), copied(20000)]);
    expect(await to`select count(*)::int as rows, sum(a)::float8 as sum, max(b) as last from copied`).toEqual([
      { rows: 20000, sum: 200010000, last: "row 9999" },
    ]);
  });

  test("8 MiB from one server session to another", async () => {
    await using from = await connect();
    await using to = await connect();
    await eightMiB(from, to);
  });

  test("a consumer that stops reading stops the server", async () => {
    await using sql = await connect();
    await using monitor = await connect();
    const { stream, received } = await aConsumerThatStopped(sql, monitor);
    expect(received + (await byteLength(stream))).toBe(moreThanTheSocketsHold * MiB);
  });

  // The trigger holds the server at the first row for as long as another session has the lock.
  test.each([
    ["goes on when the server does", "return new"],
    ["rejects with the error of the server", "raise exception ''refused''"],
  ])("a write() that waits for a server that stopped reading %s", async (_, afterwards) => {
    await using sql = await connect();
    await using other = await connect();
    const pid = await pidOf(sql);
    const key = Math.floor(Math.random() * 2 ** 31);
    await sql.unsafe(`
      create temporary table slow (a text);
      create function pg_temp.wait() returns trigger language plpgsql as
        'begin perform pg_advisory_xact_lock(${key}); ${afterwards}; end';
      create trigger wait before insert on slow for each row execute function pg_temp.wait();
    `);
    await other`select pg_advisory_lock(${key})`;

    const query = sql`copy slow from stdin`;
    const writer = query.writable().getWriter();
    let accepted = 0;
    const writing = outcome(
      (async () => {
        for (; accepted < moreThanTheSocketsHold; accepted++) await writer.write(rowOfOneMiB);
        await writer.close();
      })(),
    );
    // The backend has the whole first row, so its write() was accepted. From here to the unlock it reads nothing:
    // what is accepted fills the sockets. Writes that did not wait for room would all be accepted by now.
    while ((await other`select wait_event from pg_stat_activity where pid = ${pid}`)[0].wait_event !== "advisory");
    expect(accepted).toBeGreaterThan(0);
    expect(accepted).toBeLessThan(moreThanTheSocketsHold);

    await other`select pg_advisory_unlock(${key})`;
    if (afterwards === "return new") {
      expect(await writing).toBe("fulfilled");
      expect(summary(await query)).toEqual(copied(moreThanTheSocketsHold));
    } else {
      const err = await writing;
      expect(failure(err)).toEqual({ code: "ERR_POSTGRES_SERVER_ERROR", errno: "P0001", message: "refused" });
      expect(await outcome(writer.closed)).toBe(err);
      expect(await outcome(query)).toBe(err);
      expect(await sql`select count(*)::int as rows from slow`).toEqual([{ rows: 0 }]);
    }
  });

  // A backend that waits for room in the socket does not look at a CancelRequest.
  test("query.cancel() ends a COPY TO STDOUT whose consumer has stopped", async () => {
    await using sql = await connect();
    await using monitor = await connect();
    const pid = await pidOf(sql);
    const { query, stream } = await aConsumerThatStopped(sql, monitor);
    query.cancel();
    const err = await outcome(stream.getReader().closed);
    expect(failure(err)).toEqual({
      code: "ERR_POSTGRES_QUERY_CANCELLED",
      errno: undefined,
      message: "COPY to stdout failed: Query cancelled",
    });
    expect(await outcome(query)).toBe(err);
    expect(await pidOf(sql)).toBe(pid);
  });

  test("a session that the server ends in the middle of a COPY TO STDOUT", async () => {
    await using sql = await connect();
    await using other = await connect();
    const pid = await pidOf(sql);
    const query = sql.unsafe(copyOutOfMiB(moreThanTheSocketsHold));
    const reader = query.readable().getReader();
    await reader.read();
    await other`select pg_terminate_backend(${pid})`;
    let err: any;
    try {
      while (!(await reader.read()).done);
    } catch (e) {
      err = e;
    }
    // A backend that is blocked on the socket hangs up without a word.
    expect(err).toBeInstanceOf(SQL.PostgresError);
    expect(["ERR_POSTGRES_CONNECTION_CLOSED", "ERR_POSTGRES_SERVER_ERROR"]).toContain(err.code);
    expect(await outcome(query)).toBe(err);
    expect(await sql`select 1 as x`).toEqual([{ x: 1 }]);
  });

  const run = async (script: string, rows: number) => {
    await container.ready;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: {
        ...withoutAsanQuarantine(bunEnv),
        COPY_URL: urlOf(container),
        COPY_TEXT: copyOutOfMiB(rows),
      },
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    return { stdout, exitCode };
  };

  // Rows of 1 MiB: every read of the socket ends inside a message.
  test.concurrent("a long COPY TO STDOUT is not kept in memory", async () => {
    const { stdout, exitCode } = await run(
      `
        const sql = new Bun.SQL(process.env.COPY_URL, { max: 1 });
        await sql\`select 1\`;
        const before = process.memoryUsage.rss();
        let bytes = 0;
        for await (const chunk of sql.unsafe(process.env.COPY_TEXT).readable()) bytes += chunk.byteLength;
        // The chunks that no collection has freed yet are not what is measured.
        Bun.gc(true);
        console.log(JSON.stringify({ bytes, grew: process.memoryUsage.rss() - before }));
        await sql.close();
      `,
      64,
    );
    const { bytes, grew } = JSON.parse(stdout);
    expect(bytes).toBe(64 * MiB);
    expect(grew).toBeLessThan(48 * MiB);
    expect(exitCode).toBe(0);
  });

  test.concurrent("a script that stops reading and ends is not kept alive", async () => {
    const script = `
      const sql = new Bun.SQL(process.env.COPY_URL, { max: 1 });
      const reader = sql.unsafe(process.env.COPY_TEXT).readable().getReader();
      console.log((await reader.read()).done);
    `;
    expect(await run(script, moreThanTheSocketsHold)).toEqual({ stdout: "false\n", exitCode: 0 });
  });
});

describeWithContainer("postgres over TLS", { image: "postgres_tls" }, container => {
  const connect = async () => {
    await container.ready;
    return new SQL(`postgres://postgres@${container.host}:${container.port}/bun_sql_test`, {
      max: 1,
      tls: { ca: Bun.file(path.join(import.meta.dir, "docker-tls", "server.crt")), serverName: "localhost" },
    });
  };

  test("8 MiB from one server session to another", async () => {
    await using from = await connect();
    await using to = await connect();
    await eightMiB(from, to);
  });

  test("a consumer that stops reading stops the server", async () => {
    await using sql = await connect();
    await using monitor = await connect();
    const { stream, received } = await aConsumerThatStopped(sql, monitor);
    expect(received + (await byteLength(stream))).toBe(moreThanTheSocketsHold * MiB);
  });
});

describe("the other adapters", () => {
  test.each(["sqlite://:memory:", "mysql://user@127.0.0.1:1/db"])("%s", async url => {
    await using sql = new SQL(url);
    const message = "readable() and writable() are not supported by this adapter (PostgreSQL only)";
    expect(() => sql`select 1`.readable()).toThrow(message);
    expect(() => sql`select 1`.writable()).toThrow(message);
  });
});

describe.concurrent("frames that a server cannot be made to send", () => {
  const text = (chunk: Uint8Array | undefined) => Buffer.from(chunk!).toString();

  test("a CopyData that arrives in two reads", async () => {
    const second = pgCopyData(Buffer.from("22\n"));
    const { port, server, release } = await pgMockServer(type =>
      type !== "Q"
        ? undefined
        : [
            pgCopyOutResponse([0]),
            pgCopyData(Buffer.from("1\n")),
            second.subarray(0, 6),
            pgHold,
            second.subarray(6),
            pgCopyData(Buffer.from("333\n")),
            pgCopyDone(),
            pgCommandComplete("COPY 3"),
            pgReadyForQuery(),
          ],
    );
    try {
      await using sql = new SQL(`postgres://u@127.0.0.1:${port}/db`, { max: 1 });
      const query = sql`copy t to stdout`;
      const reader = query.readable().getReader();
      // One chunk for each read of the socket, whatever the number of rows.
      expect(text((await reader.read()).value)).toBe("1\n");
      release();
      expect(text((await reader.read()).value)).toBe("22\n333\n");
      expect(await reader.read()).toEqual({ done: true, value: undefined });
      expect(summary(await query)).toEqual(copied(3));
    } finally {
      server.close();
    }
  });

  test("an ErrorResponse between two CopyData: nothing of the failed COPY reaches the next one", async () => {
    let queries = 0;
    const { port, server } = await pgMockServer(type =>
      type !== "Q"
        ? undefined
        : queries++ === 0
          ? [
              pgCopyOutResponse([0]),
              pgCopyData(Buffer.from("lost\n")),
              pgErrorResponse({ S: "ERROR", C: "22012", M: "division by zero" }),
              pgCopyData(Buffer.from("stray\n")),
              pgReadyForQuery(),
            ]
          : [
              pgCopyOutResponse([0]),
              pgCopyData(Buffer.from("kept\n")),
              pgCopyDone(),
              pgCommandComplete("COPY 1"),
              pgReadyForQuery(),
            ],
    );
    try {
      await using sql = new SQL(`postgres://u@127.0.0.1:${port}/db`, { max: 1 });
      const streams = [sql`copy a to stdout`.readable(), sql`copy b to stdout`.readable()];
      expect(failure(await outcome(streams[0].text()))).toMatchObject({ errno: "22012" });
      expect(await streams[1].text()).toBe("kept\n");
    } finally {
      server.close();
    }
  });

  test("what writable() puts on the wire", async () => {
    const wire: string[] = [];
    const { port, server } = await pgMockServer((type, body) => {
      wire.push(type + " " + body.toString().replaceAll("\0", ""));
      if (type === "Q") return pgCopyInResponse([0]);
      if (type === "c") return [pgCommandComplete("COPY 2"), pgReadyForQuery()];
      if (type === "f") return [pgErrorResponse({ S: "ERROR", C: "57014", M: "failed" }), pgReadyForQuery()];
    });
    try {
      await using sql = new SQL(`postgres://u@127.0.0.1:${port}/db`, { max: 1 });
      const done = sql`copy t from stdin`.writable().getWriter();
      await done.write("1\n");
      await done.write(Buffer.from("2\n"));
      await done.close();
      const failed = sql`copy t from stdin`.writable().getWriter();
      await failed.abort("why");
      expect(wire).toEqual(["Q copy t from stdin", "d 1\n", "d 2\n", "c ", "Q copy t from stdin", "f why"]);
    } finally {
      server.close();
    }
  });
});

// START_REPLICATION on a replication connection: CopyBothResponse, then CopyData both ways until a CopyDone from
// each side. The readable carries the server's CopyData, the writable the client's.
describe.concurrent("START_REPLICATION", () => {
  const text = (chunk: Uint8Array | undefined) => Buffer.from(chunk!).toString();
  const selectOne = [
    pgRowDescription([{ name: "x", typeOid: 23 }]),
    pgDataRow([Buffer.from("1")]),
    pgCommandComplete("SELECT 1"),
    pgReadyForQuery(),
  ];
  const needsReadable = {
    code: "ERR_POSTGRES_COPY_NOT_SUPPORTED",
    errno: undefined,
    message: "START_REPLICATION needs query.readable()",
  };
  const cancelled = { code: "ERR_POSTGRES_QUERY_CANCELLED" };
  const endOfCommand = [pgCommandComplete("COPY 0"), pgReadyForQuery()];
  /**
   * A walsender: CopyBothResponse and `data` to the START_REPLICATION, a CopyDone and the end of the command to the
   * client's. A `pgHold` first keeps the CopyBothResponse back until `release()`; `queried` says that it is held.
   */
  const walsender = async (wire: string[], data: (Buffer | typeof pgHold)[] = []) => {
    const queried = Promise.withResolvers<void>();
    const reply = data.map(frame => (frame === pgHold ? frame : pgCopyData(frame)));
    if (reply[0] === pgHold) reply.splice(1, 0, pgCopyBothResponse([0]));
    else reply.unshift(pgCopyBothResponse([0]));
    const server = await pgMockServer((type, body) => {
      wire.push(type + " " + body.toString().replaceAll("\0", ""));
      if (type !== "Q") return type === "c" ? [pgCopyDone(), ...endOfCommand] : undefined;
      if (!body.toString().startsWith("START_REPLICATION")) return selectOne;
      queried.resolve();
      return reply;
    });
    return { ...server, queried: queried.promise };
  };
  const connect = (port: number) => new SQL(`postgres://u@127.0.0.1:${port}/db`, { max: 1 });

  test("the writable ends the session, and the connection stays usable", async () => {
    const wire: string[] = [];
    const { port, server } = await walsender(wire, [Buffer.from("k1"), Buffer.from("w2")]);
    try {
      await using sql = connect(port);
      const query = sql.unsafe("START_REPLICATION 0/0");
      const reader = query.readable().getReader();
      const writer = query.writable().getWriter();
      // One chunk per CopyData, whatever the number of reads.
      expect(text((await reader.read()).value)).toBe("k1");
      expect(text((await reader.read()).value)).toBe("w2");
      await writer.write("r1");
      await writer.write(Buffer.from("r2"));
      await writer.close();
      expect(await reader.read()).toEqual({ done: true, value: undefined });
      expect(summary(await query)).toEqual(copied(0));
      expect(await sql`select 1 as x`.simple()).toEqual([{ x: 1 }]);
      expect(wire).toEqual(["Q START_REPLICATION 0/0", "d r1", "d r2", "c ", "Q select 1 as x"]);
    } finally {
      server.close();
    }
  });

  test.each([
    ["at once", false],
    ["while the server has not answered", true],
  ])("writable() first, then readable() %s", async (_, held) => {
    const wire: string[] = [];
    const { port, server, release, queried } = await walsender(
      wire,
      held ? [pgHold, Buffer.from("k1")] : [Buffer.from("k1")],
    );
    try {
      await using sql = connect(port);
      const query = sql.unsafe("START_REPLICATION 0/0");
      const writer = query.writable().getWriter();
      if (held) await queried;
      const reader = query.readable().getReader();
      release();
      expect(text((await reader.read()).value)).toBe("k1");
      await writer.write("r1");
      await writer.close();
      expect(await reader.read()).toEqual({ done: true, value: undefined });
      expect(await sql`select 1 as x`.simple()).toEqual([{ x: 1 }]);
      expect(wire).toEqual(["Q START_REPLICATION 0/0", "d r1", "c ", "Q select 1 as x"]);
    } finally {
      server.close();
    }
  });

  test("a stream added after the server has answered", async () => {
    const wire: string[] = [];
    const { port, server } = await walsender(wire, [Buffer.from("k1")]);
    try {
      await using sql = connect(port);
      const query = sql.unsafe("START_REPLICATION 0/0");
      const reader = query.readable().getReader();
      expect(text((await reader.read()).value)).toBe("k1");
      expect(() => query.writable()).toThrow(expect.objectContaining({ code: "ERR_INVALID_STATE" }));
      expect(() => query.readable()).toThrow(expect.objectContaining({ code: "ERR_INVALID_STATE" }));
      await reader.cancel();
      expect(failure(await outcome(query))).toMatchObject(cancelled);
    } finally {
      server.close();
    }
  });

  test("the server ends its side first: the client's CopyDone goes out, and the query ends", async () => {
    const wire: string[] = [];
    const { port, server } = await pgMockServer((type, body) => {
      wire.push(type + " " + body.toString().replaceAll("\0", ""));
      if (type === "Q") return [pgCopyBothResponse([0]), pgCopyData(Buffer.from("k1")), pgCopyDone()];
      if (type === "c") return endOfCommand;
    });
    try {
      await using sql = connect(port);
      const query = sql.unsafe("START_REPLICATION 0/0");
      const stream = query.readable();
      const writer = query.writable().getWriter();
      expect(await stream.text()).toBe("k1");
      expect(summary(await query)).toEqual(copied(0));
      await writer.close();
      expect(wire).toEqual(["Q START_REPLICATION 0/0", "c "]);
    } finally {
      server.close();
    }
  });

  test("the server ends its side first and then fails: the readable rejects", async () => {
    const { port, server, release } = await pgMockServer(type => {
      if (type === "Q") return [pgCopyBothResponse([0]), pgCopyData(Buffer.from("w1")), pgCopyDone(), pgHold];
      if (type === "c")
        return [pgErrorResponse({ S: "FATAL", C: "57P01", M: "terminating walsender" }), pgReadyForQuery()];
    });
    try {
      await using sql = connect(port);
      const query = sql.unsafe("START_REPLICATION 0/0");
      const writer = query.writable().getWriter();
      const seen: string[] = [];
      const loop = (async () => {
        for await (const chunk of query.readable()) {
          seen.push(text(chunk));
          release();
        }
      })();
      expect(failure(await outcome(loop))).toMatchObject({ code: "ERR_POSTGRES_SERVER_ERROR", errno: "57P01" });
      expect(seen).toEqual(["w1"]);
      expect(failure(await outcome(writer.closed))).toMatchObject({ errno: "57P01" });
    } finally {
      server.close();
    }
  });

  test("the readable alone: the server's CopyDone ends the query", async () => {
    const wire: string[] = [];
    const { port, server } = await pgMockServer((type, body) => {
      wire.push(type + " " + body.toString().replaceAll("\0", ""));
      if (type === "Q") return [pgCopyBothResponse([0]), pgCopyData(Buffer.from("k1")), pgCopyDone()];
      if (type === "c") return endOfCommand;
    });
    try {
      await using sql = connect(port);
      const query = sql.unsafe("START_REPLICATION 0/0");
      expect(await query.readable().text()).toBe("k1");
      expect(summary(await query)).toEqual(copied(0));
      expect(wire).toEqual(["Q START_REPLICATION 0/0", "c "]);
    } finally {
      server.close();
    }
  });

  // The server is told in band, not with a CancelRequest: the walsender raises an error on a
  // CancelRequest and drops the session's temporary slots. So no second connection is opened.
  test.each([
    ["the readable alone", false],
    ["both streams", true],
  ])("cancel() of %s ends the session with a CopyDone", async (_, withWriter) => {
    const wire: string[] = [];
    const { port, server } = await walsender(wire, [Buffer.from("k1")]);
    let connections = 0;
    server.on("connection", () => connections++);
    try {
      await using sql = connect(port);
      const query = sql.unsafe("START_REPLICATION 0/0");
      const reader = query.readable().getReader();
      const writer = withWriter ? query.writable().getWriter() : null;
      expect(text((await reader.read()).value)).toBe("k1");
      await reader.cancel();
      expect(failure(await outcome(query))).toMatchObject(cancelled);
      if (writer) expect(failure(await outcome(writer.closed))).toMatchObject(cancelled);
      expect(await sql`select 1 as x`.simple()).toEqual([{ x: 1 }]);
      expect(wire).toEqual(["Q START_REPLICATION 0/0", "c ", "Q select 1 as x"]);
      expect(connections).toBe(1);
    } finally {
      server.close();
    }
  });

  test("an error while the readable is full: the query rejects and the connection stays usable", async () => {
    const { port, server } = await pgMockServer((type, body) => {
      if (type === "Q" && body.toString().startsWith("START_REPLICATION")) {
        return [
          pgCopyBothResponse([0]),
          pgCopyData(Buffer.alloc(70 * 1024, "w")),
          pgErrorResponse({ S: "ERROR", C: "XX000", M: "boom" }),
          pgReadyForQuery(),
        ];
      }
      if (type === "Q") return selectOne;
    });
    try {
      await using sql = connect(port);
      const query = sql.unsafe("START_REPLICATION 0/0");
      const reader = query.readable().getReader();
      expect((await reader.read()).value!.byteLength).toBe(70 * 1024);
      expect(failure(await outcome(query))).toMatchObject({ code: "ERR_POSTGRES_SERVER_ERROR", errno: "XX000" });
      expect(failure(await outcome(reader.read()))).toMatchObject({ errno: "XX000" });
      expect(await sql`select 1 as x`.simple()).toEqual([{ x: 1 }]);
    } finally {
      server.close();
    }
  });

  test("cancel() before the server has answered", async () => {
    const wire: string[] = [];
    const { port, server, release, queried } = await walsender(wire, [pgHold, Buffer.from("k1")]);
    try {
      await using sql = connect(port);
      const query = sql.unsafe("START_REPLICATION 0/0");
      const reader = query.readable().getReader();
      await queried;
      await reader.cancel();
      release();
      expect(failure(await outcome(query))).toMatchObject(cancelled);
      expect(await sql`select 1 as x`.simple()).toEqual([{ x: 1 }]);
      expect(wire).toEqual(["Q START_REPLICATION 0/0", "c ", "Q select 1 as x"]);
    } finally {
      server.close();
    }
  });

  test("abort() of the writable ends the session with a CopyDone, and the query rejects with the reason", async () => {
    const wire: string[] = [];
    const { port, server } = await walsender(wire, [Buffer.from("k1")]);
    try {
      await using sql = connect(port);
      const query = sql.unsafe("START_REPLICATION 0/0");
      const reader = query.readable().getReader();
      const writer = query.writable().getWriter();
      expect(text((await reader.read()).value)).toBe("k1");
      await writer.abort(new Error("boom"));
      expect(failure(await outcome(query))).toEqual({ ...cancelled, errno: undefined, message: "Error: boom" });
      expect(failure(await outcome(reader.read()))).toMatchObject({ message: "Error: boom" });
      expect(await sql`select 1 as x`.simple()).toEqual([{ x: 1 }]);
      expect(wire).toEqual(["Q START_REPLICATION 0/0", "c ", "Q select 1 as x"]);
    } finally {
      server.close();
    }
  });

  // The readable applies backpressure in both directions: a chunk over its high water mark pauses
  // the socket, so memory stays bounded. The query resolves once the readable is read to its end,
  // so the reader must keep draining while the writable closes.
  test("close() of the writable while the readable is full", async () => {
    const wire: string[] = [];
    const { port, server } = await walsender(wire, [Buffer.alloc(70 * 1024, "w")]);
    try {
      await using sql = connect(port);
      const query = sql.unsafe("START_REPLICATION 0/0");
      const reader = query.readable().getReader();
      const writer = query.writable().getWriter();
      await writer.write("r1");
      const closed = writer.close();
      expect((await reader.read()).value!.byteLength).toBe(70 * 1024);
      expect(await reader.read()).toEqual({ done: true, value: undefined });
      await closed;
      expect(summary(await query)).toEqual(copied(0));
      expect(wire).toEqual(["Q START_REPLICATION 0/0", "d r1", "c "]);
    } finally {
      server.close();
    }
  });

  test.each([
    ["without a stream", (query: SQL.Query<any>) => query.simple()],
    ["with writable() alone", (query: SQL.Query<any>) => query.writable().getWriter().write("r1")],
  ])("%s: the query rejects, and the connection stays usable", async (_, run) => {
    const wire: string[] = [];
    const { port, server } = await walsender(wire);
    try {
      let closed = false;
      await using sql = new SQL(`postgres://u@127.0.0.1:${port}/db`, { max: 1, onclose: () => (closed = true) });
      expect(failure(await outcome(run(sql.unsafe("START_REPLICATION 0/0"))))).toEqual(needsReadable);
      expect(await sql`select 1 as x`.simple()).toEqual([{ x: 1 }]);
      expect([closed, wire]).toEqual([false, ["Q START_REPLICATION 0/0", "c ", "Q select 1 as x"]]);
    } finally {
      server.close();
    }
  });

  test.each([
    ["copy t to stdout", pgCopyOutResponse([0]), "COPY ... TO STDOUT has no writable()"],
    ["copy t from stdin", pgCopyInResponse([0]), "COPY ... FROM STDIN has no readable()"],
  ])("both streams on `%s`", async (statement, response, message) => {
    const { port, server } = await pgMockServer(type => {
      if (type === "Q") return response;
      if (type === "f") return [pgErrorResponse({ S: "ERROR", C: "57014", M: "failed" }), pgReadyForQuery()];
      if (type === "c") return [pgCommandComplete("COPY 0"), pgReadyForQuery()];
    });
    try {
      await using sql = connect(port);
      const query = sql.unsafe(statement);
      const stream = query.readable();
      const writer = query.writable().getWriter();
      const expected = { code: "ERR_POSTGRES_COPY_NOT_SUPPORTED", errno: undefined, message };
      expect(failure(await outcome(query))).toEqual(expected);
      expect(failure(await outcome(stream.text()))).toEqual(expected);
      expect(failure(await outcome(writer.closed))).toEqual(expected);
    } finally {
      server.close();
    }
  });
});
