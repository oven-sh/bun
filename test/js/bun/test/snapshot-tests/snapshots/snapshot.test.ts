import { $ } from "bun";
import { describe, expect, it, test } from "bun:test";
import { bunExe, tempDirWithFiles } from "harness";

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

function defaultWrap(a: string): string {
  return `test("abc", () => { expect(${a}).toMatchSnapshot() });`;
}

class SnapshotTester {
  dir: string;
  targetSnapshotContents: string;
  isFirst: boolean = true;
  constructor() {
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
    const isFirst = this.isFirst;
    this.isFirst = false;
    await Bun.write(this.dir + "/snapshot.test.ts", contents);

    if (!opts.shouldNotError) {
      if (!isFirst) {
        // make sure it fails first:
        expect((await $`cd ${this.dir} && ${bunExe()} test ./snapshot.test.ts`.nothrow().quiet()).exitCode).not.toBe(0);
        // make sure the existing snapshot is unchanged:
        expect(await Bun.file(this.dir + "/__snapshots__/snapshot.test.ts.snap").text()).toBe(
          this.targetSnapshotContents,
        );
      }
      // update snapshots now, using -u flag unless this is the first run
      await $`cd ${this.dir} && ${bunExe()} test ${isFirst && !opts.forceUpdate ? "" : "-u"} ./snapshot.test.ts`.quiet();
      // make sure the snapshot changed & didn't grow
      const newContents = await this.getSnapshotContents();
      if (!isFirst) {
        expect(newContents).not.toStartWith(this.targetSnapshotContents);
      }
      if (!opts.skipSnapshot) expect(newContents).toMatchSnapshot();
      this.targetSnapshotContents = newContents;
    }
    // run, make sure snapshot does not change
    await $`cd ${this.dir} && ${bunExe()} test ./snapshot.test.ts`.quiet();
    if (!opts.shouldGrow) {
      expect(await Bun.file(this.dir + "/__snapshots__/snapshot.test.ts.snap").text()).toBe(
        this.targetSnapshotContents,
      );
    } else {
      this.targetSnapshotContents = await this.getSnapshotContents();
    }
  }
  async setSnapshotFile(contents: string) {
    await Bun.write(this.dir + "/__snapshots__/snapshot.test.ts.snap", contents);
    this.isFirst = true;
  }
  async getSnapshotContents(): Promise<string> {
    return await Bun.file(this.dir + "/__snapshots__/snapshot.test.ts.snap").text();
  }
}

describe("snapshots", async () => {
  const t = new SnapshotTester();
  await t.update(defaultWrap("''"), { skipSnapshot: true });

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

  t.test("null byte", defaultWrap('"1 \x00"'));
  t.test("null byte 2", defaultWrap('"2 \\x00"'));

  t.test("backticks", defaultWrap("`This is \\`wrong\\``"));
  t.test("unicode", defaultWrap("'😊abc`${def} " + "😊".substring(0, 1) + ", " + "😊".substring(1, 2) + " '"));

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
    const t4 = new SnapshotTester();
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

  const t2 = new SnapshotTester();
  t2.test("backtick in test name", `test("\`", () => {expect("abc").toMatchSnapshot();})`);
  const t3 = new SnapshotTester();
  t3.test("dollars curly in test name", `test("\${}", () => {expect("abc").toMatchSnapshot();})`);

  const t15283 = new SnapshotTester();
  t15283.test(
    "#15283",
    `it("Should work", () => {
      expect(\`This is \\\`wrong\\\`\`).toMatchSnapshot();
    });`,
  );
  t15283.test("#15283 unicode", `it("Should work", () => {expect(\`😊This is \\\`wrong\\\`\`).toMatchSnapshot()});`);
});
