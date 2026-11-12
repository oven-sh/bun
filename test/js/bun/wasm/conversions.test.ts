import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// (func (export "f") (param i64) (result f32) local.get 0  f64.convert_i64_s  f32.demote_f64)
// (func (export "g") (param i64) (result f32) local.get 0  f32.convert_i64_s)
const source = `
const section = (id, ...body) => [id, body.length, ...body];
const f = [0, 0x20, 0, 0xb9, 0xb6, 0x0b];
const g = [0, 0x20, 0, 0xb4, 0x0b];
const bytes = new Uint8Array([
  0, 0x61, 0x73, 0x6d, 1, 0, 0, 0,
  ...section(1, 1, 0x60, 1, 0x7e, 1, 0x7d),
  ...section(3, 2, 0, 0),
  ...section(7, 2, 1, 102, 0, 0, 1, 103, 0, 1),
  ...section(10, 2, f.length, ...f, g.length, ...g),
]);
const e = new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports;
const integer = 0x1000001000000001n;
const seen = new Set();
for (let i = 0; i < 20000; i++) seen.add(e.f(integer) + "," + e.g(integer));
console.log([...seen].join(" | "));
`;

test("a float made of a 64-bit integer's double is the same in every tier", async () => {
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
  expect({ stdout: stdout.trim(), stderr }).toEqual({ stdout: "1152921504606847000,1152921642045800400", stderr: "" });
  expect(exitCode).toBe(0);
});
