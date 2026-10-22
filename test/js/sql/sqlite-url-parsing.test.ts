import { SQL } from "bun";
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import { readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";

const URL_VARIABLES = ["DATABASE_URL", "DATABASEURL", "TLS_DATABASE_URL", "SQLITE_URL", "SQLITEURL", "POSTGRES_URL"];
const originalEnv = Object.fromEntries(URL_VARIABLES.map(name => [name, process.env[name]]));
beforeEach(() => {
  for (const name of URL_VARIABLES) delete process.env[name];
});
afterEach(() => {
  for (const name of URL_VARIABLES) {
    if (originalEnv[name] === undefined) delete process.env[name];
    else process.env[name] = originalEnv[name];
  }
});

// For the cases that are about the name alone: a read-only open creates no file, wherever the name points.
function parse(url: string | URL | null | undefined, options: SQL.Options = {}) {
  return new SQL(url as string, { readonly: true, ...options } as SQL.Options);
}

describe("SQLite URL Parsing Matrix", () => {
  const protocols = [
    { prefix: "sqlite://", name: "sqlite://" },
    { prefix: "sqlite:", name: "sqlite:" },
    { prefix: "file://", name: "file://" },
    { prefix: "file:", name: "file:" },
    { prefix: "", name: "no protocol" }, // adapter specified in these ones
  ] as const;

  const paths = [
    { input: ":memory:", expected: ":memory:", name: "memory database" },
    { input: "test.db", expected: "test.db", name: "simple filename" },
    { input: "./test.db", expected: "./test.db", name: "relative path" },
    { input: "../test.db", expected: "../test.db", name: "parent path" },
    { input: "path/to/test.db", expected: "path/to/test.db", name: "nested path" },
    { input: "/tmp/test.db", expected: "/tmp/test.db", name: "absolute Unix path" },
    { input: "test with spaces.db", expected: "test with spaces.db", name: "spaces in filename" },
    { input: "test#hash.db", expected: "test#hash.db", name: "hash in filename" },
    { input: "test@symbol.db", expected: "test@symbol.db", name: "@ in filename" },
    { input: "test&amp.db", expected: "test&amp.db", name: "ampersand in filename" },
    { input: "test%20encoded.db", expected: "test%20encoded.db", name: "percent encoding" },
    { input: "", expected: ":memory:", name: "empty path" },
  ] as const;

  const testMatrix = protocols
    .flatMap(protocol =>
      paths.map(path => ({
        url: protocol.prefix + path.input,
        input: path.input,
        expected: path.expected,
        protocolName: protocol.name,
        pathName: path.name,
        needsAdapter: protocol.prefix === "",
      })),
    )
    .filter(test => {
      if (test.protocolName === "no protocol" && test.pathName === "memory database") {
        return false; // :memory: without protocol is valid
      }

      return true;
    });

  describe("Protocol × Path matrix", () => {
    test.each(testMatrix)("$protocolName with $pathName: $url", async testCase => {
      if (testCase.needsAdapter) {
        // Test with explicit adapter for no-protocol cases
        await using sql = parse(testCase.url, { adapter: "sqlite" });
        expect(sql.options.adapter).toBe("sqlite");
        expect(sql.options.filename).toBe(testCase.expected || ":memory:");
      } else {
        // Test without adapter (should auto-detect SQLite)
        await using sql = parse(testCase.url);
        expect(sql.options.adapter).toBe("sqlite");

        if (testCase.protocolName === "file://") {
          const filename = sql.options.filename;
          // The implementation uses Bun.fileURLToPath if valid, else strips "file://"
          let expected: string;
          try {
            expected = Bun.fileURLToPath(testCase.url);
          } catch {
            // Not a valid file:// URL, so implementation just strips the prefix
            expected = testCase.url.slice(7); // "file://".length
          }
          // Empty filename should default to :memory:
          if (expected === "") {
            expected = ":memory:";
          }
          expect(filename).toBe(expected);
        } else {
          expect(sql.options.filename).toBe(testCase.expected);
        }
      }
    });
  });

  describe("Query parameters matrix", () => {
    const dir = tempDir("sqlite-url-query", {});
    afterAll(() => dir[Symbol.dispose]());
    const db = join(String(dir), "test.db");
    const protocolsWithQuery = ["sqlite://", "sqlite:", "file://", "file:"];

    const queryParams = [
      { query: "", readonly: undefined, create: undefined, name: "no params" },
      { query: "?mode=ro", readonly: true, create: undefined, name: "readonly" },
      { query: "?mode=rw", readonly: false, create: false, name: "read-write" },
      { query: "?mode=rwc", readonly: false, create: true, name: "read-write-create" },
      { query: "?other=param", readonly: undefined, create: undefined, name: "other param" },
      { query: "?mode=ro&cache=shared", readonly: true, create: undefined, name: "multiple params" },
    ];

    const queryMatrix = protocolsWithQuery.flatMap(base =>
      queryParams.map(param => ({
        url: base + db + param.query,
        base: base,
        ...param,
      })),
    );

    test.each(queryMatrix)("$base with $name", async testCase => {
      await using sql = new SQL(testCase.url);

      expect(sql.options.adapter).toBe("sqlite");
      expect(sql.options.readonly).toBe(testCase.readonly!);
      expect(sql.options.create).toBe(testCase.create!);

      if (!testCase.base.startsWith("file://")) {
        expect(sql.options.filename).toBe(db);
      }
    });

    test.each(protocolsWithQuery)("%s with a mode that SQLite does not have", base => {
      expect(() => new SQL(`${base}${db}?mode=invalid`)).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_VALUE",
          message: expect.stringContaining("must be one of: ro, rw, rwc, memory"),
        }),
      );
    });
  });

  describe("Windows-style paths matrix", () => {
    const windowsPaths = [
      { input: "C:/test.db", expected: "C:/test.db", name: "forward slash drive" },
      { input: "C:\\test.db", expected: "C:\\test.db", name: "backslash drive" },
      { input: "D:/path/to/test.db", expected: "D:/path/to/test.db", name: "nested forward slash" },
      { input: "D:\\path\\to\\test.db", expected: "D:\\path\\to\\test.db", name: "nested backslash" },
      { input: "\\\\server\\share\\test.db", expected: "\\\\server\\share\\test.db", name: "UNC path" },
      { input: "C:/path\\mixed/test.db", expected: "C:/path\\mixed/test.db", name: "mixed slashes" },
    ];

    const windowsProtocols = [
      "sqlite://",
      "sqlite:",
      "file:///", // Three slashes for file://
      "file:",
    ];

    const windowsMatrix = windowsProtocols.flatMap(protocol =>
      windowsPaths.map(path => ({
        url: protocol + path.input,
        input: path.input,
        expected: path.expected,
        protocol: protocol,
        pathName: path.name,
      })),
    );

    test.each(windowsMatrix)("Windows: $protocol with $pathName", async testCase => {
      await using sql = parse(testCase.url);
      expect(sql.options.adapter).toBe("sqlite");

      if (testCase.protocol.startsWith("file://")) {
        const filename = sql.options.filename;
        let expected: string;
        try {
          expected = Bun.fileURLToPath(testCase.url);
        } catch {
          expected = testCase.url.slice(testCase.protocol.length);
        }
        expect(filename).toBe(expected);
      } else {
        expect(sql.options.filename).toBe(testCase.expected);
      }
    });
  });

  describe("Unix-style paths matrix", () => {
    const unixPaths = [
      { input: "/home/user/test.db", expected: "/home/user/test.db", name: "home directory" },
      { input: "/var/lib/test.db", expected: "/var/lib/test.db", name: "system directory" },
      { input: ".hidden.db", expected: ".hidden.db", name: "hidden file" },
      { input: "~/.config/test.db", expected: "~/.config/test.db", name: "tilde path" },
      { input: "test:colon.db", expected: "test:colon.db", name: "colon in name" },
    ];

    const unixProtocols = ["sqlite://", "sqlite:", "file://", "file:"];

    const unixMatrix = unixProtocols.flatMap(protocol =>
      unixPaths.map(path => ({
        url: protocol + path.input,
        input: path.input,
        expected: path.expected,
        protocol: protocol,
        pathName: path.name,
      })),
    );

    test.each(unixMatrix)("Unix: $protocol with $pathName", async testCase => {
      await using sql = parse(testCase.url);
      expect(sql.options.adapter).toBe("sqlite");

      if (testCase.protocol === "file://") {
        const filename = sql.options.filename;
        // Same logic as above - try Bun.fileURLToPath, fallback to stripping prefix
        let expected: string;
        try {
          expected = Bun.fileURLToPath(testCase.url);
        } catch {
          expected = testCase.url.slice(7); // "file://".length
        }
        expect(filename).toBe(expected);
      } else {
        expect(sql.options.filename).toBe(testCase.expected);
      }
    });
  });

  describe("Special characters matrix", () => {
    const specialChars = [
      { char: " ", name: "space", encoded: "%20" },
      { char: "#", name: "hash", encoded: "%23" },
      { char: "%", name: "percent", encoded: "%25" },
      { char: "&", name: "ampersand", encoded: "%26" },
      { char: "(", name: "paren open", encoded: "%28" },
      { char: ")", name: "paren close", encoded: "%29" },
      { char: "[", name: "bracket open", encoded: "%5B" },
      { char: "]", name: "bracket close", encoded: "%5D" },
      { char: "{", name: "brace open", encoded: "%7B" },
      { char: "}", name: "brace close", encoded: "%7D" },
      { char: "'", name: "single quote", encoded: "%27" },
      { char: '"', name: "double quote", encoded: "%22" },
      { char: "🎉", name: "emoji", encoded: "%F0%9F%8E%89" },
      { char: "测", name: "chinese", encoded: "%E6%B5%8B" },
    ];

    const charMatrix = specialChars.flatMap(charInfo => [
      {
        url: `sqlite://test${charInfo.char}file.db`,
        expected: `test${charInfo.char}file.db`,
        description: `sqlite:// with ${charInfo.name} (raw)`,
      },
      {
        url: `sqlite://test${charInfo.encoded}file.db`,
        expected: `test${charInfo.encoded}file.db`,
        description: `sqlite:// with ${charInfo.name} (encoded)`,
      },
    ]);

    test.each(charMatrix)("$description", async testCase => {
      await using sql = parse(testCase.url);
      expect(sql.options.adapter).toBe("sqlite");
      expect(sql.options.filename).toBe(testCase.expected);
    });
  });

  describe("import.meta.resolve() compatibility", () => {
    test("handles URLs from import.meta.resolve()", async () => {
      // Use import.meta.resolve() to get the actual format for the current platform
      const resolvedUrl = import.meta.resolve("./test.db");

      await using sql = parse(resolvedUrl);
      expect(sql.options.adapter).toBe("sqlite");

      const filename = sql.options.filename;
      const expected = Bun.fileURLToPath(resolvedUrl);
      expect(filename).toBe(expected);
    });
  });

  describe("Edge cases", () => {
    test("handles very long paths", async () => {
      const longFilename = "a".repeat(255) + ".db";
      const longPath = `/tmp/${longFilename}`;
      await using sql = parse(`sqlite://${longPath}`);
      expect(sql.options.filename).toBe(longPath);
    });

    test("handles database with .db in middle of name", async () => {
      const path = "/tmp/test.db.backup";
      await using sql = parse(`sqlite://${path}`);
      expect(sql.options.filename).toBe(path);
    });

    test("handles path with multiple dots", async () => {
      const path = "/tmp/test...db";
      await using sql = parse(`sqlite://${path}`);
      expect(sql.options.filename).toBe(path);
    });

    test("empty string with adapter defaults to :memory:", async () => {
      await using sql = new SQL("", { adapter: "sqlite" });
      expect(sql.options.filename).toBe(":memory:");
    });

    test("null with adapter defaults to :memory:", async () => {
      await using sql = new SQL(null as never, { adapter: "sqlite" });
      expect(sql.options.filename).toBe(":memory:");
    });

    test("undefined with adapter defaults to :memory:", async () => {
      await using sql = new SQL(undefined as never, { adapter: "sqlite" });
      expect(sql.options.filename).toBe(":memory:");
    });
  });

  // "50%deposit.db" is a file name. In a file:// URL its "%de" is an escape, and the byte DE is not UTF-8.
  // Bun.fileURLToPath() throws for such a URL, and the filename is then the text after "file://".
  // With the path "" for it, the database is ":memory:": each write resolves and nothing is kept.
  // Not on Windows: WTF decodes such a path with U+FFFD in it there (oven-sh/WebKit#789), so the file has that name.
  describe.skipIf(isWindows)("a file:// URL whose path does not percent-decode to UTF-8", () => {
    test("keeps the rows in the file of that name", async () => {
      using dir = tempDir("sqlite-percent", {});
      const filename = "file://" + String(dir) + "/50%deposit.db";
      {
        await using sql = new SQL({ adapter: "sqlite", filename });
        await sql`create table t (n integer)`;
        await sql`insert into t values (42)`;
      }
      expect(readdirSync(String(dir))).toEqual(["50%deposit.db"]);
      await using sql = new SQL({ adapter: "sqlite", filename });
      expect(await sql`select n from t`).toEqual([{ n: 42 }]);
    });

    test.each(["50%deposit.db", "caf%E9.db", "%ff%fe.db"])("new URL(%j, directory) is that file", async name => {
      using dir = tempDir("sqlite-percent", {});
      const url = new URL(name, pathToFileURL(String(dir) + sep));
      for (const filename of [url, url.href, url.href + "?mode=rwc"]) {
        await using sql = new SQL({ adapter: "sqlite", filename });
        expect(sql.options.filename).toBe(join(String(dir), name));
        await using detected = new SQL(filename);
        expect({ adapter: detected.options.adapter, filename: detected.options.filename }).toEqual({
          adapter: "sqlite",
          filename: join(String(dir), name),
        });
      }
    });
  });

  describe("Non-SQLite protocols should use postgres", () => {
    const nonSqliteUrls = [
      "http://example.com/test.db",
      "https://example.com/test.db",
      "ftp://example.com/test.db",
      "localhost/test.db",
      "localhost:5432/test.db",
      "example.com:3306/db",
      "example.com/test",
      "localhost",
      "postgres://user:pass@localhost/db",
      "postgresql://user:pass@localhost/db",
    ];

    test.each(nonSqliteUrls)("treats %s as postgres", async url => {
      await using sql = new SQL(url);
      expect(sql.options.adapter).toBe("postgres");
    });
  });
});

describe("which string names the database", () => {
  const server = "postgres://pu:pp@pghost:5432/pgdb";

  // [environment, arguments, the file name]
  test.each<[Record<string, string>, [(string | null | SQL.Options)?, SQL.Options?], string]>([
    [{}, [{ filename: "dev.db" }], "dev.db"],
    [{}, [{ filename: "./dev.db" }], "./dev.db"],
    [{}, [{ filename: "/abs/dev.db" }], "/abs/dev.db"],
    [{}, [{ filename: "sqlite://dev.db" }], "dev.db"],
    [{}, [{ filename: "localhost" }], "localhost"],
    [{}, [{ adapter: "sqlite", filename: server }], server],
    [{}, [{ adapter: "sqlite", filename: "dev.db", hostname: "h" } as never], "dev.db"],
    [{}, [{ filename: "sqlite://dev.db", hostname: "h" } as never], "dev.db"],
    [{ DATABASE_URL: server, SQLITE_URL: "env.db" }, [{ filename: "dev.db" }], "dev.db"],

    [{}, [{ adapter: "sqlite", url: "sqlite://url.db" } as never], "url.db"],
    [{}, [{ adapter: "sqlite", url: "url.db" } as never], "url.db"],
    [{}, [{ url: "sqlite://url.db" }], "url.db"],
    [{}, [{ adapter: "sqlite", url: "url.db", filename: "dev.db" } as never], "dev.db"],
    [{}, ["sqlite://first.db", { adapter: "sqlite", url: "sqlite://url.db" } as never], "url.db"],
    [
      { SQLITE_URL: "env.db", DATABASE_URL: "sqlite://env.db" },
      [{ adapter: "sqlite", url: "url.db" } as never],
      "url.db",
    ],

    [{ SQLITE_URL: "env.db" }, [], "env.db"],
    [{ SQLITE_URL: "dir/env.db" }, [], "dir/env.db"],
    [{ SQLITE_URL: "/abs/env.db" }, [], "/abs/env.db"],
    [{ SQLITE_URL: "sqlite://env.db" }, [], "env.db"],
    [{ SQLITEURL: "env.db" }, [{ adapter: "sqlite" }], "env.db"],
    [{ SQLITEURL: "env.db" }, [], "env.db"],
    [{ SQLITE_URL: "env.db", DATABASE_URL: server }, [{ adapter: "sqlite" }], "env.db"],
    [{ SQLITE_URL: "env.db", DATABASE_URL: "sqlite://generic.db" }, [{ adapter: "sqlite" }], "generic.db"],
    [{ SQLITE_URL: "env.db" }, [{ adapter: "sqlite", hostname: "h" } as never], "env.db"],
    [{ SQLITE_URL: "env.db" }, ["", { adapter: "sqlite" }], ":memory:"],

    [{ DATABASE_URL: server }, [{ adapter: "sqlite" }], ":memory:"],
    [{ DATABASEURL: server }, [{ adapter: "sqlite" }], ":memory:"],
    [{ TLS_DATABASE_URL: server }, [{ adapter: "sqlite" }], ":memory:"],
    [{ DATABASE_URL: "postgresql://h/d" }, [{ adapter: "sqlite" }], ":memory:"],
    [{ DATABASE_URL: " POSTGRES://h/d" }, [{ adapter: "sqlite" }], ":memory:"],
    [{ DATABASE_URL: "mysql://h/d" }, [{ adapter: "sqlite" }], ":memory:"],
    [{ DATABASE_URL: "mysql2://h/d" }, [{ adapter: "sqlite" }], ":memory:"],
    [{ DATABASE_URL: "mariadb://h/d" }, [{ adapter: "sqlite" }], ":memory:"],
    [{ DATABASE_URL: server }, [null, { adapter: "sqlite" }], ":memory:"],
    [{ DATABASE_URL: server, DATABASEURL: "next.db" }, [{ adapter: "sqlite" }], "next.db"],
    [{ DATABASE_URL: "sqlite://generic.db" }, [{ adapter: "sqlite" }], "generic.db"],
    [{ DATABASE_URL: "generic.db" }, [{ adapter: "sqlite" }], "generic.db"],
    [{ DATABASE_URL: ":memory:" }, [{ adapter: "sqlite" }], ":memory:"],
    [{ DATABASE_URL: "https://example.com/db" }, [{ adapter: "sqlite" }], "https://example.com/db"],
    [{ DATABASE_URL: "libsql://example.com" }, [{ adapter: "sqlite" }], "libsql://example.com"],
  ])("%j new SQL(...%j) opens %s", async (env, [first, second], filename) => {
    Object.assign(process.env, env);
    await using sql =
      typeof first === "object" && first ? parse(undefined, { ...first, ...second }) : parse(first, second);
    expect(sql.options).toMatchObject({ adapter: "sqlite", filename });
  });

  // It has always been one. A program that passes its DATABASE_URL there must not end up with a file of that name.
  test.each<[SQL.Options, object]>([
    [{ filename: server }, { adapter: "postgres", hostname: "pghost", port: 5432, username: "pu", database: "pgdb" }],
    [{ filename: new URL(server) }, { adapter: "postgres", hostname: "pghost", database: "pgdb" }],
    [{ filename: "mysql://mu@myhost/md" }, { adapter: "mysql", hostname: "myhost", database: "md" }],
    [{ filename: "mariadb://mu@myhost/md" }, { adapter: "mariadb", hostname: "myhost" }],
    [{ filename: "dev.db", hostname: "h" } as never, { adapter: "postgres", hostname: "h" }],
    [{ filename: "dev.db", port: 5433 } as never, { adapter: "postgres", hostname: "dev.db", port: 5433 }],
    [{ filename: "dev.db", username: "u" } as never, { adapter: "postgres", hostname: "dev.db", username: "u" }],
    [{ filename: "dev.db", database: "d" } as never, { adapter: "postgres", hostname: "dev.db", database: "d" }],
    [{ filename: "dev.db", tls: true } as never, { adapter: "postgres", hostname: "dev.db" }],
    [{ filename: "" }, { adapter: "postgres", hostname: "localhost" }],
  ])("without `adapter`, %j is a connection string", (options, expected) => {
    expect(new SQL(options).options).toMatchObject(expected);
  });

  test("a DATABASE_URL that is a plain path selects no adapter", () => {
    process.env.DATABASE_URL = "plain.db";
    expect(new SQL().options).toMatchObject({ adapter: "postgres", hostname: "plain.db" });
  });

  test("`filename` is not read next to a server adapter", () => {
    expect(new SQL({ adapter: "postgres", filename: "dev.db" } as never).options).toMatchObject({
      adapter: "postgres",
      hostname: "localhost",
    });
  });

  test.each(["SQLITE://Dev.db", "Sqlite:Dev.db", "FILE:Dev.db"])(
    "the scheme of %s is matched in any case",
    async url => {
      for (const sql of [parse(url), parse(url, { adapter: "sqlite" }), parse(undefined, { filename: url })]) {
        expect(sql.options).toMatchObject({ adapter: "sqlite", filename: "Dev.db" });
        await sql.close();
      }
    },
  );

  test("a URL object", async () => {
    await using sqlite = parse(new URL("sqlite://url.db?mode=ro"));
    expect(sqlite.options).toMatchObject({ adapter: "sqlite", filename: "url.db", readonly: true });

    // from a real path: on Windows a file: URL without a drive letter names no file
    const path = join(import.meta.dir, "a b.db");
    const url = Bun.pathToFileURL(path);
    expect(url.href).toEndWith("/a%20b.db");
    await using file = parse(undefined, { filename: url });
    expect(file.options).toMatchObject({ adapter: "sqlite", filename: path });
  });

  // [the string, the file name, readonly]
  test.each<[string, string, true | undefined]>([
    ["data.db?mode=ro", "data.db", true],
    ["data.db?cache=shared", "data.db", undefined],
    ["what?.db", "what", undefined],
    ["a?b#c.db", "a", undefined],
  ])("%s has a query without a scheme too", async (name, filename, readonly) => {
    for (const sql of [
      new SQL(name, { adapter: "sqlite", create: false }),
      new SQL({ adapter: "sqlite", filename: name, create: false }),
    ]) {
      expect(sql.options.filename).toBe(filename);
      expect(sql.options.readonly).toBe(readonly as boolean);
      await sql.close();
    }
  });

  test("so has a `filename` without `adapter`", async () => {
    await using sql = new SQL({ filename: "data.db?mode=ro" });
    expect(sql.options).toMatchObject({ adapter: "sqlite", filename: "data.db", readonly: true });
  });

  test("whitespace around the string is not a part of the name", async () => {
    await using sql = parse("  sqlite://dev.db?mode=ro \n");
    expect(sql.options).toMatchObject({ adapter: "sqlite", filename: "dev.db", readonly: true });
  });
});

describe("?mode=", () => {
  // [query, readonly, create]
  test.each<[string, boolean | undefined, boolean | undefined]>([
    // not about access, and the name says where the database is
    ["?mode=memory", undefined, undefined],
    ["?mode=memory&cache=shared", undefined, undefined],
    ["?cache=shared&mode=ro", true, undefined],
    ["?mode=ro#fragment", true, undefined],
    // Behind a `#`, `ro` counts and nothing else does.
    ["?cache=shared#&mode=ro", true, undefined],
    ["?cache=shared#fragment&mode=ro", true, undefined],
    ["?cache=shared#a#b&mode=ro", true, undefined],
    ["?cache=shared#mode=ro", true, undefined],
    ["?mode=rw#fragment&mode=ro", true, undefined],
    ["?mode=rwc#fragment&mode=ro", true, undefined],
    ["?mode=ro#fragment&mode=rw", true, undefined],
    ["?cache=shared#fragment&mode=rw&mode=ro", true, undefined],
    ["?cache=shared#fragment&mode=rw", undefined, undefined],
    ["?cache=shared#fragment&mode=rwc", undefined, undefined],
    ["?cache=shared#fragment&mode=memory", undefined, undefined],
    ["?cache=shared#fragment&mode=bogus", undefined, undefined],
    ["?cache=shared#fragment&mode=RO", undefined, undefined],
    ["?cache=shared#fragment&mode=", undefined, undefined],
    ["?MODE=ro", undefined, undefined],
    // Repeated: the most restrictive.
    ["?mode=rw&mode=ro", true, undefined],
    ["?mode=ro&mode=rw", true, undefined],
    ["?mode=rwc&mode=rw", false, false],
    ["?mode=rw&mode=rwc", false, false],
  ])("%s", async (query, readonly, create) => {
    using dir = tempDir("sqlite-url-mode", {});
    const db = join(String(dir), "mode.db");
    await using sql = new SQL(`sqlite://${db}${query}`);
    expect(sql.options.filename).toBe(db);
    expect(sql.options.readonly).toBe(readonly as boolean);
    expect(sql.options.create).toBe(create as boolean);
  });

  test.each(["?mode=RO", "?mode=readonly", "?mode=", "?mode", "?mode=ro&mode=bogus", "?mode=ro%20"])(
    "%s throws",
    query => {
      using dir = tempDir("sqlite-url-mode-throws", {});
      expect(() => new SQL(`sqlite://${join(String(dir), "mode.db")}${query}`)).toThrow(
        expect.objectContaining({ name: "TypeError", code: "ERR_INVALID_ARG_VALUE" }),
      );
    },
  );

  // [query, options, what `sql.options` has]
  test.each<[string, SQL.Options, Record<string, unknown>]>([
    ["?mode=ro", { readonly: undefined }, { readonly: true }],
    ["?mode=ro", { readonly: false }, { readonly: false }],
    ["?mode=rw", { create: undefined }, { create: false }],
    ["?mode=rw", { create: true }, { create: true }],
    ["?mode=rw", { readonly: true }, { readonly: true, create: false }],
    ["?mode=rwc", { readonly: true }, { readonly: true, create: true }],
    ["?mode=rwc", { create: false }, { create: false }],
    ["?cache=shared#fragment&mode=ro", { readonly: false }, { readonly: false }],
    ["", { readwrite: false }, { readwrite: false, readonly: true, create: undefined }],
    ["", { readwrite: false, readonly: false }, { readwrite: false, readonly: true }],
    ["", { readwrite: false, create: true }, { readwrite: false, readonly: true, create: true }],
    ["?mode=rw", { readwrite: false }, { readwrite: false, readonly: true, create: false }],
    ["", { readwrite: undefined }, { readonly: undefined }],
    ["", { readwrite: true }, { readwrite: true, readonly: undefined, create: undefined }],
    ["", { strict: true }, { strict: true, readonly: undefined, create: undefined, readwrite: undefined }],
  ])("%s next to %p: an option that is given replaces the mode, field by field", async (query, options, expected) => {
    using dir = tempDir("sqlite-url-mode-options", {});
    await using sql = new SQL(`sqlite://${join(String(dir), "mode.db")}${query}`, options);
    expect(Object.fromEntries(Object.keys(expected).map(key => [key, sql.options[key]]))).toEqual(expected);
  });

  test("`readOnly` is refused, as in bun:sqlite", () => {
    expect(() => new SQL(":memory:", { readOnly: true } as never)).toThrow(
      new TypeError('Misspelled option "readOnly" should be "readonly"'),
    );
  });

  async function observe(exists: boolean, query: string, options: SQL.Options = {}) {
    using dir = tempDir("sqlite-url-open", {});
    const db = join(String(dir), "open.db");
    if (exists) {
      await using seed = new SQL(`sqlite://${db}`);
      await seed`CREATE TABLE t (a)`;
    }
    await using sql = new SQL(`sqlite://${db}${query}`, options);
    const attempt = (query: PromiseLike<unknown>) =>
      query.then(
        () => true,
        () => false,
      );
    return {
      reads: await attempt(sql`SELECT * FROM sqlite_master`),
      writes: await attempt(sql`CREATE TABLE u (a)`),
      files: readdirSync(String(dir)),
    };
  }
  const readOnly = { reads: true, writes: false, files: ["open.db"] };
  const readWrite = { reads: true, writes: true, files: ["open.db"] };
  const cannotOpen = { reads: false, writes: false, files: [] };

  test.each<[string, SQL.Options, object, object]>([
    ["", {}, readWrite, readWrite],
    ["?mode=ro", {}, readOnly, cannotOpen],
    ["?mode=rw", {}, readWrite, cannotOpen],
    ["?mode=rwc", {}, readWrite, readWrite],
    ["?mode=rw&mode=ro", {}, readOnly, cannotOpen],
    ["?mode=ro#fragment", {}, readOnly, cannotOpen],
    ["?cache=shared#fragment&mode=ro", {}, readOnly, cannotOpen],
    ["?mode=rw#fragment&mode=ro", {}, readOnly, cannotOpen],
    ["?cache=shared#fragment&mode=rw", {}, readWrite, readWrite],
    ["?cache=shared#fragment&mode=bogus", {}, readWrite, readWrite],
    ["?cache=shared#fragment&mode=ro", { readonly: false }, readWrite, readWrite],
    ["?mode=ro", { readonly: undefined }, readOnly, cannotOpen],
    ["?mode=rw", { create: true }, readWrite, readWrite],
    ["", { create: false }, readWrite, cannotOpen],
    ["", { readwrite: false }, readOnly, cannotOpen],
    ["", { readwrite: false, create: true }, readOnly, cannotOpen],
    ["", { readwrite: true }, readWrite, readWrite],
    ["?mode=memory", {}, readWrite, readWrite],
    // read-only wins over `create` and `readwrite`
    ["", { readonly: true, create: true }, readOnly, cannotOpen],
    ["", { readonly: true, readwrite: true }, readOnly, cannotOpen],
    ["", { readonly: true, create: true, readwrite: true }, readOnly, cannotOpen],
    ["", { readonly: false, create: true, readwrite: true }, readWrite, readWrite],
    ["?mode=ro", { create: true }, readOnly, cannotOpen],
    ["?mode=rwc", { readonly: true }, readOnly, cannotOpen],
  ])("sqlite://open.db%s %j opens the file in that mode", async (query, options, existing, missing) => {
    expect({
      existing: await observe(true, query, options),
      missing: await observe(false, query, options),
    }).toEqual({ existing, missing });
  });

  test("a name without a scheme: data.db?mode=ro opens data.db read-only", async () => {
    using dir = tempDir("sqlite-url-plain-name", {});
    const db = join(String(dir), "data.db");
    {
      await using seed = new SQL({ adapter: "sqlite", filename: db });
      await seed`CREATE TABLE t (a)`;
    }
    await using sql = new SQL(`${db}?mode=ro`, { adapter: "sqlite" });
    expect(await sql`SELECT * FROM t`).toEqual([]);
    expect(await sql`CREATE TABLE u (a)`.catch(e => e.code)).toBe("SQLITE_READONLY");
    expect(readdirSync(String(dir))).toEqual(["data.db"]);
  });
});

describe("what the options object inherits", () => {
  const inheriting = (inherited: object, own: object = {}) => Object.assign(Object.create(inherited), own);

  // What `make` opens: a database with one row, or a file that is not there.
  async function observe(exists: boolean, make: (file: string) => SQL) {
    using dir = tempDir("sqlite-inherited", {});
    const file = join(String(dir), "open.db");
    if (exists) {
      await using seed = new SQL({ adapter: "sqlite", filename: file });
      await seed`CREATE TABLE t (n)`;
      await seed`INSERT INTO t VALUES (1)`;
    }
    await using sql = make(file);
    const rows = await sql`SELECT n FROM t`.catch(() => null);
    return {
      integer: rows && typeof rows[0].n,
      writes: await sql`CREATE TABLE u (a)`.then(
        () => true,
        () => false,
      ),
      files: readdirSync(String(dir)),
    };
  }

  type Shape = [string, (file: string, inherited: object) => SQL];
  // `sqlite://C:\\Temp\\open.db` is not a URL.
  const possible = (shapes: Shape[]) => shapes.filter(([shape]) => !isWindows || !shape.includes("new URL"));

  // An options object that stands alone behind a URL, or behind nothing, and `adapter` in it.
  const asItIs: Shape[] = [
    ["new SQL(file, { adapter })", (file, inherited) => new SQL(file, inheriting(inherited, { adapter: "sqlite" }))],
    [
      "new SQL('sqlite://file', { adapter })",
      (file, inherited) => new SQL(`sqlite://${file}`, inheriting(inherited, { adapter: "sqlite" })),
    ],
    [
      "new SQL(new URL('sqlite://file'), { adapter })",
      (file, inherited) => new SQL(new URL(`sqlite://${file}`), inheriting(inherited, { adapter: "sqlite" })),
    ],
    [
      "new SQL(undefined, { adapter, filename })",
      (file, inherited) => new SQL(undefined, inheriting(inherited, { adapter: "sqlite", filename: file })),
    ],
    ["an inherited adapter", (file, inherited) => new SQL(file, inheriting({ ...inherited, adapter: "sqlite" }))],
    [
      "getters on the class",
      (file, inherited) => {
        class Config {
          adapter = "sqlite";
        }
        for (const key in inherited) Object.defineProperty(Config.prototype, key, { get: () => inherited[key] });
        return new SQL(file, new Config() as SQL.Options);
      },
    ],
  ];
  describe.each(possible(asItIs))("%s", (_, make) => {
    test("readonly: true", async () => {
      expect(await observe(true, file => make(file, { readonly: true }))).toEqual({
        integer: "number",
        writes: false,
        files: ["open.db"],
      });
    });
    test("create: false", async () => {
      expect(await observe(false, file => make(file, { create: false }))).toEqual({
        integer: null,
        writes: false,
        files: [],
      });
    });
    test("safeIntegers: true", async () => {
      expect((await observe(true, file => make(file, { safeIntegers: true }))).integer).toBe("bigint");
    });
    test("readonly: false replaces ?mode=ro, as an own one does", async () => {
      await using sql = make("/nonexistent/open.db?mode=ro", { readonly: false });
      expect(sql.options).toMatchObject({ filename: "/nonexistent/open.db", readonly: false });
    });
  });

  test.each([true, false, undefined])("an own readonly: %p hides the inherited one", async readonly => {
    await using sql = new SQL(
      "/nonexistent/open.db",
      inheriting({ readonly: !readonly }, { adapter: "sqlite", readonly }),
    );
    expect(sql.options.readonly).toBe(readonly as boolean);
  });

  // Only the scheme gives the adapter, or the object is the first argument.
  test.each(
    possible([
      ["new SQL('sqlite://file', {})", (file, inherited) => new SQL(`sqlite://${file}`, inheriting(inherited))],
      [
        "new SQL(new URL('sqlite://file'), {})",
        (file, inherited) => new SQL(new URL(`sqlite://${file}`), inheriting(inherited)),
      ],
      [
        "new SQL({ adapter, filename })",
        (file, inherited) => new SQL(inheriting(inherited, { adapter: "sqlite", filename: file })),
      ],
      ["new SQL({ url })", (file, inherited) => new SQL(inheriting(inherited, { url: `sqlite://${file}` }))],
    ]),
  )("%s: nothing that says how the file is opened counts", async (_, make) => {
    const inherited = { readonly: true, create: false, safeIntegers: true };
    expect(await observe(true, file => make(file, inherited))).toEqual({
      integer: "number",
      writes: true,
      files: ["open.db"],
    });
    expect((await observe(false, file => make(file, inherited))).files).toEqual(["open.db"]);
  });

  test("an inherited readonly: false does not replace ?mode=ro where only the scheme gives the adapter", async () => {
    await using sql = new SQL("sqlite://:memory:?mode=ro", inheriting({ readonly: false }));
    expect(sql.options.readonly).toBe(true);
  });
});

describe("integers", () => {
  test.each<[SQL.Options, boolean | undefined]>([
    [{}, undefined],
    [{ bigint: true } as never, true],
    [{ bigint: false } as never, false],
    [{ safeIntegers: true }, true],
    [{ safeIntegers: false, bigint: true } as never, false],
    [{ safeIntegers: undefined, bigint: true } as never, true],
  ])("%p", async (options, safeIntegers) => {
    await using sql = new SQL(":memory:", options);
    expect(sql.options.safeIntegers).toBe(safeIntegers as boolean);
  });
});
