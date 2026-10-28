// `return list.map(f)` is a tail call. Where everything about `list` is proven the call becomes a direct call of the library's own
// function. Where one thing is left to test (here: that nobody has put a `map` of his own on what `new Array(n)` made) the test has
// to be placed for the call too, not for the read of `map` alone: or the call stays a call of a value for ever.
// The list is offered to a function that nobody knows: without that the compiler proves that nobody has, and there is nothing to test.
// Inlined into its caller the call is no tail call, so the program is built without the inliner.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { withoutPass } from "./harness/flags";
import { describe, printIR, test, writesProgramInto } from "./harness/printed-ir";
import { built, spawned } from "./run-programs";

const program = `
  declare const console: { log(...values: unknown[]): void };
  function holes(n: number): number[] { const r: number[] = new Array(n); for (let i = 0; i < n; i++) r[i] = i; return r; }
  function doubled(list: number[]): number[] { return list.map((v) => v * 2); }
  const list = holes(50);
  const somebody: any = console;
  somebody.mayKeep?.(list);
  let sum = 0;
  for (let round = 0; round < 100; round++) sum += doubled(list)[round % 50];
  console.log(sum);
`;

describe("a tail call of a built-in that the library implements", () => {
  test("is among the uses of the test that its receiver needs", async () => {
    using dir = tempDir("aot-tail-calls-of-built-ins", { "main.ts": program });
    const folder = String(dir);
    const flags = [withoutPass("InlineCalls")];
    built(
      await spawned(
        [bunExe(), "build", "--compile", "--aot", ...flags, writesProgramInto(folder), "main.ts", "--outfile", "main"],
        folder,
        { ...bunEnv, NO_COLOR: "1" },
      ),
    );
    const dump = (await printIR(folder, { until: "PlaceTypeTests", functionName: "doubled", flags })).split("\n");
    const body = dump.slice(0, dump.indexOf("}"));
    expect(body.some(line => line.includes(" = IsPristine "))).toBe(true);
    expect(body.some(line => line.includes(" = CallDirect "))).toBe(true);
    const run = await spawned(["./main"], String(dir), bunEnv);
    expect(run.stdout.trim()).toBe("4900");
  }, 240_000);
});
