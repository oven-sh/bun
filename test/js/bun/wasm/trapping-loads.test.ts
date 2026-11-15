import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// (memory 1 1)
// (func (export "f") (param i32) (result i32) local.get 0  i32.load  i32.const 255  i32.and)
// (func (export "g") (param i32) (result i32) local.get 0  i64.load  i64.const 256  i64.and  i64.eqz  if (result i32) i32.const 1 else i32.const 2 end)
const source = `
const section = (id, ...body) => [id, body.length, ...body];
const f = [0, 0x20, 0, 0x28, 0, 0, 0x41, 0xff, 1, 0x71, 0x0b];
const g = [0, 0x20, 0, 0x29, 0, 0, 0x42, 0x80, 2, 0x83, 0x50, 4, 0x7f, 0x41, 1, 5, 0x41, 2, 0x0b, 0x0b];
const bytes = new Uint8Array([
  0, 0x61, 0x73, 0x6d, 1, 0, 0, 0,
  ...section(1, 1, 0x60, 1, 0x7f, 1, 0x7f),
  ...section(3, 2, 0, 0),
  ...section(5, 1, 1, 1, 1),
  ...section(7, 2, 1, 102, 0, 0, 1, 103, 0, 1),
  ...section(10, 2, f.length, ...f, g.length, ...g),
]);
const e = new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports;
const attempt = (f, p) => { try { return f(p); } catch (error) { return error.constructor.name; } };
const seen = new Set();
for (let i = 0; i < 20000; i++) {
  e.f(i & 0xfff);
  e.g(i & 0xfff);
  if (i % 100 === 0) seen.add([attempt(e.f, 65534), attempt(e.f, 65532), attempt(e.g, 65530), attempt(e.g, 65528)].join());
}
console.log([...seen].join(" | "));
`;

test("a load that crosses the end of the memory traps in every tier", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", source],
    env: {
      ...bunEnv,
      BUN_JSC_thresholdForOMGOptimizeAfterWarmUp: "100",
      BUN_JSC_thresholdForBBQOptimizeAfterWarmUp: "10",
    },
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr }).toEqual({ stdout: "RuntimeError,0,RuntimeError,1", stderr: "" });
  expect(exitCode).toBe(0);
});
