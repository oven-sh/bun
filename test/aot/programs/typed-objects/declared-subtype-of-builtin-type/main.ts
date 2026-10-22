// A declaration file declares a subtype of `Map` that the compiler's table of built-ins does not list. A value of type `Map` may then be one of those, so the type alone is no proof of the class: the build counts `Map` and no other type, and the program behaves as in plain Bun.
// STATISTIC: BuiltinTypesDegradedToViews = 1
import type { Registry } from "./registry";

function total(counts: Map<string, number>): number {
  let sum = 0;
  for (const count of counts.values()) sum += count;
  return sum;
}
function size(names: Set<string>): number {
  return names.size;
}
const registry = Object.assign(new Map([["a", 1], ["b", 2]]), { label: "numbers" }) as Registry;
console.log(total(registry), registry.label, registry instanceof Map);
console.log(total(new Map([["c", 3]])), size(new Set(["a", "b", "a"])));
