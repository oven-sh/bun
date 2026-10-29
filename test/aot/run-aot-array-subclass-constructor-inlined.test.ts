import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

const files = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: { strict: true, typeRoots: [join(import.meta.dir, "..", "..", "packages")], types: ["bun-types"] },
  }),
  "typed.ts": `
class ZeroArray extends Array<number> { constructor(size: number) { super(size); this.fill(0); } }
function many(): number {
  let sum = 0;
  for (let i = 0; i < 300000; i++) { const made = new ZeroArray(8); sum += made.length + made[3]!; }
  return sum;
}
console.log(many());`,
  "untyped.js": `
class ZeroArray extends Array { constructor(size) { super(size); this.fill(0); } }
function many() {
  let sum = 0;
  for (let i = 0; i < 300000; i++) { const made = new ZeroArray(8); sum += made.length + made[3]; }
  return sum;
}
console.log(many());`,
  "in-a.test.ts": `
import { expect, test } from "bun:test";
class ZeroArray extends Array<number> { constructor(size: number) { super(size); this.fill(0); } }
test("a subclass of Array made many times", () => {
  let sum = 0;
  for (let i = 0; i < 300000; i++) { const made = new ZeroArray(8); sum += made.length + made[3]!; }
  expect(sum).toBe(2400000);
  expect(new ZeroArray(4) instanceof ZeroArray).toBe(true);
});`,
};

async function run(cwd: string, cmd: string[]) {
  await using ran = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([ran.stdout.text(), ran.stderr.text(), ran.exited]);
  return { stdout, stderr: exitCode ? stderr : "", exitCode, signal: ran.signalCode };
}

test.concurrent.each(["typed.ts", "untyped.js"])(
  "%s answers under bun run --aot and --debug-aot as under plain Bun",
  async name => {
    using dir = tempDir("aot-array-constructor-inlined", files);
    const plain = await run(String(dir), [bunExe(), "run", name]);
    expect(plain).toEqual({ stdout: "2400000\n", stderr: "", exitCode: 0, signal: null });
    for (const flag of ["--aot", "--debug-aot"])
      expect({ flag, ...(await run(String(dir), [bunExe(), "run", flag, name])) }).toEqual({ flag, ...plain });
  },
  120_000,
);

test.each(["--aot", "--debug-aot"])(
  "and in a test file under bun test %s",
  async flag => {
    using dir = tempDir("aot-array-constructor-inlined", files);
    expect(await run(String(dir), [bunExe(), "test", flag, "./in-a.test.ts"])).toMatchObject({
      stderr: "",
      exitCode: 0,
      signal: null,
    });
  },
  120_000,
);
