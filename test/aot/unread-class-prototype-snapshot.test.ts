// `expect(value).toMatchSnapshot()` and `Bun.inspect(value, { sorted: true })` list the properties of a value through one native function, in sorted order.
// Under `bun test --aot` it lists the members of a class prototype from which nothing has been read, as under `bun test`: none, because none is enumerable.
// It hands over an accessor under an index key as `bun test` does too: the accessor, and null where it reproduces what an older Bun wrote.
import { expect } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "path";
import { run } from "./harness/run";
import { test } from "./supported";

const files = {
  "prototype.test.ts": `
    import { expect, test } from "bun:test";
    class Snapshotted {
      zeta(): number { return 1; }
      alpha(): string { return "a"; }
      get size(): number { return 2; }
    }
    class Inspected {
      zeta(): number { return 1; }
      alpha(): string { return "a"; }
      get size(): number { return 2; }
    }
    class Nested {
      zeta(): number { return 1; }
      alpha(): string { return "a"; }
    }
    class Base { inherited(): void {} }
    class Derived extends Base { own(): void {} }
    class Empty {}
    test("a prototype", () => { expect(Snapshotted.prototype).toMatchSnapshot(); });
    test("a prototype inside an object", () => { expect({ holder: Nested.prototype }).toMatchSnapshot(); });
    test("the prototype of a subclass", () => { expect(Derived.prototype).toMatchSnapshot(); });
    test("a prototype without members", () => { expect(Empty.prototype).toMatchSnapshot(); });
    test("sorted keys", () => { console.log(Bun.inspect(Inspected.prototype, { sorted: true })); });
  `,
};

async function runTests(cwd: string, flags: string[]) {
  const { stdout, stderr, exitCode } = await run(
    [bunExe(), "test", ...flags, "--update-snapshots", "./prototype.test.ts"],
    cwd,
    { ...bunEnv, BUN_AOT_VERBOSE: "1" },
  );
  return {
    printed: stdout.slice(stdout.indexOf("Inspected {")),
    snapshots: exitCode === 0 ? readFileSync(join(cwd, "__snapshots__", "prototype.test.ts.snap"), "utf8") : stderr,
    usedImage: stderr.includes("[aot] image: "),
    exitCode,
  };
}

test("bun test --debug-aot prints a class prototype that nothing has read from as bun test does", async () => {
  using plainDir = tempDir("unread-class-prototype-snapshot", files);
  using compiledDir = tempDir("unread-class-prototype-snapshot", files);
  const [plain, compiled] = await Promise.all([
    runTests(String(plainDir), []),
    runTests(String(compiledDir), ["--debug-aot"]),
  ]);

  expect(plain.exitCode).toBe(0);
  expect(plain.printed).toBe("Inspected {}\n");
  for (const member of ["alpha", "zeta", "own", "constructor", "inherited"])
    expect(plain.snapshots).not.toContain(`"${member}": `);

  expect(compiled).toEqual({ ...plain, usedImage: true });
}, 120_000);

// Bun 1.4.4 wrote this snapshot file.
const olderBun = `// Bun Snapshot v1, https://bun.sh/docs/test/snapshots

exports[\`what an older Bun wrote 1\`] = \`
{
  "0": null,
  "7": null,
  "8": null,
  "a": 1,
  "named": [native code],
}
\`;
`;
const indexAccessorFiles = {
  "index.test.js": `
    import { expect, test } from "bun:test";
    const value = () => {
      const o = { a: 1, get named() { return 1; } };
      Object.defineProperty(o, 0, { get() { throw new Error("not ready"); }, enumerable: true });
      Object.defineProperty(o, 7, { get() { return "seven"; }, enumerable: true });
      Object.defineProperty(o, 8, { set(v) {}, enumerable: true });
      return o;
    };
    const declared = () => ({ a: 1, get 0() { return "zero"; }, set 8(v) {}, get named() { return 1; } });
    class Instance {
      a = 1;
      constructor() {
        Object.defineProperty(this, 0, { get() { return "zero"; }, enumerable: true });
      }
    }
    test("sorted keys", () => {
      for (const object of [value(), declared(), new Instance()]) console.log(Bun.inspect(object, { sorted: true }));
    });
    test("what an older Bun wrote", () => { expect(value()).toMatchSnapshot(); });
    test("a getter that throws", () => {
      expect(value()).toMatchInlineSnapshot(\`
        {
          "0": [native code],
          "7": "seven",
          "8": undefined,
          "a": 1,
          "named": 1,
        }
      \`);
    });
  `,
  "__snapshots__/index.test.js.snap": olderBun,
};

test("bun test --debug-aot prints an accessor under an index key as bun test does", async () => {
  using plainDir = tempDir("index-accessor-snapshot", indexAccessorFiles);
  using compiledDir = tempDir("index-accessor-snapshot", indexAccessorFiles);
  const runIn = async (cwd: string, flags: string[]) => {
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags, "./index.test.js"], cwd, {
      ...bunEnv,
      CI: "true",
      BUN_AOT_VERBOSE: "1",
    });
    return {
      printed: stdout.slice(stdout.indexOf("{")),
      failed: stderr.split("\n").filter(line => line.startsWith("(fail)")),
      snapshots: readFileSync(join(cwd, "__snapshots__", "index.test.js.snap"), "utf8"),
      usedImage: stderr.includes("[aot] image: "),
      exitCode,
    };
  };
  const [plain, compiled] = await Promise.all([
    runIn(String(plainDir), []),
    runIn(String(compiledDir), ["--debug-aot"]),
  ]);

  const object = (...lines: string[]) => `{\n${lines.map(line => `  ${line},\n`).join("")}}\n`;
  expect(plain).toEqual({
    printed:
      object(`"0": [Getter]`, `"7": [Getter]`, `"8": [Setter]`, `a: 1`, `named: [Getter]`) +
      object(`"0": [Getter]`, `"8": [Setter]`, `a: 1`, `named: [Getter]`) +
      "Instance " +
      object(`"0": [Getter]`, `a: 1`),
    failed: [],
    snapshots: olderBun,
    usedImage: false,
    exitCode: 0,
  });
  expect(compiled).toEqual({ ...plain, usedImage: true });
});
