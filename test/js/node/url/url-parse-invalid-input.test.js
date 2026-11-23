import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import assert from "node:assert";
import url from "node:url";

describe("url.parse", () => {
  // TODO: Support error code.
  test.todo("invalid input", () => {
    // https://github.com/joyent/node/issues/568
    [
      [undefined, "undefined"],
      [null, "object"],
      [true, "boolean"],
      [false, "boolean"],
      [0.0, "number"],
      [0, "number"],
      [[], "object"],
      [{}, "object"],
      [() => {}, "function"],
      [Symbol("foo"), "symbol"],
    ].forEach(([val, type]) => {
      assert.throws(
        () => {
          url.parse(val);
        },
        {
          code: "ERR_INVALID_ARG_TYPE",
          name: "TypeError",
          message: 'The "url" argument must be of type string.',
        },
      );
    });

    assert.throws(
      () => {
        url.parse("http://%E0%A4%A@fail");
      },
      e => {
        // The error should be a URIError.
        if (!(e instanceof URIError)) return false;

        // The error should be from the JS engine and not from Node.js.
        // JS engine errors do not have the `code` property.
        return e.code === undefined;
      },
    );

    assert.throws(
      () => {
        url.parse("http://[127.0.0.1\x00c8763]:8000/");
      },
      { code: "ERR_INVALID_URL", input: "http://[127.0.0.1\x00c8763]:8000/" },
    );

    if (common.hasIntl) {
      // An array of Unicode code points whose Unicode NFKD contains a "bad
      // character".
      const badIDNA = (() => {
        const BAD_CHARS = "#%/:?@[\\]^|";
        const out = [];
        for (let i = 0x80; i < 0x110000; i++) {
          const cp = String.fromCodePoint(i);
          for (const badChar of BAD_CHARS) {
            if (cp.normalize("NFKD").includes(badChar)) {
              out.push(cp);
            }
          }
        }
        return out;
      })();

      // The generation logic above should at a minimum produce these two
      // characters.
      assert(badIDNA.includes("℀"));
      assert(badIDNA.includes("＠"));

      for (const badCodePoint of badIDNA) {
        const badURL = `http://fail${badCodePoint}fail.com/`;
        assert.throws(
          () => {
            url.parse(badURL);
          },
          e => e.code === "ERR_INVALID_URL",
          `parsing ${badURL}`,
        );
      }

      assert.throws(
        () => {
          url.parse("http://\u00AD/bad.com/");
        },
        e => e.code === "ERR_INVALID_URL",
        "parsing http://\u00AD/bad.com/",
      );
    }
  });

  test("rethrows a primitive thrown while describing the argument", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        import url from "node:url";
        for (const thrown of ["nope", 1, null, undefined, Symbol.for("nope")]) {
          const arg = { get constructor() { throw thrown; } };
          for (const fn of [() => url.parse(arg), () => url.resolve(arg, "/a"), () => url.resolve("/a", arg)]) {
            try {
              fn();
              console.log("did not throw");
            } catch (e) {
              console.log(e === thrown ? "rethrown" : "wrong value", String(thrown));
            }
          }
        }
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout).toBe(
      ["nope", "1", "null", "undefined", "Symbol(nope)"].flatMap(v => Array(3).fill(`rethrown ${v}\n`)).join(""),
    );
    expect(exitCode).toBe(0);
  });

  test("only ERR_INVALID_URL carries the input", () => {
    assert.throws(
      () => url.parse(1),
      e => e.code === "ERR_INVALID_ARG_TYPE" && !("input" in e),
    );
    assert.throws(
      () => url.parse("http://%E0%A4%A@fail"),
      e => e instanceof URIError && !("input" in e),
    );
    assert.throws(() => url.parse("http://[127.0.0.1\x00c8763]:8000/"), {
      code: "ERR_INVALID_URL",
      input: "http://[127.0.0.1\x00c8763]:8000/",
    });
  });
});

// Node 25+ throws ERR_INVALID_ARG_VALUE for every leftover ":" in a host (DEP0170).
// Bun throws for the web schemes and for scheme-less input parsed with slashesDenoteHost.
// Other input keeps its old result, because published packages still parse it.
describe("url.parse invalid port", () => {
  const invalidPort = input => ({
    name: "TypeError",
    code: "ERR_INVALID_ARG_VALUE",
    message: `The argument 'url' ${input}. Received 'Invalid port in url'`,
  });
  const pick = u => ({ protocol: u.protocol, auth: u.auth, host: u.host, port: u.port, pathname: u.pathname });

  test.each([
    "http://example.com:abc/",
    "http://example.com:80abc/",
    "http://example.com:-1/",
    "http://user@example.com:abc/",
    "http://example.com:8080:90/",
    "http://[::1]:abc/",
    "https://evil.com:.example.com",
    "HTTP://a:b/",
    "ftp://a:b/",
    "gopher://a:b/",
    "file://a:b/",
    "ws://a:b/",
    "wss://a:b/",
    "  http://a:b/  ",
  ])("url.parse(%j) throws", input => {
    assert.throws(() => url.parse(input), invalidPort(input));
  });

  test("an over-long host with an invalid port throws", () => {
    const input = "http://" + Buffer.alloc(300, "a").toString() + ":x/";
    assert.throws(() => url.parse(input), invalidPort(input));
  });

  test.each([
    ["url.resolve with an invalid source", () => url.resolve("http://a:b/", "/x"), "http://a:b/"],
    ["url.resolve with an invalid absolute target", () => url.resolve("http://a/", "http://c:d/"), "http://c:d/"],
    ["url.resolve with a protocol-relative target", () => url.resolve("http://a/", "//c:8080:90/"), "//c:8080:90/"],
    ["url.resolveObject", () => url.resolveObject("http://a/", "//c:8080:90/"), "//c:8080:90/"],
    ["url.format with a string", () => url.format("http://a:b/"), "http://a:b/"],
    ["Url#resolve", () => url.parse("http://a/").resolve("//c:8080:90/"), "//c:8080:90/"],
    ["Url#resolveObject", () => url.parse("http://a/").resolveObject("//c:8080:90/"), "//c:8080:90/"],
    ["Url#parse", () => new url.Url().parse("http://a:b/"), "http://a:b/"],
    ["url.parse with slashesDenoteHost", () => url.parse("//h:abc/p", false, true), "//h:abc/p"],
    [
      "url.parse with slashesDenoteHost and an scp-style string",
      () => url.parse("//git@github.com:npm/npm.git", false, true),
      "//git@github.com:npm/npm.git",
    ],
    [
      "url.resolve with a git+ssh source and an scp-style target",
      () => url.resolve("git+ssh://git@github.com/a/b", "//git@host:o/r"),
      "//git@host:o/r",
    ],
  ])("%s throws", (_, fn, input) => {
    assert.throws(fn, invalidPort(input));
  });

  test("a malformed auth still throws URIError first", () => {
    assert.throws(() => url.parse("http://%zz@a:b/"), URIError);
  });

  test("other schemes and one-argument scheme-less input keep their old result", () => {
    // hosted-git-info 2.x and normalize-package-data 2.x parse scp-style git URLs.
    expect(pick(url.parse("git+ssh://git@github.com:npm/npm"))).toEqual({
      protocol: "git+ssh:",
      auth: "git",
      host: "github.com",
      port: null,
      pathname: "/:npm/npm",
    });
    expect(pick(url.parse("ssh://git@host:owner/repo"))).toEqual({
      protocol: "ssh:",
      auth: "git",
      host: "host",
      port: null,
      pathname: "/:owner/repo",
    });
    expect(pick(url.parse("//git@github.com:npm/npm.git"))).toEqual({
      protocol: null,
      auth: "git",
      host: "github.com",
      port: null,
      pathname: "/:npm/npm.git",
    });
    // sequelize 6 reads the protocol and the pathname.
    expect(pick(url.parse("sqlite::memory:"))).toEqual({
      protocol: "sqlite:",
      auth: null,
      host: "",
      port: null,
      pathname: "/:memory",
    });
    // mongodb 3.x reads the protocol, the first host and the first port of a multi-host string.
    expect(pick(url.parse("mongodb://h1:27017,h2:27017/db"))).toEqual({
      protocol: "mongodb:",
      auth: null,
      host: "h1:27017",
      port: "27017",
      pathname: "/:27017,h2/db",
    });
    expect(url.resolve("git+ssh://git@github.com:npm/npm", "x")).toBe("git+ssh://git@github.com/:npm/x");
  });

  test.each(["git+ssh://git@[::1]:owner/repo", "//git@[::1]:owner/repo"])(
    "url.parse(%j) outside the gate still throws ERR_INVALID_URL",
    input => {
      assert.throws(() => url.parse(input), { name: "TypeError", code: "ERR_INVALID_URL", input });
    },
  );

  test("a valid port or a colon outside the host does not throw", () => {
    expect(pick(url.parse("http://example.com:99999/"))).toEqual({
      protocol: "http:",
      auth: null,
      host: "example.com:99999",
      port: "99999",
      pathname: "/",
    });
    expect(url.parse("http://host:/").host).toBe("host");
    expect(url.parse("http:a:b").pathname).toBe("a:b");
    expect(url.parse("javascript:alert(1):2").pathname).toBe("alert(1):2");
    expect(url.parse("//h:abc/p").pathname).toBe("//h:abc/p");
    expect(url.resolve("http://a/b", "./c:d")).toBe("http://a/c:d");
  });

  test("an uncaught invalid port error ends the process", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `require("node:url").parse("https://evil.com:.example.com")`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("");
    expect(stderr).toContain("ERR_INVALID_ARG_VALUE");
    expect(stderr).toContain("The argument 'url' https://evil.com:.example.com. Received 'Invalid port in url'");
    expect(exitCode).toBe(1);
  });

  test("the lenient path emits no DEP0170 warning", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const url = require("node:url");
        const codes = [];
        process.on("warning", w => codes.push(w.code));
        process.on("exit", () => console.log(JSON.stringify(codes)));
        url.parse("git+ssh://git@github.com:npm/npm");
        url.parse("ssh://git@host:owner/repo");
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("DEP0170");
    expect(stdout).toBe('["DEP0169"]\n');
    expect(exitCode).toBe(0);
  });
});
