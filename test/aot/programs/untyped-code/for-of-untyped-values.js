// for-of over values of no type: arrays of every kind of storage, with holes, that grow, shrink, are emptied or are given other storage while the loop runs; what is no array: strings,
// sets, maps, generators, typed arrays, arguments objects, objects with an iterator of their own; breaks, continues and throws out of the loop.
const lines = [];
function sum(list) { let total = 0; for (const item of list) total += item === undefined ? 1000 : typeof item === "number" ? item : String(item).length; return total; }
function show(list) { const seen = []; for (const item of list) seen.push(item === undefined ? "hole" : String(item)); return seen.join(); }
function growing(list, most) { const seen = []; for (const item of list) { seen.push(item); if (list.length < most) list.push(item * 2); } return seen.join(); }
function shrinking(list) { const seen = []; for (const item of list) { seen.push(item); list.pop(); } return seen.join(); }
function emptied(list, at) { const seen = []; for (const item of list) { seen.push(item); if (item === at) list.length = 0; } return seen.join(); }
function shifted(list) { const seen = []; for (const item of list) { seen.push(item); if (seen.length < 3) list.shift(); } return seen.join(); }
function restored(list) { const seen = []; for (const item of list) { seen.push(String(item)); if (seen.length === 1) { list[1] = 1.5; list[2] = "text"; list[9] = 9; } } return seen.join(); }
function nested(outer) { let n = 0; for (const inner of outer) for (const item of inner) n += item; return n; }
function broken(list, at) { let n = 0; for (const item of list) { if (item === at) break; if (item % 2) continue; n += item; } return n; }
function thrown(list, at) { let n = 0; try { for (const item of list) { if (item === at) throw new Error("at " + item); n += item; } } catch (error) { return error.message + " after " + n; } return "none, " + n; }
function* generated(n) { for (let i = 0; i < n; i++) yield i * 3; }
function ofArguments() { return sum(arguments); }
const closable = { closed: 0, [Symbol.iterator]() { let i = 0; const self = this; return { next() { return { done: i >= 5, value: i++ }; }, return() { self.closed++; return {}; } }; } };
const holey = [1, , 3, , 5]; const doubles = [0.5, 1.5, 2.5]; const mixed = [1, "two", 3.5, null, undefined, { toString() { return "object"; } }];
for (let round = 0; round < 40; round++) { const all = [sum([1, 2, 3]), sum(doubles), sum(holey), sum(mixed), sum("text"), sum(new Set([1, 2, 2, 3])), sum(generated(4)), sum(new Uint8Array([7, 8])), ofArguments(4, 5, 6), sum([]), sum(closable)]; if (round === 39) lines.push("sums " + all.join()); }
lines.push("show " + show(holey) + " | " + show(mixed) + " | " + show(new Map([[1, 2]])) + " | " + show("añ😀b") + " | " + show(new Array(3)));
lines.push("growing " + growing([1], 6), "shrinking " + shrinking([1, 2, 3, 4, 5, 6]), "emptied " + emptied([1, 2, 3, 4], 2), "shifted " + shifted([1, 2, 3, 4, 5, 6, 7]), "restored " + restored([1, 2, 3]));
lines.push("nested " + nested([[1, 2], [], [3], new Set([4])]), "broken " + broken([2, 4, 5, 6, 7, 8], 7) + " " + broken(closable, 3) + " closed " + closable.closed, "thrown " + thrown([1, 2, 3, 4], 3) + " | " + thrown(closable, 2) + " closed " + closable.closed + " | " + thrown([1], 9));
class Listing extends Array {} const listing = Listing.from([1, 2, 3]); lines.push("a subclass " + sum(listing) + " " + show(listing));
const frozen = Object.freeze([1, 2, 3]); lines.push("frozen " + sum(frozen));
for (const bad of [undefined, null, 5, {}, () => 1]) { try { sum(bad); lines.push("no error"); } catch (error) { lines.push(error.constructor.name); } }
console.log(lines.join("\n"));
