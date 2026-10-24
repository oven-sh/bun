function one() { return 1; }
function text(a) { return "t" + a; }
function flag(a) { return !a; }
function either(f) { if (f) return 1; return "s"; }
function fallsOff(f) { if (f) return 1; }
function bare(f) { if (f) return; return 2; }
function throwsOrNumber(f) { if (f) throw new Error("thrown"); return 3; }
function handsOn(a) { return a; }
function recursive(n) { return n <= 0 ? 0 : 1 + recursive(n - 1); }
function even(n) { return n === 0 ? true : odd(n - 1); }
function odd(n) { return n === 0 ? false : even(n - 1); }
function finallyWins() { try { return 1; } finally { return "finally"; } }
function throughFinally() { try { return 1; } finally { one(); } }
function made() { return 5; }
async function later() { return 1; }
function* steps() { yield 1; return 2; }
const arrow = a => a * a;
const expression = function (a) { return typeof a; };
let reassigned = () => 1;
reassigned = () => "s";
function overwritten() { return 1; }
overwritten = function () { return "overwritten"; };
var hoisted = function () { return 1; };
const object = { method() { return 1; }, get got() { return "got"; } };
class C { method() { return 1.5; } static make() { return "made"; } get got() { return true; } }
function shadows(one) { const v = one(); return v; }
function inner() { function one() { return "inner"; } const v = one(); return v; }
export function run() {
  const a = one(), b = text(1), c = flag(0), d = either(true), e = either(false), f = fallsOff(false), g = bare(true), h = handsOn("x"), i = recursive(3), j = even(4);
  let k; try { k = throwsOrNumber(true); } catch (error) { k = error.message; }
  const l = finallyWins(), m = throughFinally(), n = new made(), o = later(), p = steps(), q = arrow(4), r = arrow(4n), s = expression(1), t = reassigned(), u = overwritten(), v = hoisted();
  const w = object.method(), x = object.got, y = new C().method(), z = C.make();
  const sum = a + i + q, joined = b + s, both = c && j;
  return [a, b, c, d, e, f, g, h, i, j, k, l, m, typeof n, typeof o, typeof p, q, r, s, t, u, v, w, x, y, z, new C().got, shadows(() => "shadow"), inner(), sum, joined, both].map(it => typeof it + String(it)).join();
}
