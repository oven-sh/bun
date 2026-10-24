// `a >>> b` on operands of unknown type: a result from 2 ** 31 on is no int32.
function ushr(a, b) { return a >>> b; }
const values = [-1, 3, 4294967295, 2147483648, -2147483648, 1.5, "7", null, undefined, true];
const out = [];
for (const a of values) for (const b of [0, 1, 31, 32]) out.push(ushr(a, b));
console.log(out.join());
console.log((-1) >>> 0, [-1].map(x => x >>> 0)[0]);
