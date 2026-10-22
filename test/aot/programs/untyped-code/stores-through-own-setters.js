// A store to a property that is the object's own accessor calls the setter. Once the run time has seen such a store for a kind of object it is not asked again, wherever the accessor lies: in the object, out of line, far out of line.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const visits = () => count("operationAOTPutByIdAndCache") + count("operationAOTGetByIdAndCache");
const makeSmall = seed => ({ kept: seed, get near() { return this.kept + 1; }, set near(v) { this.kept = v - 1; }, set only(v) { this.kept = v * 2; } });
const makeWide = seed => {
  const o = { kept: seed };
  for (let i = 0; i < 200; i++) Object.defineProperty(o, "w" + i, { get() { return this.kept + i; }, set(v) { this.kept = v - i; }, enumerable: true, configurable: true });
  return o;
};
function storeSmall(o, v) { o.near = v; const first = o.kept; o.only = v; return first * 3 + o.kept + o.near; }
function storeWide(o, v) { o.w0 = v; const first = o.kept; o.w20 = v; const second = o.kept; o.w150 = v; const third = o.kept; o.w199 = v; return first + second * 3 + third * 5 + o.kept * 7 + o.w150; }
const small = [makeSmall(1), makeSmall(2)];
const wide = [makeWide(3), makeWide(4)];
let sum = 0;
const mix = n => { sum = Math.imul(sum, 31) + (n | 0) | 0; };
const round = i => { for (const o of small) mix(storeSmall(o, i)); for (const o of wide) mix(storeWide(o, i)); };
round(1);
console.log("the first round:", sum, small[0].kept, wide[1].kept, wide[0].w199);
for (let i = 0; i < 30; i++) round(i);
const before = visits();
for (let i = 0; i < 300; i++) round(i);
console.log("300 rounds:", sum, "the run time is asked at most fifty times in 3600 stores:", typeof aotOperationCount !== "function" || visits() - before <= 50);
Object.defineProperty(wide[0], "w150", { set(v) { this.kept = -v; }, configurable: true });
Object.defineProperty(wide[1], "w20", { value: 5, writable: true, configurable: true });
Object.defineProperty(small[0], "near", { get() { return 9; }, configurable: true });
let refused = "";
try { round(7); } catch (error) { refused = error instanceof TypeError ? "a TypeError" : String(error); }
console.log("after changes:", sum, refused, small[0].kept, small[0].near);
mix(storeSmall(small[1], 8)); mix(storeWide(wide[0], 9)); mix(storeWide(wide[1], 10));
console.log("the others:", sum, wide[0].kept, wide[0].w150, wide[1].w20, wide[1].kept);
