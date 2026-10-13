// Several native APIs read a JS string as UTF-8 through `Bun::UTF8View`. An 8-bit
// ASCII string is borrowed. Any other string is converted, and the conversion can
// fail: the buffer holds at most 2**31 - 1 bytes and a Latin-1 string reserves two
// bytes per character, so a non-ASCII Latin-1 string of 2**30 characters does not
// convert. The helper asserted that the conversion worked, which aborted the
// process (`panic(main thread): abort() called`, exit code 134), also inside
// try / catch. Each API now throws `RangeError: Out of memory`, which is what JSC
// reports for a string it cannot create. An API that only looks the string up
// answers that nothing matches: the string is not a name in the certificate and
// it is not a builtin module.
//
// An 8-bit ASCII string must stay borrowed: no API here needs a NUL terminator,
// so a copy of it is waste. The conversion refuses every 8-bit string of 2**30
// characters before it reads one, ASCII or not. So the last row binds an ASCII
// string of that length. SQLite takes it or reports that it is too big for
// SQLite: the limit is 1e9 bytes in the bundled SQLite and 2 GiB in the system
// SQLite that macOS loads. Each answer shows that SQLite got the string's buffer,
// where a copy reports "Out of memory".
import { decodeURIComponentSIMD } from "bun:internal-for-testing";
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tls } from "harness";
import crypto from "node:crypto";
import Module from "node:module";
import { totalmem } from "node:os";

// Each case prints its line as soon as it finishes. If a case aborts the child,
// the diff shows which one.
const fixture = `
  import { decodeURIComponentSIMD } from "bun:internal-for-testing";
  import { Database } from "bun:sqlite";
  import crypto from "node:crypto";
  import Module from "node:module";

  const cert = new crypto.X509Certificate(${JSON.stringify(tls.cert)});
  const db = new Database(":memory:");

  const cases = {
    "X509Certificate#checkHost": text => cert.checkHost(text),
    "X509Certificate#checkEmail": text => cert.checkEmail(text),
    "new X509Certificate": text => new crypto.X509Certificate(text),
    "hkdfSync salt": text => crypto.hkdfSync("sha256", "key", text, "info", 8),
    "hkdfSync info": text => crypto.hkdfSync("sha256", "key", "salt", text, 8),
    "hkdf salt": text => crypto.hkdf("sha256", "key", text, "info", 8, () => {}),
    "require.resolve.paths": text => require.resolve.paths(text),
    "Module._resolveLookupPaths": text => Module._resolveLookupPaths(text, { paths: ["/node_modules"] }),
    "Database#run": text => db.run(text),
    "Database#prepare": text => db.prepare(text),
    "Statement#get parameter": text => db.prepare("SELECT length(?) AS n").get(text),
    "decodeURIComponentSIMD": text => decodeURIComponentSIMD(text),
    // The value of a cookie is converted only when the header has a "%" in it.
    "new Bun.CookieMap": text => new Bun.CookieMap("a=%41" + text),
  };
  let text = "\\u00e9".repeat(2 ** 30);
  for (const [name, run] of Object.entries(cases)) {
    try {
      const result = run(text);
      console.log(name + ": returned " + (Array.isArray(result) ? "an array" : result));
    } catch (e) {
      console.log(name + ": " + e.name + ": " + e.message);
    }
  }

  text = undefined;
  Bun.gc(true);
  try {
    const { n } = cases["Statement#get parameter"]("q".repeat(2 ** 30));
    console.log("ASCII parameter: " + (n === 2 ** 30 ? "SQLite got the string" : "length " + n));
  } catch (e) {
    const tooBigForSQLite = e.message === "string or blob too big";
    console.log("ASCII parameter: " + (tooBigForSQLite ? "SQLite got the string" : e.name + ": " + e.message));
  }
`;

// The length is what is under test, so the child holds a string of 1 GiB, and a
// second one while the cookie case joins the header. The test skips on small
// machines (the gate streams-string-limit.test.ts uses). The child takes about 10
// seconds in a debug ASAN build, 6 of them in the unoptimized ASCII scan of the
// last row, so this one test carries its own ceiling. `repeat` is used instead of
// the harness's `Buffer.alloc(n, fill).toString()`: for one character it takes
// half the time and it does not hold a second 1 GiB.
test.skipIf(totalmem() < 8 * 1024 ** 3)(
  "a string whose UTF-8 form does not fit in a buffer is an error instead of an abort",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim().split("\n"), stderr, exitCode }).toEqual({
      stdout: [
        "X509Certificate#checkHost: returned undefined",
        "X509Certificate#checkEmail: returned undefined",
        "new X509Certificate: RangeError: Out of memory",
        "hkdfSync salt: RangeError: Out of memory",
        "hkdfSync info: RangeError: Out of memory",
        "hkdf salt: RangeError: Out of memory",
        "require.resolve.paths: returned an array",
        "Module._resolveLookupPaths: returned an array",
        "Database#run: RangeError: Out of memory",
        "Database#prepare: RangeError: Out of memory",
        "Statement#get parameter: RangeError: Out of memory",
        "decodeURIComponentSIMD: RangeError: Out of memory",
        "new Bun.CookieMap: RangeError: Out of memory",
        "ASCII parameter: SQLite got the string",
      ],
      stderr: "",
      exitCode: 0,
    });
  },
  30_000,
);

// The same APIs with a short string that takes the conversion: Latin-1 with a
// non-ASCII character, and 16-bit.
test.each([
  ["Latin-1", "caf\u00e9"],
  ["16-bit", "caf\u00e9 \u{1F600}"],
])("a short %s string converts as before", (_, text) => {
  const bytes = Buffer.from(text);
  const cert = new crypto.X509Certificate(tls.cert);
  using db = new Database(":memory:");
  db.run(`CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('${text}')`);

  expect({
    checkHost: cert.checkHost(text),
    checkEmail: cert.checkEmail(text),
    // The PEM reader stops at the END line, so the text after it only has to convert.
    certificate: new crypto.X509Certificate(tls.cert + text).fingerprint256,
    hkdf: Buffer.from(crypto.hkdfSync("sha256", "key", text, text, 16)).toString("hex"),
    resolvePaths: require.resolve.paths(text),
    resolveLookupPaths: (Module as any)._resolveLookupPaths(text, { paths: ["/node_modules"] }),
    run: db.query("SELECT v FROM t").get(),
    prepare: db.prepare(`SELECT '${text}' AS v`).get(),
    parameter: db.prepare("SELECT ? AS v").get(text),
    decode: decodeURIComponentSIMD("%41" + text),
    cookie: new Bun.CookieMap("a=%41" + text).get("a"),
  }).toEqual({
    checkHost: undefined,
    checkEmail: undefined,
    certificate: cert.fingerprint256,
    hkdf: Buffer.from(crypto.hkdfSync("sha256", "key", bytes, bytes, 16)).toString("hex"),
    resolvePaths: require.resolve.paths("not-a-builtin"),
    resolveLookupPaths: ["/node_modules"],
    run: { v: text },
    prepare: { v: text },
    parameter: { v: text },
    decode: "A" + text,
    cookie: "A" + text,
  });
});

// A 16-bit string with an unpaired surrogate, with a UTF-8 form of about 1.43 GB.
// The conversion measures the string and converts it into a buffer of that size.
// The measured size does not count the 3 bytes of U+FFFD for the surrogate, so the
// conversion then needs 3 bytes for each code unit, which is a few bytes more. It
// used to grow the first buffer for that, and a buffer grows by 1.5x: past the
// 2**31 - 1 bytes that it can hold. The process aborted (`panic(main thread):
// abort() called`, exit code 134), also inside try / catch. Now the conversion
// allocates the exact size, and SQLite gets the statement. It reports that the
// statement is too long, or takes it where the system SQLite has a higher limit.
//
// The surrogate is not the last code unit of the statement: the arm64 code can
// count 4 bytes for an unpaired surrogate at the very end, and then the first
// buffer is large enough.
const illFormedFixture = `
  const { Database } = require("bun:sqlite");
  const { DatabaseSync } = require("node:sqlite");

  const sql = "select '" + "\\u65e5".repeat(477_218_588) + "\\ud800'";
  const db = new Database(":memory:");
  const nodeDb = new DatabaseSync(":memory:");
  const tooLongForSQLite = e => e.code === "SQLITE_TOOBIG" || (e.code === "ERR_SQLITE_ERROR" && e.errcode === 18);

  const cases = {
    "Database#prepare": () => db.prepare(sql),
    "DatabaseSync#prepare": () => nodeDb.prepare(sql),
  };
  for (const [name, run] of Object.entries(cases)) {
    try {
      run();
      console.log(name + ": SQLite got the statement");
    } catch (e) {
      console.log(name + ": " + (tooLongForSQLite(e) ? "SQLite got the statement" : e.name + ": " + e.message));
    }
  }
`;

// The child needs 5 GB, and a debug build or an ASAN build takes minutes for it.
// This test and the first one are not concurrent: together they need more memory
// than either asks the machine to have.
test.skipIf(isDebug || isASAN || totalmem() < 12 * 1024 ** 3)(
  "a long 16-bit string with an unpaired surrogate converts instead of aborting",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", illFormedFixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim().split("\n"), stderr, exitCode }).toEqual({
      stdout: ["Database#prepare: SQLite got the statement", "DatabaseSync#prepare: SQLite got the statement"],
      stderr: "",
      exitCode: 0,
    });
  },
  60_000,
);

// The same step with strings of a few megabytes. WebKit's debug builds can refuse
// every allocation over a given size (JSC's maxSingleAllocationSize option), and
// an allocation that cannot fail aborts the process when it is refused. With a
// limit of 4 MiB:
//   a  the second buffer is 3,000,003 bytes. It used to be 1.5x the first: 4,500,000.
//   c  the second buffer is 6,000,000 bytes. Its allocation can fail now, and the
//      conversion reports that.
// The option does nothing in a release build of WebKit.
const secondBufferFixture = `
  const { Database } = require("bun:sqlite");
  const db = new Database(":memory:");
  const texts = {
    a: "\\u65e5".repeat(999_999) + "\\ud800a",
    c: "a".repeat(1_999_998) + "\\u65e5\\ud800",
  };
  for (const [name, text] of Object.entries(texts)) {
    const cases = {
      "Date.parse": () => Date.parse(text),
      "Database#prepare": () => db.prepare("select 1 where '" + text + "' = ''"),
    };
    for (const [api, run] of Object.entries(cases)) {
      try {
        const result = run();
        console.log(name + " " + api + ": " + (typeof result === "number" ? result : "prepared"));
      } catch (e) {
        console.log(name + " " + api + ": " + e.name + ": " + e.message);
      }
    }
  }
`;

test.skipIf(!isDebug)("the second buffer for an unpaired surrogate has the exact size, and can fail", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", secondBufferFixture],
    env: { ...bunEnv, BUN_JSC_maxSingleAllocationSize: String(4 * 1024 * 1024) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim().split("\n"), stderr, exitCode }).toEqual({
    stdout: [
      "a Date.parse: NaN",
      "a Database#prepare: prepared",
      "c Date.parse: RangeError: Out of memory",
      "c Database#prepare: RangeError: Out of memory",
    ],
    stderr: "",
    exitCode: 0,
  });
});

// The second conversion writes U+FFFD for the unpaired surrogate. The first buffer
// is inside the conversion's 1,024 bytes of stack, or an allocation. So is the
// second, with 3 bytes for each code unit. Each length here is next to one of
// those limits (341 and 1,024 code units). Two native consumers get the bytes and
// show them: SQLite returns them in hex, and a URL percent-encodes them. The two
// use different entry points of the conversion. Buffer.from() and
// encodeURIComponent() have encoders of their own.
test("an unpaired surrogate converts to U+FFFD on each side of the conversion's buffer sizes", () => {
  using db = new Database(":memory:");
  const converted: Record<string, string> = {};
  const expected: Record<string, string> = {};
  const hex = (text: string) => Buffer.from(text).toString("hex").toUpperCase();
  // Each text here is "a" and characters that are not ASCII, so both encoders escape the same bytes.
  const percentEncoded = (text: string) => encodeURIComponent(text.toWellFormed());
  const url = new URL("http://example.com/");
  const usernameOf = (text: string) => ((url.username = text), url.username);
  const ascii = (length: number) => Buffer.alloc(length, "a").toString("latin1");
  const utf16 = (pattern: string, length: number) =>
    Buffer.alloc(length * 2, Buffer.from(pattern, "utf16le")).toString("utf16le");

  // SQLite converts the text of a statement. The statement has the length under test, so its text is shorter.
  const prefix = "SELECT hex(CAST('";
  const suffix = "' AS BLOB)) AS hex";
  for (const length of [340, 341, 342, 343, 1021, 1022, 1023, 1024, 1025, 4096]) {
    for (const [consumer, textLength] of [
      ["SQLite", length - prefix.length - suffix.length],
      ["URL", length],
    ] as const) {
      // A debug build takes 80 ms to set a username of this length.
      if (consumer === "URL" && length === 4096) continue;
      const texts = {
        "3 bytes for each, unpaired surrogate at the end": utf16("\u65e5", textLength - 1) + "\ud800",
        "3 bytes for each, unpaired surrogate in the middle":
          utf16("\u65e5", textLength >> 1) + "\udbff" + utf16("\u65e5", textLength - (textLength >> 1) - 1),
        "unpaired surrogate at the start, then ASCII": "\udc00" + ascii(textLength - 1),
        "ASCII, then two unpaired surrogates": ascii(textLength - 2) + "\udfff\ud800",
      };
      for (const [name, text] of Object.entries(texts)) {
        const row = `${name}, ${length} code units, ${consumer}`;
        if (consumer === "SQLite") {
          converted[row] = (db.prepare(prefix + text + suffix).get() as { hex: string }).hex;
          expected[row] = hex(text);
        } else {
          converted[row] = usernameOf(text);
          expected[row] = percentEncoded(text);
        }
      }
    }
  }

  expect(converted).toEqual(expected);
});
