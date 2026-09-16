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
//
// A C API that takes a `const char*` (a path, SQL text, a name) needs a copy with
// a NUL terminator, so it cannot borrow. `bun:sqlite` and `node:sqlite` made that
// copy with `utf8()`, which asserts the same way, and now throw
// `RangeError: Out of memory` through `Bun::tryUTF8`. The console label functions
// convert the label in Rust, which has no such limit. `process.initgroups` hands a
// string user to initgroups(3) as it is, so it is one more `const char*` row. A
// user or group name that bun looks up itself is bounded before the lookup
// instead (the last test).
import { decodeURIComponentSIMD } from "bun:internal-for-testing";
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isWindows, tempDir, tls } from "harness";
import crypto from "node:crypto";
import Module from "node:module";
import { totalmem } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// On macOS bun loads the system libsqlite3.dylib. Apple builds it without the
// session extension and without extension loading, and each of those calls says
// so before it reads its strings (node-sqlite.test.ts has the same probes).
const succeeds = (run: () => void) => {
  try {
    run();
    return true;
  } catch {
    return false;
  }
};
const sqliteHasSession = succeeds(() => new DatabaseSync(":memory:").createSession());
const sqliteHasLoadExtension = succeeds(() => new DatabaseSync(":memory:", { allowExtension: true }).close());

// Each case prints its line as soon as it finishes. If a case aborts the child,
// the diff shows which one.
const fixture = `
  import { decodeURIComponentSIMD } from "bun:internal-for-testing";
  import { Database } from "bun:sqlite";
  import crypto from "node:crypto";
  import Module from "node:module";
  import { DatabaseSync, backup } from "node:sqlite";

  const cert = new crypto.X509Certificate(${JSON.stringify(tls.cert)});
  const db = new Database(":memory:");
  const nodeDb = new DatabaseSync(":memory:", { allowExtension: ${sqliteHasLoadExtension} });

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

    "new Database": text => new Database(text),
    "Database#serialize": text => db.serialize(text),
    "Database#fileControl": text => db.fileControl(text, 10, 0),
    "new DatabaseSync": text => new DatabaseSync(text),
    "DatabaseSync#exec": text => nodeDb.exec(text),
    "DatabaseSync#prepare": text => nodeDb.prepare(text),
    "SQLTagStore#get": text => nodeDb.createTagStore().get([text]),
    "DatabaseSync#location": text => nodeDb.location(text),
    "DatabaseSync#serialize": text => nodeDb.serialize(text),
    "DatabaseSync#deserialize dbName": text => nodeDb.deserialize(new Uint8Array(8), { dbName: text }),
    "DatabaseSync#function name": text => nodeDb.function(text, () => 1),
    "DatabaseSync#aggregate name": text => nodeDb.aggregate(text, { start: 0, step: sum => sum }),
    "StatementSync#get parameter": text => nodeDb.prepare("SELECT length(?) AS n").get(text),
    "StatementSync#get function result": text => {
      nodeDb.function("result", () => text);
      return nodeDb.prepare("SELECT result()").get();
    },
    "backup path": text => backup(nodeDb, text),
    "backup source": text => backup(nodeDb, ":memory:", { source: text }),
    "backup target": text => backup(nodeDb, ":memory:", { target: text }),
    ...(${isWindows} ? {} : {
      "process.initgroups user": text => process.initgroups(text, 0),
    }),
    ...(${sqliteHasLoadExtension} ? {
      "Database#loadExtension path": text => db.loadExtension(text),
      "Database#loadExtension entryPoint": text => db.loadExtension("extension", text),
      "DatabaseSync#loadExtension path": text => nodeDb.loadExtension(text),
      "DatabaseSync#loadExtension entryPoint": text => nodeDb.loadExtension("extension", text),
    } : {}),
    ...(${sqliteHasSession} ? {
      "DatabaseSync#createSession db": text => nodeDb.createSession({ db: text }),
      "DatabaseSync#createSession table": text => nodeDb.createSession({ table: text }),
    } : {}),
    // A property key is hashed: 0.1 seconds for 1 GiB in a release build, 10 seconds in a debug build.
    ...(${isDebug} ? {} : {
      "StatementSync#get named parameter key": text => nodeDb.prepare("SELECT $a").get({ [text]: 1 }),
    }),
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
  const ascii = "q".repeat(2 ** 30);
  const asciiParameter = name => {
    try {
      const { n } = cases[name](ascii);
      console.log("ASCII " + name + ": " + (n === 2 ** 30 ? "SQLite got the string" : "length " + n));
    } catch (e) {
      const tooBigForSQLite = e.message === "string or blob too big";
      console.log("ASCII " + name + ": " + (tooBigForSQLite ? "SQLite got the string" : e.name + ": " + e.message));
    }
  };
  asciiParameter("Statement#get parameter");

  // The ASCII scan and the hash of 1 GiB are unoptimized in a debug build: 6 seconds for each row above, 14 for each below.
  if (!${isDebug}) {
    asciiParameter("StatementSync#get parameter");

    // With a timer for another label, these look the label up and print nothing.
    console.time("another label");
    for (const name of ["timeLog", "timeEnd", "countReset", "time"]) {
      console.log("console." + name + ": returned " + console[name](ascii));
    }
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
        ...[
          "new Database",
          "Database#serialize",
          "Database#fileControl",
          "new DatabaseSync",
          "DatabaseSync#exec",
          "DatabaseSync#prepare",
          "SQLTagStore#get",
          "DatabaseSync#location",
          "DatabaseSync#serialize",
          "DatabaseSync#deserialize dbName",
          "DatabaseSync#function name",
          "DatabaseSync#aggregate name",
          "StatementSync#get parameter",
          "StatementSync#get function result",
          "backup path",
          "backup source",
          "backup target",
          ...(isWindows ? [] : ["process.initgroups user"]),
          ...(sqliteHasLoadExtension
            ? [
                "Database#loadExtension path",
                "Database#loadExtension entryPoint",
                "DatabaseSync#loadExtension path",
                "DatabaseSync#loadExtension entryPoint",
              ]
            : []),
          ...(sqliteHasSession ? ["DatabaseSync#createSession db", "DatabaseSync#createSession table"] : []),
          ...(isDebug ? [] : ["StatementSync#get named parameter key"]),
        ].map(name => `${name}: RangeError: Out of memory`),
        "ASCII Statement#get parameter: SQLite got the string",
        ...(isDebug
          ? []
          : [
              "ASCII StatementSync#get parameter: SQLite got the string",
              "console.timeLog: returned undefined",
              "console.timeEnd: returned undefined",
              "console.countReset: returned undefined",
              "console.time: returned undefined",
            ]),
      ],
      stderr: "",
      exitCode: 0,
    });
  },
  30_000,
);

// console.count prints its label, so it has a child of its own. The parent counts
// the bytes and does not keep them. A debug build takes 28 seconds for this label.
test.skipIf(isDebug || totalmem() < 8 * 1024 ** 3)(
  "console.count prints a label of 2**30 characters",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `console.count("q".repeat(2 ** 30));`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    let bytes = 0;
    for await (const chunk of proc.stdout) bytes += chunk.length;
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect({ bytes, stderr, exitCode }).toEqual({ bytes: 2 ** 30 + ": 1\n".length, stderr: "", exitCode: 0 });
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

  // The path, the SQL text, the function name and the parameter name are `const char*`. The parameter and the function result are a pointer and a length.
  using dir = tempDir("utf8-conversion-limit", {});
  const path = join(String(dir), `${text}.sqlite`);
  using fileDb = new Database(path);
  fileDb.run("CREATE TABLE t (v TEXT)");
  using nodeDb = new DatabaseSync(path);
  nodeDb.exec(`INSERT INTO t VALUES ('${text}')`);
  nodeDb.function(text, () => text);

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
    open: fileDb.query("SELECT v FROM t").get(),
    nodeOpen: nodeDb.location(),
    nodeExec: { ...nodeDb.prepare("SELECT v FROM t").get() },
    nodeParameter: { ...nodeDb.prepare("SELECT ? AS v").get(text) },
    nodeFunction: { ...nodeDb.prepare(`SELECT "${text}"() AS v`).get() },
    nodeNamedParameter: { ...nodeDb.prepare("SELECT $cl\u00e9 AS v").get({ "$cl\u00e9": text }) },
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
    open: { v: text },
    nodeOpen: path,
    nodeExec: { v: text },
    nodeParameter: { v: text },
    nodeFunction: { v: text },
    nodeNamedParameter: { v: text },
  });
});

// The label functions key their table by the UTF-8 bytes of the label and print those bytes. The escapes stay
// escapes in the child's source, so that it builds the Latin-1, 16-bit and lone surrogate strings itself.
test("a short console label of each encoding converts as before", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      String.raw`
        for (const label of [undefined, "", "ascii", "caf\u00e9", "caf\u00e9 \u{1F600}", "lone \ud800 surrogate"]) {
          console.count(label);
          console.count(label);
          console.countReset(label);
          console.count(label);
          console.time(label);
          console.timeLog(label, "extra");
          console.timeEnd(label);
        }
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const labels = ["default", "", "ascii", "caf\u00e9", "caf\u00e9 \u{1F600}", "lone \ufffd surrogate"];
  expect({
    stdout: stdout.split("\n"),
    stderr: stderr.replace(/^\[.+?s\]/gm, "[time]").split("\n"),
    exitCode,
  }).toEqual({
    stdout: [...labels.flatMap(label => [`${label}: 1`, `${label}: 2`, `${label}: 1`]), ""],
    stderr: [
      ...labels.flatMap(label => (label ? [`[time] ${label} extra`, `[time] ${label}`] : ["[time] extra", "[time]"])),
      "",
    ],
    exitCode: 0,
  });
});

// A user or group name that bun looks up went to getpwnam_r / getgrnam_r through `utf8()` as well. A passwd or group entry has to
// fit in the 8192 byte buffer that the lookup fills, so a longer name cannot match, and it no longer reaches the
// lookup. Where nss-systemd is configured, a name of 4 MiB aborted the process inside the lookup
// (`Assertion '_nn_ <= ALLOCA_MAX' failed`), long before the 2**30 characters that `utf8()` asserts on.
test.skipIf(isWindows)(
  "a user or group name too long for a passwd or group entry is an unknown credential",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const cases = {
          "setuid": name => process.setuid(name),
          "seteuid": name => process.seteuid(name),
          "setgid": name => process.setgid(name),
          "setegid": name => process.setegid(name),
          "setgroups": name => process.setgroups([name]),
          "initgroups extraGroup": name => process.initgroups(0, name),
        };
        for (const length of [8192, 4 * 1024 * 1024]) {
          for (const [key, run] of Object.entries(cases)) {
            try {
              console.log(key + ": returned " + run("q".repeat(length)));
            } catch (e) {
              console.log(key + ": " + e.code + ": " + e.message.replace(/q+$/, match => "q x " + match.length));
            }
          }
        }
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const expected = (length: number) => [
      `setuid: ERR_UNKNOWN_CREDENTIAL: User identifier does not exist: q x ${length}`,
      `seteuid: ERR_UNKNOWN_CREDENTIAL: User identifier does not exist: q x ${length}`,
      `setgid: ERR_UNKNOWN_CREDENTIAL: Group identifier does not exist: q x ${length}`,
      `setegid: ERR_UNKNOWN_CREDENTIAL: Group identifier does not exist: q x ${length}`,
      `setgroups: ERR_UNKNOWN_CREDENTIAL: Group identifier does not exist: q x ${length}`,
      `initgroups extraGroup: ERR_UNKNOWN_CREDENTIAL: Group identifier does not exist: q x ${length}`,
    ];
    expect({ stdout: stdout.trim().split("\n"), stderr, exitCode }).toEqual({
      stdout: [...expected(8192), ...expected(4 * 1024 * 1024)],
      stderr: "",
      exitCode: 0,
    });
  },
);
