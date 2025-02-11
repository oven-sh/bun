import { $, spawnSync } from "bun";
import { readFileSync, writeFileSync } from "fs";
import { describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, DirectoryTree, tempDirWithFiles } from "harness";

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
    test(label, async () => await this.update(contents, opts));
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
        expect((await $`cd ${this.dir} && ${bunExe()} test ./snapshot.test.ts`.nothrow().quiet()).exitCode).not.toBe(0);
        // make sure the existing snapshot is unchanged:
        expect(await this.getSnapshotContents()).toBe(this.targetSnapshotContents);
      }
      // update snapshots now, using -u flag unless this is the first run
      await $`cd ${this.dir} && ${bunExe()} test ${isFirst && !opts.forceUpdate ? "" : "-u"} ./snapshot.test.ts`.quiet();
      // make sure the snapshot changed & didn't grow
      const newContents = await this.getSnapshotContents();
      if (!isFirst) {
        expect(newContents).not.toStartWith(this.targetSnapshotContents);
      }
      if (!opts.skipSnapshot && !this.inlineSnapshot) expect(newContents).toMatchSnapshot();
      this.targetSnapshotContents = newContents;
    }
    // run, make sure snapshot does not change
    await $`cd ${this.dir} && ${bunExe()} test ./snapshot.test.ts`.quiet();
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
          '// Bun Snapshot v1, https://goo.gl/fbAQLP\n\nexports[`t1 1`] = `"abc def ghi jkl"`;\n\nexports[`t2 1`] = `"abc\\`def"`;\n\nexports[`t3 1`] = `"abc def ghi"`;\n',
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

  testError(eopts: { update?: boolean; msg: string }, code: string): void {
    const thefile = this.tmpfile(code);

    const spawnres = Bun.spawnSync({
      cmd: [bunExe(), "test", ...(eopts.update ? ["-u"] : []), thefile],
      env: bunEnv,
      cwd: this.tmpdir,
      stdio: ["pipe", "pipe", "pipe"],
    });
    expect(spawnres.stderr.toString()).toInclude(eopts.msg);
    expect(spawnres.exitCode).not.toBe(0);
    expect(this.readfile(thefile)).toEqual(code);
  }
  test(cb: (v: (a: string, b: string, c: string) => string) => string): void {
    this.testInternal(
      false,
      cb((a, b, c) => a),
      cb((a, b, c) => c),
    );
    this.testInternal(
      true,
      cb((a, b, c) => b),
      cb((a, b, c) => c),
    );
  }
  testUpdateOnly(cb: (v: (b: string, c: string) => string) => string): void {
    this.testInternal(
      true,
      cb((b, c) => b),
      cb((b, c) => c),
    );
  }
  testInternal(use_update: boolean, before_value: string, after_value: string): void {
    const thefile = this.tmpfile(before_value);

    if (use_update) {
      // run without update, expect error
      const spawnres = Bun.spawnSync({
        cmd: [bunExe(), "test", thefile],
        env: bunEnv,
        cwd: this.tmpdir,
        stdio: ["pipe", "pipe", "pipe"],
      });
      expect(spawnres.stderr.toString()).toInclude("error:");
      expect(spawnres.exitCode).not.toBe(0);
      expect(this.readfile(thefile)).toEqual(before_value);
    }

    {
      const spawnres = Bun.spawnSync({
        cmd: [bunExe(), "test", ...(use_update ? ["-u"] : []), thefile],
        env: bunEnv,
        cwd: this.tmpdir,
        stdio: ["pipe", "pipe", "pipe"],
      });
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
      const spawnres = Bun.spawnSync({
        cmd: [bunExe(), "test", thefile],
        env: bunEnv,
        cwd: this.tmpdir,
        stdio: ["pipe", "pipe", "pipe"],
      });
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
      const spawnres = Bun.spawnSync({
        cmd: [bunExe(), "test", "-u", thefile],
        env: bunEnv,
        cwd: this.tmpdir,
        stdio: ["pipe", "pipe", "pipe"],
      });
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
  test("changing inline snapshot", () => {
    tester.test(
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
  test("inline snapshot update cases", () => {
    tester.test(
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
  it("should error trying to update outside of a test", () => {
    tester.testError(
      { msg: "error: Snapshot matchers cannot be used outside of a test" },
      /*js*/ `
        expect("1").toMatchInlineSnapshot();
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
  it("should error trying to update the same line twice", () => {
    tester.testError(
      { msg: "error: Failed to update inline snapshot: Multiple inline snapshots for the same call are not supported" },
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
  it("should not allow a snapshot in a snapshot", () => {
    // this is possible to support, but is not supported
    tester.testError(
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

  it("requires exactly 'toMatchInlineSnapshot' 1", () => {
    tester.testError(
      { msg: "error: Failed to update inline snapshot: Could not find 'toMatchInlineSnapshot' here" },
      /*js*/ `
        test("cases", () => {
          expect(1)["toMatchInlineSnapshot"]();
        });
      `,
    );
  });
  it("requires exactly 'toMatchInlineSnapshot' 2", () => {
    tester.testError(
      { msg: "error: Failed to update inline snapshot: Could not find 'toMatchInlineSnapshot' here" },
      /*js*/ `
        test("cases", () => {
          expect(1).t\\u{6f}MatchInlineSnapshot();
        });
      `,
    );
  });
  it("only replaces when the argument is a literal string 1", () => {
    tester.testError(
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
  it("only replaces when the argument is a literal string 2", () => {
    tester.testError(
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
  it("only replaces when the argument is a literal string 3", () => {
    tester.testError(
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
  it("only replaces when the argument is a literal string 4", () => {
    tester.testError(
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
  it("does not allow spread 1", () => {
    tester.testError(
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
  it("does not allow spread 2", () => {
    tester.testError(
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
  it("limit two arguments", () => {
    tester.testError(
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
  it("must be in test file", () => {
    tester.testError(
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
  it("is right file", () => {
    tester.test(
      v => /*js*/ `
        import {wrongFile} from "./helper";
        test("cases", () => {
          expect("rightfile").toMatchInlineSnapshot(${v("", '"9"', '`"rightfile"`')});
          expect(wrongFile).toMatchInlineSnapshot(${v("", '"9"', "`[Function: wrongFile]`")});
        });
      `,
    );
  });
  it("indentation", () => {
    tester.test(
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
  it("preserve existing indentation", () => {
    tester.testUpdateOnly(
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
        });
      `,
    );
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
  }).toThrowErrorMatchingSnapshot();
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
  const dir = tempDirWithFiles("writesnapshotfromfilter", {
    "mytests": {
      "snap.test.ts": sver("a", false),
      "snap2.test.ts": sver("b", false),
      "more": {
        "testing.test.ts": sver("TEST", false),
      },
    },
  });
  await $`cd ${dir} && ${bunExe()} test mytests`;
  expect(await Bun.file(dir + "/mytests/snap.test.ts").text()).toBe(sver("a", true));
  expect(await Bun.file(dir + "/mytests/snap2.test.ts").text()).toBe(sver("b", true));
  expect(await Bun.file(dir + "/mytests/more/testing.test.ts").text()).toBe(sver("TEST", true));
  await $`cd ${dir} && ${bunExe()} test mytests`;
  expect(await Bun.file(dir + "/mytests/snap.test.ts").text()).toBe(sver("a", true));
  expect(await Bun.file(dir + "/mytests/snap2.test.ts").text()).toBe(sver("b", true));
  expect(await Bun.file(dir + "/mytests/more/testing.test.ts").text()).toBe(sver("TEST", true));
});
