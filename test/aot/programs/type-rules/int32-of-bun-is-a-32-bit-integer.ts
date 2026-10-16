// `int32` as the module "bun" declares it is a 32-bit integer, under whatever name it is imported or aliased: what is no such number throws where it enters. The name alone says nothing: see an-alias-called-int32-is-a-number.
import type { int32 } from "bun";
import type { int32 as Whole } from "bun";
type Count = int32;
type Inline = import("bun").int32;
function attempt(label: string, run: () => unknown): void { try { console.log(label, run()); } catch (error) { console.log(label, (error as Error).constructor.name); } }
const given: number[] = JSON.parse("[3, 1.5, 4294967296, -2147483648, 2147483647, -2147483649]");
function half(n: int32): number { return n / 2; }
function whole(n: Whole): number { return n + 1; }
function counted(n: Count): number { return n * 2; }
function inline(n: Inline): number { return n - 1; }
function yielded(n: number): int32 { return n; }
class Cursor { line: int32 = 0; move(by: number): int32 { this.line = by; return this.line; } }
for (const n of given) {
  attempt("a parameter " + n, () => half(n));
  attempt("under another name " + n, () => whole(n));
  attempt("through an alias " + n, () => counted(n));
  attempt("by an import type " + n, () => inline(n));
  attempt("a result " + n, () => yielded(n));
  attempt("a field " + n, () => new Cursor().move(n));
  attempt("a variable " + n, () => { const kept: int32 = n; return kept; });
}
