// `expect(value).toMatchSnapshot()` and `Bun.inspect(value, { sorted: true })` list the properties of a value through one native function, in sorted order.
// Under `bun test --aot` it lists the members of a class prototype from which nothing has been read, as under `bun test`: the methods and accessors, without `constructor`.
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
  expect(plain.printed).toBe(
    "Inspected {\n  alpha: [Function: alpha],\n  size: [Getter],\n  zeta: [Function: zeta],\n}\n",
  );
  for (const method of ["alpha", "zeta", "own"]) expect(plain.snapshots).toContain(`"${method}": `);
  expect(plain.snapshots).not.toContain("constructor");
  expect(plain.snapshots).not.toContain("inherited");

  expect(compiled).toEqual({ ...plain, usedImage: true });
}, 120_000);
