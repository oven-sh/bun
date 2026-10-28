// How much of a program the ahead-of-time compiler can type: what `bun check --aot` reports about it, in one line.
//
//   open      the named types (classes, interfaces, type aliases) that some property access has to check for first, because another kind
//             of object can be there. An object literal type has no name: when one opens, fewer accesses are typed
//   checks    the sites where a value is still tested against a written type when the program runs
//   accesses  of the program's property accesses, dependencies included: how many are a load or a store at a fixed offset
//
// A change to the compiler that turns a proof into a prediction, or takes a layout away, changes no output of any program. It shows here.
import { bunEnv, bunExe } from "harness";
import { dirname } from "path";
import { spawned } from "../run-programs";

export type Typedness = { line: string; types: string[] };

/** `types`: the named types that are open, sorted. */
export async function typednessOf(entryPoint: string): Promise<Typedness> {
  const result = await spawned([bunExe(), "check", "--aot", "--explain=json", "--explain=guards-json", entryPoint], dirname(entryPoint), bunEnv);
  if (result.signal) return { line: `signal ${result.signal}`, types: [] };
  const objects: Record<string, any>[] = result.stdout.split("\n").filter(line => line.startsWith("{")).map(line => JSON.parse(line));
  const summary = objects.find(object => "causes" in object);
  if (!summary) return { line: "is not compiled", types: [] };
  // "missed-optimization": the compiler has proven which objects come there and has not made a load of the access. It names their types, and no other kind of object can be there.
  const types = [...new Set(objects.filter(object => "rank" in object && object.reason !== "missed-optimization").flatMap(cause => cause.types as string[]))].sort();
  const checks = objects.filter(object => object.aot === "type-check").length;
  const counted = [summary.accesses, summary.dependencyAccesses];
  const [typed, all] = [counted.reduce((sum, each) => sum + each.free, 0), counted.reduce((sum, each) => sum + each.free + each.tested + each.byName, 0)];
  return { line: `${types.length} open, ${checks} checks, accesses ${typed} of ${all}`, types };
}
