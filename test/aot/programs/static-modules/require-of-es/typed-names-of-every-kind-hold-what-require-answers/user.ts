import equals = require("./m.ts");
type M = { f: typeof import("./m.ts").f };
export const exported: M = require("./m.ts");
function outer() {
  const inner: M = require("./m.ts");
  return () => inner.f();
}
export const viaClosure = outer();
var held: M = require("./m.ts");
export function viaVar() {
  return held.f();
}
let changing: typeof import("./m.ts") = require("./m.ts");
export function viaLet() {
  return changing.f();
}
const old: { g(): number } = require("./c.cjs");
export function viaCommonJs() {
  return old.g();
}
export function viaEquals() {
  return equals.f();
}
class Keeps {
  static kept: M = require("./m.ts");
  own: M = require("./m.ts");
}
export function viaClass() {
  return Keeps.kept.f() + new Keeps().own.f();
}
const { f: taken }: M = require("./m.ts");
export function viaPattern() {
  return taken();
}
