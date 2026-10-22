// Counted loops with a second exit: a return, a break, a throw, a missing element. They run past 65,536 and 131,072 iterations, and the second exit is taken just before, at and just after
// each of those counts, on the first iteration, on the last one and never. The bound is a parameter, a constant length, a growing length, a shrinking length, and the largest 32-bit integer.
const lines = [];
function indexOf(list, wanted) { for (let i = 0; i < list.length; i++) { if (list[i] === wanted) return i; } return -1; }
function sumUntilNegative(list) { let sum = 0; for (let i = 0; i < list.length; ++i) { const v = list[i]; if (v < 0) break; sum = (sum + v) | 0; } return sum; }
function sumOfPresent(list) { let sum = 0; for (let i = 0; i < list.length; i++) { const v = list[i]; if (v === undefined) continue; sum += v; } return sum; }
function countDown(from, stop) { let turns = 0; for (let i = from; i >= 0; i--) { if (i === stop) return turns; turns++; } return -turns; }
function byThrees(limit, stop) { let last = -1; for (let i = 0; i <= limit; i += 3) { if (i === stop) return "stopped " + last; last = i; } return "ended " + last; }
function fill(list, limit) { for (let i = 0; i < list.length; i++) { if (list.length < limit) list.push(i & 7); if (list[i] === 9) break; } return list.length; }
function drain(list) { let sum = 0; for (let i = 0; i < list.length; i++) { sum += list[i]; if ((i & 1023) === 1023) list.length -= 100; } return sum + " " + list.length; }
function throwAt(limit, at) { let i = 0; try { for (; i < limit; i++) { if (i === at) throw new Error("at " + i); } } catch (error) { return error.message + ", " + i; } return "none, " + i; }
function dot(a, b) { let sum = 0; for (let i = 0; i < a.length; i++) { const x = b[i]; if (x === undefined) return "short " + sum; sum = (sum + a[i] * x) | 0; } return "whole " + sum; }
function upToLargest(from, stop) { let turns = 0; for (let i = from; i <= 2147483647; i++) { if (i === stop) return -turns; turns++; } return turns; }
function downToSmallest(from, stop) { let turns = 0; for (let i = from; i >= -2147483648; i--) { if (i === stop) return -turns; turns++; } return turns; }
function make(length) { const list = []; for (let i = 0; i < length; i++) list.push(i & 7); return list; }

const counts = [0, 1, 2, 65535, 65536, 65537, 131071, 131072, 131073, 200000];
for (const length of [0, 1, 65536, 65537, 131073, 200000]) {
  for (const at of counts) {
    const list = make(length);
    if (at < length) list[at] = -5;
    lines.push(`${length} ${at}: ${indexOf(list, -5)} ${sumUntilNegative(list)} ${countDown(length, at)} ${byThrees(length, at)} ${throwAt(length, at)}`);
    if (at < length) delete list[at];
    lines.push(`  ${sumOfPresent(list)} ${dot(make(length), list)} ${dot(list, make(at))}`);
  }
}
for (const limit of [0, 1, 65537, 140000]) lines.push(`fill ${limit}: ${fill([1], limit)} ${fill([9], limit)} ${fill([], limit)}`);
for (const length of [0, 1023, 1024, 70000, 140000]) lines.push(`drain ${length}: ${drain(make(length))}`);
for (const stop of [0, 2147483647, 2147483646, 2147483647 - 65536]) lines.push(`largest ${stop}: ${upToLargest(2147483647 - 70000, stop)} ${downToSmallest(70000 - 2147483648, -stop - 1)}`);
console.log(lines.join("\n"));
