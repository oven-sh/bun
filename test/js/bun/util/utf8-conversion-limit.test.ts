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
// string of that length: SQLite's own "too big" shows that SQLite got the
// string's buffer, where a copy reports "Out of memory".
import { decodeURIComponentSIMD } from "bun:internal-for-testing";
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tls } from "harness";
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
  function report(label, name, text) {
    try {
      const result = cases[name](text);
      console.log(label + name + ": returned " + (Array.isArray(result) ? "an array" : result));
    } catch (e) {
      console.log(label + name + ": " + e.name + ": " + e.message);
    }
  }

  let text = "\\u00e9".repeat(2 ** 30);
  for (const name of Object.keys(cases)) report("", name, text);

  text = undefined;
  Bun.gc(true);
  report("ASCII ", "Statement#get parameter", "q".repeat(2 ** 30));
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
        "ASCII Statement#get parameter: Error: string or blob too big",
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
    resolveLookupPaths: Module._resolveLookupPaths(text, { paths: ["/node_modules"] }),
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
