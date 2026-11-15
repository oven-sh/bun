// --aot-testing=WidenFlowNodes:<seed> gives some results of calls and reads anything, and --aot-check=FlowMonotonicity stops the build where the flow analysis then says more than it says of the unchanged program.
// An instance of Entry is converted to a primitive, so a lookup records Symbol.toPrimitive on Entry.prototype, which has escaped. The record sent the unknown into the pool of names that closures are searched for too:
// next() counted as unknown code's unless the instance was widened and the lookup never made.
import { describe, expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { slot, spawned, unsupported } from "./harness/commands";
import { test } from "./harness/default-timeout";
import { withoutDebugInformation } from "./harness/without-debug-information";

const env = { ...bunEnv, NO_COLOR: "1" };
const program = `function next(value: number): number { return value + 1; }
function show(value: any): string {
  return Reflect.ownKeys(value).map(key => String(key) + ":" + show(value[key as any])).join();
}
const table: any = Object.assign(Object.create(null), { name: 1 });
class Other {}
function fillOthers(count: number): any { const all: any = []; for (let i = 0; i < count; i++) all.push(new (Other as any)({ size: "text" })); return all; }
function Entry(this: any, given: any) {}
function fillEntries(count: number): any { const all: any = []; for (let i = 0; i < count; i++) all.push(new (Entry as any)(null)); return all; }
function plus(one: any, two: any): any {}
function work(one: any): any {
  let total: any = 0;
  const counts: any = {};
  for (const [each, held] of Object.entries(table)) total = plus(total, counts[each]);
}
try { console.log(show(fillOthers(1)), show(fillEntries(8)), show(work(new Proxy({ a: 1 }, { get: (from: any, key) => from[key] })))); } catch (error) { console.log(error instanceof TypeError); }
console.log(String(next).length > 9, next(2));
`;

describe.skipIf(!!unsupported)("the flow analysis given more inputs", () => {
  for (const seed of [8, 16, 17, 19, 24, 1073741824])
    test(`says no more under seed ${seed}`, () =>
      slot(async () => {
        using dir = tempDir("aot-flow-monotone", { "main.ts": program });
        const folder = String(dir);
        const built = await spawned(
          [
            bunExe(),
            "build",
            "--compile",
            "--aot",
            `--aot-testing=WidenFlowNodes:${seed}`,
            "--aot-check=FlowMonotonicity",
            ...withoutDebugInformation,
            "./main.ts",
            "--outfile",
            "main",
          ],
          folder,
          env,
        );
        expect({ stops: built.stderr.includes("FlowNotMonotonic"), exitCode: built.exitCode }).toEqual({
          stops: false,
          exitCode: 0,
        });
        const run = await spawned([join(folder, isWindows ? "main.exe" : "main")], folder, env);
        expect({ stdout: run.stdout, exitCode: run.exitCode }).toEqual({ stdout: "true\ntrue 3\n", exitCode: 0 });
      }));
});
