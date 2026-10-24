// A typed function is handed to text that becomes code at run time, and called from there: constants and a variable imported from another file, whose types are inferred.
import { open } from "./open";
import { origin, registry, limit } from "./constants";
function probe(i: number): number {
  return origin.x + registry.get("a")!.y + limit + i;
}
console.log(open(probe)(1));
