import { $ } from "bun";
import { describe, expect, it, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { bunEnv, bunExe, DirectoryTree, isDebug, tempDir, tempDirWithFiles } from "harness";
import { join } from "path";

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

function defaultWrap(a: string, b: string = ""): string {
  return `test("abc", () => { expect(${a}).toMatchSnapshot(${b}) });`;
}

class SnapshotTester {
  dir: string;
  targetSnapshotContents: string;
  isFirst: boolean = true;
  constructor(public inlineSnapshot: boolean) {
    this.dir = tempDirWithFiles("snapshotTester", { "snapshot.test.ts": "" });
    this.targetSnapshotContents = "";
  }
  test(
    label: string,
    contents: string,
    opts: { shouldNotError?: boolean; shouldGrow?: boolean; skipSnapshot?: boolean } = {},
  ) {
    test(label, async () => await this.update(contents, opts), isDebug ? 100_000 : 5_000);
  }
  async update(
    contents: string,
    opts: { shouldNotError?: boolean; shouldGrow?: boolean; skipSnapshot?: boolean; forceUpdate?: boolean } = {},
  ) {
    if (this.inlineSnapshot) {
      contents = contents.replaceAll("toMatchSnapshot()", "toMatchInlineSnapshot('bad')");
      this.targetSnapshotContents = contents;
    }

    const isFirst = this.isFirst;
    this.isFirst = false;
    await Bun.write(this.dir + "/snapshot.test.ts", contents);

    if (!opts.shouldNotError) {
      if (!isFirst) {
        // make sure it fails first:
        expect((await $`cd ${this.dir} && ${bunExe()} test ./snapshot.test.ts`.nothrow().quiet()).exitCode).toBe(1);
        // make sure the existing snapshot is unchanged:
        expect(await this.getSnapshotContents()).toBe(this.targetSnapshotContents);
      }
      // update snapshots now, using -u flag unless this is the first run
      await $`cd ${this.dir} && ${bunExe()} test ${isFirst && !opts.forceUpdate ? "" : "-u"} ./snapshot.test.ts`
        .quiet()
        .env({ ...bunEnv, CI: "false" });
      // make sure the snapshot changed & didn't grow
      const newContents = await this.getSnapshotContents();
      if (!isFirst) {
        expect(newContents).not.toStartWith(this.targetSnapshotContents);
      }
      if (!opts.skipSnapshot && !this.inlineSnapshot) expect(newContents).toMatchSnapshot();
      this.targetSnapshotContents = newContents;
    }
    // run, make sure snapshot does not change
    await $`cd ${this.dir} && ${bunExe()} test ./snapshot.test.ts`.quiet().env({ ...bunEnv, CI: "false" });
    if (!opts.shouldGrow) {
      expect(await this.getSnapshotContents()).toBe(this.targetSnapshotContents);
    } else {
      this.targetSnapshotContents = await this.getSnapshotContents();
    }
  }
  async setSnapshotFile(contents: string) {
    if (this.inlineSnapshot) throw new Error("not allowed");
    await Bun.write(this.dir + "/__snapshots__/snapshot.test.ts.snap", contents);
    this.isFirst = true;
  }
  async getSrcContents(): Promise<string> {
    return await Bun.file(this.dir + "/snapshot.test.ts").text();
  }
  async getSnapshotContents(): Promise<string> {
    if (this.inlineSnapshot) return await this.getSrcContents();
    return await Bun.file(this.dir + "/__snapshots__/snapshot.test.ts.snap").text();
  }
}

for (const inlineSnapshot of [false, true]) {
  describe(inlineSnapshot ? "inline snapshots" : "snapshots", async () => {
    const t = new SnapshotTester(inlineSnapshot);
    await t.update(defaultWrap("''", inlineSnapshot ? '`""`' : undefined), { skipSnapshot: true });

    t.test("dollars", defaultWrap("`\\$`"));
    t.test("backslash", defaultWrap("`\\\\`"));
    t.test("dollars curly", defaultWrap("`\\${}`"));
    t.test("dollars curly 2", defaultWrap("`\\${`"));
    t.test("stuff", defaultWrap(`\`æ™\n\r!!!!*5897yhduN\\"\\'\\\`Il\``));
    t.test("stuff 2", defaultWrap(`\`æ™\n\r!!!!*5897yh!uN\\"\\'\\\`Il\``));

    t.test("regexp 1", defaultWrap("/${1..}/"));
    t.test("regexp 2", defaultWrap("/${2..}/"));
    t.test("string", defaultWrap('"abc"'));
    t.test("string with newline", defaultWrap('"qwerty\\nioup"'));

    if (!inlineSnapshot)
      // disabled for inline snapshot because of the bug in CodepointIterator; should be fixed by https://github.com/oven-sh/bun/pull/15163
      t.test("null byte", defaultWrap('"1 \x00"'));
    t.test("null byte 2", defaultWrap('"2 \\x00"'));

    t.test("backticks", defaultWrap("`This is \\`wrong\\``"));
    if (!inlineSnapshot)
      // disabled for inline snapshot because reading the file will have U+FFFD in it rather than surrogate halves
      t.test(
        "unicode surrogate halves",
        defaultWrap("'😊abc`${def} " + "😊".substring(0, 1) + ", " + "😊".substring(1, 2) + " '"),
      );

    if (!inlineSnapshot)
      // disabled for inline snapshot because it needs to update the thing
      t.test(
        "property matchers",
        defaultWrap(
          '{createdAt: new Date(), id: Math.floor(Math.random() * 20), name: "LeBron James"}',
          `{createdAt: expect.any(Date), id: expect.any(Number)}`,
        ),
      );

    if (!inlineSnapshot) {
      // these other ones are disabled in inline snapshots

      test("jest newline oddity", async () => {
        await t.update(defaultWrap("'\\n'"));
        await t.update(defaultWrap("'\\r'"), { shouldNotError: true });
        await t.update(defaultWrap("'\\r\\n'"), { shouldNotError: true });
      });

      test("don't grow file on error", async () => {
        await t.setSnapshotFile("exports[`snap 1`] = `hello`goodbye`;");
        try {
          await t.update(/*js*/ `
            test("t1", () => {expect("abc def ghi jkl").toMatchSnapshot();})
            test("t2", () => {expect("abc\`def").toMatchSnapshot();})
            test("t3", () => {expect("abc def ghi").toMatchSnapshot();})
          `);
        } catch (e) {}
        expect(await t.getSnapshotContents()).toBe("exports[`snap 1`] = `hello`goodbye`;");
      });

      test("replaces file that fails to parse when update flag is used", async () => {
        await t.setSnapshotFile("exports[`snap 1`] = `hello`goodbye`;");
        await t.update(
          /*js*/ `
            test("t1", () => {expect("abc def ghi jkl").toMatchSnapshot();})
            test("t2", () => {expect("abc\`def").toMatchSnapshot();})
            test("t3", () => {expect("abc def ghi").toMatchSnapshot();})
          `,
          { forceUpdate: true },
        );
        expect(await t.getSnapshotContents()).toBe(
          '// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n\nexports[`t1 1`] = `"abc def ghi jkl"`;\n\nexports[`t2 1`] = `"abc\\`def"`;\n\nexports[`t3 1`] = `"abc def ghi"`;\n',
        );
      });

      test("grow file for new snapshot", async () => {
        const t4 = new SnapshotTester(inlineSnapshot);
        await t4.update(/*js*/ `
              test("abc", () => { expect("hello").toMatchSnapshot() });
            `);
        await t4.update(
          /*js*/ `
                test("abc", () => { expect("hello").toMatchSnapshot() });
                test("def", () => { expect("goodbye").toMatchSnapshot() });
              `,
          { shouldNotError: true, shouldGrow: true },
        );
        await t4.update(/*js*/ `
              test("abc", () => { expect("hello").toMatchSnapshot() });
              test("def", () => { expect("hello").toMatchSnapshot() });
            `);
        await t4.update(/*js*/ `
              test("abc", () => { expect("goodbye").toMatchSnapshot() });
              test("def", () => { expect("hello").toMatchSnapshot() });
            `);
      });

      const t2 = new SnapshotTester(inlineSnapshot);
      t2.test("backtick in test name", `test("\`", () => {expect("abc").toMatchSnapshot();})`);
      const t3 = new SnapshotTester(inlineSnapshot);
      t3.test("dollars curly in test name", `test("\${}", () => {expect("abc").toMatchSnapshot();})`);

      const t15283 = new SnapshotTester(inlineSnapshot);
      t15283.test(
        "#15283",
        `it("Should work", () => {
          expect(\`This is \\\`wrong\\\`\`).toMatchSnapshot();
        });`,
      );
      t15283.test(
        "#15283 unicode",
        `it("Should work", () => {expect(\`😊This is \\\`wrong\\\`\`).toMatchSnapshot()});`,
      );
    }
  });
}

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

class InlineSnapshotTester {
  tmpdir: string;
  tmpid: number;
  constructor(tmpfiles: DirectoryTree) {
    this.tmpdir = tempDirWithFiles("InlineSnapshotTester", tmpfiles);
    this.tmpid = 0;
  }
  tmpfile(content: string): string {
    const filename = "_" + this.tmpid++ + ".test.ts";
    writeFileSync(this.tmpdir + "/" + filename, content);
    return filename;
  }
  readfile(name: string): string {
    return readFileSync(this.tmpdir + "/" + name, { encoding: "utf-8" });
  }

  async spawn(extraArgs: string[], thefile: string) {
    const proc = Bun.spawn({
      cmd: [bunExe(), "test", ...extraArgs, thefile],
      env: { ...bunEnv, CI: "false" },
      cwd: this.tmpdir,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr: { toString: () => stderr }, exitCode };
  }

  async testError(eopts: { update?: boolean; msg: string }, code: string): Promise<void> {
    const thefile = this.tmpfile(code);

    const spawnres = await this.spawn(eopts.update ? ["-u"] : [], thefile);
    expect(spawnres.stderr.toString()).toInclude(eopts.msg);
    expect(spawnres.exitCode).toBe(1);
    expect(this.readfile(thefile)).toEqual(code);
  }
  async test(cb: (v: (a: string, b: string, c: string) => string) => string): Promise<void> {
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
  }
  async testUpdateOnly(cb: (v: (b: string, c: string) => string) => string): Promise<void> {
    await this.testInternal(
      true,
      cb((b, c) => b),
      cb((b, c) => c),
    );
  }
  async testInternal(use_update: boolean, before_value: string, after_value: string): Promise<void> {
    const thefile = this.tmpfile(before_value);

    if (use_update) {
      // run without update, expect error
      const spawnres = await this.spawn([], thefile);
      expect(spawnres.stderr.toString()).toInclude("error:");
      expect(spawnres.exitCode).toBe(1);
      expect(this.readfile(thefile)).toEqual(before_value);
    }

    {
      const spawnres = await this.spawn(use_update ? ["-u"] : [], thefile);
      expect(spawnres.stderr.toString()).not.toInclude("error:");
      expect({
        exitCode: spawnres.exitCode,
        content: this.readfile(thefile),
      }).toEqual({
        exitCode: 0,
        content: after_value,
      });
    }

    // run without update, expect pass with no change
    {
      const spawnres = await this.spawn([], thefile);
      expect(spawnres.stderr.toString()).not.toInclude("error:");
      expect({
        exitCode: spawnres.exitCode,
        content: this.readfile(thefile),
      }).toEqual({
        exitCode: 0,
        content: after_value,
      });
    }

    // update again, expect pass with no change
    {
      const spawnres = await this.spawn(["-u"], thefile);
      expect(spawnres.stderr.toString()).not.toInclude("error:");
      expect({
        exitCode: spawnres.exitCode,
        content: this.readfile(thefile),
      }).toEqual({
        exitCode: 0,
        content: after_value,
      });
    }
  }
}

describe("inline snapshots", () => {
  const bad = '"bad"';
  const helper_js = /*js*/ `
    import {expect} from "bun:test";
    export function wrongFile(value) {
      expect(value).toMatchInlineSnapshot();
    }
  `;
  const tester = new InlineSnapshotTester({
    "helper.js": helper_js,
  });
  test("changing inline snapshot", async () => {
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
    );
  });
  test("inline snapshot update cases", async () => {
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
    );
  });
  it("updating outside of a test", async () => {
    await tester.test(
      v => /*js*/ `
        expect("1").toMatchInlineSnapshot(${v("", bad, '`"1"`')});
      `,
    );
  });
  it.skip("should pass not needing update outside of a test", () => {
    // todo write the test right
    tester.test(
      v => /*js*/ `
        expect("1").toMatchInlineSnapshot('"1"');
      `,
    );
  });
  it("should error trying to update the same line twice", async () => {
    await tester.testError(
      {
        msg: "error: Failed to update inline snapshot: Multiple inline snapshots on the same line must all have the same value",
      },
      /*js*/ `
        function oops(a) {expect(a).toMatchInlineSnapshot()}
        test("whoops", () => {
          oops(1);
          oops(2);
        });
      `,
    );

    // fun trick:
    // function oops(a) {expect(a).toMatchInlineSnapshot('1')}
    // now do oops(1); oops(2);
    // with `-u` it will toggle between '1' and '2' but won't error
    // jest has the same bug so it's fine
  });

  // snapshot in a snapshot
  it("should not allow a snapshot in a snapshot", async () => {
    // this is possible to support, but is not supported
    await tester.testError(
      { msg: "error: Failed to update inline snapshot: Did not advance." },
      ((v: (a: string, b: string, c: string) => string) => /*js*/ `
        test("cases", () => {
          expect({a: new Date()}).toMatchInlineSnapshot(
            ( expect(2).toMatchInlineSnapshot(${v("", bad, "`2`")}) , {a: expect.any(Date)})
              ${v(",", ', "bad"', ', `\n{\n  "a": Any<Date>,\n}\n`')}
          );
        });
      `)((a, b, c) => a),
    );
  });

  it("requires exactly 'toMatchInlineSnapshot' 1", async () => {
    await tester.testError(
      { msg: "error: Failed to update inline snapshot: Could not find 'toMatchInlineSnapshot' here" },
      /*js*/ `
        test("cases", () => {
          expect(1)["toMatchInlineSnapshot"]();
        });
      `,
    );
  });
  it("requires exactly 'toMatchInlineSnapshot' 2", async () => {
    await tester.testError(
      { msg: "error: Failed to update inline snapshot: Could not find 'toMatchInlineSnapshot' here" },
      /*js*/ `
        test("cases", () => {
          expect(1).t\\u{6f}MatchInlineSnapshot();
        });
      `,
    );
  });
  it("only replaces when the argument is a literal string 1", async () => {
    await tester.testError(
      {
        update: true,
        msg: "error: Failed to update inline snapshot: Argument must be a string literal",
      },
      /*js*/ `
        test("cases", () => {
          const value = "25";
          expect({}).toMatchInlineSnapshot(value);
        });
      `,
    );
  });
  it("only replaces when the argument is a literal string 2", async () => {
    await tester.testError(
      {
        update: true,
        msg: "error: Failed to update inline snapshot: Argument must be a string literal",
      },
      /*js*/ `
        test("cases", () => {
          const value = "25";
          expect({}).toMatchInlineSnapshot({}, value);
        });
      `,
    );
  });
  it("only replaces when the argument is a literal string 3", async () => {
    await tester.testError(
      {
        update: true,
        msg: "error: Failed to update inline snapshot: Argument must be a string literal",
      },
      /*js*/ `
        test("cases", () => {
          expect({}).toMatchInlineSnapshot({}, {});
        });
      `,
    );
  });
  it("only replaces when the argument is a literal string 4", async () => {
    await tester.testError(
      {
        update: true,
        msg: "Matcher error: Expected properties must be an object",
      },
      /*js*/ `
        test("cases", () => {
          expect({}).toMatchInlineSnapshot("1", {});
        });
      `,
    );
  });
  it("does not allow spread 1", async () => {
    await tester.testError(
      {
        update: true,
        msg: "error: Failed to update inline snapshot: Spread is not allowed",
      },
      /*js*/ `
        test("cases", () => {
          expect({}).toMatchInlineSnapshot(...["1"]);
        });
      `,
    );
  });
  it("does not allow spread 2", async () => {
    await tester.testError(
      {
        update: true,
        msg: "error: Failed to update inline snapshot: Spread is not allowed",
      },
      /*js*/ `
        test("cases", () => {
          expect({}).toMatchInlineSnapshot({}, ...["1"]);
        });
      `,
    );
  });
  it("limit two arguments", async () => {
    await tester.testError(
      {
        update: true,
        msg: "error: Failed to update inline snapshot: Snapshot expects at most two arguments",
      },
      /*js*/ `
        test("cases", () => {
          expect({}).toMatchInlineSnapshot({}, "1", "hello");
        });
      `,
    );
  });
  it("must be in test file", async () => {
    await tester.testError(
      {
        update: true,
        msg: "Inline snapshot matchers must be called from the test file",
      },
      /*js*/ `
        import {wrongFile} from "./helper";
        test("cases", () => {
          wrongFile("interesting");
        });
      `,
    );
    expect(readFileSync(tester.tmpdir + "/helper.js", "utf-8")).toBe(helper_js);
  });
  it("is right file", async () => {
    await tester.test(
      v => /*js*/ `
        import {wrongFile} from "./helper";
        test("cases", () => {
          expect("rightfile").toMatchInlineSnapshot(${v("", '"9"', '`"rightfile"`')});
          expect(wrongFile).toMatchInlineSnapshot(${v("", '"9"', "`[Function: wrongFile]`")});
        });
      `,
    );
  });
  it("indentation", async () => {
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
    );
  });
  it("preserve existing indentation", async () => {
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
    );
  });
  it("#16403", async () => {
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
  });
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
    expect(() => {}).toThrowErrorMatchingInlineSnapshot(`undefined`);
  }).toThrowErrorMatchingInlineSnapshot(`
"\x1B[2mexpect(\x1B[0m\x1B[31mreceived\x1B[0m\x1B[2m).\x1B[0mtoThrowErrorMatchingInlineSnapshot\x1B[2m(\x1B[0m\x1B[2m)\x1B[0m

\x1B[1mMatcher error\x1B[0m: Received function did not throw
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

test("write snapshot from filter", async () => {
  const sver = (m: string, a: boolean) => /*js*/ `
    test("mysnap", () => {
      expect("${m}").toMatchInlineSnapshot(${a ? '`"' + m + '"`' : ""});
      expect(() => {throw new Error("${m}!")}).toThrowErrorMatchingInlineSnapshot(${a ? '`"' + m + '!"`' : ""});
    })
  `;
  await using dir = tempDir("writesnapshotfromfilter", {
    "mytests": {
      "snap.test.ts": sver("a", false),
      "snap2.test.ts": sver("b", false),
      "more": {
        "testing.test.ts": sver("TEST", false),
      },
    },
  });
  await $`cd ${dir} && ${bunExe()} test mytests`.env({ ...bunEnv, CI: "false" });
  expect(await Bun.file(dir + "/mytests/snap.test.ts").text()).toBe(sver("a", true));
  expect(await Bun.file(dir + "/mytests/snap2.test.ts").text()).toBe(sver("b", true));
  expect(await Bun.file(dir + "/mytests/more/testing.test.ts").text()).toBe(sver("TEST", true));
  await $`cd ${dir} && ${bunExe()} test mytests`.env({ ...bunEnv, CI: "false" });
  expect(await Bun.file(dir + "/mytests/snap.test.ts").text()).toBe(sver("a", true));
  expect(await Bun.file(dir + "/mytests/snap2.test.ts").text()).toBe(sver("b", true));
  expect(await Bun.file(dir + "/mytests/more/testing.test.ts").text()).toBe(sver("TEST", true));
});

// When the runner gives up on a test or hook that is still running (it timed out, or an unhandled
// error failed it while it was awaiting), its body keeps running while the next test executes. The
// snapshot matchers it calls from then on must be rejected, not written under the next test's name.
describe("snapshot matchers called after the runner gave up on the test", () => {
  const rejected = "Snapshot matchers are not supported after the test has finished executing";
  const header = "// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n";

  // `report` logs whether each late matcher threw, and what, so stdout tells the outcomes apart.
  const prelude = /* ts */ `
    import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
    function report(label: string, matcher: () => void) {
      try {
        matcher();
        console.log(label + ": did not throw");
      } catch (error) {
        console.log(label + ": " + (error as Error).message);
      }
    }
  `;

  async function runTestFile(source: string) {
    using dir = tempDir("snapshot-after-runner-moved-on", { "late.test.ts": prelude + source });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "late.test.ts"],
      cwd: String(dir),
      env: { ...bunEnv, CI: "false" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const snapPath = join(String(dir), "__snapshots__", "late.test.ts.snap");
    const snap = existsSync(snapPath) ? readFileSync(snapPath, "utf8") : null;
    // stdout starts with the "bun test vX.Y.Z (sha)" banner; the rest is what the test file logged.
    return { stdout: stdout.replace(/^bun test v.*\n/, ""), stderr, exitCode, snap };
  }

  test.concurrent("a test that timed out", async () => {
    // Same body for both cases, as with test.each. The first case only continues once the second
    // one has started, so it has always timed out by then; the second case then waits for the
    // first one's late matchers before taking its own snapshots. The inline snapshot is keyed by
    // its own source location, so it still works late; it must just not count against "second".
    const { stdout, stderr, snap } = await runTestFile(/* ts */ `
      const secondStarted = Promise.withResolvers<void>();
      const firstDone = Promise.withResolvers<void>();
      async function migrate(name: string) {
        if (name === "first") {
          await secondStarted.promise;
          report("late with hint", () => expect("lockfile of " + name).toMatchSnapshot(name));
          report("late without hint", () => expect("lockfile of " + name).toMatchSnapshot());
          report("late toThrowErrorMatchingSnapshot", () =>
            expect(() => {
              throw new Error(name);
            }).toThrowErrorMatchingSnapshot(),
          );
          report("late toMatchInlineSnapshot", () => expect("lockfile of " + name).toMatchInlineSnapshot(\`"lockfile of first"\`));
          firstDone.resolve();
          return;
        }
        secondStarted.resolve();
        await firstDone.promise;
        expect("lockfile of " + name).toMatchSnapshot(name);
        expect("lockfile of " + name).toMatchSnapshot();
      }
      describe("migrate", () => {
        test("first", () => migrate("first"), 1);
        test("second", () => migrate("second"));
      });
    `);

    expect(stdout).toBe(
      [
        `late with hint: ${rejected}`,
        `late without hint: ${rejected}`,
        `late toThrowErrorMatchingSnapshot: ${rejected}`,
        "late toMatchInlineSnapshot: did not throw",
        "",
      ].join("\n"),
    );
    expect(stderr).toContain("this test timed out after 1ms");
    expect(stderr).toContain("(pass) migrate > second");
    // Nothing of the first case's under the second case's name, and the second case's own
    // unhinted snapshot is still number 1 (on the previous behaviour the late calls, the inline
    // one included, pushed it to number 2).
    expect(snap).toBe(
      header +
        '\nexports[`migrate second: second 1`] = `"lockfile of second"`;\n' +
        '\nexports[`migrate second 1`] = `"lockfile of second"`;\n',
    );
  });

  test.concurrent("a hook that timed out", async () => {
    const { stdout, stderr, snap } = await runTestFile(/* ts */ `
      const secondStarted = Promise.withResolvers<void>();
      const hookDone = Promise.withResolvers<void>();
      let hookRuns = 0;
      beforeEach(async () => {
        if (hookRuns++ > 0) return;
        await secondStarted.promise;
        report("late from the hook", () => expect("from the hook").toMatchSnapshot("hook"));
        hookDone.resolve();
      }, 1);
      test("first", () => {});
      test("second", async () => {
        secondStarted.resolve();
        await hookDone.promise;
        expect("from second").toMatchSnapshot();
      });
    `);

    expect(stdout).toBe(`late from the hook: ${rejected}\n`);
    expect(stderr).toContain("(pass) second");
    expect(snap).toBe(header + '\nexports[`second 1`] = `"from second"`;\n');
  });

  test.concurrent("a test failed by an unhandled error while it was awaiting", async () => {
    // The only snapshot matcher in the file is the late one, so nothing at all should be written:
    // not even an empty snapshot file.
    const { stdout, stderr, snap } = await runTestFile(/* ts */ `
      const secondStarted = Promise.withResolvers<void>();
      const firstDone = Promise.withResolvers<void>();
      test("first", async () => {
        Promise.reject(new Error("failure in the background"));
        await secondStarted.promise;
        report("late after the rejection", () => expect("from first").toMatchSnapshot());
        firstDone.resolve();
      });
      test("second", async () => {
        secondStarted.resolve();
        await firstDone.promise;
      });
    `);

    expect(stdout).toBe(`late after the rejection: ${rejected}\n`);
    expect(stderr).toContain("failure in the background");
    expect(stderr).toContain("(pass) second");
    expect(snap).toBeNull();
  });

  test.concurrent("an attempt that the runner gave up on, while its retry runs", async () => {
    const { stdout, stderr, snap } = await runTestFile(/* ts */ `
      const retryStarted = Promise.withResolvers<void>();
      const firstAttemptDone = Promise.withResolvers<void>();
      let attempts = 0;
      test(
        "retried",
        async () => {
          if (attempts++ === 0) {
            Promise.reject(new Error("first attempt fails in the background"));
            await retryStarted.promise;
            report("late from the first attempt", () => expect("from attempt 1").toMatchSnapshot());
            firstAttemptDone.resolve();
            return;
          }
          retryStarted.resolve();
          await firstAttemptDone.promise;
          expect("from attempt 2").toMatchSnapshot();
        },
        { retry: 1 },
      );
    `);

    expect(stdout).toBe(`late from the first attempt: ${rejected}\n`);
    expect(stderr).toContain("(pass) retried");
    // The passing attempt owns "retried 1"; a later run must compare against its value.
    expect(snap).toBe(header + '\nexports[`retried 1`] = `"from attempt 2"`;\n');
  });

  test.concurrent("callbacks registered by a finished hook still snapshot under the running test", async () => {
    // The server's fetch handler was registered by beforeAll, which finished normally, so its
    // snapshots belong to whichever test is making the request, as before.
    const { stderr, snap, exitCode } = await runTestFile(/* ts */ `
      let server: ReturnType<typeof Bun.serve>;
      beforeAll(() => {
        server = Bun.serve({
          port: 0,
          fetch(request) {
            expect(new URL(request.url).pathname).toMatchSnapshot("requested path");
            return new Response("ok");
          },
        });
      });
      test("one", async () => {
        expect(await (await fetch(server.url + "one")).text()).toBe("ok");
      });
      test("two", async () => {
        expect(await (await fetch(server.url + "two")).text()).toBe("ok");
        server.stop(true);
      });
    `);

    expect(stderr).toContain(" 2 pass\n");
    expect(snap).toBe(
      header + '\nexports[`one: requested path 1`] = `"/one"`;\n' + '\nexports[`two: requested path 1`] = `"/two"`;\n',
    );
    expect(exitCode).toBe(0);
  });
});
