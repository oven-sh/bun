// outer.ts says `export * as inner from`. Its importers read inner by name, by a computed name, through a namespace of the namespace, and through a pattern.
import * as outer from "./outer";
import { inner, renamedInner } from "./outer";

console.log(outer.inner.byTwoMembers());
console.log(inner.byNamedImport());
console.log((outer.inner as any)["by" + "Computed"]());
console.log((outer as any)["in" + "ner"].byComputedOuter());
const { inner: { byPattern } } = outer;
console.log(byPattern());
console.log(renamedInner.deepest.threeDown());
console.log(Object.keys(outer.renamedInner.deepest).join());
