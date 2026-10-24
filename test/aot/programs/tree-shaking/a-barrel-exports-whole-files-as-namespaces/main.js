// The barrel of a pure package says `export * as name from` five times, and once hands on a namespace import with a clause of its own. One namespace is read by a name, one by a computed name, one is listed, one is passed on, one nobody asks for.
import { byName, byComputedName, listed, passedOn, viaClause } from "namespaces";

console.log(byName.wanted());
console.log(byComputedName["wan" + "ted"]());
console.log(Object.keys(listed).join());
console.log((object => object.wanted())(passedOn));
console.log(viaClause.wanted());
