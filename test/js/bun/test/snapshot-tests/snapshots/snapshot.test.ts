import { $ } from "bun";
import { describe, expect, it, test } from "bun:test";
import { cpSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "fs";
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

test("own non-enumerable properties are not printed", () => {
  class Wrapper {
    visible = 1;
    [Symbol("visibleSymbol")] = 2;
    constructor() {
      Object.defineProperty(this, Symbol("impl"), { value: { hidden: true } });
      Object.defineProperty(this, "hidden", { value: { hidden: true } });
      Object.defineProperty(this, "accessor", { get() {} });
    }
  }
  expect(new Wrapper()).toMatchInlineSnapshot(`
    Wrapper {
      "visible": 1,
      [Symbol(visibleSymbol)]: 2,
    }
  `);
  expect([Object.defineProperty({}, "hidden", { value: 1 })]).toMatchInlineSnapshot(`
    [
      {},
    ]
  `);
  const messageOf = (fn: () => void) => {
    try {
      fn();
    } catch (error) {
      return Bun.stripANSI((error as Error).message);
    }
  };
  expect(messageOf(() => expect(new Wrapper()).toEqual({ visible: 2 }))).toBe(`expect(received).toEqual(expected)

- {
-   "visible": 2,
+ Wrapper {
+   "visible": 1,
+   [Symbol(visibleSymbol)]: 2,
  }

- Expected  - 2
+ Received  + 3
`);
  expect(messageOf(() => expect(new Wrapper()).toBeNull())).toBe(`expect(received).toBeNull()

Received: Wrapper {
  visible: 1,
  [Symbol(visibleSymbol)]: 2,
}
`);
});

describe("an own accessor prints as what its getter returns", () => {
  const messageOf = (fn: () => void) => {
    try {
      fn();
    } catch (error) {
      return Bun.stripANSI((error as Error).message);
    }
  };
  const symbol = Symbol("symbol");
  const value = () => {
    const self = {
      get number() {
        return 1;
      },
      get object() {
        return { list: [1, 2] };
      },
      get both() {
        return "both";
      },
      set both(_) {},
      set setter(_: unknown) {},
      get self() {
        return self;
      },
      get [symbol]() {
        return "symbol";
      },
      nested: [
        {
          get inner() {
            return undefined;
          },
        },
      ],
    };
    return self;
  };

  test("in a snapshot", () => {
    expect(value()).toMatchInlineSnapshot(`
      {
        "both": "both",
        "nested": [
          {
            "inner": undefined,
          },
        ],
        "number": 1,
        "object": {
          "list": [
            1,
            2,
          ],
        },
        "self": [Circular],
        "setter": undefined,
        [Symbol(symbol)]: "symbol",
      }
    `);
    expect(
      new Map([
        [
          "key",
          {
            get a() {
              return 1;
            },
          },
        ],
      ]),
    ).toMatchInlineSnapshot(`
      Map {
        "key" => {
          "a": 1,
        },
      }
    `);
  });

  test("in a diff", () => {
    expect(
      messageOf(() => expect(value()).toEqual({}))
        ?.split("\n")
        .filter(line => line.startsWith("+ ")),
    ).toEqual([
      "+ {",
      '+   "both": "both",',
      '+   "nested": [',
      "+     {",
      '+       "inner": undefined,',
      "+     },",
      "+   ],",
      '+   "number": 1,',
      '+   "object": {',
      '+     "list": [',
      "+       1,",
      "+       2,",
      "+     ],",
      "+   },",
      '+   "self": [Circular],',
      '+   "setter": undefined,',
      '+   [Symbol(symbol)]: "symbol",',
      "+ }",
      "+ Received  + 18",
    ]);
  });

  test("in the message of a matcher", () => {
    expect(messageOf(() => expect(value()).toBeNull())).toBe(`expect(received).toBeNull()

Received: {
  number: 1,
  object: {
    list: [ 1, 2 ],
  },
  both: "both",
  setter: undefined,
  self: [Circular],
  nested: [
    {
      inner: undefined,
    }
  ],
  [Symbol(symbol)]: "symbol",
}
`);
  });

  test("once", () => {
    let calls = 0;
    const counted = {
      get a() {
        return ++calls;
      },
    };
    expect(counted).toMatchInlineSnapshot(`
      {
        "a": 1,
      }
    `);
    expect(messageOf(() => expect(counted).toBeNull())).toContain("a: 2,");
    expect(calls).toBe(2);
  });

  test("not the accessors of its class, and not those that are not enumerable", () => {
    const read: string[] = [];
    class Instance {
      own = 1;
      constructor() {
        Object.defineProperty(this, "hidden", { get: () => read.push("hidden") });
      }
      get inherited() {
        return read.push("inherited");
      }
    }
    expect(new Instance()).toMatchInlineSnapshot(`
      Instance {
        "own": 1,
      }
    `);
    expect(messageOf(() => expect(new Instance()).toBeNull())).toBe(`expect(received).toBeNull()

Received: Instance {
  own: 1,
  inherited: [Getter],
}
`);
    expect(read).toEqual([]);
  });

  test("a getter that throws leaves the accessor, which is what there was before getters were called", () => {
    const throws = () => ({
      before: 1,
      nested: {
        get a() {
          throw new Error("from the getter");
        },
        get b() {
          return 2;
        },
      },
      after: 2,
    });
    const messageOf = (fn: () => void) => {
      try {
        fn();
      } catch (error) {
        return (error as Error).message.replaceAll(/\x1b\[\d+m/g, "");
      }
    };
    expect(throws()).toMatchInlineSnapshot(`
      {
        "after": 2,
        "before": 1,
        "nested": {
          "a": [native code],
          "b": 2,
        },
      }
    `);
    expect(messageOf(() => expect(throws()).toEqual({}))).toBe(
      'expect(received).toEqual(expected)\n\n- {}\n+ {\n+   "after": 2,\n+   "before": 1,\n+   "nested": {\n+     "a": [native code],\n+     "b": 2,\n+   },\n+ }\n\n- Expected  - 1\n+ Received  + 8\n',
    );
    const printed = "{\n  before: 1,\n  nested: {\n    a: [Getter],\n    b: 2,\n  },\n  after: 2,\n}";
    expect(messageOf(() => expect(throws()).toBeNull())).toBe(`expect(received).toBeNull()\n\nReceived: ${printed}\n`);
    expect(messageOf(() => expect(throws(), "with a label").toBeNull())).toBe(`with a label\n\nReceived: ${printed}\n`);
    expect(messageOf(() => expect(1).toBe(throws()))).toBe(
      `expect(received).toBe(expected)\n\nExpected: ${printed}\nReceived: 1\n`,
    );
  });

  test("console.log() and Bun.inspect() do not call it", () => {
    expect(
      Bun.inspect({
        get a() {
          throw new Error("the getter was called");
        },
        set b(_: unknown) {},
        get c() {
          return 1;
        },
        set c(_) {},
      }),
    ).toBe("{\n  a: [Getter],\n  b: [Setter],\n  c: [Getter/Setter],\n}");
  });
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

async function runTests(cwd: string, env: Record<string, string>, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...args],
    env: { ...bunEnv, ...env },
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  const count = (what: string) => Number(stderr.match(new RegExp(`^ *(\\d+) ${what}$`, "m"))?.[1] ?? 0);
  return { stderr, exitCode, pass: count("pass"), fail: count("fail") };
}

const headers = {
  bun: "// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n",
  jest: "// Jest Snapshot v1, https://jestjs.io/docs/snapshot-testing\n",
  vitest: "// Vitest Snapshot v1, https://vitest.dev/guide/snapshot.html\n",
};

// `formats/vitest` was written by Vitest 5.0.3 and `formats/jest` by Jest 30.5.2: the `.snap` files, and the inline
// snapshots in the fixtures. To add a case, let that runner write it. Never update them with Bun.
describe.concurrent("the fixtures and snapshot files that another runner wrote", () => {
  const timeout = isDebug ? 120_000 : 20_000;
  const tests = { vitest: 622, jest: 601 };

  function copyOf(runner: "vitest" | "jest") {
    const dir = tempDir(`snapshot-formats-${runner}`, {});
    cpSync(join(import.meta.dir, "..", "formats", runner), String(dir), { recursive: true });
    symlinkSync(
      join(import.meta.dir, "..", "..", "..", "..", "..", "node_modules"),
      join(String(dir), "node_modules"),
      "junction",
    );
    return dir;
  }
  const fixturesIn = (dir: string) =>
    readdirSync(dir)
      .filter(name => name.includes(".fixture."))
      .sort();
  function contentsOf(dir: string) {
    const names = [
      ...fixturesIn(dir),
      ...readdirSync(join(dir, "__snapshots__")).map(name => join("__snapshots__", name)),
    ];
    return Object.fromEntries(names.sort().map(name => [name, readFileSync(join(dir, name), "latin1")]));
  }
  const run = (dir: string, env: Record<string, string>, ...args: string[]) =>
    runTests(dir, env, ...args, ...fixturesIn(dir).map(name => "./" + name));

  test.each(["vitest", "jest"] as const)(
    "%s: pass, and are left alone",
    async runner => {
      using dir = copyOf(runner);
      const before = contentsOf(String(dir));
      const { stderr, exitCode, pass, fail } = await run(String(dir), { CI: "true" });
      expect({ fail, pass, stderr: fail ? stderr : "" }).toEqual({ fail: 0, pass: tests[runner], stderr: "" });
      expect(contentsOf(String(dir))).toEqual(before);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  test.each(["vitest", "jest"] as const)(
    "%s: --update-snapshots has nothing to change",
    async runner => {
      using dir = copyOf(runner);
      // A test of "bun:test" updates an inline snapshot to what Bun prints.
      if (runner === "jest") rmSync(join(String(dir), "inline.fixture.js"));
      const before = contentsOf(String(dir));
      const { stderr, exitCode, fail } = await run(String(dir), { CI: "true" }, "--update-snapshots");
      expect({ fail, stderr: fail ? stderr : "" }).toEqual({ fail: 0, stderr: "" });
      expect(contentsOf(String(dir))).toEqual(before);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "vitest: Bun writes the same, byte for byte",
    async () => {
      using dir = copyOf("vitest");
      const written = contentsOf(String(dir));
      rmSync(join(String(dir), "__snapshots__"), { recursive: true });
      for (const name of fixturesIn(String(dir))) {
        const empty = written[name].replace(/(InlineSnapshot\((?:\{.*?\})?)(?:, )?`(?:[^`\\]|\\[^])*`\)/g, "$1)");
        writeFileSync(join(String(dir), name), empty, "latin1");
      }
      const { stderr, exitCode, pass, fail } = await run(String(dir), { CI: "false" });
      expect({ fail, pass, stderr: fail ? stderr : "" }).toEqual({ fail: 0, pass: tests.vitest, stderr: "" });
      expect(contentsOf(String(dir))).toEqual(written);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "jest: Bun adds the same to its files, byte for byte",
    async () => {
      using dir = copyOf("jest");
      const written = contentsOf(String(dir));
      for (const name of readdirSync(join(String(dir), "__snapshots__"))) {
        writeFileSync(join(String(dir), "__snapshots__", name), headers.jest);
      }
      const { stderr, exitCode, pass, fail } = await run(String(dir), { CI: "false" });
      expect({ fail, pass, stderr: fail ? stderr : "" }).toEqual({ fail: 0, pass: tests.jest, stderr: "" });
      expect(contentsOf(String(dir))).toEqual(written);
      expect(exitCode).toBe(0);
    },
    timeout,
  );
});

describe.concurrent("the first line of a snapshot file says whose format it has", () => {
  const timeout = isDebug ? 60_000 : 5_000;
  const snap = (dir: unknown, name = "a.test.js") =>
    readFileSync(join(String(dir), "__snapshots__", name + ".snap"), "utf8");
  const importing = (module: string | null) =>
    module ? `import { describe, test, expect, beforeEach } from ${JSON.stringify(module)};\n` : "";
  // What tells the formats apart: how names and hints are joined, what prints a function, what a thrown error leaves.
  const body = `
    describe("outer", () => {
      test("inner", () => {
        expect({ f: function named() {} }).toMatchSnapshot();
        expect(1).toMatchSnapshot("hint");
        expect(() => { throw new TypeError("message"); }).toThrowErrorMatchingSnapshot();
      });
    });
  `;
  const entries = {
    bun:
      '\nexports[`outer inner 1`] = `\n{\n  "f": [Function: named],\n}\n`;\n' +
      "\nexports[`outer inner: hint 1`] = `1`;\n" +
      '\nexports[`outer inner 2`] = `"message"`;\n',
    jest:
      '\nexports[`outer inner 1`] = `\n{\n  "f": [Function],\n}\n`;\n' +
      '\nexports[`outer inner 2`] = `"message"`;\n' +
      "\nexports[`outer inner: hint 1`] = `1`;\n",
    vitest:
      "\nexports[`outer > inner > hint 1`] = `1`;\n" +
      '\nexports[`outer > inner 1`] = `\n{\n  "f": [Function],\n}\n`;\n' +
      "\nexports[`outer > inner 2`] = `[TypeError: message]`;\n",
  };

  test.each([
    ["vitest", "vitest"],
    ["bun:test", "bun"],
    ["@jest/globals", "bun"],
    [null, "bun"],
  ] as const)(
    "a new file, tests of %j",
    async (module, format) => {
      using dir = tempDir("snapshot-new-file", { "a.test.js": importing(module) + body });
      const { stderr, exitCode } = await runTests(String(dir), { CI: "false" });
      expect(stderr).toContain("+3 added");
      expect(snap(dir)).toBe(headers[format] + entries[format]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  const modules = ["vitest", "bun:test", null];
  test.each((["bun", "jest", "vitest"] as const).flatMap(format => modules.map(module => [format, module] as const)))(
    "a file of %s, tests of %j",
    async (format, module) => {
      using dir = tempDir("snapshot-existing-file", {
        "a.test.js": importing(module) + body,
        "__snapshots__/a.test.js.snap": headers[format] + entries[format],
      });
      const read = await runTests(String(dir), { CI: "true" });
      expect({ fail: read.fail, pass: read.pass, stderr: read.fail ? read.stderr : "" }).toEqual({
        fail: 0,
        pass: 1,
        stderr: "",
      });
      expect(snap(dir)).toBe(headers[format] + entries[format]);
      expect(read.exitCode).toBe(0);

      writeFileSync(join(String(dir), "__snapshots__", "a.test.js.snap"), headers[format]);
      const written = await runTests(String(dir), { CI: "false" });
      expect(written.stderr).toContain("+3 added");
      expect(snap(dir)).toBe(headers[format] + entries[format]);
      expect(written.exitCode).toBe(0);

      const updated = await runTests(String(dir), { CI: "true" }, "--update-snapshots");
      expect(snap(dir)).toBe(headers[format] + entries[format]);
      expect(updated.exitCode).toBe(0);
    },
    timeout,
  );

  test.each([
    ["no first line", ""],
    ["a first line of nobody", "// something else\n"],
    ["Bun's older link", "// Bun Snapshot v1, https://goo.gl/fbAQLP\n"],
    ["Jest's name and Bun's link", "// Jest Snapshot v1, https://bun.sh/docs/test/snapshots\n"],
  ])(
    "%s: Bun's format",
    async (_, header) => {
      using dir = tempDir("snapshot-other-header", {
        "a.test.js": importing("vitest") + body + `test("new", () => { expect(() => {}).toMatchSnapshot(); });`,
        "__snapshots__/a.test.js.snap": header + entries.bun,
      });
      const { stderr, exitCode } = await runTests(String(dir), { CI: "false" });
      expect(stderr).toContain("3 passed, 1 added");
      expect(snap(dir)).toBe(header + entries.bun + "\nexports[`new 1`] = `[Function]`;\n");
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "Jest's older link: Jest's format",
    async () => {
      const header = "// Jest Snapshot v1, https://goo.gl/fbAQLP\n";
      using dir = tempDir("snapshot-older-jest", {
        "a.test.js": body,
        "__snapshots__/a.test.js.snap": header + entries.jest,
      });
      const { stderr, exitCode, pass } = await runTests(String(dir), { CI: "true" });
      expect({ pass, stderr: pass ? "" : stderr }).toEqual({ pass: 1, stderr: "" });
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  describe.each(["jest", "vitest"] as const)(
    "what Bun used to append to a file of %s, with its keys and its way of printing",
    format => {
      const old = '\nexports[`z old 1`] = `\n{\n  "a": 1,\n}\n`;\n';
      const appendedTo = headers[format] + old + entries.bun;
      const tests = body + `test("z old", () => { expect({ a: 1 }).toMatchSnapshot(); });`;

      test.each(["true", "false"])(
        "still passes, and stays as it is (CI: %s)",
        async CI => {
          using dir = tempDir("snapshot-appended-to", {
            "a.test.js": tests,
            "__snapshots__/a.test.js.snap": appendedTo,
          });
          const { pass, stderr, exitCode } = await runTests(String(dir), { CI });
          expect({ pass, stderr: pass === 2 ? "" : stderr }).toEqual({ pass: 2, stderr: "" });
          expect(stderr).toContain(" 4 snapshots, ");
          expect(snap(dir)).toBe(appendedTo);
          expect(exitCode).toBe(0);
        },
        timeout,
      );

      test.each(["true", "false"])(
        "still fails when the value is another (CI: %s)",
        async CI => {
          using dir = tempDir("snapshot-appended-to", {
            "a.test.js": tests.replace('expect(1).toMatchSnapshot("hint")', 'expect(2).toMatchSnapshot("hint")'),
            "__snapshots__/a.test.js.snap": appendedTo,
          });
          const { pass, fail, stderr, exitCode } = await runTests(String(dir), { CI });
          expect({ pass, fail }).toEqual({ pass: 1, fail: 1 });
          expect(stderr).toContain("Expected: 1\nReceived: 2");
          expect(snap(dir)).toBe(appendedTo);
          expect(exitCode).toBe(1);
        },
        timeout,
      );

      test(
        "is still known for what it is after a run that adds an entry and does not see the others",
        async () => {
          using dir = tempDir("snapshot-appended-to", {
            "a.test.js": tests + `test("a new", () => { expect(() => {}).toMatchSnapshot(); });`,
            "__snapshots__/a.test.js.snap": appendedTo,
          });
          const added = await runTests(String(dir), { CI: "false" }, "-t", "a new");
          expect(added.stderr).toContain("+1 added");
          expect(snap(dir)).toBe(appendedTo + "\nexports[`a new 1`] = `[Function]`;\n");
          const all = await runTests(String(dir), { CI: "true" });
          expect({ pass: all.pass, stderr: all.pass === 3 ? "" : all.stderr }).toEqual({ pass: 3, stderr: "" });
          expect([added.exitCode, all.exitCode]).toEqual([0, 0]);
        },
        timeout,
      );

      test(
        "--update-snapshots makes a file of the runner's of it",
        async () => {
          using dir = tempDir("snapshot-appended-to", {
            "a.test.js": tests,
            "__snapshots__/a.test.js.snap": appendedTo,
          });
          const { exitCode } = await runTests(String(dir), { CI: "true" }, "--update-snapshots");
          expect(snap(dir)).toBe(headers[format] + entries[format] + old);
          expect(exitCode).toBe(0);
        },
        timeout,
      );

      test(
        "is not looked for in a file whose keys are in the runner's order, which Bun has not appended to",
        async () => {
          const sorted = headers[format] + entries[format].replace("[Function]", "[Function: named]");
          using dir = tempDir("snapshot-sorted", { "a.test.js": body, "__snapshots__/a.test.js.snap": sorted });
          const { fail, stderr, exitCode } = await runTests(String(dir), { CI: "true" });
          expect(fail).toBe(1);
          expect(stderr).toContain('-   "f": [Function: named],\n+   "f": [Function],');
          expect(snap(dir)).toBe(sorted);
          expect(exitCode).toBe(1);
        },
        timeout,
      );
    },
  );

  test(
    "`fn.mock` has the members it has in the runner of the file",
    async () => {
      const files = (format: "bun" | "jest" | "vitest", lib: string, ofCalled: string, ofNew: string) => ({
        "a.test.js": `
          test("t", () => {
            const called = ${lib}.fn(x => x + 1);
            called(1);
            expect(called.mock).toMatchSnapshot();
            expect(${lib}.fn().mock).toMatchSnapshot();
          });
        `,
        "__snapshots__/a.test.js.snap":
          headers[format] +
          `\nexports[\`t 1\`] = \`\n{\n  "calls": [\n    [\n      1,\n    ],\n  ],\n  "contexts": [\n    undefined,\n  ],\n  "instances": [\n    undefined,\n  ],\n  "invocationCallOrder": [\n    1,\n  ],\n${ofCalled}}\n\`;\n` +
          `\nexports[\`t 2\`] = \`\n{\n  "calls": [],\n  "contexts": [],\n  "instances": [],\n  "invocationCallOrder": [],\n${ofNew}}\n\`;\n`,
      });
      const lastCall = '  "lastCall": [\n    1,\n  ],\n';
      const results = (name: string, type: string) =>
        `  "${name}": [\n    {\n      "type": "${type}",\n      "value": 2,\n    },\n  ],\n`;
      using bun = tempDir(
        "snapshot-mock-state",
        files("bun", "jest", results("results", "return"), '  "results": [],\n'),
      );
      using jest = tempDir(
        "snapshot-mock-state",
        files("jest", "jest", lastCall + results("results", "return"), '  "results": [],\n'),
      );
      using vitest = tempDir(
        "snapshot-mock-state",
        files(
          "vitest",
          "vi",
          lastCall + results("results", "return") + results("settledResults", "fulfilled"),
          '  "lastCall": undefined,\n  "results": [],\n  "settledResults": [],\n',
        ),
      );
      const runs = await Promise.all([bun, jest, vitest].map(dir => runTests(String(dir), { CI: "true" })));
      expect(runs.map(({ pass, stderr }) => (pass ? "" : stderr))).toEqual(["", "", ""]);
      expect(runs.map(run => run.exitCode)).toEqual([0, 0, 0]);
    },
    timeout,
  );

  test(
    `a new file, when a hook of "vitest" that is of no test is the first to write`,
    async () => {
      using dir = tempDir("snapshot-new-file-hook", {
        "a.test.js": `
          import { beforeAll, describe, expect, test } from "vitest";
          describe("d", () => {
            beforeAll(() => { expect(() => {}).toMatchSnapshot(); });
            test("t", () => { expect(class A {}).toMatchSnapshot(); });
          });
        `,
      });
      const { stderr, exitCode } = await runTests(String(dir), { CI: "false" });
      expect(stderr).toContain("+2 added");
      expect(snap(dir)).toStartWith(headers.vitest);
      expect(snap(dir)).toContain("\nexports[`d > t 1`] = `[Function]`;\n");
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "tests of two modules in one file: the first to write decides",
    async () => {
      const files = (first: string, second: string) => ({
        "a.test.js": `
          import * as vitest from "vitest";
          import * as bun from "bun:test";
          ${first}.describe("d", () => { ${first}.test("first", () => { ${first}.expect(() => {}).toMatchSnapshot(); }); });
          ${second}.describe("d", () => { ${second}.test("second", () => { ${second}.expect(class A {}).toMatchSnapshot(); }); });
        `,
      });
      using vitestFirst = tempDir("snapshot-mixed", files("vitest", "bun"));
      using bunFirst = tempDir("snapshot-mixed", files("bun", "vitest"));
      const results = await Promise.all([vitestFirst, bunFirst].map(dir => runTests(String(dir), { CI: "false" })));
      expect(snap(vitestFirst)).toBe(
        headers.vitest + "\nexports[`d > first 1`] = `[Function]`;\n\nexports[`d > second 1`] = `[Function]`;\n",
      );
      expect(snap(bunFirst)).toBe(
        headers.bun + "\nexports[`d first 1`] = `[Function]`;\n\nexports[`d second 1`] = `[class A]`;\n",
      );
      expect(results.map(result => result.exitCode)).toEqual([0, 0]);
    },
    timeout,
  );

  test(
    "a snapshot in a hook is one of the test's, in the formats of Jest and Vitest",
    async () => {
      const hooks = `
        describe("d", () => {
          beforeEach(() => { expect("hook").toMatchSnapshot(); });
          test("t", () => { expect("test").toMatchSnapshot(); });
        });
      `;
      using jest = tempDir("snapshot-hook", {
        "a.test.js": hooks,
        "__snapshots__/a.test.js.snap":
          headers.jest + '\nexports[`d t 1`] = `"hook"`;\n\nexports[`d t 2`] = `"test"`;\n',
      });
      using vitest = tempDir("snapshot-hook", {
        "a.test.js": importing("vitest") + hooks,
        "__snapshots__/a.test.js.snap":
          headers.vitest + '\nexports[`d > t 1`] = `"hook"`;\n\nexports[`d > t 2`] = `"test"`;\n',
      });
      const results = await Promise.all([jest, vitest].map(dir => runTests(String(dir), { CI: "true" })));
      expect(results.map(({ pass, fail, exitCode }) => ({ pass, fail, exitCode }))).toEqual([
        { pass: 1, fail: 0, exitCode: 0 },
        { pass: 1, fail: 0, exitCode: 0 },
      ]);
    },
    timeout,
  );

  test(
    "in CI, a test of vitest that has no snapshot fails and leaves no file",
    async () => {
      using dir = tempDir("snapshot-ci", { "a.test.js": importing("vitest") + body });
      const { stderr, exitCode } = await runTests(String(dir), { CI: "true" });
      expect(stderr).toContain('Snapshot name: "outer > inner 1"');
      expect(readdirSync(String(dir))).toEqual(["a.test.js"]);
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "Vitest does not mind the white space around a snapshot, Jest does",
    async () => {
      const files = (format: "jest" | "vitest") => ({
        "a.test.js": `test("t", () => { expect({ a: 1 }).toMatchSnapshot(); });`,
        "__snapshots__/a.test.js.snap": headers[format] + '\nexports[`t 1`] = `{\n  "a": 1,\n}`;\n',
      });
      using jest = tempDir("snapshot-trim", files("jest"));
      using vitest = tempDir("snapshot-trim", files("vitest"));
      const results = await Promise.all([jest, vitest].map(dir => runTests(String(dir), { CI: "true" })));
      expect(results.map(result => result.exitCode)).toEqual([1, 0]);
    },
    timeout,
  );

  describe("--update-snapshots", () => {
    const tests = `
      describe("d", () => {
        test("same", () => { expect("same").toMatchSnapshot(); });
        test("changed", () => { expect("new value").toMatchSnapshot(); });
        test("fewer", () => { expect("one").toMatchSnapshot(); });
        test.skip("skipped", () => { expect("s").toMatchSnapshot(); expect("h").toMatchSnapshot("hint"); });
        test.todo("todo");
        test("no longer snapshots", () => {});
        test("fails before", () => { throw new Error("x"); });
        test("added", () => { expect("added").toMatchSnapshot(); });
        describe.skip("skipped block", () => { test("inside", () => { expect("i").toMatchSnapshot(); }); });
      });
    `;
    // `values` are in the order of Vitest's keys.
    const file = (format: "jest" | "vitest", values: Record<string, string>) => {
      let entries = Object.entries(values);
      if (format === "jest") {
        entries = entries.map(([key, value]) => [key.replace(" > hint", ": hint").replaceAll(" > ", " "), value]);
        entries.sort(([a], [b]) => (a < b ? -1 : 1));
      }
      return headers[format] + entries.map(([key, value]) => `\nexports[\`${key}\`] = \`"${value}"\`;\n`).join("");
    };
    const before = {
      "d > changed 1": "old value",
      "d > fails before 1": "f",
      "d > fewer 1": "one",
      "d > fewer 2": "two",
      "d > gone 1": "gone",
      "d > no longer snapshots 1": "n",
      "d > same 1": "same",
      "d > skipped > hint 1": "h",
      "d > skipped 1": "s",
      "d > skipped block > inside 1": "i",
      "d > todo 1": "t",
    };

    test.each(["jest", "vitest"] as const)(
      "%s: what no test asks for goes, what a skipped or failed test would ask for stays",
      async format => {
        using dir = tempDir("snapshot-obsolete", {
          "a.test.js": importing(format === "vitest" ? "vitest" : null) + tests,
          "__snapshots__/a.test.js.snap": file(format, before),
        });
        const { stderr, exitCode } = await runTests(String(dir), { CI: "true" }, "--update-snapshots");
        expect(stderr).toContain("2 passed, 2 added");
        const after = {
          "d > added 1": "added",
          "d > changed 1": "new value",
          "d > fails before 1": "f",
          "d > fewer 1": "one",
          "d > same 1": "same",
          "d > skipped > hint 1": "h",
          "d > skipped 1": "s",
          "d > skipped block > inside 1": "i",
        };
        expect(snap(dir)).toBe(file(format, after));
        expect(exitCode).toBe(1);
      },
      timeout,
    );

    test.each(["jest", "vitest"] as const)(
      "%s: with a filter, only what has no test goes",
      async format => {
        using dir = tempDir("snapshot-obsolete-filter", {
          "a.test.js": importing(format === "vitest" ? "vitest" : null) + tests,
          "__snapshots__/a.test.js.snap": file(format, before),
        });
        const { exitCode } = await runTests(String(dir), { CI: "true" }, "--update-snapshots", "-t", "same");
        const { "d > gone 1": _, ...after } = before;
        expect(snap(dir)).toBe(file(format, after));
        expect(exitCode).toBe(0);
      },
      timeout,
    );

    test.each(["jest", "vitest"] as const)(
      "%s: without it, nothing goes",
      async format => {
        using dir = tempDir("snapshot-obsolete-kept", {
          "a.test.js": `test("t", () => { expect(1).toMatchSnapshot(); });`,
          "__snapshots__/a.test.js.snap": headers[format] + "\nexports[`gone 1`] = `0`;\n\nexports[`t 1`] = `1`;\n",
        });
        const { exitCode } = await runTests(String(dir), { CI: "false" });
        expect(snap(dir)).toBe(headers[format] + "\nexports[`gone 1`] = `0`;\n\nexports[`t 1`] = `1`;\n");
        expect(exitCode).toBe(0);
      },
      timeout,
    );

    test.each(["jest", "vitest"] as const)(
      "%s: a file that nothing is left of is removed",
      async format => {
        using dir = tempDir("snapshot-obsolete-file", {
          "a.test.js": `test("t", () => { expect(1).toMatchInlineSnapshot(\`1\`); });`,
          "__snapshots__/a.test.js.snap": headers[format] + "\nexports[`t 1`] = `1`;\n",
        });
        const { exitCode } = await runTests(String(dir), { CI: "false" }, "--update-snapshots");
        expect(readdirSync(join(String(dir), "__snapshots__"))).toEqual([]);
        expect(exitCode).toBe(0);
      },
      timeout,
    );
  });
});

describe.concurrent("an inline snapshot does not say who wrote it", () => {
  const timeout = isDebug ? 60_000 : 5_000;
  const values = `
    const value = () => ({ f: function named() {}, re: /a+/, [Symbol("s")]: new Map([["k", "multi\\nline"]]) });
    const fail = () => { throw new RangeError("message"); };
  `;
  const bun = {
    value:
      '`\n{\n  "f": [Function: named],\n  "re": /a+/,\n  [Symbol(s)]: \nMap {\n    "k" => \n"multi\nline"\n,\n  }\n,\n}\n`',
    thrown: '`"message"`',
  };
  const jest = {
    value: '`\n{\n  "f": [Function],\n  "re": /a\\\\+/,\n  Symbol(s): Map {\n    "k" => "multi\nline",\n  },\n}\n`',
    thrown: '`"message"`',
  };
  const vitest = { value: jest.value, thrown: "`[RangeError: message]`" };
  const tests = (module: string, written: { value: string; thrown: string }) => `
    import { test, expect } from ${JSON.stringify(module)};
    ${values}
    test("t", () => {
      expect(value()).toMatchInlineSnapshot(${written.value});
      expect(fail).toThrowErrorMatchingInlineSnapshot(${written.thrown});
    });
  `;

  test.each(
    ["bun:test", "vitest"].flatMap(module =>
      Object.entries({ bun, jest, vitest }).map(([by, written]) => [module, by, written] as const),
    ),
  )(
    "a test of %j passes with what %s writes",
    async (module, _, written) => {
      using dir = tempDir("inline-snapshot-formats", { "a.test.js": tests(module, written) });
      const { stderr, exitCode, pass } = await runTests(String(dir), { CI: "true" });
      expect({ pass, stderr: pass ? "" : stderr }).toEqual({ pass: 1, stderr: "" });
      expect(readFileSync(join(String(dir), "a.test.js"), "utf8")).toBe(tests(module, written));
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  test.each([
    ["bun:test", bun],
    ["vitest", vitest],
  ] as const)(
    "a test of %j writes and updates as its own runner",
    async (module, own) => {
      const indented = (text: string) => text.slice(0, -2).replaceAll(/\n(?=.)/g, "\n        ") + "\n      `";
      const expected = tests(module, { value: indented(own.value), thrown: own.thrown });
      using empty = tempDir("inline-snapshot-write", { "a.test.js": tests(module, { value: "", thrown: "" }) });
      using other = tempDir("inline-snapshot-update", {
        "a.test.js": tests(module, { value: "`other`", thrown: "`other`" }),
      });
      const results = await Promise.all([
        runTests(String(empty), { CI: "false" }),
        runTests(String(other), { CI: "false" }, "--update-snapshots"),
      ]);
      expect(readFileSync(join(String(empty), "a.test.js"), "utf8")).toBe(expected);
      expect(readFileSync(join(String(other), "a.test.js"), "utf8")).toBe(expected);
      expect(results.map(result => result.exitCode)).toEqual([0, 0]);
    },
    timeout,
  );

  test.each(["<<<<<<< ours\nexports[`t 1`] = `1`;\n=======\n", "exports[`t 1`] = `"])(
    "does not need the file of the other snapshots, which the matcher that does says it cannot read: %j",
    async unreadable => {
      using dir = tempDir("inline-snapshot-alone", {
        "a.test.js": `
          test("inline", () => { expect(1).toMatchInlineSnapshot(\`1\`); });
          test("in the file", () => { expect(1).toMatchSnapshot(); });
        `,
        "__snapshots__/a.test.js.snap": unreadable,
      });
      const { stderr, pass, fail, exitCode } = await runTests(String(dir), { CI: "true" });
      expect({ pass, fail }).toEqual({ pass: 1, fail: 1 });
      expect(stderr).toContain("(pass) inline");
      expect(stderr).toContain("error: Failed to parse snapshot file for: " + join(String(dir), "a.test.js"));
      expect(readFileSync(join(String(dir), "__snapshots__", "a.test.js.snap"), "utf8")).toBe(unreadable);
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  test.each(["bun:test", "vitest"])(
    "a test of %j fails with what nobody writes",
    async module => {
      using dir = tempDir("inline-snapshot-mismatch", {
        "a.test.js": tests(module, { value: '`\n{\n  "f": [Function other],\n}\n`', thrown: "`[Error: message]`" }),
      });
      const { stderr, exitCode } = await runTests(String(dir), { CI: "true" });
      expect(stderr).toContain("expect(received).toMatchInlineSnapshot(expected)");
      expect(exitCode).toBe(1);
    },
    timeout,
  );
});

describe.concurrent("toMatchFileSnapshot()", () => {
  const timeout = isDebug ? 60_000 : 5_000;
  const read = (dir: unknown, ...path: string[]) => readFileSync(join(String(dir), ...path), "utf8");
  const header = `import { test, expect, describe } from "bun:test";\n`;

  test(
    "compares a string with all that the file holds, and anything else with how it prints",
    async () => {
      using dir = tempDir("file-snapshot", {
        "sub/a.test.js": `${header}
          import { join } from "node:path";
          test("t", async () => {
            const promise = expect("text\\n").toMatchFileSnapshot("./saved/text.txt");
            expect(promise).toBeInstanceOf(Promise);
            expect(await promise).toBeUndefined();
            await expect("text\\n").toMatchFileSnapshot("saved/text.txt", "a hint");
            await expect("text\\n").toMatchFileSnapshot(join(import.meta.dir, "saved", "text.txt"));
            await expect("above").toMatchFileSnapshot("../above.txt");
            await expect("").toMatchFileSnapshot("./saved/empty.txt");
            await expect({ a: [1, () => {}], b: "multi\\nline" }).toMatchFileSnapshot("./saved/object.txt");
            await expect(5).toMatchFileSnapshot("./saved/number.txt");
            await expect(new String("b")).toMatchFileSnapshot("./saved/string-object.txt");
            await expect("one\\ntwo\\n").toMatchFileSnapshot("./saved/crlf.txt");
            await expect("one\\r\\ntwo\\r\\n").toMatchFileSnapshot("./saved/crlf.txt");
            await expect(Promise.resolve("text\\n")).resolves.toMatchFileSnapshot("./saved/text.txt");
          });
        `,
        "sub/saved/text.txt": "text\n",
        "sub/saved/empty.txt": "",
        "sub/saved/object.txt": '{\n  "a": [\n    1,\n    [Function],\n  ],\n  "b": "multi\nline",\n}',
        "sub/saved/number.txt": "5",
        "sub/saved/string-object.txt": 'String {\n  "0": "b",\n}',
        "sub/saved/crlf.txt": "one\r\ntwo\r\n",
        "above.txt": "above",
      });
      const { stderr, exitCode, pass } = await runTests(String(dir), { CI: "true" });
      expect({ pass, stderr: pass ? "" : stderr }).toEqual({ pass: 1, stderr: "" });
      expect(stderr).toContain("11 snapshots,");
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "fails with the difference",
    async () => {
      using dir = tempDir("file-snapshot-mismatch", {
        "a.test.js": `${header}
          const message = f => { try { f(); } catch (error) { return error.message; } };
          test("t", () => {
            console.log(JSON.stringify([
              message(() => expect("new").toMatchFileSnapshot("./old.txt")),
              message(() => expect("old\\n").toMatchFileSnapshot("./old.txt")),
              message(() => expect("new", "my label").toMatchFileSnapshot("./old.txt")),
              message(() => expect("old\\r\\n").toMatchFileSnapshot("./lf.txt")),
            ]));
          });
          test("not awaited", () => { expect("new").toMatchFileSnapshot("./old.txt"); });
        `,
        "old.txt": "old",
        "lf.txt": "old\n",
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test"],
        env: { ...bunEnv, CI: "false" },
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(JSON.parse(stdout.slice(stdout.indexOf("[")))).toEqual([
        "expect(received).toMatchFileSnapshot(path)\n\nExpected: old\nReceived: new\n",
        expect.stringContaining("- Expected  - 1\n+ Received  + 2"),
        "my label\n\nExpected: old\nReceived: new\n",
        expect.stringContaining("expect(received).toMatchFileSnapshot(path)"),
      ]);
      expect(stderr).toContain("(fail) not awaited");
      expect(stderr).toContain("5 failed");
      expect([read(dir, "old.txt"), read(dir, "lf.txt")]).toEqual(["old", "old\n"]);
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  const writes = `${header}
    test("t", async () => {
      await expect("text\\n").toMatchFileSnapshot("./made/for/it/text.txt");
      await expect({ a: 1 }).toMatchFileSnapshot("./object.txt");
      await expect("changed").toMatchFileSnapshot("./old.txt");
    });
  `;

  test(
    "makes the file that is missing, and its directories",
    async () => {
      using dir = tempDir("file-snapshot-write", { "a.test.js": writes, "old.txt": "changed" });
      const { stderr, exitCode } = await runTests(String(dir), { CI: "false" });
      expect(stderr).toContain("1 passed, 2 added");
      expect(read(dir, "made", "for", "it", "text.txt")).toBe("text\n");
      expect(read(dir, "object.txt")).toBe('{\n  "a": 1,\n}');
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "does not in CI",
    async () => {
      using dir = tempDir("file-snapshot-ci", { "a.test.js": writes, "old.txt": "changed" });
      const { stderr, exitCode } = await runTests(String(dir), { CI: "true" });
      expect(stderr).toContain("Snapshot creation is disabled in CI environments unless --update-snapshots is used");
      expect(stderr).toContain('Snapshot file: "./made/for/it/text.txt"');
      expect(readdirSync(String(dir)).sort()).toEqual(["a.test.js", "old.txt"]);
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "--update-snapshots writes what differs or is missing, also in CI",
    async () => {
      using dir = tempDir("file-snapshot-update", { "a.test.js": writes, "old.txt": "old" });
      const { stderr, exitCode } = await runTests(String(dir), { CI: "true" }, "--update-snapshots");
      expect(stderr).toContain("+3 added");
      expect([read(dir, "made", "for", "it", "text.txt"), read(dir, "object.txt"), read(dir, "old.txt")]).toEqual([
        "text\n",
        '{\n  "a": 1,\n}',
        "changed",
      ]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "takes a number among the snapshots of its test, as in Vitest",
    async () => {
      using dir = tempDir("file-snapshot-count", {
        "a.test.js": `
          import { test, expect, describe } from "vitest";
          describe("d", () => {
            test("t", async () => {
              expect("first").toMatchSnapshot();
              await expect("x").toMatchFileSnapshot("./x.txt");
              await expect("x").toMatchFileSnapshot("./x.txt", "hint");
              expect(() => expect("x").toMatchFileSnapshot("./")).toThrow();
              expect("third").toMatchSnapshot();
            });
          });
        `,
        "x.txt": "x",
        "__snapshots__/a.test.js.snap":
          headers.vitest + '\nexports[`d > t 1`] = `"first"`;\n\nexports[`d > t 3`] = `"third"`;\n',
      });
      const { stderr, exitCode, pass } = await runTests(String(dir), { CI: "true" });
      expect({ pass, stderr: pass ? "" : stderr }).toEqual({ pass: 1, stderr: "" });
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "what it refuses",
    async () => {
      using dir = tempDir("file-snapshot-errors", {
        "a.test.js": `${header}
          const message = f => { try { f(); return "no error"; } catch (error) { return error.message.replaceAll(import.meta.dir, "<dir>").replaceAll("\\\\", "/"); } };
          const outside = message(() => expect("x").toMatchFileSnapshot("./x.txt"));
          test("t", () => {
            expect(1).toMatchSnapshot();
            console.log(JSON.stringify({
              outside,
              not: message(() => expect("x").not.toMatchFileSnapshot("./x.txt")),
              "no path": message(() => expect("x").toMatchFileSnapshot()),
              "path": message(() => expect("x").toMatchFileSnapshot(5)),
              "hint": message(() => expect("x").toMatchFileSnapshot("./x.txt", 5)),
              "own": message(() => expect("x").toMatchFileSnapshot("./__snapshots__/a.test.js.snap")),
              "directory": message(() => expect("x").toMatchFileSnapshot("./__snapshots__")),
              "long": message(() => expect("x").toMatchFileSnapshot(Buffer.alloc(100_000, "a").toString())).slice(0, 12),
              "null byte": message(() => expect("x").toMatchFileSnapshot("a\\0b.txt")),
            }, null, 2));
          });
        `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test"],
        env: { ...bunEnv, CI: "false" },
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(JSON.parse(stdout.slice(stdout.indexOf("{")))).toEqual({
        outside: "Snapshot matchers are not supported in concurrent tests",
        not: "expect(received).not.toMatchFileSnapshot()\n\nMatcher error: Snapshot matchers cannot be used with not\n",
        "no path": "\n\nMatcher error: Expected first argument to be a string\n",
        "path": "\n\nMatcher error: Expected first argument to be a string\n",
        "hint": "\n\nMatcher error: Expected second argument to be a string\n",
        "own":
          "toMatchFileSnapshot() cannot use the file that holds the other snapshots of the test file: ./__snapshots__/a.test.js.snap",
        "directory": expect.stringMatching(/^(EISDIR|EACCES|EPERM): .*'<dir>\/__snapshots__'$/),
        "long": "ENAMETOOLONG",
        "null byte": "\n\nMatcher error: Expected first argument to be a string without null bytes\n",
      });
      expect(readdirSync(String(dir)).sort()).toEqual(["__snapshots__", "a.test.js"]);
      expect({ stderr: exitCode ? stderr : "", exitCode }).toEqual({ stderr: "", exitCode: 0 });
    },
    timeout,
  );
});

describe.concurrent("expect.addSnapshotSerializer()", () => {
  const timeout = isDebug ? 60_000 : 5_000;
  const snap = (dir: unknown, name = "a.test.js") =>
    readFileSync(join(String(dir), "__snapshots__", name + ".snap"), "utf8");
  const money = `
    class Money {
      constructor(amount, currency) {
        this.amount = amount;
        this.currency = currency;
      }
    }
  `;
  const moneySerializer = `{ test: value => value instanceof Money, serialize: value => value.amount + " " + value.currency }`;

  test.each([
    ["bun:test", headers.bun, "d t"],
    ["vitest", headers.vitest, "d > t"],
  ])(
    "a test of %j: prints the values it is for, wherever they are",
    async (module, header, name) => {
      using dir = tempDir("snapshot-serializer", {
        "a.test.js": `
          import { describe, test, expect } from ${JSON.stringify(module)};
          ${money}
          class Box {
            constructor(content) {
              this.content = content;
            }
          }
          expect.addSnapshotSerializer(${moneySerializer});
          expect.addSnapshotSerializer({
            test: value => value instanceof Box,
            serialize: (value, config, indentation, depth, refs, printer) =>
              "Box(" + printer(value.content, config, indentation, depth, refs) + ")",
          });
          expect.addSnapshotSerializer({
            test: value => typeof value === "string" && value.startsWith("raw:"),
            print: (value, print, indent) => "RAW\\n" + indent(value.slice(4) + "\\n" + print([1])),
          });
          describe("d", () => {
            test("t", () => {
              expect(new Money(5, "EUR")).toMatchSnapshot();
              expect({ price: new Money(1, "USD"), all: [new Money(2, "GBP")], in: new Map([[new Money(3, "A"), new Set([new Money(4, "B")])]]) }).toMatchSnapshot();
              expect([new Box({ a: new Box(new Money(6, "JPY")) })]).toMatchSnapshot();
              expect({ text: "raw:text" }).toMatchSnapshot();
              expect(new Money(7, "CHF")).toMatchInlineSnapshot(\`7 CHF\`);
            });
          });
        `,
      });
      const { stderr, exitCode, pass } = await runTests(String(dir), { CI: "false" });
      expect({ pass, stderr: pass ? "" : stderr }).toEqual({ pass: 1, stderr: "" });
      // Bun's own format puts line breaks around a Map or a Set that is inside of something.
      const [open, close, indent] = module === "vitest" ? ["", "", ""] : ["\n", "\n", "    "];
      expect(snap(dir)).toBe(
        header +
          `\nexports[\`${name} 1\`] = \`5 EUR\`;\n` +
          `\nexports[\`${name} 2\`] = \`\n{\n  "all": [\n    2 GBP,\n  ],\n  "in": ${open}Map {\n    3 A => ${indent}${open}Set {\n      4 B,\n    }${close},\n  }${close},\n  "price": 1 USD,\n}\n\`;\n` +
          `\nexports[\`${name} 3\`] = \`\n[\n  Box({\n    "a": Box(6 JPY),\n  }),\n]\n\`;\n` +
          `\nexports[\`${name} 4\`] = \`\n{\n  "text": RAW\n    text\n    [\n        1,\n      ],\n}\n\`;\n`,
      );
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "the last one that was added is asked first",
    async () => {
      using dir = tempDir("snapshot-serializer-order", {
        "a.test.js": `
          const asked = [];
          for (const name of ["first", "second", "third"]) {
            expect.addSnapshotSerializer({
              test(value) {
                asked.push(name);
                return name === "second";
              },
              serialize: () => name,
            });
          }
          test("t", () => {
            expect(0).toMatchInlineSnapshot(\`second\`);
            expect(asked).toEqual(["third", "second"]);
          });
        `,
      });
      const { stderr, exitCode, pass } = await runTests(String(dir), { CI: "true" });
      expect({ pass, stderr: pass ? "" : stderr }).toEqual({ pass: 1, stderr: "" });
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "is for snapshots only",
    async () => {
      using dir = tempDir("snapshot-serializer-scope", {
        "a.test.js": `
          ${money}
          expect.addSnapshotSerializer(${moneySerializer});
          test("t", () => {
            expect(() => expect([new Money(1, "EUR")]).toEqual([])).toThrow('"currency": "EUR"');
            expect(() => expect(new Money(1, "EUR")).toBeNull()).toThrow('currency: "EUR"');
            expect(Bun.inspect(new Money(1, "EUR"))).toContain('currency: "EUR"');
          });
        `,
      });
      const { stderr, exitCode, pass } = await runTests(String(dir), { CI: "true" });
      expect({ pass, stderr: pass ? "" : stderr }).toEqual({ pass: 1, stderr: "" });
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  test.each([[[]], [["--isolate"]]])(
    "lasts until the end of its test file, and for every file when a preload script adds it %j",
    async args => {
      const prints = (expected: string) => `
        test("t", () => {
          expect([new Preloaded(), new Local()]).toMatchInlineSnapshot(\`${expected}\`);
        });
      `;
      using dir = tempDir("snapshot-serializer-lifetime", {
        "preload.js": `
          globalThis.Preloaded = class Preloaded {};
          globalThis.Local = class Local {};
          const { expect } = require("bun:test");
          expect.addSnapshotSerializer({ test: value => value instanceof Preloaded, serialize: () => "from the preload script" });
        `,
        "a.test.js": prints("\n[\n  from the preload script,\n  Local {},\n]\n"),
        "b.test.js":
          `expect.addSnapshotSerializer({ test: value => value instanceof Local, serialize: () => "from b" });` +
          prints("\n[\n  from the preload script,\n  from b,\n]\n"),
        "c.test.js": prints("\n[\n  from the preload script,\n  Local {},\n]\n"),
      });
      const { stderr, exitCode, pass } = await runTests(
        String(dir),
        { CI: "true" },
        "--preload",
        "./preload.js",
        ...args,
      );
      expect({ pass, stderr: pass === 3 ? "" : stderr }).toEqual({ pass: 3, stderr: "" });
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  test.each([[[]], [["--isolate"]]])(
    "lasts for every file that imports the module that adds it, which is evaluated once, and is there once %j",
    async args => {
      const prints = (expected: string, before = "") => `
        import { Shared, Local, addAgain } from "./helper.js";
        ${before}
        test("t", () => {
          expect([new Shared(), new Local()]).toMatchInlineSnapshot(\`${expected}\`);
        });
      `;
      using dir = tempDir("snapshot-serializer-helper", {
        "helper.js": `
          export class Shared {}
          export class Local {}
          const serializer = {
            test: value => value instanceof Shared,
            serialize: (value, config) => "from the helper, one of " + config.plugins.length,
          };
          export function addAgain() {
            expect.addSnapshotSerializer(serializer);
          }
          addAgain();
        `,
        "a.test.js": prints("\n[\n  from the helper, one of 1,\n  Local {},\n]\n"),
        "b.test.js": prints(
          "\n[\n  from the helper, one of 2,\n  from b,\n]\n",
          `expect.addSnapshotSerializer({ test: value => value instanceof Local, serialize: () => "from b" });`,
        ),
        "c.test.js": prints("\n[\n  from the helper, one of 1,\n  Local {},\n]\n", "addAgain(); addAgain();"),
      });
      const { stderr, exitCode, pass } = await runTests(String(dir), { CI: "true" }, ...args);
      expect({ pass, stderr: pass === 3 ? "" : stderr }).toEqual({ pass: 3, stderr: "" });
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "what it refuses, and what a serializer may not do",
    async () => {
      using dir = tempDir("snapshot-serializer-errors", {
        "a.test.js": `
          const error = f => { try { f(); return "no error"; } catch (error) { return error.name + ": " + error.message; } };
          test("t", () => {
            const invalid = [undefined, null, 5, {}, { test() {} }, { serialize() {} }, { test: 1, serialize() {} }, { test() {}, print: 1 }];
            console.log(JSON.stringify({
              invalid: [...new Set(invalid.map(serializer => error(() => expect.addSnapshotSerializer(serializer)).replace(/Received .*/, "Received")))],
              number: error(() => {
                expect.addSnapshotSerializer({ test: value => value === "number", serialize: () => 5 });
                expect("number").toMatchInlineSnapshot(\`x\`);
              }),
              test: error(() => {
                expect.addSnapshotSerializer({ test(value) { if (value === "test") throw new RangeError("in test()"); }, serialize: () => "" });
                expect(["test"]).toMatchInlineSnapshot(\`x\`);
              }),
              serialize: error(() => {
                expect.addSnapshotSerializer({ test: value => value === "serialize", serialize() { throw new RangeError("in serialize()"); } });
                expect({ a: "serialize" }).toMatchInlineSnapshot(\`x\`);
              }),
              forever: error(() => {
                expect.addSnapshotSerializer({ test: value => value === "forever", serialize: (value, ...rest) => rest.pop()(value, ...rest) });
                expect("forever").toMatchInlineSnapshot(\`x\`);
              }),
            }, null, 2));
          });
        `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test"],
        env: { ...bunEnv, CI: "true" },
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(JSON.parse(stdout.slice(stdout.indexOf("{")))).toEqual({
        invalid: [
          'TypeError: The "serializer" argument must be of type object with a test() and a serialize() or print() function. Received',
        ],
        number: "TypeError: A snapshot serializer must return a string, received number",
        test: "RangeError: in test()",
        serialize: "RangeError: in serialize()",
        forever: "RangeError: Maximum call stack size exceeded.",
      });
      expect({ stderr: exitCode ? stderr : "", exitCode }).toEqual({ stderr: "", exitCode: 0 });
    },
    timeout,
  );
});

describe.concurrent("a snapshot that does not match what the value prints as", () => {
  const timeout = isDebug ? 60_000 : 5_000;
  async function logOf(files: Record<string, string>) {
    using dir = tempDir("snapshot-mismatch", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test"],
      env: { ...bunEnv, CI: "true" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { log: stdout.split("\n").filter(line => line && !line.startsWith("bun test ")), stderr, exitCode };
  }
  const firstLine = `const firstLine = f => { try { f(); return "passes"; } catch (error) { return error.message.split("\\n")[0]; } };`;

  // Written before Bun printed DOM nodes as markup, called getters and left out what is not enumerable.
  const olderBun = `{
  "accessor": {
    "computed": [native code],
    "plain": 2,
    "written": [native code],
  },
  "element": HTMLSpanElement {
    "attributes": [],
    "childNodes": [],
    "nodeType": 1,
    "tagName": "SPAN",
  },
  "hidden": {
    "hidden": {
      "deep": true,
    },
    "shown": 1,
  },
  "list": [
    1,
  ],
  "text": [
    Text {
      "data": "words",
      "nodeType": 3,
    },
  ],
}`;
  const values = `
    class HTMLSpanElement {
      nodeType = 1;
      tagName = "SPAN";
      attributes = [];
      childNodes = [];
    }
    class Text {
      nodeType = 3;
      data = "words";
    }
    class NodeList extends Array {}
    let computed = 0;
    const values = () => ({
      accessor: { get computed() { return ++computed; }, set written(value) {}, plain: 2 },
      hidden: Object.defineProperty({ shown: 1 }, "hidden", { value: { deep: true } }),
      element: new HTMLSpanElement(),
      text: [new Text()],
      list: NodeList.from([1]),
    });
  `;

  test.each(["bun:test", "vitest"])(
    "passes when it is what an older Bun wrote, in a test of %j",
    async module => {
      const { log, stderr, exitCode } = await logOf({
        "a.test.js": `
          import { test, expect } from ${JSON.stringify(module)};
          ${values}
          test("in a file", () => { expect(values()).toMatchSnapshot(); });
          test("inline", () => { expect(values()).toMatchInlineSnapshot(\`\n${olderBun}\n\`); });
          test("but for one line", () => {
            expect(() => expect({ ...values(), more: 1 }).toMatchInlineSnapshot(\`\n${olderBun}\n\`)).toThrow();
            expect(() => expect(values()).toMatchInlineSnapshot(\`\n${olderBun.replace('"plain": 2,\n', "")}\n\`)).toThrow();
            expect(() => expect(values()).toMatchInlineSnapshot(\`\n${olderBun}\n \`)).toThrow();
          });
        `,
        "__snapshots__/a.test.js.snap": headers.bun + `\nexports[\`in a file 1\`] = \`\n${olderBun}\n\`;\n`,
      });
      expect({ log, stderr: exitCode ? stderr : "", exitCode }).toEqual({ log: [], stderr: "", exitCode: 0 });
    },
    timeout,
  );

  test(
    "passes when it is what an older Bun wrote for an accessor that throws",
    async () => {
      const printed = `{\n  "bad": [native code],\n  "good": [native code],\n  "ok": 1,\n}`;
      const { log, stderr, exitCode } = await logOf({
        "a.test.js": `
          const value = () => ({ ok: 1, get good() { return 2; }, get bad() { throw new Error("not ready"); } });
          test("in a file", () => { expect(value()).toMatchSnapshot(); });
          test("inline", () => { expect(value()).toMatchInlineSnapshot(\`\n${printed}\n\`); });
        `,
        "__snapshots__/a.test.js.snap": headers.bun + `\nexports[\`in a file 1\`] = \`\n${printed}\n\`;\n`,
      });
      expect({ log, stderr: exitCode ? stderr : "", exitCode }).toEqual({ log: [], stderr: "", exitCode: 0 });
    },
    timeout,
  );

  test(
    "passes when it is what an older Bun wrote where the object did not keep the property matchers it was given",
    async () => {
      const throughAGetter = `{\n  "o": [native code],\n}`;
      const frozen = `{\n  "a": [\n    1,\n    2,\n  ],\n}`;
      const { log, stderr, exitCode } = await logOf({
        "a.test.js": `
          const number = () => expect.any(Number);
          const throughAGetter = () => [{ get o() { return { id: 1, k: 2 }; } }, { o: { id: number() } }];
          const frozen = () => [{ a: Object.freeze([1, 2]) }, { a: [number(), 2] }];
          test("through a getter", () => {
            expect(throughAGetter()[0]).toMatchSnapshot(throughAGetter()[1]);
            expect(throughAGetter()[0]).toMatchInlineSnapshot(throughAGetter()[1], \`\n${throughAGetter}\n\`);
          });
          test("frozen", () => {
            expect(frozen()[0]).toMatchSnapshot(frozen()[1]);
            expect(frozen()[0]).toMatchInlineSnapshot(frozen()[1], \`\n${frozen}\n\`);
            expect(() => expect({ a: Object.freeze([3, 2]) }).toMatchInlineSnapshot(frozen()[1], \`\n${frozen}\n\`)).toThrow();
          });
        `,
        "__snapshots__/a.test.js.snap":
          headers.bun +
          `\nexports[\`through a getter 1\`] = \`\n${throughAGetter}\n\`;\n` +
          `\nexports[\`frozen 1\`] = \`\n${frozen}\n\`;\n`,
      });
      expect({ log, stderr: exitCode ? stderr : "", exitCode }).toEqual({ log: [], stderr: "", exitCode: 0 });
    },
    timeout,
  );

  test(
    "what an older Bun wrote counts as passed, stays as it is, and --update-snapshots rewrites it once",
    async () => {
      const older = headers.bun + `\nexports[\`in a file 1\`] = \`\n${olderBun}\n\`;\n`;
      using dir = tempDir("snapshot-older-bun", {
        "a.test.js": `${values}\ntest("in a file", () => { expect(values()).toMatchSnapshot(); });`,
        "__snapshots__/a.test.js.snap": older,
      });
      const snap = () => readFileSync(join(String(dir), "__snapshots__", "a.test.js.snap"), "utf8");
      for (const CI of ["true", "false"]) {
        const { stderr, exitCode } = await runTests(String(dir), { CI });
        expect(stderr).toContain(" 1 snapshots, ");
        expect(stderr).not.toContain("added");
        expect(snap()).toBe(older);
        expect(exitCode).toBe(0);
      }

      const first = await runTests(String(dir), { CI: "true" }, "--update-snapshots");
      const updated = snap();
      expect(updated).toContain('"computed": 1,');
      expect(updated).toContain("<span />");
      expect(updated).not.toContain('"hidden": {\n      "deep"');
      const second = await runTests(String(dir), { CI: "true" }, "--update-snapshots");
      expect(snap()).toBe(updated);
      const read = await runTests(String(dir), { CI: "true" });
      expect(snap()).toBe(updated);
      expect([first.exitCode, second.exitCode, read.exitCode]).toEqual([0, 0, 0]);
    },
    timeout,
  );

  test(
    "has the properties that only the class of the object can list, and an older Bun's, which had none of them, passes",
    async () => {
      const { log, stderr, exitCode } = await logOf({
        "exports.js": `export const a = 1; export const b = "two";`,
        "a.test.js": `
          import { test, expect } from "bun:test";
          import vm from "node:vm";
          import * as namespace from "./exports.js";
          ${firstLine}
          const sandbox = () => vm.runInContext("this", vm.createContext({ b: 2, a: 1 }));
          test("now", () => {
            expect({ namespace }).toMatchInlineSnapshot(\`
              {
                "namespace": Module Module {
                  "a": 1,
                  "b": "two",
                },
              }
            \`);
            expect({ sandbox: sandbox() }).toMatchInlineSnapshot(\`
              {
                "sandbox": JSGlobalProxy {
                  "a": 1,
                  "b": 2,
                },
              }
            \`);
          });
          test("an older Bun", () => {
            expect({ namespace }).toMatchInlineSnapshot(\`
              {
                "namespace": Module {},
              }
            \`);
            expect({ sandbox: sandbox() }).toMatchInlineSnapshot(\`
              {
                "sandbox": JSGlobalProxy {},
              }
            \`);
          });
          test("another value", () => {
            console.log(firstLine(() => expect({ namespace }).toMatchInlineSnapshot(\`
              {
                "namespace": Module Module {
                  "a": 1,
                  "b": "three",
                },
              }
            \`)));
          });
        `,
      });
      expect({ log, stderr: exitCode ? stderr : "", exitCode }).toEqual({
        log: ["expect(received).toMatchInlineSnapshot(expected)"],
        stderr: "",
        exitCode: 0,
      });
    },
    timeout,
  );

  test(
    "of import.meta.env fails when a variable has another value",
    async () => {
      using dir = tempDir("snapshot-import-meta-env", {
        "a.test.js": `
          test("the variables", () => {
            process.env = { API_URL: process.env.API_URL };
            expect(import.meta.env).toMatchSnapshot();
            expect({ nested: import.meta.env }).toMatchSnapshot();
          });
        `,
      });
      const written = await runTests(String(dir), { CI: "false", API_URL: "first" });
      expect(
        readFileSync(join(String(dir), "__snapshots__", "a.test.js.snap"), "utf8").match(/"API_URL": .*/g),
      ).toEqual(['"API_URL": "first",', '"API_URL": "first",']);
      const same = await runTests(String(dir), { CI: "true", API_URL: "first" });
      const other = await runTests(String(dir), { CI: "true", API_URL: "second" });
      expect(other.stderr).toContain('"API_URL": "second"');
      expect([written.exitCode, same.exitCode, other.exitCode]).toEqual([0, 0, 1]);
    },
    timeout,
  );

  test(
    "keeps its message whatever runs when the value is printed as an older Bun did",
    async () => {
      const { log, stderr, exitCode } = await logOf({
        "a.test.js": `
          ${firstLine}
          const secondTime = (first = 1) => { let calls = 0; return () => { if (++calls > first) throw new RangeError("the second time"); }; };
          const hostile = {
            toJSON() { const check = secondTime(); return new Proxy({}, { get(target, key) { if (key === "toJSON") check(); } }); },
            toStringTag() { const check = secondTime(2); return { get [Symbol.toStringTag]() { check(); return "Tag"; } }; },
            ownKeys() { const check = secondTime(); return { inside: new Proxy({}, { ownKeys() { check(); return []; } }) }; },
            getPrototypeOf() { const check = secondTime(); return [new Proxy({}, { getPrototypeOf() { check(); return null; } })]; },
          };
          test("t", () => {
            for (const [name, make] of Object.entries(hostile)) {
              console.log(name, firstLine(() => expect(make()).toMatchInlineSnapshot(\`other\`)));
              console.log(name, firstLine(() => expect(make()).toMatchSnapshot(name)));
            }
          });
        `,
        "__snapshots__/a.test.js.snap":
          headers.bun +
          ["toJSON", "toStringTag", "ownKeys", "getPrototypeOf"]
            .map(name => `\nexports[\`t: ${name} 1\`] = \`other\`;\n`)
            .join(""),
      });
      expect(log).toEqual(
        ["toJSON", "toStringTag", "ownKeys", "getPrototypeOf"].flatMap(name => [
          `${name} expect(received).toMatchInlineSnapshot(expected)`,
          `${name} expect(received).toMatchSnapshot(expected)`,
        ]),
      );
      expect({ stderr: exitCode ? stderr : "", exitCode }).toEqual({ stderr: "", exitCode: 0 });
    },
    timeout,
  );

  test(
    "prints the value once more at most, and keeps its message whatever that throws",
    async () => {
      const file = (module: string) => `
        import { test, expect } from ${JSON.stringify(module)};
        ${firstLine}
        test("t", () => {
          let reads = 0;
          console.log(firstLine(() => expect({ get a() { return ++reads; } }).toMatchInlineSnapshot(\`other\`)), reads);
          reads = 0;
          console.log(firstLine(() => expect({ get a() { if (++reads > 1) throw new RangeError("the second time"); return 1; } }).toMatchInlineSnapshot(\`other\`)), reads);
        });
      `;
      const [bun, vitest] = await Promise.all(
        ["bun:test", "vitest"].map(module => logOf({ "a.test.js": file(module) })),
      );
      const message = "expect(received).toMatchInlineSnapshot(expected)";
      expect(bun.log).toEqual([`${message} 2`, `${message} 2`]);
      expect(vitest.log).toEqual([`${message} 1`, `${message} 1`]);
      expect([bun.exitCode, vitest.exitCode]).toEqual([0, 0]);
    },
    timeout,
  );

  test(
    `fails for the white space around it, but in a test of "vitest"`,
    async () => {
      const file = (module: string) => `
        import { test, expect } from ${JSON.stringify(module)};
        ${firstLine}
        test("t", () => {
          console.log(firstLine(() => expect("a").toMatchInlineSnapshot(\`  "a"  \`)));
          console.log(firstLine(() => expect({ a: 1 }).toMatchInlineSnapshot(\`{\n  "a": 1,\n}\`)));
        });
      `;
      const [bun, vitest] = await Promise.all(
        ["bun:test", "vitest"].map(module => logOf({ "a.test.js": file(module) })),
      );
      const message = "expect(received).toMatchInlineSnapshot(expected)";
      expect(bun.log).toEqual([message, message]);
      expect(vitest.log).toEqual(["passes", "passes"]);
    },
    timeout,
  );

  test(
    "an error that is among its own causes",
    async () => {
      const { log, stderr, exitCode } = await logOf({
        "a.test.js": `
          ${firstLine}
          const thrower = error => () => { throw error; };
          test("t", () => {
            let reads = 0;
            const itself = new Error("itself");
            Object.defineProperty(itself, "cause", { get() { reads++; return itself; } });
            console.log(firstLine(() => expect(thrower(itself)).toThrowErrorMatchingInlineSnapshot(\`"other"\`)), reads);
            expect(thrower(itself)).toThrowErrorMatchingSnapshot();

            const first = new Error("first"), second = new Error("second", { cause: first });
            first.cause = second;
            expect(thrower(first)).toThrowErrorMatchingSnapshot();

            reads = 0;
            const endless = () => Object.defineProperty(new Error("endless"), "cause", { get() { reads++; return endless(); } });
            console.log(firstLine(() => expect(thrower(endless())).toThrowErrorMatchingInlineSnapshot(\`"other"\`)), reads);
          });
        `,
        "__snapshots__/a.test.js.snap":
          headers.jest + '\nexports[`t 2`] = `"itself"`;\n\nexports[`t 3`] = `\n"first\nCause: second"\n`;\n',
      });
      const message = "expect(received).toThrowErrorMatchingInlineSnapshot(expected)";
      expect(log).toEqual([`${message} 1`, `${message} 101`]);
      expect({ stderr: exitCode ? stderr : "", exitCode }).toEqual({ stderr: "", exitCode: 0 });
    },
    timeout,
  );
});

describe.concurrent("what script hands to the printer of snapshots", () => {
  const timeout = isDebug ? 60_000 : 5_000;
  async function logOf(files: Record<string, string>, env: Record<string, string> = {}) {
    using dir = tempDir("snapshot-hostile", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test"],
      env: { ...bunEnv, CI: "true", ...env },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { log: stdout.split("\n").filter(line => line && !line.startsWith("bun test ")), stderr, exitCode };
  }

  test(
    "the sample of an asymmetric matcher of another library is taken as pretty-format takes it",
    async () => {
      const file = (module: string) => `
        import { test, expect } from ${JSON.stringify(module)};
        const samples = { undefined: undefined, null: null, number: 5, string: "ab", symbol: Symbol("x"), bigint: 10n };
        test("t", () => {
          for (const name of ["ObjectContaining", "ObjectNotContaining", "ArrayContaining", "ArrayNotContaining"]) {
            for (const [kind, sample] of Object.entries(samples)) {
              try {
                expect({ $$typeof: Symbol.for("jest.asymmetricMatcher"), toString: () => name, sample }).toMatchInlineSnapshot(\`other\`);
              } catch (error) {
                console.log(JSON.stringify([name, kind, error.name, error.message.replace("expect(received).toMatchInlineSnapshot(expected)\\n\\n", "")]));
              }
            }
          }
        });
      `;
      const [vitest, bun] = await Promise.all(
        ["vitest", "bun:test"].map(module => logOf({ "a.test.js": file(module) })),
      );
      const mismatch = (received: string) =>
        received.includes("\n")
          ? `- other\n${received.replaceAll(/^/gm, "+ ")}\n\n- Expected  - 1\n+ Received  + ${received.split("\n").length}\n`
          : `Expected: other\nReceived: ${received}\n`;
      expect(vitest.log.map(line => JSON.parse(line))).toEqual(
        ["ObjectContaining", "ObjectNotContaining"]
          .flatMap(name => [
            [name, "undefined", "TypeError", "Cannot convert undefined or null to object"],
            [name, "null", "TypeError", "Cannot convert undefined or null to object"],
            [name, "number", "Error", mismatch(`${name} {}`)],
            [name, "string", "Error", mismatch(`\n${name} {\n  "0": "a",\n  "1": "b",\n}\n`)],
            [name, "symbol", "Error", mismatch(`${name} {}`)],
            [name, "bigint", "Error", mismatch(`${name} {}`)],
          ])
          .concat(
            ["ArrayContaining", "ArrayNotContaining"].flatMap(name => [
              [name, "undefined", "TypeError", "Cannot read properties of undefined (reading 'length')"],
              [name, "null", "TypeError", "Cannot read properties of null (reading 'length')"],
              [name, "number", "Error", mismatch(`${name} []`)],
              [name, "string", "TypeError", "Cannot use the 'in' operator on a value that is not an object"],
              [name, "symbol", "Error", mismatch(`${name} []`)],
              [name, "bigint", "Error", mismatch(`${name} []`)],
            ]),
          ),
      );
      expect(bun.log.map(line => JSON.parse(line).slice(0, 3))).toEqual(
        vitest.log.map(line => [...JSON.parse(line).slice(0, 2), "Error"]),
      );
      expect([vitest.exitCode, bun.exitCode]).toEqual([0, 0]);
    },
    timeout,
  );

  test(
    "a look-alike of a DOM node with members of other types than the DOM gives them",
    async () => {
      using dir = tempDir("snapshot-look-alikes", {});
      cpSync(join(import.meta.dir, "..", "formats", "look-alikes"), String(dir), { recursive: true });
      const snap = () => readFileSync(join(String(dir), "__snapshots__", "dom.fixture.js.snap"), "latin1");
      const before = snap();
      const { pass, fail, stderr, exitCode } = await runTests(String(dir), { CI: "true" }, "./dom.fixture.js");
      expect({ fail, pass, stderr: fail ? stderr : "" }).toEqual({ fail: 0, pass: 19, stderr: "" });
      expect(snap()).toBe(before);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "a value that is its own property matchers, nested too deeply to walk, is a RangeError",
    async () => {
      const file = (module: string) => `
        import { test, expect } from ${JSON.stringify(module)};
        test("t", () => {
          let value = 1;
          for (let i = 0; i < 100_000; i++) value = { a: value };
          for (const matcher of ["toMatchSnapshot", "toMatchInlineSnapshot"]) {
            try {
              expect(value)[matcher](value);
            } catch (error) {
              console.log(matcher, error.name + ": " + error.message);
            }
          }
        });
      `;
      const results = await Promise.all([
        logOf({ "a.test.js": file("vitest") }),
        logOf({ "a.test.js": file("bun:test"), "__snapshots__/a.test.js.snap": headers.jest }),
        logOf({ "a.test.js": file("bun:test") }),
      ]);
      const expected = {
        log: [
          "toMatchSnapshot RangeError: Maximum call stack size exceeded.",
          "toMatchInlineSnapshot RangeError: Maximum call stack size exceeded.",
        ],
        exitCode: 0,
      };
      expect(results.map(({ log, exitCode }) => ({ log, exitCode }))).toEqual([expected, expected, expected]);
    },
    timeout,
  );

  // Nine stack overflows, about half a second each on a release build.
  const timeoutOfCycles = 60_000;
  test(
    "what holds itself in a way that pretty-format does not notice either is a RangeError, and soon",
    async () => {
      using dir = tempDir("snapshot-cycles", {
        "a.test.js": `
          import { test, expect } from "vitest";
          const element = (type, props) => ({ $$typeof: Symbol.for("react.transitional.element"), type, props });
          const json = members => ({ $$typeof: Symbol.for("react.test.json"), type: "a", props: {}, children: null, ...members });
          class HTMLDivElement {
            nodeType = 1;
            tagName = "DIV";
            attributes = [];
            childNodes = [];
          }
          const tied = (value, tie) => (tie(value), value);
          const cycles = {
            "an element in its props": tied(element("a", {}), it => (it.props.it = it)),
            "an element among its children": tied(element("a", {}), it => (it.props.children = [it])),
            "a test renderer's object in its props": tied(json(), it => (it.props.it = it)),
            "a test renderer's object among its children": tied(json(), it => (it.children = [it])),
            "a DOM element in an attribute": tied(new HTMLDivElement(), it => (it.attributes = [{ name: "it", value: it }])),
            "a DOM element among its children": tied(new HTMLDivElement(), it => (it.childNodes = [it])),
            "a DOM element in an element in an attribute": tied(
              new HTMLDivElement(),
              it => (it.attributes = [{ name: "it", value: element("a", { it }) }]),
            ),
            "an Immutable.List among its values": tied(
              { "@@__IMMUTABLE_ITERABLE__@@": true, "@@__IMMUTABLE_LIST__@@": true },
              it => (it.values = () => [it].values()),
            ),
            "an asymmetric matcher in its sample": tied(
              { $$typeof: Symbol.for("jest.asymmetricMatcher"), toString: () => "ObjectContaining" },
              it => (it.sample = { it }),
            ),
          };
          test("t", () => {
            for (const [name, value] of Object.entries(cycles)) {
              try {
                expect(value).toMatchInlineSnapshot(\`other\`);
              } catch (error) {
                console.log(name + ": " + error.name + ": " + error.message);
              }
            }
          });
        `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "--timeout", String(timeoutOfCycles)],
        env: { ...bunEnv, CI: "true" },
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
        timeout: timeoutOfCycles / 2,
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      const log = stdout.split("\n").filter(line => line && !line.startsWith("bun test "));
      // How deep the stack goes before that much is printed depends on the build.
      const error = "RangeError: <Maximum call stack size exceeded. or The value is too large to print in a snapshot>";
      expect({
        log: log.map(line =>
          line.replace(
            /RangeError: (Maximum call stack size exceeded\.|The value is too large to print in a snapshot)$/,
            error,
          ),
        ),
        exitCode,
      }).toEqual({
        log: [
          "an element in its props",
          "an element among its children",
          "a test renderer's object in its props",
          "a test renderer's object among its children",
          "a DOM element in an attribute",
          "a DOM element among its children",
          "a DOM element in an element in an attribute",
          "an Immutable.List among its values",
          "an asymmetric matcher in its sample",
        ].map(name => `${name}: ${error}`),
        exitCode: 0,
      });
    },
    timeoutOfCycles,
  );

  test.each([{}, { REALLOCATE: "1" }])(
    "the `refs` that a serializer gives to `printer` are kept, whatever becomes of its array %j",
    async env => {
      const { log, stderr, exitCode } = await logOf(
        {
          "a.test.js": `
            let given;
            expect.addSnapshotSerializer({
              test: value => value?.outer === true,
              serialize(value, config, indentation, depth, refs, printer) {
                given = Array.from({ length: 2000 }, (_, i) => ({ index: i, more: [i, i, i] }));
                return printer(value.inner, config, indentation, depth, given);
              },
            });
            expect.addSnapshotSerializer({
              test: value => value?.leaf === true,
              serialize(value, config, indentation, depth, refs) {
                const kept = refs.filter((ref, i) => ref?.index === i && String(ref.more) === [i, i, i].join()).length;
                return kept + " of " + refs.length + " at depth " + depth;
              },
            });
            test("t", () => {
              const inner = {
                get a() {
                  given.length = 0;
                  given = null;
                  Bun.gc(true);
                  if (process.env.REALLOCATE) globalThis.others = Array.from({ length: 20000 }, (_, i) => ({ other: "x" + i, more: 1 }));
                  return { leaf: true };
                },
              };
              expect({ outer: true, inner }).toMatchInlineSnapshot(\`
                {
                  "a": 2000 of 2001 at depth 2001,
                }
              \`);
            });
          `,
        },
        env,
      );
      expect({ log, stderr: exitCode ? stderr : "", exitCode }).toEqual({ log: [], stderr: "", exitCode: 0 });
    },
    timeout,
  );
});
