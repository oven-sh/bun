import { describe, expect, it, test } from "bun:test";
import { readFileSync, writeFileSync } from "fs";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

function test1000000(arg1: any, arg218718132: any) {}

test("most types", () => {
  expect(test1000000).toMatchSnapshot("Function");
  expect(null).toMatchSnapshot("null");
  expect(() => {}).toMatchSnapshot("arrow function");
  expect(7).toMatchSnapshot("testing 7");
  expect(6).toMatchSnapshot("testing 4");
  expect(5).toMatchSnapshot("testing 5");
  expect(4).toMatchSnapshot("testing 4");
  expect(3).toMatchSnapshot();
  expect(1).toMatchSnapshot();
  expect(2).toMatchSnapshot();
  expect(9).toMatchSnapshot("testing 7");
  expect(8).toMatchSnapshot("testing 7");
  expect(undefined).toMatchSnapshot("undefined");
  expect("hello string").toMatchSnapshot("string");
  expect([[]]).toMatchSnapshot("Array with empty array");
  expect([[], [], [], []]).toMatchSnapshot("Array with multiple empty arrays");
  expect([1, 2, [3, 4], [4, [5, 6]], 8]).toMatchSnapshot("Array with nested arrays");
  let buf = new Buffer("hello");
  // @ts-ignore
  buf.x = "yyyyyyyyyy";
  expect(buf).toMatchSnapshot("Buffer with property");
  expect(new Buffer("hello")).toMatchSnapshot("Buffer2");
  expect(new Buffer("hel`\n\n`")).toMatchSnapshot("Buffer3");
  expect({ a: new Buffer("hello") }).toMatchSnapshot("Object with Buffer");
  expect({ a: { b: new Buffer("hello") } }).toMatchSnapshot("nested object with Buffer");
  expect({ a: { b: new Buffer("") } }).toMatchSnapshot("nested object with empty Buffer");
  expect({ a: new Buffer("") }).toMatchSnapshot("Object with empty Buffer");
  expect(new Buffer("")).toMatchSnapshot("Buffer");
  expect(new Date(0)).toMatchSnapshot("Date");
  expect(new Error("hello")).toMatchSnapshot("Error");
  expect(new Error()).toMatchSnapshot("Empty Error");
  expect(new Map()).toMatchSnapshot("empty map");
  expect(
    new Map([
      [1, "eight"],
      ["seven", "312390840812"],
    ] as any),
  ).toMatchSnapshot("Map");
  expect(new Set()).toMatchSnapshot("Set");
  expect(new Set([1, 2, 3, 4, 5, 6, 7, 8, 9])).toMatchSnapshot("Set2");
  expect(new WeakMap()).toMatchSnapshot("WeakMap");
  expect(new WeakSet()).toMatchSnapshot("WeakSet");
  expect(new Promise(() => {})).toMatchSnapshot("Promise");
  expect(new RegExp("hello")).toMatchSnapshot("RegExp");

  let s = new String("");

  expect(s).toMatchSnapshot("String with property");
  expect({ a: s }).toMatchSnapshot("Object with String with property");
  expect({ a: new String() }).toMatchSnapshot("Object with empty String");
  expect(new String("hello")).toMatchSnapshot("String");

  expect(new Number(7)).toMatchSnapshot("Number");
  expect({ a: {} }).toMatchSnapshot("Object with empty object");
  expect(new Boolean(true)).toMatchSnapshot("Boolean");
  expect(new Int8Array([3])).toMatchSnapshot("Int8Array with one element");
  expect(new Int8Array([1, 2, 3, 4])).toMatchSnapshot("Int8Array with elements");
  expect(new Int8Array()).toMatchSnapshot("Int8Array");
  expect({ a: 1, b: new Int8Array([123, 423, 4, 34]) }).toMatchSnapshot("Object with Int8Array");
  expect({ a: { b: new Int8Array([]) } }).toMatchSnapshot("nested object with empty Int8Array");
  expect(new Uint8Array()).toMatchSnapshot("Uint8Array");
  expect(new Uint8ClampedArray()).toMatchSnapshot("Uint8ClampedArray");
  expect(new Int16Array()).toMatchSnapshot("Int16Array");
  expect(new Uint16Array()).toMatchSnapshot("Uint16Array");
  expect(new Int32Array()).toMatchSnapshot("Int32Array");
  expect(new Uint32Array()).toMatchSnapshot("Uint32Array");
  expect(new Float32Array()).toMatchSnapshot("Float32Array");
  expect(new Float64Array()).toMatchSnapshot("Float64Array");
  expect(new ArrayBuffer(0)).toMatchSnapshot("ArrayBuffer");
  expect(new DataView(new ArrayBuffer(0))).toMatchSnapshot("DataView");
  expect({}).toMatchSnapshot("Object");
  expect({ a: 1, b: 2 }).toMatchSnapshot("Object2");
  expect([]).toMatchSnapshot("Array");
  expect([1, 2, 3]).toMatchSnapshot("Array2");
  class A {
    a = 1;
    b = 2;
    constructor() {
      // @ts-ignore
      this.c = 3;
    }
    d() {
      return 4;
    }
    get e() {
      return 5;
    }
    set e(value) {
      // @ts-ignore
      this.f = value;
    }
  }
  expect(new A()).toMatchSnapshot("Class");

  expect({ a: 1, b: 2, c: 3, d: new A(), e: 5, f: 6 }).toMatchSnapshot({ d: expect.any(A) });
  expect({
    first: new Date(),
    a: {
      j: new Date(),
      b: {
        c: {
          num: 1,
          d: {
            e: {
              bigint: 123n,
              f: {
                g: {
                  h: {
                    i: new Date(),
                    bool: true,
                  },
                  compare: "compare",
                },
              },
              ignore1: 234,
              ignore2: {
                ignore3: 23421,
                ignore4: {
                  ignore5: {
                    ignore6: "hello",
                    ignore7: "done",
                  },
                },
              },
            },
          },
          string: "hello",
        },
      },
    },
  }).toMatchSnapshot({
    first: expect.any(Date),
    a: {
      j: expect.any(Date),
      b: {
        c: {
          num: expect.any(Number),
          string: expect.any(String),
          d: {
            e: {
              bigint: expect.any(BigInt),
              f: {
                g: {
                  compare: "compare",
                  h: {
                    i: expect.any(Date),
                    bool: expect.any(Boolean),
                  },
                },
              },
            },
          },
        },
      },
    },
  });
});

it("should work with expect.anything()", () => {
  // expect({ a: 0 }).toMatchSnapshot({ a: expect.anything() });
});

/** The result line of a test, or one of the final count lines, of a `bun test` run. */
const summaryLine =
  /^\((pass|fail|skip|todo)\) |^ \d+ (pass|fail|skip|todo)$|^snapshots: |^ +\d+ snapshots, |^ \d+ expect\(\) calls$|^Ran \d+ tests? across /;

/**
 * Runs `bun test` in `cwd`. The runner prints only its version banner to stdout, everything else goes to stderr.
 * `summary` keeps the result line of each test and the final counts, and leaves out the per-failure diffs.
 * `report` and `output` start with the command and its exit code, then hold `summary` or the whole `stderr`.
 */
async function runBunTest(cwd: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...args],
    // bun refuses to write snapshots in CI
    env: { ...bunEnv, CI: "false" },
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(normalizeBunSnapshot(stdout)).toBe("bun test <version> (<revision>)");
  // Some messages quote a path, which doubles the backslashes of a Windows path. Map that form to <dir> too.
  const quotedDir = cwd.replaceAll("\\", "\\\\") + "\\\\";
  const normalized = normalizeBunSnapshot(stderr.replaceAll(quotedDir, "<dir>/"), cwd);
  const summary = normalized
    .split("\n")
    .filter(line => summaryLine.test(line))
    .join("\n");
  const command = `$ bun test ${args.join(" ")} (exit ${exitCode})`;
  return {
    exitCode,
    stderr: normalized,
    summary,
    report: `${command}\n${summary}`,
    output: `${command}\n${normalized}`,
  };
}
type BunTestRun = Awaited<ReturnType<typeof runBunTest>>;

/**
 * The reports of the runs that change a file. Every run in `passing` must pass the same way as the last of
 * them.
 */
function transcript(changing: BunTestRun[], passing: BunTestRun[]): string {
  const reference = changing.at(-1)!;
  for (const run of passing) {
    expect(run.summary, run.stderr).toBe(reference.summary);
    expect(run.exitCode).toBe(reference.exitCode);
  }
  return changing.map(run => run.report).join("\n\n");
}

/** A multi-line snapshot value goes on its own lines inside the backticks. Inline snapshots indent those lines. */
function quoteSnapshot(value: string, indent = ""): string {
  if (!value.includes("\n")) return `\`${value}\``;
  return (
    "`\n" +
    value
      .split("\n")
      .map(line => (line ? indent + line : line))
      .join("\n") +
    "\n`"
  );
}

/** The `.snap` file with the given entries, in the order bun writes them. */
function snapFile(entries: Record<string, string>): string {
  let file = "// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n";
  for (const [name, value] of Object.entries(entries)) file += `\nexports[\`${name}\`] = ${quoteSnapshot(value)};\n`;
  return file;
}

/**
 * A temp dir with one test file, `snapshot.test.ts`. With `inline`, the test file holds its snapshots,
 * otherwise `__snapshots__/snapshot.test.ts.snap` does.
 */
class SnapshotTester {
  readonly dir;
  constructor(
    readonly inline: boolean,
    source: string,
    snap?: string,
  ) {
    this.dir = tempDir("snapshotTester", {
      "snapshot.test.ts": source,
      ...(snap === undefined ? {} : { "__snapshots__/snapshot.test.ts.snap": snap }),
    });
  }
  [Symbol.dispose]() {
    this.dir[Symbol.dispose]();
  }
  run(...flags: string[]) {
    return runBunTest(String(this.dir), ...flags, "./snapshot.test.ts");
  }
  writeSource(source: string) {
    writeFileSync(`${this.dir}/snapshot.test.ts`, source);
  }
  /** The file that holds the snapshots. */
  snapshot(): string {
    return readFileSync(
      `${this.dir}/${this.inline ? "snapshot.test.ts" : "__snapshots__/snapshot.test.ts.snap"}`,
      "utf8",
    );
  }
}

/** The stored snapshot matches: the run passes and leaves it alone. */
async function expectPass(t: SnapshotTester, expected: string): Promise<string> {
  const passed = await t.run();
  expect(t.snapshot(), passed.stderr).toBe(expected);
  return passed.report;
}

/** No stored snapshot yet: the first run writes `expected`, and the next run passes without a change. */
async function expectCreate(t: SnapshotTester, expected: string): Promise<string> {
  const created = await t.run();
  expect(t.snapshot(), created.stderr).toBe(expected);
  return [created.report, await expectPass(t, expected)].join("\n\n");
}

/**
 * The stored snapshot does not match the test: the run fails and leaves it alone, `-u` rewrites it to
 * `expected`, and the next run passes without a change.
 */
async function expectUpdate(t: SnapshotTester, expected: string): Promise<string> {
  const before = t.snapshot();
  const failed = await t.run();
  expect(t.snapshot(), failed.stderr).toBe(before);
  const updated = await t.run("-u");
  expect(t.snapshot(), updated.stderr).toBe(expected);
  return [failed.report, updated.report, await expectPass(t, expected)].join("\n\n");
}

function defaultWrap(a: string, b: string = ""): string {
  return `test("abc", () => { expect(${a}).toMatchSnapshot(${b}) });`;
}

/**
 * Each case snapshots `value` from the test "abc". `snapshot` is the stored form of the value, as it appears
 * between the backticks of a `.snap` entry or of an inline snapshot.
 */
const snapshotCases: { label: string; value: string; snapshot: string; matchers?: string; inline?: false }[] = [
  { label: "dollars", value: "`\\$`", snapshot: `"$"` },
  { label: "backslash", value: "`\\\\`", snapshot: `"\\\\"` },
  { label: "dollars curly", value: "`\\${}`", snapshot: `"\\\${}"` },
  { label: "dollars curly 2", value: "`\\${`", snapshot: `"\\\${"` },
  { label: "stuff", value: `\`æ™\n\r!!!!*5897yhduN\\"\\'\\\`Il\``, snapshot: `"æ™\n\n!!!!*5897yhduN"'\\\`Il"` },
  { label: "stuff 2", value: `\`æ™\n\r!!!!*5897yh!uN\\"\\'\\\`Il\``, snapshot: `"æ™\n\n!!!!*5897yh!uN"'\\\`Il"` },
  { label: "regexp 1", value: "/${1..}/", snapshot: `/\\\${1..}/` },
  { label: "regexp 2", value: "/${2..}/", snapshot: `/\\\${2..}/` },
  { label: "string", value: '"abc"', snapshot: `"abc"` },
  { label: "string with newline", value: '"qwerty\\nioup"', snapshot: `"qwerty\nioup"` },
  {
    label: "null byte",
    value: '"1 \x00"',
    snapshot: `"1 \\x00"`,
    // disabled for inline snapshot because of the bug in CodepointIterator; should be fixed by https://github.com/oven-sh/bun/pull/15163
    inline: false,
  },
  { label: "null byte 2", value: '"2 \\x00"', snapshot: `"2 \\x00"` },
  { label: "backticks", value: "`This is \\`wrong\\``", snapshot: `"This is \\\`wrong\\\`"` },
  {
    label: "unicode surrogate halves",
    value: "'😊abc`${def} " + "😊".substring(0, 1) + ", " + "😊".substring(1, 2) + " '",
    snapshot: `"😊abc\\\`\\\${def} \uFFFD, \uFFFD "`,
    // disabled for inline snapshot because reading the file will have U+FFFD in it rather than surrogate halves
    inline: false,
  },
  {
    label: "property matchers",
    value: '{createdAt: new Date(), id: Math.floor(Math.random() * 20), name: "LeBron James"}',
    matchers: `{createdAt: expect.any(Date), id: expect.any(Number)}`,
    snapshot: `{\n  "createdAt": Any<Date>,\n  "id": Any<Number>,\n  "name": "LeBron James",\n}`,
    // disabled for inline snapshot because it needs to update the thing
    inline: false,
  },
];

describe.concurrent("snapshots", () => {
  // each case starts from the snapshot the previous case leaves behind, so the run fails before -u replaces it
  const chained = snapshotCases.map((c, i) => ({ ...c, previous: i === 0 ? `""` : snapshotCases[i - 1].snapshot }));
  test.each(chained)("$label", async ({ value, snapshot, matchers, previous }) => {
    using t = new SnapshotTester(false, defaultWrap(value, matchers), snapFile({ "abc 1": previous }));
    expect(await expectUpdate(t, snapFile({ "abc 1": snapshot }))).toMatchInlineSnapshot(`
      "$ bun test ./snapshot.test.ts (exit 1)
      (fail) abc
       0 pass
       1 fail
      snapshots: 1 failed
       1 expect() calls
      Ran 1 test across 1 file.

      $ bun test -u ./snapshot.test.ts (exit 0)
      (pass) abc
       1 pass
       0 fail
      snapshots: +1 added
       1 expect() calls
      Ran 1 test across 1 file.

      $ bun test ./snapshot.test.ts (exit 0)
      (pass) abc
       1 pass
       0 fail
       1 snapshots, 1 expect() calls
      Ran 1 test across 1 file."
    `);
  });

  test("jest newline oddity", async () => {
    using t = new SnapshotTester(false, defaultWrap("'\\n'"), snapFile({ "abc 1": `""` }));
    const snap = snapFile({ "abc 1": `"\n"` });
    expect(await expectUpdate(t, snap)).toMatchInlineSnapshot(`
      "$ bun test ./snapshot.test.ts (exit 1)
      (fail) abc
       0 pass
       1 fail
      snapshots: 1 failed
       1 expect() calls
      Ran 1 test across 1 file.

      $ bun test -u ./snapshot.test.ts (exit 0)
      (pass) abc
       1 pass
       0 fail
      snapshots: +1 added
       1 expect() calls
      Ran 1 test across 1 file.

      $ bun test ./snapshot.test.ts (exit 0)
      (pass) abc
       1 pass
       0 fail
       1 snapshots, 1 expect() calls
      Ran 1 test across 1 file."
    `);
    // "\r" and "\r\n" match the stored "\n"
    t.writeSource(defaultWrap("'\\r'"));
    expect(await expectPass(t, snap)).toMatchInlineSnapshot(`
      "$ bun test ./snapshot.test.ts (exit 0)
      (pass) abc
       1 pass
       0 fail
       1 snapshots, 1 expect() calls
      Ran 1 test across 1 file."
    `);
    t.writeSource(defaultWrap("'\\r\\n'"));
    expect(await expectPass(t, snap)).toMatchInlineSnapshot(`
      "$ bun test ./snapshot.test.ts (exit 0)
      (pass) abc
       1 pass
       0 fail
       1 snapshots, 1 expect() calls
      Ran 1 test across 1 file."
    `);
  });

  const threeTests = [
    `test("t1", () => {expect("abc def ghi jkl").toMatchSnapshot();})`,
    `test("t2", () => {expect("abc\`def").toMatchSnapshot();})`,
    `test("t3", () => {expect("abc def ghi").toMatchSnapshot();})`,
    "",
  ].join("\n");
  const brokenSnap = "exports[`snap 1`] = `hello`goodbye`;";

  test("don't grow file on error", async () => {
    using t = new SnapshotTester(false, threeTests, brokenSnap);
    const failed = await t.run();
    expect(t.snapshot(), failed.stderr).toBe(brokenSnap);
    expect(failed.output).toMatchInlineSnapshot(`
      "$ bun test ./snapshot.test.ts (exit 1)
      snapshot.test.ts:
      1 | test("t1", () => {expect("abc def ghi jkl").toMatchSnapshot();})
                                                      ^
      error: Failed to snapshot value: abc def ghi jkl
          at <anonymous> (file:NN:NN)
      (fail) t1
      1 | test("t1", () => {expect("abc def ghi jkl").toMatchSnapshot();})
      2 | test("t2", () => {expect("abc\`def").toMatchSnapshot();})
                                              ^
      error: Failed to snapshot value: abc\`def
          at <anonymous> (file:NN:NN)
      (fail) t2
      1 | test("t1", () => {expect("abc def ghi jkl").toMatchSnapshot();})
      2 | test("t2", () => {expect("abc\`def").toMatchSnapshot();})
      3 | test("t3", () => {expect("abc def ghi").toMatchSnapshot();})
                                                  ^
      error: Failed to snapshot value: abc def ghi
          at <anonymous> (file:NN:NN)
      (fail) t3

       0 pass
       3 fail
       3 expect() calls
      Ran 3 tests across 1 file."
    `);
  });

  test("replaces file that fails to parse when update flag is used", async () => {
    using t = new SnapshotTester(false, threeTests, brokenSnap);
    const updated = await t.run("-u");
    const snap = snapFile({ "t1 1": `"abc def ghi jkl"`, "t2 1": `"abc\\\`def"`, "t3 1": `"abc def ghi"` });
    expect(t.snapshot(), updated.stderr).toBe(snap);
    expect([updated.report, await expectPass(t, snap)].join("\n\n")).toMatchInlineSnapshot(`
      "$ bun test -u ./snapshot.test.ts (exit 0)
      (pass) t1
      (pass) t2
      (pass) t3
       3 pass
       0 fail
      snapshots: +3 added
       3 expect() calls
      Ran 3 tests across 1 file.

      $ bun test ./snapshot.test.ts (exit 0)
      (pass) t1
      (pass) t2
      (pass) t3
       3 pass
       0 fail
       3 snapshots, 3 expect() calls
      Ran 3 tests across 1 file."
    `);
  });

  test("grow file for new snapshot", async () => {
    const source = (abc: string, def?: string) =>
      `test("abc", () => { expect("${abc}").toMatchSnapshot() });\n` +
      (def === undefined ? "" : `test("def", () => { expect("${def}").toMatchSnapshot() });\n`);
    using t = new SnapshotTester(false, source("hello"));
    expect(await expectCreate(t, snapFile({ "abc 1": `"hello"` }))).toMatchInlineSnapshot(`
      "$ bun test ./snapshot.test.ts (exit 0)
      (pass) abc
       1 pass
       0 fail
      snapshots: +1 added
       1 expect() calls
      Ran 1 test across 1 file.

      $ bun test ./snapshot.test.ts (exit 0)
      (pass) abc
       1 pass
       0 fail
       1 snapshots, 1 expect() calls
      Ran 1 test across 1 file."
    `);

    // a new test adds its snapshot to the file without -u
    t.writeSource(source("hello", "goodbye"));
    const grown = await t.run();
    expect(t.snapshot(), grown.stderr).toBe(snapFile({ "abc 1": `"hello"`, "def 1": `"goodbye"` }));
    expect(grown.report).toMatchInlineSnapshot(`
      "$ bun test ./snapshot.test.ts (exit 0)
      (pass) abc
      (pass) def
       2 pass
       0 fail
      snapshots: 1 passed, 1 added
       2 expect() calls
      Ran 2 tests across 1 file."
    `);

    t.writeSource(source("hello", "hello"));
    expect(await expectUpdate(t, snapFile({ "abc 1": `"hello"`, "def 1": `"hello"` }))).toMatchInlineSnapshot(`
      "$ bun test ./snapshot.test.ts (exit 1)
      (pass) abc
      (fail) def
       1 pass
       1 fail
      snapshots: 1 passed, 1 failed
       2 expect() calls
      Ran 2 tests across 1 file.

      $ bun test -u ./snapshot.test.ts (exit 0)
      (pass) abc
      (pass) def
       2 pass
       0 fail
      snapshots: +2 added
       2 expect() calls
      Ran 2 tests across 1 file.

      $ bun test ./snapshot.test.ts (exit 0)
      (pass) abc
      (pass) def
       2 pass
       0 fail
       2 snapshots, 2 expect() calls
      Ran 2 tests across 1 file."
    `);

    t.writeSource(source("goodbye", "hello"));
    expect(await expectUpdate(t, snapFile({ "abc 1": `"goodbye"`, "def 1": `"hello"` }))).toMatchInlineSnapshot(`
      "$ bun test ./snapshot.test.ts (exit 1)
      (fail) abc
      (pass) def
       1 pass
       1 fail
      snapshots: 1 passed, 1 failed
       2 expect() calls
      Ran 2 tests across 1 file.

      $ bun test -u ./snapshot.test.ts (exit 0)
      (pass) abc
      (pass) def
       2 pass
       0 fail
      snapshots: +2 added
       2 expect() calls
      Ran 2 tests across 1 file.

      $ bun test ./snapshot.test.ts (exit 0)
      (pass) abc
      (pass) def
       2 pass
       0 fail
       2 snapshots, 2 expect() calls
      Ran 2 tests across 1 file."
    `);
  });

  test("backtick in test name", async () => {
    using t = new SnapshotTester(false, `test("\`", () => {expect("abc").toMatchSnapshot();})`);
    expect(await expectCreate(t, snapFile({ "\\` 1": `"abc"` }))).toMatchInlineSnapshot(`
      "$ bun test ./snapshot.test.ts (exit 0)
      (pass) \`
       1 pass
       0 fail
      snapshots: +1 added
       1 expect() calls
      Ran 1 test across 1 file.

      $ bun test ./snapshot.test.ts (exit 0)
      (pass) \`
       1 pass
       0 fail
       1 snapshots, 1 expect() calls
      Ran 1 test across 1 file."
    `);
  });

  test("dollars curly in test name", async () => {
    using t = new SnapshotTester(false, `test("\${}", () => {expect("abc").toMatchSnapshot();})`);
    expect(await expectCreate(t, snapFile({ "\\${} 1": `"abc"` }))).toMatchInlineSnapshot(`
      "$ bun test ./snapshot.test.ts (exit 0)
      (pass) \${}
       1 pass
       0 fail
      snapshots: +1 added
       1 expect() calls
      Ran 1 test across 1 file.

      $ bun test ./snapshot.test.ts (exit 0)
      (pass) \${}
       1 pass
       0 fail
       1 snapshots, 1 expect() calls
      Ran 1 test across 1 file."
    `);
  });

  const snap15283 = snapFile({ "Should work 1": `"This is \\\`wrong\\\`"` });
  test("#15283", async () => {
    using t = new SnapshotTester(
      false,
      `it("Should work", () => {
        expect(\`This is \\\`wrong\\\`\`).toMatchSnapshot();
      });`,
    );
    expect(await expectCreate(t, snap15283)).toMatchInlineSnapshot(`
      "$ bun test ./snapshot.test.ts (exit 0)
      (pass) Should work
       1 pass
       0 fail
      snapshots: +1 added
       1 expect() calls
      Ran 1 test across 1 file.

      $ bun test ./snapshot.test.ts (exit 0)
      (pass) Should work
       1 pass
       0 fail
       1 snapshots, 1 expect() calls
      Ran 1 test across 1 file."
    `);
  });

  test("#15283 unicode", async () => {
    using t = new SnapshotTester(
      false,
      `it("Should work", () => {expect(\`😊This is \\\`wrong\\\`\`).toMatchSnapshot()});`,
      snap15283,
    );
    expect(await expectUpdate(t, snapFile({ "Should work 1": `"😊This is \\\`wrong\\\`"` }))).toMatchInlineSnapshot(`
      "$ bun test ./snapshot.test.ts (exit 1)
      (fail) Should work
       0 pass
       1 fail
      snapshots: 1 failed
       1 expect() calls
      Ran 1 test across 1 file.

      $ bun test -u ./snapshot.test.ts (exit 0)
      (pass) Should work
       1 pass
       0 fail
      snapshots: +1 added
       1 expect() calls
      Ran 1 test across 1 file.

      $ bun test ./snapshot.test.ts (exit 0)
      (pass) Should work
       1 pass
       0 fail
       1 snapshots, 1 expect() calls
      Ran 1 test across 1 file."
    `);
  });
});

describe.concurrent("inline snapshots", () => {
  test.each(snapshotCases.filter(c => c.inline !== false))("$label", async ({ value, snapshot }) => {
    const source = defaultWrap(value);
    using t = new SnapshotTester(true, source.replace("toMatchSnapshot()", "toMatchInlineSnapshot('bad')"));
    const updated = source.replace("toMatchSnapshot()", `toMatchInlineSnapshot(${quoteSnapshot(snapshot, "  ")})`);
    expect(await expectUpdate(t, updated)).toMatchInlineSnapshot(`
      "$ bun test ./snapshot.test.ts (exit 1)
      (fail) abc
       0 pass
       1 fail
      snapshots: 1 failed
       1 expect() calls
      Ran 1 test across 1 file.

      $ bun test -u ./snapshot.test.ts (exit 0)
      (pass) abc
       1 pass
       0 fail
       1 snapshots, 1 expect() calls
      Ran 1 test across 1 file.

      $ bun test ./snapshot.test.ts (exit 0)
      (pass) abc
       1 pass
       0 fail
       1 snapshots, 1 expect() calls
      Ran 1 test across 1 file."
    `);
  });
});

const helper_js = /*js*/ `import {expect} from "bun:test";
export function wrongFile(value) {
  expect(value).toMatchInlineSnapshot();
}
`;

/** A temp dir for test files with inline snapshots. `helper.js` is a module that is not a test file. */
class InlineSnapshotTester {
  readonly dir = tempDir("InlineSnapshotTester", { "helper.js": helper_js });
  tmpid = 0;
  [Symbol.dispose]() {
    this.dir[Symbol.dispose]();
  }
  tmpfile(content: string): string {
    const filename = "_" + this.tmpid++ + ".test.ts";
    writeFileSync(this.dir + "/" + filename, content);
    return filename;
  }
  readfile(name: string): string {
    return readFileSync(this.dir + "/" + name, { encoding: "utf-8" });
  }
  run(thefile: string, ...flags: string[]) {
    return runBunTest(String(this.dir), ...flags, "./" + thefile);
  }

  /** A file whose inline snapshot bun cannot update: the run fails and leaves the file alone. */
  async testError(code: string, ...flags: string[]): Promise<string> {
    const thefile = this.tmpfile(code);
    const failed = await this.run(thefile, ...flags);
    expect(this.readfile(thefile), failed.stderr).toEqual(code);
    return failed.output;
  }
  /**
   * Runs the same test file two ways, concurrently: with empty inline snapshots, which the first run fills in,
   * and with wrong inline snapshots, which `-u` corrects. `v(a, b, c)` picks the text for each way: `a` is the
   * empty snapshot, `b` the wrong one, and `c` the right one that both ways end with.
   */
  async test(cb: (v: (a: string, b: string, c: string) => string) => string): Promise<string> {
    const settled = await Promise.allSettled([
      this.testInternal(
        false,
        cb((a, b, c) => a),
        cb((a, b, c) => c),
      ),
      this.testInternal(
        true,
        cb((a, b, c) => b),
        cb((a, b, c) => c),
      ),
    ]);
    for (const r of settled) if (r.status === "rejected") throw r.reason;
    const [fresh, wrong] = settled.map(r => (r as PromiseFulfilledResult<BunTestRun[]>).value);
    return transcript([fresh[0], wrong[0], wrong[1]], [...fresh.slice(1), ...wrong.slice(2)]);
  }
  async testUpdateOnly(cb: (v: (b: string, c: string) => string) => string): Promise<string> {
    const runs = await this.testInternal(
      true,
      cb((b, c) => b),
      cb((b, c) => c),
    );
    return transcript(runs.slice(0, 2), runs.slice(2));
  }
  /**
   * With `use_update`, `before_value` holds wrong snapshots: the first run fails and `-u` corrects them.
   * Without it, `before_value` holds empty snapshots, which the first run fills in. Either way the file ends as
   * `after_value`, and every later run passes without a change, with or without `-u`.
   */
  async testInternal(use_update: boolean, before_value: string, after_value: string): Promise<BunTestRun[]> {
    const thefile = this.tmpfile(before_value);
    const runs: BunTestRun[] = [];

    if (use_update) {
      const failed = await this.run(thefile);
      expect(this.readfile(thefile), failed.stderr).toEqual(before_value);
      runs.push(failed);
    }

    const written = await this.run(thefile, ...(use_update ? ["-u"] : []));
    expect(this.readfile(thefile), written.stderr).toEqual(after_value);
    runs.push(written);

    for (const flags of [[], ["-u"]]) {
      const passed = await this.run(thefile, ...flags);
      expect(this.readfile(thefile), passed.stderr).toEqual(after_value);
      runs.push(passed);
    }
    return runs;
  }
}

describe.concurrent("inline snapshots", () => {
  const bad = '"bad"';
  test("changing inline snapshot", async () => {
    using tester = new InlineSnapshotTester();
    expect(
      await tester.test(
        v => /*js*/ `
        test("inline snapshots", () => {
          expect("1").toMatchInlineSnapshot(${v("", bad, '`"1"`')});
          expect("2").toMatchInlineSnapshot( ${v("", bad, '`"2"`')});
          expect("3").toMatchInlineSnapshot(  ${v("", bad, '`"3"`')});
        });
        test("m1", () => {
          expect("a").toMatchInlineSnapshot(${v("", bad, '`"a"`')});
          expect("b").toMatchInlineSnapshot(${v("", bad, '`"b"`')});
          expect("§<-1l").toMatchInlineSnapshot(${v("", bad, '`"§<-1l"`')});
          expect("𐀁").toMatchInlineSnapshot(${v("", bad, '`"𐀁"`')});
          expect( "m ") . toMatchInlineSnapshot ( ${v("", bad, '`"m "`')}) ;
          expect("§§§").     toMatchInlineSnapshot(${v("", bad, '`"§§§"`')}) ;
        });
      `,
      ),
    ).toMatchInlineSnapshot(`
      "$ bun test ./_0.test.ts (exit 0)
      (pass) inline snapshots
      (pass) m1
       2 pass
       0 fail
      snapshots: +9 added
       9 expect() calls
      Ran 2 tests across 1 file.

      $ bun test ./_1.test.ts (exit 1)
      (fail) inline snapshots
      (fail) m1
       0 pass
       2 fail
      snapshots: 2 failed
       2 expect() calls
      Ran 2 tests across 1 file.

      $ bun test -u ./_1.test.ts (exit 0)
      (pass) inline snapshots
      (pass) m1
       2 pass
       0 fail
       9 snapshots, 9 expect() calls
      Ran 2 tests across 1 file."
    `);
  });
  test("inline snapshot update cases", async () => {
    using tester = new InlineSnapshotTester();
    expect(
      await tester.test(
        // prettier-ignore
        v => /*js*/ `
        test("cases", () => {
          expect("1").toMatchInlineSnapshot(${v("", bad, '`"1"`')});
          expect("2").toMatchInlineSnapshot( ${v("", bad, '`"2"`')});
          expect("3"). toMatchInlineSnapshot( ${v("", bad, '`"3"`')});
          expect("4") . toMatchInlineSnapshot( ${v("", bad, '`"4"`')});
          expect("5" ) . toMatchInlineSnapshot( ${v("", bad, '`"5"`')});
          expect("6" ) . toMatchInlineSnapshot ( ${v("", bad, '`"6"`')});
          expect("7" ) . toMatchInlineSnapshot (  ${v("", bad, '`"7"`')});
          expect("8" ) . toMatchInlineSnapshot (  ${v("", bad, '`"8"`')}) ;
          expect("9" ) . toMatchInlineSnapshot (  \n${v("", bad, '`"9"`')}) ;
          expect("10" ) .\ntoMatchInlineSnapshot (  \n${v("", bad, '`"10"`')}) ;
          expect("11")
            .toMatchInlineSnapshot(${v("", bad, '`"11"`')}) ;
          expect("12")\r
            .\r
              toMatchInlineSnapshot\r
                (\r
                  ${v("", bad, '`"12"`')})\r
                    ;
          expect("13").toMatchInlineSnapshot(${v("", bad, '`"13"`')}); expect("14").toMatchInlineSnapshot(${v("", bad, '`"14"`')}); expect("15").toMatchInlineSnapshot(${v("", bad, '`"15"`')});
          expect({a: new Date()}).toMatchInlineSnapshot({a: expect.any(Date)}${v("", `, "bad"`, `, \`
            {
              "a": Any<Date>,
            }
          \``)});
          expect({a: new Date()}).toMatchInlineSnapshot({a: expect.any(Date)}${v(",", `, "bad"`, `, \`
            {
              "a": Any<Date>,
            }
          \``)});
          expect({a: new Date()}).toMatchInlineSnapshot({a: expect.any(Date)
}${v("", `, "bad"`, `, \`
  {
    "a": Any<Date>,
  }
\``)});
          expect({a: new Date()}).\ntoMatchInlineSnapshot({a: expect.any(Date)
}${v("", `, "bad"`, `, \`
  {
    "a": Any<Date>,
  }
\``)});
          expect({a: new Date()})\n.\ntoMatchInlineSnapshot({a: expect.any(Date)
}${v("", `, "bad"`, `, \`
  {
    "a": Any<Date>,
  }
\``)});
          expect({a: new Date()})\n.\ntoMatchInlineSnapshot({a: 
expect.any(Date)
}${v("", `, "bad"`, `, \`
  {
    "a": Any<Date>,
  }
\``)});
          expect({a: new Date()})\n.\ntoMatchInlineSnapshot({a: 
expect.any(
Date)
}${v("", `, "bad"`, `, \`
  {
    "a": Any<Date>,
  }
\``)});
          expect({a: new Date()}).toMatchInlineSnapshot( {a: expect.any(Date)} ${v("", `, "bad"`, `, \`
            {
              "a": Any<Date>,
            }
          \``)});
          expect({a: new Date()}).toMatchInlineSnapshot( {a: expect.any(Date)} ${v(",", `, "bad"`, `, \`
            {
              "a": Any<Date>,
            }
          \``)});
          expect("😊").toMatchInlineSnapshot(${v("", bad, `\`"😊"\``)});
          expect("\\r").toMatchInlineSnapshot(${v("", bad, `\`
            "
            "
          \``)});
          expect("\\r\\n").toMatchInlineSnapshot(${v("", bad, `\`
            "
            "
          \``)});
          expect("\\n").toMatchInlineSnapshot(${v("", bad, `\`
            "
            "
          \``)});
        });
      `,
      ),
    ).toMatchInlineSnapshot(`
      "$ bun test ./_0.test.ts (exit 0)
      (pass) cases
       1 pass
       0 fail
      snapshots: +28 added
       28 expect() calls
      Ran 1 test across 1 file.

      $ bun test ./_1.test.ts (exit 1)
      (fail) cases
       0 pass
       1 fail
      snapshots: 1 failed
       1 expect() calls
      Ran 1 test across 1 file.

      $ bun test -u ./_1.test.ts (exit 0)
      (pass) cases
       1 pass
       0 fail
       28 snapshots, 28 expect() calls
      Ran 1 test across 1 file."
    `);
  });
  it("updating outside of a test", async () => {
    using tester = new InlineSnapshotTester();
    expect(
      await tester.test(
        v => /*js*/ `
        expect("1").toMatchInlineSnapshot(${v("", bad, '`"1"`')});
      `,
      ),
    ).toMatchInlineSnapshot(`
      "$ bun test ./_0.test.ts (exit 0)
       0 pass
       0 fail
      snapshots: +1 added
       1 expect() calls
      Ran 0 tests across 1 file.

      $ bun test ./_1.test.ts (exit 1)
       0 pass
       1 fail
      snapshots: 1 failed
       1 expect() calls
      Ran 1 test across 1 file.

      $ bun test -u ./_1.test.ts (exit 0)
       0 pass
       0 fail
       1 snapshots, 1 expect() calls
      Ran 0 tests across 1 file."
    `);
  });
  it.skip("should pass not needing update outside of a test", async () => {
    // todo write the test right
    using tester = new InlineSnapshotTester();
    await tester.test(
      v => /*js*/ `
        expect("1").toMatchInlineSnapshot('"1"');
      `,
    );
  });
  it("should error trying to update the same line twice", async () => {
    using tester = new InlineSnapshotTester();
    expect(
      await tester.testError(/*js*/ `
        function oops(a) {expect(a).toMatchInlineSnapshot()}
        test("whoops", () => {
          oops(1);
          oops(2);
        });
      `),
    ).toMatchInlineSnapshot(`
      "$ bun test ./_0.test.ts (exit 1)
      _0.test.ts:
      (pass) whoops
      2 |         function oops(a) {expect(a).toMatchInlineSnapshot()}
                                                                    ^
      error: Failed to update inline snapshot: Multiple inline snapshots on the same line must all have the same value:
      Expected: 1
      Received: 2
          at <dir>/_0.test.ts:2:59

       1 pass
       0 fail
      snapshots: +1 added
       2 expect() calls
      Ran 1 test across 1 file."
    `);

    // fun trick:
    // function oops(a) {expect(a).toMatchInlineSnapshot('1')}
    // now do oops(1); oops(2);
    // with `-u` it will toggle between '1' and '2' but won't error
    // jest has the same bug so it's fine
  });

  // snapshot in a snapshot
  it("should not allow a snapshot in a snapshot", async () => {
    // this is possible to support, but is not supported
    using tester = new InlineSnapshotTester();
    expect(
      await tester.testError(/*js*/ `
        test("cases", () => {
          expect({a: new Date()}).toMatchInlineSnapshot(
            ( expect(2).toMatchInlineSnapshot() , {a: expect.any(Date)})
              ,
          );
        });
      `),
    ).toMatchInlineSnapshot(`
      "$ bun test ./_0.test.ts (exit 1)
      _0.test.ts:
      (pass) cases
      4 |             ( expect(2).toMatchInlineSnapshot() , {a: expect.any(Date)})
                                                        ^
      error: Failed to update inline snapshot: Did not advance.
          at <dir>/_0.test.ts:4:47

       1 pass
       0 fail
      snapshots: +1 added
       2 expect() calls
      Ran 1 test across 1 file."
    `);
  });

  it("requires exactly 'toMatchInlineSnapshot' 1", async () => {
    using tester = new InlineSnapshotTester();
    expect(
      await tester.testError(/*js*/ `
        test("cases", () => {
          expect(1)["toMatchInlineSnapshot"]();
        });
      `),
    ).toMatchInlineSnapshot(`
      "$ bun test ./_0.test.ts (exit 1)
      _0.test.ts:
      (pass) cases
      3 |           expect(1)["toMatchInlineSnapshot"]();
                              ^
      error: Failed to update inline snapshot: Could not find 'toMatchInlineSnapshot' here
          at <dir>/_0.test.ts:3:21

       1 pass
       0 fail
       1 snapshots, 1 expect() calls
      Ran 1 test across 1 file."
    `);
  });
  it("requires exactly 'toMatchInlineSnapshot' 2", async () => {
    using tester = new InlineSnapshotTester();
    expect(
      await tester.testError(/*js*/ `
        test("cases", () => {
          expect(1).t\\u{6f}MatchInlineSnapshot();
        });
      `),
    ).toMatchInlineSnapshot(`
      "$ bun test ./_0.test.ts (exit 1)
      _0.test.ts:
      (pass) cases
      3 |           expect(1).t/u{6f}MatchInlineSnapshot();
                              ^
      error: Failed to update inline snapshot: Could not find 'toMatchInlineSnapshot' here
          at <dir>/_0.test.ts:3:21

       1 pass
       0 fail
       1 snapshots, 1 expect() calls
      Ran 1 test across 1 file."
    `);
  });
  it("only replaces when the argument is a literal string 1", async () => {
    using tester = new InlineSnapshotTester();
    expect(
      await tester.testError(
        /*js*/ `
        test("cases", () => {
          const value = "25";
          expect({}).toMatchInlineSnapshot(value);
        });
      `,
        "-u",
      ),
    ).toMatchInlineSnapshot(`
      "$ bun test -u ./_0.test.ts (exit 1)
      _0.test.ts:
      (pass) cases
      4 |           expect({}).toMatchInlineSnapshot(value);
                                                     ^
      error: Failed to update inline snapshot: Argument must be a string literal
          at <dir>/_0.test.ts:4:44

       1 pass
       0 fail
       1 snapshots, 1 expect() calls
      Ran 1 test across 1 file."
    `);
  });
  it("only replaces when the argument is a literal string 2", async () => {
    using tester = new InlineSnapshotTester();
    expect(
      await tester.testError(
        /*js*/ `
        test("cases", () => {
          const value = "25";
          expect({}).toMatchInlineSnapshot({}, value);
        });
      `,
        "-u",
      ),
    ).toMatchInlineSnapshot(`
      "$ bun test -u ./_0.test.ts (exit 1)
      _0.test.ts:
      (pass) cases
      4 |           expect({}).toMatchInlineSnapshot({}, value);
                                                         ^
      error: Failed to update inline snapshot: Argument must be a string literal
          at <dir>/_0.test.ts:4:48

       1 pass
       0 fail
       1 snapshots, 1 expect() calls
      Ran 1 test across 1 file."
    `);
  });
  it("only replaces when the argument is a literal string 3", async () => {
    using tester = new InlineSnapshotTester();
    expect(
      await tester.testError(
        /*js*/ `
        test("cases", () => {
          expect({}).toMatchInlineSnapshot({}, {});
        });
      `,
        "-u",
      ),
    ).toMatchInlineSnapshot(`
      "$ bun test -u ./_0.test.ts (exit 1)
      _0.test.ts:
      (pass) cases
      3 |           expect({}).toMatchInlineSnapshot({}, {});
                                                         ^
      error: Failed to update inline snapshot: Argument must be a string literal
          at <dir>/_0.test.ts:3:48

       1 pass
       0 fail
       1 snapshots, 1 expect() calls
      Ran 1 test across 1 file."
    `);
  });
  it("only replaces when the argument is a literal string 4", async () => {
    using tester = new InlineSnapshotTester();
    expect(
      await tester.testError(
        /*js*/ `test("cases", () => {
          expect({}).toMatchInlineSnapshot("1", {});
        });`,
        "-u",
      ),
    ).toMatchInlineSnapshot(`
      "$ bun test -u ./_0.test.ts (exit 1)
      _0.test.ts:
      1 | test("cases", () => {
      2 |           expect({}).toMatchInlineSnapshot("1", {});
                               ^
      error: expect(received).toMatchInlineSnapshot(properties, hint)

      Matcher error: Expected properties must be an object
          at <anonymous> (file:NN:NN)
      (fail) cases

       0 pass
       1 fail
       1 expect() calls
      Ran 1 test across 1 file."
    `);
  });
  it("does not allow spread 1", async () => {
    using tester = new InlineSnapshotTester();
    expect(
      await tester.testError(
        /*js*/ `
        test("cases", () => {
          expect({}).toMatchInlineSnapshot(...["1"]);
        });
      `,
        "-u",
      ),
    ).toMatchInlineSnapshot(`
      "$ bun test -u ./_0.test.ts (exit 1)
      _0.test.ts:
      (pass) cases
      3 |           expect({}).toMatchInlineSnapshot(...["1"]);
                                                     ^
      error: Failed to update inline snapshot: Spread is not allowed
          at <dir>/_0.test.ts:3:44

       1 pass
       0 fail
       1 snapshots, 1 expect() calls
      Ran 1 test across 1 file."
    `);
  });
  it("does not allow spread 2", async () => {
    using tester = new InlineSnapshotTester();
    expect(
      await tester.testError(
        /*js*/ `
        test("cases", () => {
          expect({}).toMatchInlineSnapshot({}, ...["1"]);
        });
      `,
        "-u",
      ),
    ).toMatchInlineSnapshot(`
      "$ bun test -u ./_0.test.ts (exit 1)
      _0.test.ts:
      (pass) cases
      3 |           expect({}).toMatchInlineSnapshot({}, ...["1"]);
                                                         ^
      error: Failed to update inline snapshot: Spread is not allowed
          at <dir>/_0.test.ts:3:48

       1 pass
       0 fail
       1 snapshots, 1 expect() calls
      Ran 1 test across 1 file."
    `);
  });
  it("limit two arguments", async () => {
    using tester = new InlineSnapshotTester();
    expect(
      await tester.testError(
        /*js*/ `
        test("cases", () => {
          expect({}).toMatchInlineSnapshot({}, "1", "hello");
        });
      `,
        "-u",
      ),
    ).toMatchInlineSnapshot(`
      "$ bun test -u ./_0.test.ts (exit 1)
      _0.test.ts:
      (pass) cases
      3 |           expect({}).toMatchInlineSnapshot({}, "1", "hello");
                                                              ^
      error: Failed to update inline snapshot: Snapshot expects at most two arguments
          at <dir>/_0.test.ts:3:53

       1 pass
       0 fail
       1 snapshots, 1 expect() calls
      Ran 1 test across 1 file."
    `);
  });
  it("must be in test file", async () => {
    using tester = new InlineSnapshotTester();
    expect(
      await tester.testError(
        /*js*/ `
        import {wrongFile} from "./helper";
        test("cases", () => {
          wrongFile("interesting");
        });
      `,
        "-u",
      ),
    ).toMatchInlineSnapshot(`
      "$ bun test -u ./_0.test.ts (exit 1)
      _0.test.ts:
      1 | import {expect} from "bun:test";
      2 | export function wrongFile(value) {
      3 |   expect(value).toMatchInlineSnapshot();
                          ^
      error: expect(received).toMatchInlineSnapshot()

      Matcher error: Inline snapshot matchers must be called from the test file:
        Expected to be called from file: "<dir>/_0.test.ts"
        toMatchInlineSnapshot called from file: "<dir>/helper.js"
          at wrongFile (file:NN:NN)
          at <anonymous> (file:NN:NN)
      (fail) cases

       0 pass
       1 fail
       1 snapshots, 1 expect() calls
      Ran 1 test across 1 file."
    `);
    expect(tester.readfile("helper.js")).toBe(helper_js);
  });
  it("is right file", async () => {
    using tester = new InlineSnapshotTester();
    expect(
      await tester.test(
        v => /*js*/ `
        import {wrongFile} from "./helper";
        test("cases", () => {
          expect("rightfile").toMatchInlineSnapshot(${v("", '"9"', '`"rightfile"`')});
          expect(wrongFile).toMatchInlineSnapshot(${v("", '"9"', "`[Function: wrongFile]`")});
        });
      `,
      ),
    ).toMatchInlineSnapshot(`
      "$ bun test ./_0.test.ts (exit 0)
      (pass) cases
       1 pass
       0 fail
      snapshots: +2 added
       2 expect() calls
      Ran 1 test across 1 file.

      $ bun test ./_1.test.ts (exit 1)
      (fail) cases
       0 pass
       1 fail
      snapshots: 1 failed
       1 expect() calls
      Ran 1 test across 1 file.

      $ bun test -u ./_1.test.ts (exit 0)
      (pass) cases
       1 pass
       0 fail
       2 snapshots, 2 expect() calls
      Ran 1 test across 1 file."
    `);
  });
  it("indentation", async () => {
    using tester = new InlineSnapshotTester();
    expect(
      await tester.test(
        // prettier-ignore
        v => /*js*/ `
        test("cases", () => {
          expect("abc\\n\\ndef").toMatchInlineSnapshot(${v("", `"hello"`, `\`
            "abc

            def"
          \``)});
          expect("from indented to dedented").toMatchInlineSnapshot(${v("", `\`
            "abc

            def"
          \``, `\`"from indented to dedented"\``)});
        });
      `,
      ),
    ).toMatchInlineSnapshot(`
      "$ bun test ./_0.test.ts (exit 0)
      (pass) cases
       1 pass
       0 fail
      snapshots: +2 added
       2 expect() calls
      Ran 1 test across 1 file.

      $ bun test ./_1.test.ts (exit 1)
      (fail) cases
       0 pass
       1 fail
      snapshots: 1 failed
       1 expect() calls
      Ran 1 test across 1 file.

      $ bun test -u ./_1.test.ts (exit 0)
      (pass) cases
       1 pass
       0 fail
       2 snapshots, 2 expect() calls
      Ran 1 test across 1 file."
    `);
  });
  it("preserve existing indentation", async () => {
    using tester = new InlineSnapshotTester();
    expect(
      await tester.testUpdateOnly(
        // prettier-ignore
        v => /*js*/ `
        test("cases", () => {
          expect("keeps the same\\n\\nindentation").toMatchInlineSnapshot(${v(`\`
                  "weird existing
                  indentation" 
    \``, `\`
                  "keeps the same

                  indentation"
    \``)});
    expect("keeps no\\n\\nindentation").toMatchInlineSnapshot(${v(`\`
"no existing

indentation" 
\``, `\`
"keeps no

indentation"
\``)});
        });
      `,
      ),
    ).toMatchInlineSnapshot(`
      "$ bun test ./_0.test.ts (exit 1)
      (fail) cases
       0 pass
       1 fail
      snapshots: 1 failed
       1 expect() calls
      Ran 1 test across 1 file.

      $ bun test -u ./_0.test.ts (exit 0)
      (pass) cases
       1 pass
       0 fail
       2 snapshots, 2 expect() calls
      Ran 1 test across 1 file."
    `);
  });
  it("#16403", async () => {
    using tester = new InlineSnapshotTester();
    const settled = await Promise.allSettled([
      tester.test(v =>
        v(
          '\tit(\'should get range of notes\', () => {\n\t\tconst range = ["C2", "B2"];\n\n\t\texpect(range).toMatchInlineSnapshot();\n\t});\n',
          '\tit(\'should get range of notes\', () => {\n\t\tconst range = ["C2", "B2"];\n\n\t\texpect(range).toMatchInlineSnapshot(`\n\t\t  [\n\t\t    "ab",\n\t\t    "cd",\n\t\t  ]\n\t\t`);\n\t});\n',
          '\tit(\'should get range of notes\', () => {\n\t\tconst range = ["C2", "B2"];\n\n\t\texpect(range).toMatchInlineSnapshot(`\n\t\t  [\n\t\t    "C2",\n\t\t    "B2",\n\t\t  ]\n\t\t`);\n\t});\n',
        ),
      ),
      tester.testUpdateOnly(v =>
        v(
          '\tit(\'should get range of notes\', () => {\n\t\tconst range = ["C2", "B2"];\n\n\t\texpect(range).toMatchInlineSnapshot(`\n\t\t\t[\n\t\t\t  "ab",\n\t\t\t  "cd",\n\t\t\t]\n\t\t`);\n\t});\n',
          '\tit(\'should get range of notes\', () => {\n\t\tconst range = ["C2", "B2"];\n\n\t\texpect(range).toMatchInlineSnapshot(`\n\t\t\t[\n\t\t\t  "C2",\n\t\t\t  "B2",\n\t\t\t]\n\t\t`);\n\t});\n',
        ),
      ),
    ]);
    for (const r of settled) if (r.status === "rejected") throw r.reason;
    const [spaces, tabs] = settled.map(r => (r as PromiseFulfilledResult<string>).value);
    expect(spaces).toMatchInlineSnapshot(`
      "$ bun test ./_0.test.ts (exit 0)
      (pass) should get range of notes
       1 pass
       0 fail
      snapshots: +1 added
       1 expect() calls
      Ran 1 test across 1 file.

      $ bun test ./_1.test.ts (exit 1)
      (fail) should get range of notes
       0 pass
       1 fail
      snapshots: 1 failed
       1 expect() calls
      Ran 1 test across 1 file.

      $ bun test -u ./_1.test.ts (exit 0)
      (pass) should get range of notes
       1 pass
       0 fail
       1 snapshots, 1 expect() calls
      Ran 1 test across 1 file."
    `);
    expect(tabs).toMatchInlineSnapshot(`
      "$ bun test ./_2.test.ts (exit 1)
      (fail) should get range of notes
       0 pass
       1 fail
      snapshots: 1 failed
       1 expect() calls
      Ran 1 test across 1 file.

      $ bun test -u ./_2.test.ts (exit 0)
      (pass) should get range of notes
       1 pass
       0 fail
       1 snapshots, 1 expect() calls
      Ran 1 test across 1 file."
    `);
  });
});

test.concurrent("write snapshot from filter", async () => {
  const sver = (m: string, a: boolean) => /*js*/ `
    test("mysnap", () => {
      expect("${m}").toMatchInlineSnapshot(${a ? '`"' + m + '"`' : ""});
      expect(() => {throw new Error("${m}!")}).toThrowErrorMatchingInlineSnapshot(${a ? '`"' + m + '!"`' : ""});
    })
  `;
  using dir = tempDir("writesnapshotfromfilter", {
    "mytests": {
      "snap.test.ts": sver("a", false),
      "snap2.test.ts": sver("b", false),
      "more": {
        "testing.test.ts": sver("TEST", false),
      },
    },
  });
  const written = await runBunTest(String(dir), "mytests");
  expect(written.report).toMatchInlineSnapshot(`
    "$ bun test mytests (exit 0)
    (pass) mysnap
    (pass) mysnap
    (pass) mysnap
     3 pass
     0 fail
    snapshots: +6 added
     6 expect() calls
    Ran 3 tests across 3 files."
  `);
  expect(await Bun.file(dir + "/mytests/snap.test.ts").text()).toBe(sver("a", true));
  expect(await Bun.file(dir + "/mytests/snap2.test.ts").text()).toBe(sver("b", true));
  expect(await Bun.file(dir + "/mytests/more/testing.test.ts").text()).toBe(sver("TEST", true));
  const passed = await runBunTest(String(dir), "mytests");
  expect(passed.report).toMatchInlineSnapshot(`
    "$ bun test mytests (exit 0)
    (pass) mysnap
    (pass) mysnap
    (pass) mysnap
     3 pass
     0 fail
     6 snapshots, 6 expect() calls
    Ran 3 tests across 3 files."
  `);
  expect(await Bun.file(dir + "/mytests/snap.test.ts").text()).toBe(sver("a", true));
  expect(await Bun.file(dir + "/mytests/snap2.test.ts").text()).toBe(sver("b", true));
  expect(await Bun.file(dir + "/mytests/more/testing.test.ts").text()).toBe(sver("TEST", true));
});

test("basic unchanging inline snapshot", () => {
  expect("hello").toMatchInlineSnapshot('"hello"');
  expect({ v: new Date() }).toMatchInlineSnapshot(
    { v: expect.any(Date) },
    `
{
  "v": Any<Date>,
}
`,
  );
});

test("indented inline snapshots", () => {
  expect("a\nb").toMatchInlineSnapshot(`
    "a
    b"
`);
  expect({ a: 2 }).toMatchInlineSnapshot(`
    {
      "a": 2,
    }
            `);
  expect(() => {
    expect({ a: 2 }).toMatchInlineSnapshot(`
                {
              "a": 2,
                }
`);
  }).toThrow();
});

test("error snapshots", () => {
  expect(() => {
    throw new Error("hello");
  }).toThrowErrorMatchingInlineSnapshot(`"hello"`);
  expect(() => {
    throw 0;
  }).toThrowErrorMatchingInlineSnapshot(`undefined`);
  expect(() => {
    throw { a: "b" };
  }).toThrowErrorMatchingInlineSnapshot(`undefined`);
  expect(() => {
    throw undefined; // this one doesn't work in jest because it doesn't think the function threw
  }).toThrowErrorMatchingInlineSnapshot(`undefined`);
  expect(() => {
    try {
      expect(() => {}).toThrowErrorMatchingInlineSnapshot(`undefined`);
    } catch (e) {
      (e as Error).message = Bun.stripANSI((e as Error).message);
      throw e;
    }
  }).toThrowErrorMatchingInlineSnapshot(`
"expect(received).toThrowErrorMatchingInlineSnapshot()

Matcher error: Received function did not throw
"
`);
});
test("error inline snapshots", () => {
  expect(() => {
    throw new Error("hello");
  }).toThrowErrorMatchingSnapshot();
  expect(() => {
    throw 0;
  }).toThrowErrorMatchingSnapshot();
  expect(() => {
    throw { a: "b" };
  }).toThrowErrorMatchingSnapshot();
  expect(() => {
    throw undefined;
  }).toThrowErrorMatchingSnapshot();
  expect(() => {
    throw "abcdef";
  }).toThrowErrorMatchingSnapshot("hint");
  expect(() => {
    throw new Error("😊");
  }).toThrowErrorMatchingInlineSnapshot(`"😊"`);
});

test("snapshot numbering", () => {
  function fails() {
    throw new Error("snap");
  }
  expect("item one").toMatchSnapshot();
  expect(fails).toThrowErrorMatchingSnapshot();
  expect("1").toMatchInlineSnapshot(`"1"`);
  expect(fails).toThrowErrorMatchingSnapshot();
  expect(fails).toThrowErrorMatchingInlineSnapshot(`"snap"`);
  expect("hello").toMatchSnapshot();
  expect("hello").toMatchSnapshot("hinted");
});
