// `int32` as the module "bun" declares it is a 32-bit integer, under whatever name it is imported or aliased: the build stops at a value that it cannot prove to be one. The name alone says nothing: see int32-alias-is-number.
import type { int32 } from "bun";
import type { int32 as Whole } from "bun";
type Count = int32;
type Inline = import("bun").int32;
const given: number[] = JSON.parse("[3, 1.5]");
function half(n: int32): number { return n / 2; }
function whole(n: Whole): number { return n + 1; }
function counted(n: Count): number { return n * 2; }
function inline(n: Inline): number { return n - 1; }
function yielded(n: number): int32 { return n; }
class Cursor { line: int32 = 0; move(by: number): int32 { this.line = by; return this.line; } }
for (const n of given) {
  const kept: int32 = n;
  console.log(half(n), whole(n), counted(n), inline(n), yielded(n), new Cursor().move(n), kept);
}
