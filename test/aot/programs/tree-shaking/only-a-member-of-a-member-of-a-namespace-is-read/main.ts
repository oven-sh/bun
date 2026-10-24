// The one use of each file is a chain of plain members: outer.inner.target(), a named import of the inner namespace, three levels, and a namespace that a file exports with a clause of its own.
import * as outer from "./outer";
import { second } from "./outer";

console.log(outer.first.target());
console.log(second.target());
console.log(outer.third.deeper.target());
console.log(outer.fourth.target());
