// The namespace object leaves the file that imports it: as an argument, in a spread, in an array, in a property, as a default value, through a return, a closure, a global and Object.assign. Whoever gets it calls an export that nothing names.
import * as a from "./a";
import * as b from "./b";
import * as c from "./c";
import * as d from "./d";
import * as e from "./e";
import * as f from "./f";
import * as g from "./g";
import * as h from "./h";
import * as i from "./i";
import { call } from "./call";

console.log(call(a));
console.log(call({ ...b }));
console.log(call([c][0]));
console.log(call({ held: d }.held));
function withDefault(lib: object = e) { return call(lib); }
console.log(withDefault());
function returned() { return f; }
console.log(call(returned()));
const closure = () => g;
console.log(call(closure()));
(globalThis as any).heldByGlobal = h;
console.log(call((globalThis as any).heldByGlobal));
console.log(call(Object.assign({}, i)));
