import { describe, expect, test } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, tempDir, tmpdirSync } from "harness";

test("it will create a snapshot file and directory if they don't exist", () => {
  const tempDir = tmpdirSync();
  fs.rmSync(tempDir, { force: true, recursive: true });
  fs.mkdirSync(tempDir, { recursive: true });

  fs.copyFileSync(import.meta.dir + "/new-snapshot.ts", tempDir + "/new-snapshot.test.ts");
  const { exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "test"],
    cwd: tempDir,
    env: { ...bunEnv, CI: "false" },
  });

  expect(exitCode).toBe(0);
  expect(fs.existsSync(tempDir + "/__snapshots__/new-snapshot.test.ts.snap")).toBe(true);

  // remove the snapshot file but leave the directory and test again.
  fs.rmSync(tempDir + "/__snapshots__/new-snapshot.test.ts.snap", { force: true });
  const { exitCode: exitCode2 } = Bun.spawnSync({
    cmd: [bunExe(), "test"],
    cwd: tempDir,
    env: { ...bunEnv, CI: "false" },
  });

  expect(exitCode2).toBe(0);
  expect(fs.existsSync(tempDir + "/__snapshots__/new-snapshot.test.ts.snap")).toBe(true);
});

test("--update-snapshots keeps the old file until the new contents are written", async () => {
  const header = "// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n";
  const before = header + '\nexports[`one 1`] = `"old"`;\n\nexports[`removed 1`] = `"old"`;\n';
  using dir = tempDir("snapshot-update-bail", {
    "a.test.ts": `
      import { test, expect } from "bun:test";
      test("one", () => { expect("new").toMatchSnapshot(); });
      test("fails", () => { expect(process.env.FAIL).toBeUndefined(); });
    `,
    "__snapshots__/a.test.ts.snap": before,
  });
  async function update(env: Record<string, string>) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--update-snapshots", "--bail"],
      cwd: String(dir),
      env: { ...bunEnv, CI: "false", ...env },
      stdout: "ignore",
      stderr: "ignore",
    });
    return { exitCode: await proc.exited, snap: fs.readFileSync(`${dir}/__snapshots__/a.test.ts.snap`, "utf8") };
  }
  expect(await update({ FAIL: "1" })).toEqual({ exitCode: 1, snap: before });
  expect(await update({})).toEqual({ exitCode: 0, snap: header + '\nexports[`one 1`] = `"new"`;\n' });
});

test.concurrent("property matchers that are one asymmetric matcher are applied to the received value", async () => {
  const header = "// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n";
  const source = `
    import { test, expect } from "bun:test";
    expect.extend({
      toHaveKey(received, key) {
        return { pass: key in received, message: () => "toHaveKey" };
      },
    });
    test("plain", () => { expect({ a: 1 }).toMatchSnapshot(); });
    test("matches", () => { expect({ a: 1, b: 2 }).toMatchSnapshot(expect.objectContaining({ a: 1 })); });
    test("extended", () => { expect({ a: 1, b: 2 }).toMatchSnapshot(expect.toHaveKey("a")); });
    test("written", () => {
      expect({ a: 1, b: 2 }).toMatchInlineSnapshot(expect.toHaveKey("a"), \`
        {
          "a": 1,
          "b": 2,
        }
      \`);
    });
    test("file", () => { expect({ a: 1 }).toMatchSnapshot(expect.objectContaining({ b: 1 })); });
    test("inline", () => { expect({ a: 1 }).toMatchInlineSnapshot(expect.any(Array)); });
  `;
  using dir = tempDir("snapshot-whole-matcher", { "a.test.ts": source });
  async function run() {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test"],
      cwd: String(dir),
      env: { ...bunEnv, CI: "false" },
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    return {
      results: stderr.match(/^\((pass|fail)\) \w+/gm),
      refused: stderr.match(/Expected propertyMatchers to match properties from received object/g)?.length,
      exitCode,
      snap: fs.readFileSync(`${dir}/__snapshots__/a.test.ts.snap`, "utf8"),
      source: fs.readFileSync(`${dir}/a.test.ts`, "utf8"),
    };
  }
  const entry = (name: string) => "\nexports[`" + name + ' 1`] = `\n{\n  "a": 1,\n  "b": 2,\n}\n`;\n';
  const expected = {
    results: ["(pass) plain", "(pass) matches", "(pass) extended", "(pass) written", "(fail) file", "(fail) inline"],
    refused: 2,
    exitCode: 1,
    // A matcher that matches stores the received value. One that does not match stores nothing:
    // the file has no entry for "file", and no inline snapshot was written into the test.
    snap: header + '\nexports[`plain 1`] = `\n{\n  "a": 1,\n}\n`;\n' + entry("matches") + entry("extended"),
    source,
  };
  expect(await run()).toEqual(expected);
  // the second run compares with what the first run stored
  expect(await run()).toEqual(expected);
});

test.concurrent("property matchers that are one asymmetric matcher, in a Jest and a Vitest snapshot file", async () => {
  const tests = (module: string) => `
    import { test, expect } from "${module}";
    test("plain", () => { expect("x").toMatchSnapshot(); });
    test("refused", () => { expect({ a: 1 }).toMatchSnapshot(expect.objectContaining({ b: 1 })); });
  `;
  const jestHeader = "// Jest Snapshot v1, https://jestjs.io/docs/snapshot-testing\n";
  using dir = tempDir("snapshot-whole-matcher-formats", {
    // the first line of a snapshot file gives its format, and the import gives the format of a new file
    "jest.test.ts": tests("bun:test"),
    "__snapshots__/jest.test.ts.snap": jestHeader,
    "vitest.test.ts": tests("vitest"),
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test"],
    cwd: String(dir),
    env: { ...bunEnv, CI: "false" },
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  const snap = (name: string) => fs.readFileSync(`${dir}/__snapshots__/${name}.test.ts.snap`, "utf8");
  expect({
    results: stderr.match(/^\((pass|fail)\) \w+/gm),
    refused: stderr.match(/Expected propertyMatchers to match properties from received object/g)?.length,
    exitCode,
    jest: snap("jest"),
    vitest: snap("vitest"),
  }).toEqual({
    results: ["(pass) plain", "(fail) refused", "(pass) plain", "(fail) refused"],
    refused: 2,
    exitCode: 1,
    jest: jestHeader + '\nexports[`plain 1`] = `"x"`;\n',
    vitest: "// Vitest Snapshot v1, https://vitest.dev/guide/snapshot.html\n" + '\nexports[`plain 1`] = `"x"`;\n',
  });
});

describe("toMatchSnapshot(properties) with a matcher as one of the two whole values", () => {
  const rows = `
    class Shape { x = expect.any(Number); asymmetricMatch(other) { return typeof other.x === "number"; } }
    class ProtoOnly { asymmetricMatch(other) { return typeof other.x === "number"; } }
    const hidden = (own, answer) => Object.defineProperty(own, "asymmetricMatch", { value: () => answer });
    const row = (name, received, properties) => test(name, () => {
      let outcome = "passes";
      try { expect(received).toMatchSnapshot(properties); } catch { outcome = "fails"; }
      console.log(name + ": " + outcome);
    });
    row("literal says yes", { a: 1 }, { asymmetricMatch: () => true });
    row("literal says no", { a: 1 }, { asymmetricMatch: () => false });
    row("class says yes", { x: Math.random(), y: 2 }, new Shape());
    row("class says no", { x: "s", y: 2 }, new Shape());
    row("prototype method says yes", { x: 1, y: 2 }, new ProtoOnly());
    row("prototype method says no", { x: "s", y: 2 }, new ProtoOnly());
    row("says yes where the keys differ", { a: 1 }, hidden({ b: expect.any(Number) }, true));
    row("says no where the keys match", { a: 1 }, hidden({ a: expect.any(Number) }, false));
    row("received says yes", hidden({ x: Math.random() }, true), { x: expect.any(Number) });
    row("received says no", hidden({ x: 1 }, false), { x: expect.any(Number) });
    row("says yes, matchers two levels down", { id: 1, deep: { id: Math.random(), list: [Math.random(), "b"] } }, hidden({ deep: { id: expect.any(Number), list: [expect.any(Number), "b"] } }, true));
    row("built-in matcher says yes", { a: 1 }, expect.any(Object));
    row("built-in matcher says no", { a: 1 }, expect.any(Array));
  `;
  const names = [...rows.matchAll(/row\("([^"]+)"/g)].map(match => match[1]);
  const stored: Record<string, string> = {
    "literal says yes": '{\n  "a": 1,\n}',
    "class says yes": '{\n  "x": Any<Number>,\n  "y": 2,\n}',
    "prototype method says yes": '{\n  "x": 1,\n  "y": 2,\n}',
    "says yes where the keys differ": '{\n  "a": 1,\n}',
    "received says yes": '{\n  "x": Any<Number>,\n}',
    "says yes, matchers two levels down":
      '{\n  "deep": {\n    "id": Any<Number>,\n    "list": [\n      Any<Number>,\n      "b",\n    ],\n  },\n  "id": 1,\n}',
    "built-in matcher says yes": '{\n  "a": 1,\n}',
  };
  // Jest and Vitest merge every key of the properties, and can't print a matcher that is all of them.
  // The Bun format puts a matcher only where the value has a key.
  const storedByJestAndVitest: Record<string, string> = {
    ...stored,
    "literal says yes": '{\n  "a": 1,\n  "asymmetricMatch": [Function],\n}',
    "says yes where the keys differ": '{\n  "a": 1,\n  "b": Any<Number>,\n}',
  };
  delete storedByJestAndVitest["built-in matcher says yes"];
  const file = (header: string, entries: Record<string, string>, order: string[]) =>
    header + order.map(name => `\nexports[\`${name} 1\`] = \`\n${entries[name]}\n\`;\n`).join("");

  async function run(dir: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "rows.test.js"],
      cwd: dir,
      env: { ...bunEnv, CI: "false" },
      stdout: "pipe",
      stderr: "ignore",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    return {
      log: stdout.split("\n").filter(line => /: (passes|fails)$/.test(line)),
      snap: fs.readFileSync(`${dir}/__snapshots__/rows.test.js.snap`, "utf8"),
      exitCode,
    };
  }

  // The two other texts are what Jest 30.5.2 and Vitest 5.1.0 write for these rows.
  test.concurrent.each([
    {
      format: "Bun",
      module: "bun:test",
      existing: undefined,
      snap: file("// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n", stored, Object.keys(stored)),
    },
    {
      format: "Jest",
      module: "bun:test",
      existing: "// Jest Snapshot v1, https://jestjs.io/docs/snapshot-testing\n",
      snap: file(
        "// Jest Snapshot v1, https://jestjs.io/docs/snapshot-testing\n",
        storedByJestAndVitest,
        Object.keys(storedByJestAndVitest).sort(),
      ),
    },
    {
      format: "Vitest",
      module: "vitest",
      existing: undefined,
      snap: file(
        "// Vitest Snapshot v1, https://vitest.dev/guide/snapshot.html\n",
        storedByJestAndVitest,
        Object.keys(storedByJestAndVitest).sort(),
      ),
    },
  ])(
    "the matcher answers, and the $format format keeps the matchers under its keys",
    async ({ format, module, existing, snap }) => {
      using dir = tempDir("snapshot-whole-matcher", {
        "rows.test.js": `import { test, expect } from "${module}";\n${rows}`,
        ...(existing ? { "__snapshots__/rows.test.js.snap": existing } : {}),
      });
      const entries = format === "Bun" ? stored : storedByJestAndVitest;
      const expected = {
        log: names.map(name => `${name}: ${name in entries ? "passes" : "fails"}`),
        snap,
        exitCode: 0,
      };
      expect(await run(String(dir))).toEqual(expected);
      // The values that Math.random() made are not in the file, so the second run agrees with it.
      expect(await run(String(dir))).toEqual(expected);
    },
  );

  test.concurrent("nothing is asked or compared after the answer", async () => {
    using dir = tempDir("snapshot-whole-matcher-asks", {
      "rows.test.js": `
        import { test, expect } from "bun:test";
        let asked = 0;
        let tested = 0;
        expect.addEqualityTesters([() => { tested++; return undefined; }]);
        const inner = { asymmetricMatch: () => (asked++, true) };
        const says = answer => Object.defineProperty({ inner, id: expect.any(Number) }, "asymmetricMatch", { value: () => answer });
        test("counts", () => {
          let outcome = "passes";
          expect({ inner: 1, id: Math.random() }).toMatchSnapshot(says(true));
          try { expect({ inner: 1, id: 1 }).toMatchSnapshot(says(false)); } catch { outcome = "fails"; }
          console.log("asked " + asked + ", tested " + tested + ", says no: " + outcome);
        });
      `,
    });
    expect(await run(String(dir))).toEqual({
      log: ["asked 0, tested 0, says no: fails"],
      snap:
        "// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n" +
        '\nexports[`counts 1`] = `\n{\n  "id": Any<Number>,\n  "inner": 1,\n}\n`;\n',
      exitCode: 0,
    });
  });

  // What a matcher answered for is not compared, so a matcher under a key of it has matched nothing.
  // The Bun format shows it where the value has that key, and reads the keys that deepMerge() of jest-snapshot reads.
  test.concurrent(
    "after the answer, the Bun format shows a matcher of the properties only where the value has its key",
    async () => {
      const stored: Record<string, string> = {
        "a key that the value lacks": '{\n  "a": 1,\n}',
        "an object that the value lacks": '{\n  "a": 1,\n}',
        "a list that is longer than the value's": '{\n  "list": [\n    Any<Number>,\n  ],\n}',
        "a cycle": '{\n  "id": Any<Number>,\n  "self": [Circular],\n}',
        "a symbol key": '{\n  "id": Any<Number>,\n  [Symbol(s)]: 1,\n}',
        "a key that is not enumerable": '{\n  "id": Any<Number>,\n  "y": 2,\n}',
        "a function that has a matcher": '{\n  "f": {\n    "z": 1,\n  },\n  "id": Any<Number>,\n}',
      };
      using dir = tempDir("snapshot-whole-matcher-keys", {
        "rows.test.js": `
        import { test, expect } from "bun:test";
        const hidden = (own, answer) => Object.defineProperty(own, "asymmetricMatch", { value: () => answer });
        const s = Symbol("s");
        const row = (name, received, properties) => test(name, () => {
          expect(received).toMatchSnapshot(properties);
          console.log(name + ": passes");
        });
        row("a key that the value lacks", { a: 1 }, hidden({ b: expect.any(Number) }, true));
        row("an object that the value lacks", { a: 1 }, hidden({ deep: { id: expect.any(Number) } }, true));
        row("a list that is longer than the value's", { list: [Math.random()] }, hidden({ list: [expect.any(Number), { id: expect.any(Number) }, expect.any(String)] }, true));
        const cyclic = { id: Math.random() };
        cyclic.self = cyclic;
        const cyclicProperties = hidden({ id: expect.any(Number) }, true);
        cyclicProperties.self = cyclicProperties;
        row("a cycle", cyclic, cyclicProperties);
        row("a symbol key", { [s]: 1, id: Math.random() }, hidden({ [s]: expect.any(Number), id: expect.any(Number) }, true));
        row("a key that is not enumerable", { y: 2, id: Math.random() }, Object.defineProperty(hidden({ id: expect.any(Number) }, true), "y", { value: expect.any(Number) }));
        row("a function that has a matcher", { f: { z: 1 }, id: Math.random() }, hidden({ f: Object.assign(() => {}, { z: expect.any(Number) }), id: expect.any(Number) }, true));
      `,
      });
      const expected = {
        log: Object.keys(stored).map(name => `${name}: passes`),
        snap: file("// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n", stored, Object.keys(stored)),
        exitCode: 0,
      };
      expect(await run(String(dir))).toEqual(expected);
      expect(await run(String(dir))).toEqual(expected);
    },
  );

  test.concurrent("properties that are deeper than the native stack throw a RangeError after the answer", async () => {
    using dir = tempDir("snapshot-whole-matcher-deep", {
      "rows.test.js": `
        import { test, expect } from "bun:test";
        let a = {}, b = {};
        const received = a, properties = b;
        for (let i = 0; i < 100000; i++) { a.x = {}; b.x = {}; a = a.x; b = b.x; }
        Object.defineProperty(properties, "asymmetricMatch", { value: () => true });
        test("deep", () => {
          try {
            expect(received).toMatchSnapshot(properties);
            console.log("no error: passes");
          } catch (error) {
            console.log(error instanceof RangeError, error.message + ": fails");
          }
        });
      `,
      "__snapshots__/rows.test.js.snap": "// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n",
    });
    expect(await run(String(dir))).toEqual({
      log: ["true Maximum call stack size exceeded.: fails"],
      snap: "// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n",
      exitCode: 0,
    });
  });
});
