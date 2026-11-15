import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// (func (param i32) (local v128)
//   local.get 0
//   local.get 0  v128.load  local.tee 1  local.get 1
//   local.get 0  v128.load offset=16
//   i32x4.relaxed_dot_i8x16_i7x16_add_s  v128.store offset=32)
const source = `
const section = (id, ...body) => [id, body.length, ...body];
const code = [1, 1, 0x7b, 0x20, 0, 0x20, 0, 0xfd, 0, 4, 0, 0x22, 1, 0x20, 1, 0x20, 0, 0xfd, 0, 4, 16, 0xfd, 0x93, 0x02, 0xfd, 11, 4, 32, 0x0b];
const bytes = new Uint8Array([
  0, 0x61, 0x73, 0x6d, 1, 0, 0, 0,
  ...section(1, 1, 0x60, 1, 0x7f, 0),
  ...section(3, 1, 0),
  ...section(5, 1, 0, 1),
  ...section(7, 2, 1, 102, 0, 0, 1, 109, 2, 0),
  ...section(10, 1, code.length, ...code),
]);
const { f, m } = new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports;
const factors = new Int8Array(m.buffer, 0, 16);
const sums = new Int32Array(m.buffer, 32, 4);
for (let i = 0; i < 16; i++) factors[i] = i * 3 + 1;
new Int32Array(m.buffer, 16, 4).set([1000, 2000, 3000, 4000]);
const seen = new Set();
for (let i = 0; i < 20000; i++) {
  f(0);
  seen.add(sums.join());
}
console.log([...seen].join(" | "));
`;

test("the relaxed dot product of a value with itself, in every tier", async () => {
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
  const squares = [0, 1, 2, 3].map(lane =>
    [0, 1, 2, 3].reduce((sum, i) => sum + ((lane * 4 + i) * 3 + 1) ** 2, (lane + 1) * 1000),
  );
  expect({ stdout: stdout.trim(), stderr }).toEqual({ stdout: squares.join(), stderr: "" });
  expect(exitCode).toBe(0);
});
