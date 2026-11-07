import { SQL } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, describeWithContainer } from "harness";

type Run = (sql: SQL, query: string, values?: unknown[]) => Promise<unknown>;
const entryPoints: [name: string, run: Run][] = [
  ["sql.unsafe", (sql, query, values) => sql.unsafe(query, values)],
  ["sql.begin", (sql, query, values) => sql.begin(tx => tx.unsafe(query, values))],
  [
    "sql.reserve",
    async (sql, query, values) => {
      const reserved = await sql.reserve();
      try {
        return await reserved.unsafe(query, values);
      } finally {
        reserved.release();
      }
    },
  ],
];

async function expectUsable(sql: SQL) {
  expect<unknown>(await sql`SELECT 1 AS ok`).toEqual([{ ok: 1 }]);
}

async function rejectionOf(promise: PromiseLike<unknown>): Promise<any> {
  const settled = await promise.then(
    value => ({ resolved: value }),
    reason => ({ rejected: reason }),
  );
  if ("resolved" in settled) throw new Error("expected a rejection, resolved with " + Bun.inspect(settled.resolved));
  return settled.rejected;
}

function summary(error: any, Class: { prototype: object }) {
  return {
    prototype: Object.getPrototypeOf(error) === Class.prototype,
    isError: Error.isError(error),
    keys: Object.keys(error),
    name: error.name,
    code: error.code,
    message: error.message,
  };
}

function layout(error: object, ignored: string[]) {
  return Reflect.ownKeys(error)
    .filter(key => !ignored.includes(key as string))
    .map(key => [key, Object.getOwnPropertyDescriptor(error, key)]);
}
// An Error that JavaScript makes has these. They describe the place where it was made.
const stackKeys = ["stack", "sourceURL", "originalLine", "originalColumn"];

class UserError extends Error {}
const thrownValues: [kind: string, value: unknown][] = [
  ["an Error subclass", new UserError("thrown by user code")],
  ["a plain object", { code: "USER_CODE", message: "thrown by user code" }],
  ["a string", "thrown by user code"],
  ["null", null],
  ["undefined", undefined],
];
const unchanged = thrownValues.flatMap(([kind]) => [
  [kind, "unchanged"],
  [kind, "unchanged"],
]);
/** Twice for each value: a new statement and a known one are written in different places. */
async function arrivals(query: (parameter: unknown, kind: number) => PromiseLike<unknown>) {
  const arrived: string[][] = [];
  for (const [index, [kind, value]] of thrownValues.entries()) {
    const parameter = {
      toJSON() {
        throw value;
      },
    };
    for (let use = 0; use < 2; use++) {
      const rejection = await rejectionOf(query(parameter, index));
      arrived.push([kind, Object.is(rejection, value) ? "unchanged" : Bun.inspect(rejection)]);
    }
  }
  return arrived;
}

/** Not concurrent: Error.prepareStackTrace is global. */
async function withPrepareStackTrace<T>(
  onError: (error: Error, frames: unknown[]) => void,
  body: () => T | Promise<T>,
): Promise<T> {
  const original = Error.prepareStackTrace;
  Error.prepareStackTrace = (error, frames) => {
    if (error instanceof SQL.SQLError) onError(error, frames);
    return String(error) + frames.map(frame => "\n    at " + frame).join("");
  };
  try {
    return await body();
  } finally {
    Error.prepareStackTrace = original;
  }
}

// The PostgreSQL wire protocol counts the parameters of a statement in 16 bits.
const tooManyParameters = () => new Array(65536).fill(null);
const tooManyParametersMessage =
  "query has too many parameters - the PostgreSQL wire protocol supports a maximum of 65535 parameters per query. Try reducing your batch size.";

describeWithContainer("mysql", { image: "mysql_plain", concurrent: true }, container => {
  const connect = (database = "bun_sql_test") =>
    new SQL({ url: `mysql://root@${container.host}:${container.port}/${database}`, max: 1 });
  const noSuchTable = {
    prototype: true,
    isError: true,
    keys: ["name", "code", "errno", "sqlState"],
    name: "MySQLError",
    code: "ERR_MYSQL_SERVER_ERROR",
    message: "Table 'bun_sql_test.no_such_table_for_sql_errors' doesn't exist",
  };

  test.each(entryPoints)("%s: a wrong number of parameters rejects with a MySQLError", async (_, run) => {
    await container.ready;
    await using sql = connect();
    const expected = {
      prototype: true,
      isError: true,
      keys: ["name", "code"],
      name: "MySQLError",
      code: "ERR_MYSQL_WRONG_NUMBER_OF_PARAMETERS_PROVIDED",
      message: "Wrong number of parameters provided",
    };

    // The second one is of a statement that is prepared.
    const errors = [
      await rejectionOf(run(sql, "SELECT ? AS n", [1, 2])),
      await rejectionOf(run(sql, "SELECT ? AS n", [1, 2])),
      await rejectionOf(run(sql, "SELECT ? AS a, ? AS b", [1])),
    ];
    expect(errors.map(error => summary(error, SQL.MySQLError))).toEqual([expected, expected, expected]);
    await expectUsable(sql);
  });

  test("each run of a statement that fails to prepare rejects with the same MySQLError", async () => {
    await container.ready;
    await using sql = connect();

    const errors: any[] = [];
    for (let i = 0; i < 3; i++) {
      errors.push(await rejectionOf(sql.unsafe("SELECT * FROM no_such_table_for_sql_errors WHERE a = ?", [1])));
    }
    expect(errors.map(error => summary(error, SQL.MySQLError))).toEqual([noSuchTable, noSuchTable, noSuchTable]);
    expect(errors.map(error => [error.errno, error.sqlState])).toEqual(Array(3).fill([1146, "42S02"]));
  });

  test("an error that the server sends while the client connects is a MySQLError", async () => {
    await container.ready;
    await using sql = connect("no_such_database_for_sql_errors");

    const error = await rejectionOf(sql`SELECT 1`);
    expect(summary(error, SQL.MySQLError)).toEqual({
      ...noSuchTable,
      message: "Unknown database 'no_such_database_for_sql_errors'",
    });
    expect([error.errno, error.sqlState]).toEqual([1049, "42000"]);
  });

  test("a native error has the layout of new SQL.MySQLError()", async () => {
    await container.ready;
    await using sql = connect();

    const madeByTheClient = await rejectionOf(sql.unsafe("SELECT ? AS n", [1, 2]));
    const fromServer = await rejectionOf(sql`SELECT * FROM no_such_table_for_sql_errors`);
    for (const error of [madeByTheClient, fromServer]) {
      const { code, errno, sqlState } = error;
      const reference = new SQL.MySQLError(error.message, { code, errno, sqlState });
      // `line` and `column` of the reference are the place in this file.
      expect(layout(error, stackKeys)).toEqual(layout(reference, [...stackKeys, "line", "column"]));
      expect(String(error)).toBe(String(reference));
      expect(error).toBeInstanceOf(SQL.SQLError);
      expect(Object.prototype.toString.call(error)).toBe("[object Error]");
    }
    expect(layout(fromServer, stackKeys).map(([key]) => key)).toEqual(["message", "name", "code", "errno", "sqlState"]);
  });

  test("a value that a parameter throws arrives unchanged", async () => {
    await container.ready;
    await using sql = connect();
    expect(await arrivals((parameter, kind) => sql.unsafe(`SELECT ? AS thrown_${kind}`, [parameter]))).toEqual(
      unchanged,
    );
    await expectUsable(sql);
  });
});

describeWithContainer("postgres", { image: "postgres_plain", concurrent: true }, container => {
  const connect = (database = "bun_sql_test") =>
    new SQL({ url: `postgres://bun_sql_test@${container.host}:${container.port}/${database}`, max: 1 });
  const tooMany = {
    prototype: true,
    isError: true,
    keys: ["name", "code", "hint"],
    name: "PostgresError",
    code: "ERR_POSTGRES_TOO_MANY_PARAMETERS",
    message: tooManyParametersMessage,
  };

  test.each(entryPoints)("%s: a query with too many parameters rejects with a PostgresError", async (_, run) => {
    await container.ready;
    await using sql = connect();
    await sql`SELECT 1`;

    expect(summary(await rejectionOf(run(sql, "SELECT 1", tooManyParameters())), SQL.PostgresError)).toEqual(tooMany);
    await expectUsable(sql);
  });

  test("an error that the server sends while the client connects is a PostgresError", async () => {
    await container.ready;
    await using sql = connect("no_such_database_for_sql_errors");

    const error = await rejectionOf(sql`SELECT 1`);
    expect(summary(error, SQL.PostgresError)).toEqual({
      prototype: true,
      isError: true,
      keys: ["name", "code", "errno", "severity", "file", "line", "routine"],
      name: "PostgresError",
      code: "ERR_POSTGRES_SERVER_ERROR",
      message: 'database "no_such_database_for_sql_errors" does not exist',
    });
    expect([error.errno, error.severity]).toEqual(["3D000", "FATAL"]);
  });

  test("a native error has the layout of new SQL.PostgresError()", async () => {
    await container.ready;
    await using sql = connect();
    await sql`CREATE TEMPORARY TABLE sql_errors (id int PRIMARY KEY, name text NOT NULL)`;
    await sql`INSERT INTO sql_errors VALUES (1, 'a')`;

    const madeByTheClient = await rejectionOf(sql.unsafe("SELECT 1", tooManyParameters()));
    const unique = await rejectionOf(sql`INSERT INTO sql_errors VALUES (1, 'b')`);
    const notNull = await rejectionOf(sql`INSERT INTO sql_errors VALUES (2, ${null})`);
    const noMessage = await rejectionOf(sql.unsafe(`DO $$ BEGIN RAISE EXCEPTION USING MESSAGE = ''; END $$`));
    for (const error of [madeByTheClient, unique, notNull, noMessage]) {
      expect(layout(error, stackKeys)).toEqual(layout(new SQL.PostgresError(error.message, { ...error }), stackKeys));
      expect(error).toBeInstanceOf(SQL.SQLError);
      expect(Object.prototype.toString.call(error)).toBe("[object Error]");
    }

    // `line` and `column` are PostgreSQL's fields, never a position in a JavaScript source.
    const common = ["name", "code", "errno", "detail", "severity", "schema", "table"];
    expect([madeByTheClient, unique, notNull].map(error => Object.keys(error))).toEqual([
      ["name", "code", "hint"],
      [...common, "constraint", "file", "line", "routine"],
      [...common, "column", "file", "line", "routine"],
    ]);
    expect({
      client: [madeByTheClient.line, madeByTheClient.column],
      unique: [unique.errno, unique.constraint, unique.column],
      notNull: [notNull.errno, notNull.constraint, notNull.column],
      line: [unique.line, notNull.line].map(line => /^[0-9]+$/.test(line)),
    }).toEqual({
      client: [undefined, undefined],
      unique: ["23505", "sql_errors_pkey", undefined],
      notNull: ["23502", undefined, "name"],
      line: [true, true],
    });
    expect({ message: noMessage.message, string: String(noMessage), errno: noMessage.errno }).toEqual({
      message: "",
      string: "PostgresError",
      errno: "P0001",
    });
  });

  test("every field of the server's error is text, not only the message", async () => {
    await container.ready;
    await using sql = connect();
    await sql`CREATE TEMPORARY TABLE "täble" ("名" text PRIMARY KEY)`;
    await sql`INSERT INTO "täble" VALUES (${"é日本😀"})`;

    const unique = await rejectionOf(sql`INSERT INTO "täble" VALUES (${"é日本😀"})`);
    const raised = await rejectionOf(
      sql.unsafe(`DO $$ BEGIN RAISE EXCEPTION 'mé' USING DETAIL = 'café', HINT = '日本', COLUMN = 'ñ'; END $$`),
    );
    expect({
      unique: [unique.message, unique.detail, unique.table, unique.constraint],
      raised: [raised.message, raised.detail, raised.hint, raised.column],
    }).toEqual({
      unique: [
        'duplicate key value violates unique constraint "täble_pkey"',
        'Key ("名")=(é日本😀) already exists.',
        "täble",
        "täble_pkey",
      ],
      raised: ["mé", "café", "日本", "ñ"],
    });
  });

  test("a value that a parameter throws arrives unchanged", async () => {
    await container.ready;
    await using sql = connect();
    expect(await arrivals((parameter, kind) => sql.unsafe(`SELECT $1::json AS thrown_${kind}`, [parameter]))).toEqual(
      unchanged,
    );
    await expectUsable(sql);
  });
});

for (const [adapter, image, url, failing, message] of [
  [
    "mysql",
    "mysql_plain",
    (host: string, port: number) => `mysql://root@${host}:${port}/bun_sql_test`,
    "SELECT * FROM no_such_table_for_sql_errors",
    "MySQLError: Table 'bun_sql_test.no_such_table_for_sql_errors' doesn't exist",
  ],
  [
    "postgres",
    "postgres_plain",
    (host: string, port: number) => `postgres://bun_sql_test@${host}:${port}/bun_sql_test`,
    "SELECT * FROM no_such_table_for_sql_errors",
    'PostgresError: relation "no_such_table_for_sql_errors" does not exist',
  ],
] as const) {
  describeWithContainer(`${adapter}: the stack of a native error`, { image }, container => {
    const connect = () => new SQL({ url: url(container.host, container.port), max: 1 });

    test.each([
      ["no JavaScript on the stack", (query: SQL.Query<any>) => rejectionOf(query)],
      // execute() starts the query before it returns.
      ["the caller of execute() on the stack", (query: SQL.Query<any>) => rejectionOf(query.execute())],
    ])("made with %s: Error.prepareStackTrace runs on the first read, not inside the client", async (_, make) => {
      await container.ready;
      await using sql = connect();
      await sql`SELECT 1`;

      const formatted: unknown[] = [];
      const onError = (formattedError: Error, frames: unknown[]) =>
        formatted.push([formattedError === error ? "the error" : formattedError, frames.length]);
      let error: any;
      error = await withPrepareStackTrace(onError, () => make(sql.unsafe(failing)));
      expect(formatted).toEqual([]);

      expect(await withPrepareStackTrace(onError, () => [error.stack, error.stack])).toEqual([message, message]);
      expect(formatted).toEqual([["the error", 0]]);
    });

    test("follows a change of the message until the first read", async () => {
      await container.ready;
      await using sql = connect();

      const error = await rejectionOf(sql.unsafe(failing));
      error.message = "changed";
      const first = error.stack;
      error.message = "changed again";
      expect([first, error.stack]).toEqual([error.name + ": changed", error.name + ": changed"]);
    });

    test("is an own data property that is not enumerable, before and after the first read", async () => {
      await container.ready;
      await using sql = connect();

      const error = await rejectionOf(sql.unsafe(failing));
      const before = Object.getOwnPropertyDescriptor(error, "stack");
      const descriptor = { value: message, writable: true, enumerable: false, configurable: true };
      expect({ before, stack: error.stack, after: Object.getOwnPropertyDescriptor(error, "stack") }).toEqual({
        before: descriptor,
        stack: message,
        after: descriptor,
      });

      const assigned = await rejectionOf(sql.unsafe(failing));
      assigned.stack = "assigned before the first read";
      expect(Object.getOwnPropertyDescriptor(assigned, "stack")).toEqual({
        value: "assigned before the first read",
        writable: true,
        enumerable: false,
        configurable: true,
      });
    });

    test("an Error.prepareStackTrace that throws does not keep the query pending", async () => {
      await container.ready;
      await using sql = connect();

      const error = await withPrepareStackTrace(
        () => {
          throw new UserError("thrown by Error.prepareStackTrace");
        },
        () => rejectionOf(sql.unsafe(failing)),
      );
      expect(String(error)).toBe(message);
      await expectUsable(sql);
    });

    // Process-wide state that user code can change, so the fixture has a process of its own.
    test("no user code runs inside the client", async () => {
      await container.ready;
      const fixture = /* js */ `
        const { SQL } = require("bun");
        const sql = new SQL({ url: process.env.DATABASE_URL, max: 1 });
        await sql\`SELECT 1\`;

        const userCode = [];
        for (const key of ["errno", "sqlState", "detail", "hint", "severity", "routine", "line", "column"]) {
          Object.defineProperty(Object.prototype, key, {
            configurable: true,
            get() {
              return "from Object.prototype";
            },
            set() {
              userCode.push("Object.prototype." + key + " setter");
            },
          });
        }
        Object.defineProperty(Error.prototype, "name", {
          configurable: true,
          get() {
            return "Error";
          },
          set() {
            userCode.push("Error.prototype.name setter");
          },
        });
        Error.prepareStackTrace = (error, frames) => {
          userCode.push("Error.prepareStackTrace");
          return String(error);
        };

        const error = await sql.unsafe(process.env.FAILING).then(() => "resolved", error => error);
        console.log(JSON.stringify({ string: String(error), isSQLError: error instanceof SQL.SQLError, userCode }));
        await sql.close();
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", fixture],
        env: { ...bunEnv, DATABASE_URL: url(container.host, container.port), FAILING: failing },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      // stderr is here so that a failure shows it. A sanitizer build can write to it.
      expect({ stdout: stdout.trim() && JSON.parse(stdout), stderr, exitCode }).toEqual({
        stdout: { string: message, isSQLError: true, userCode: [] },
        stderr: expect.any(String),
        exitCode: 0,
      });
    });
  });
}

describeWithContainer("postgres: line and column", { image: "postgres_plain" }, container => {
  test("stay the server's when the stack is filled again", async () => {
    await container.ready;
    await using sql = new SQL({
      url: `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`,
      max: 1,
    });
    await sql`CREATE TEMPORARY TABLE sql_errors_not_null (id int NOT NULL)`;
    const fields = (error: any) => [error.column, /^[0-9]+$/.test(error.line), error.sourceURL];

    const error = await rejectionOf(sql`INSERT INTO sql_errors_not_null (id) VALUES (${null})`);
    Bun.gc(true);
    expect(fields(error)).toEqual(["id", true, undefined]);

    (function capturesTheStack() {
      Error.captureStackTrace(error);
    })();
    expect(error.stack).toContain("capturesTheStack");
    expect(fields(error)).toEqual(["id", true, undefined]);
  });
});
