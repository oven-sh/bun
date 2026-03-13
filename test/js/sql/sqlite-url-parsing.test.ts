import { SQL } from "bun";
import { describe, expect, test } from "bun:test";

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
        await using sql = new SQL(testCase.url, { adapter: "sqlite" });
        expect(sql.options.adapter).toBe("sqlite");
        expect(sql.options.filename).toBe(testCase.expected || ":memory:");
      } else {
        // Test without adapter (should auto-detect SQLite)
        await using sql = new SQL(testCase.url);
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
    const protocolsWithQuery = ["sqlite://test.db", "sqlite:test.db", "file://test.db", "file:test.db"];

    const queryParams = [
      { query: "", readonly: undefined, create: undefined, name: "no params" },
      { query: "?mode=ro", readonly: true, create: undefined, name: "readonly" },
      { query: "?mode=rw", readonly: false, create: undefined, name: "read-write" },
      { query: "?mode=rwc", readonly: false, create: true, name: "read-write-create" },
      { query: "?mode=invalid", readonly: undefined, create: undefined, name: "invalid mode" },
      { query: "?other=param", readonly: undefined, create: undefined, name: "other param" },
      { query: "?mode=ro&cache=shared", readonly: true, create: undefined, name: "multiple params" },
    ];

    const queryMatrix = protocolsWithQuery.flatMap(base =>
      queryParams.map(param => ({
        url: base + param.query,
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
        expect(sql.options.filename).toBe("test.db");
      }
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
      await using sql = new SQL(testCase.url);
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
      await using sql = new SQL(testCase.url);
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
      await using sql = new SQL(testCase.url);
      expect(sql.options.adapter).toBe("sqlite");
      expect(sql.options.filename).toBe(testCase.expected);
    });
  });

  describe("import.meta.resolve() compatibility", () => {
    test("handles URLs from import.meta.resolve()", async () => {
      // Use import.meta.resolve() to get the actual format for the current platform
      const resolvedUrl = import.meta.resolve("./test.db");

      await using sql = new SQL(resolvedUrl);
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
      await using sql = new SQL(`sqlite://${longPath}`);
      expect(sql.options.filename).toBe(longPath);
    });

    test("handles database with .db in middle of name", async () => {
      // Use a path that won't create a file in the project root
      const path = "/tmp/test.db.backup";
      await using sql = new SQL(`sqlite://${path}`);
      expect(sql.options.filename).toBe(path);
    });

    test("handles path with multiple dots", async () => {
      // Use a path that won't create a file in the project root
      const path = "/tmp/test...db";
      await using sql = new SQL(`sqlite://${path}`);
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
