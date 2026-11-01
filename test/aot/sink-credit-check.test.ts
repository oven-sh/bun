// The inliner credits a call with the allocations that are built for it alone. It asks twice: a quick look, and the escape analysis; a build that verifies each pass stops where the two differ.
// `seen.push([a])` in one loop and `show(kept)` for each of `seen` in the next: what the call takes out of a holder is whole whatever becomes of the call, so neither credits it.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { built, spawned } from "./harness/commands";
import { compileCommand } from "./harness/flags";
import { test } from "./supported";

// As a fuzzer wrote it, less two functions: shorter cuts build without the cure.
const source = `let everythingPrinted = "";
function shownInTheText(value) { return (typeof value === "object" && value !== null) || typeof value === "function" || typeof value === "symbol" ? typeof value : String(value); }
function printValue(...values) { for (const value of values) everythingPrinted += shownInTheText(value) + " "; everythingPrinted += "\\n"; }
{
    let told = "";
    function show(value) { return typeof value === "object" && value !== null ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value); }
    function num(value) { return Object.is(value, -0) ? "-0" : String(value); }
    const first = { k: 1 };
    const second = { k: 2 };
    const third = { k: 3 };
    function orStart1_3(value) { return value === undefined ? 7 : value; }
    function* turns1_3(given, p, q, r) {
        let out = "";
        const seen = [];
        const values = [0.5, 2, -0];
        let a = given;
        let turn = 0;
        do {
            a = a !== values[0] ? values[0] : values[1];
            seen.push([a]);
            yield turn;
        } while (++turn < 20);
        for (const kept of seen) out += (typeof kept === "function" ? show(kept()) : show(kept)) + ",";
        return out + a;
    }
    const steps1_3 = turns1_3(7, 0.5, 2, -0);
    let result1_3 = steps1_3.next();
    for (let more = 0; more < 300 && !result1_3.done; more++) result1_3 = steps1_3.next(result1_3.value);
    told += result1_3.value + "|";
    printValue("variables from turn to turn 1", told);
}
console.log(everythingPrinted);
export {};
import { stat as statOfNodeFs } from "node:fs";
statOfNodeFs(".", () => {});
`;

test("an array that is stored in a list and read out of it again is credited to no call", async () => {
  using dir = tempDir("aot-sink-credit-check", { "program.js": source });
  const folder = String(dir);
  built(await spawned([bunExe(), ...compileCommand, "--aot-check=verify-each-pass", "program.js", "--outfile", "program"], folder, bunEnv)); // prettier-ignore
  const ran = await spawned(["./program"], folder, bunEnv);
  expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({
    stdout:
      "variables from turn to turn 1 [0.5],[2],[0.5],[2],[0.5],[2],[0.5],[2],[0.5],[2],[0.5],[2],[0.5],[2],[0.5],[2],[0.5],[2],[0.5],[2],2| \n\n",
    exitCode: 0,
  });
}, 120_000);
