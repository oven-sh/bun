// A const enum leaves nothing at run time, and a branch on it is decided at build time. An ordinary enum of another file is an object, read by name, by a computed name and backwards.
import { Flag, Kind, describeKind } from "./enums";

function whenOn() { return "on"; }
function whenOff() { return "off"; }
function forCircle() { return "circle"; }
function forSquare() { return "square"; }

console.log(Flag.On ? whenOn() : whenOff());
console.log(Flag.Off ? whenOn() : whenOff());
const handlers = { [Kind.Circle]: forCircle, [Kind.Square]: forSquare };
console.log(handlers[Kind.Square](), handlers[Kind["Cir" + "cle" as "Circle"]]());
console.log(Kind[0], describeKind(Kind.Square));
