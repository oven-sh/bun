// The optimizing tier places a function's jump tables and floating-point constants after the function's code and addresses them relative to the
// instruction that wants them. On arm64 the shortest such instruction reaches 1 MB. Each function here has more code than that between the two.
import { describe, expect } from "bun:test";
import { rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned, unsupported } from "./harness/commands";
import { afterAll, test } from "./harness/default-timeout";

function unsigned(value: number): number[] {
  const bytes: number[] = [];
  do {
    const byte = value & 0x7f;
    value >>>= 7;
    bytes.push(value ? byte | 0x80 : byte);
  } while (value);
  return bytes;
}
function signed(value: number): number[] {
  const bytes: number[] = [];
  for (;;) {
    const byte = value & 0x7f;
    value >>= 7;
    const isLast = (value === 0 && !(byte & 0x40)) || (value === -1 && !!(byte & 0x40));
    bytes.push(isLast ? byte : byte | 0x80);
    if (isLast) return bytes;
  }
}
const section = (id: number, body: number[]) => [id, ...unsigned(body.length), ...body];
const name = (text: string) => [text.length, ...Buffer.from(text)];
const i32 = 0x7f;
const f64 = 0x7c;

// (func (export "farTable") (param $case i32) (param $address i32) (result i32) (local $x i32)): a br_table of ten cases sets $x, then `operations` stores that depend on one another.
function farTable(operations: number): number[] {
  const body = [1, 1, i32];
  for (let block = 0; block < 11; block++) body.push(0x02, 0x40);
  body.push(0x20, 0, 0x0e, 10, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10);
  for (let block = 0; block < 10; block++) body.push(0x0b, 0x41, ...signed(100 + block), 0x21, 2, 0x0c, 9 - block);
  body.push(0x0b);
  for (let k = 0; k < operations; k++)
    body.push(
      0x20,
      1,
      0x20,
      2,
      0x41,
      ...signed((k * 7919) % 1000003),
      0x6c,
      0x41,
      ...signed(k),
      0x73,
      0x22,
      2,
      0x36,
      2,
      ...unsigned((k % 4000) * 4),
    );
  body.push(0x20, 2, 0x0b);
  return [...unsigned(body.length), ...body];
}
// (func (export "farConstants") (param $x f64) (param $address i32) (result f64)): each step multiplies by a constant of its own.
function farConstants(operations: number): number[] {
  const body = [0];
  const constant = new Uint8Array(8);
  for (let k = 0; k < operations; k++) {
    new DataView(constant.buffer).setFloat64(0, k + 0.5, true);
    body.push(0x20, 1, 0x20, 0, 0x44, ...constant, 0xa2, 0x22, 0, 0x39, 3, ...unsigned((k % 2000) * 8));
  }
  body.push(0x20, 0, 0x0b);
  return [...unsigned(body.length), ...body];
}
const moduleOf = (operations: number) =>
  new Uint8Array([
    0x00,
    0x61,
    0x73,
    0x6d,
    1,
    0,
    0,
    0,
    ...section(1, [2, 0x60, 2, i32, i32, 1, i32, 0x60, 2, f64, i32, 1, f64]),
    ...section(3, [2, 0, 1]),
    ...section(5, [1, 0, 1]),
    ...section(7, [2, ...name("farTable"), 0, 0, ...name("farConstants"), 0, 1]),
    ...section(10, [2, ...farTable(operations), ...farConstants(operations)]),
  ]);

const entry = `
import path from "./module.wasm" with { type: "file" };
const e = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(await Bun.file(path).arrayBuffer()))).exports;
console.log("farTable", [0, 1, 5, 9, 10, -1].map(c => e.farTable(c, 0)).join());
console.log("farConstants", e.farConstants(1e-300, 0), e.farConstants(0, 8));
`;

// A debug or sanitizer build takes minutes for functions of this size.
describe.skipIf(!!unsupported || isDebug || isASAN)("compile/aot/wasm-large-function", () => {
  const folder = String(tempDir("aot-wasm-large-function", { "entry.js": entry }));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  test("tables and constants more than 1 MB from their use", async () => {
    await slot(async () => {
      writeFileSync(join(folder, "module.wasm"), moduleOf(120_000));
      const executable = join(folder, isWindows ? "compiled.exe" : "compiled");
      const build = await spawned(
        [bunExe(), "build", "--compile", "--aot", "--explain=statistics", "./entry.js", "--outfile", executable],
        folder,
        bunEnv,
      );
      built(build);
      expect(Number(/\bWasmOptimizedCopies\D+(\d+)/.exec(build.stderr + build.stdout)?.[1])).toBe(2);
      const plain = await spawned([bunExe(), "--no-install", "./entry.js"], folder, bunEnv);
      const compiled = await spawned([executable], folder, { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
      expect(compiled.stdout).toBe(plain.stdout);
      expect(compiled.stdout).toStartWith("farTable ");
      expect(compiled.exitCode).toBe(0);
    });
  }, 600_000);
});
