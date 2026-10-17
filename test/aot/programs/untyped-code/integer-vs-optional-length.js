// `i < a.length`, all four orderings, either way round: a counter, which is kept as an integer, against what is an integer or `undefined`: compared as integers; against `undefined` nothing holds.
function below(a) { let n = 0; for (let i = 0; i < a.length; i++) n++; return n; }
function upTo(a) { let n = 0; for (let i = 0; i <= a.length; i++) n++; return n; }
function above(a) { let n = 0; for (let i = 0; a.length > i; i++) n++; return n; }
function from(a) { let n = 0; for (let i = 0; a.length >= i; i++) n++; return n; }
function downTo(a) { let n = 0; for (let i = 7; i > a.length; i--) n++; return n; }
function downThrough(a) { let n = 0; for (let i = 7; i >= a.length; i--) n++; return n; }
function downToTurnedRound(a) { let n = 0; for (let i = 7; a.length < i; i--) n++; return n; }
function downThroughTurnedRound(a) { let n = 0; for (let i = 7; a.length <= i; i--) n++; return n; }
function fromBelowZero(a) { let n = 0; for (let i = -3; i < a.length; i++) n++; return n; }
function sum(a) { let t = 0; for (let i = 0; i < a.length; i++) t += a[i]; return t; }
function sumWhileItGrows(a) { let t = 0; for (let i = 0; i < a.length; i++) { t += a[i]; if (a.length < 9) a.push(i); } return t; }
function sumWhileItShrinks(a) { let t = 0; for (let i = 0; i < a.length; i++) { t += a[i]; a.length = a.length - 1; } return t; }
console.log("below", below([]), below([4]), below([4, 5, 6]), below([1, 2, 3, 4, 5, 6, 7]), below([1, 2, 3, 4, 5, 6, 7, 8, 9]));
console.log("upTo", upTo([]), upTo([4]), upTo([4, 5, 6]), upTo([1, 2, 3, 4, 5, 6, 7]), upTo([1, 2, 3, 4, 5, 6, 7, 8, 9]));
console.log("above", above([]), above([4]), above([4, 5, 6]), above([1, 2, 3, 4, 5, 6, 7]), above([1, 2, 3, 4, 5, 6, 7, 8, 9]));
console.log("from", from([]), from([4]), from([4, 5, 6]), from([1, 2, 3, 4, 5, 6, 7]), from([1, 2, 3, 4, 5, 6, 7, 8, 9]));
console.log("downTo", downTo([]), downTo([4]), downTo([4, 5, 6]), downTo([1, 2, 3, 4, 5, 6, 7]), downTo([1, 2, 3, 4, 5, 6, 7, 8, 9]));
console.log("downThrough", downThrough([]), downThrough([4]), downThrough([4, 5, 6]), downThrough([1, 2, 3, 4, 5, 6, 7]), downThrough([1, 2, 3, 4, 5, 6, 7, 8, 9]));
console.log("downToTurnedRound", downToTurnedRound([]), downToTurnedRound([4]), downToTurnedRound([4, 5, 6]), downToTurnedRound([1, 2, 3, 4, 5, 6, 7]), downToTurnedRound([1, 2, 3, 4, 5, 6, 7, 8, 9]));
console.log("downThroughTurnedRound", downThroughTurnedRound([]), downThroughTurnedRound([4]), downThroughTurnedRound([4, 5, 6]), downThroughTurnedRound([1, 2, 3, 4, 5, 6, 7]), downThroughTurnedRound([1, 2, 3, 4, 5, 6, 7, 8, 9]));
console.log("fromBelowZero", fromBelowZero([]), fromBelowZero([4]), fromBelowZero([4, 5, 6]), fromBelowZero([1, 2, 3, 4, 5, 6, 7]));
console.log("sum", sum([]), sum([4]), sum([4, 5, 6]), sum([1.5, 2.5]), sum([1, 2, 3, 4, 5, 6, 7, 8, 9]));
console.log(sumWhileItGrows([1, 2, 3]), sumWhileItGrows([]), sumWhileItShrinks([1, 2, 3, 4, 5]), sumWhileItShrinks([1]));

// The length of nothing is `undefined`.
let never = 0;
function orderings(a, i) {
  try { if (never > 0) throw never; } catch { return ""; }
  return "" + +(i < a?.length) + +(i <= a?.length) + +(i > a?.length) + +(i >= a?.length) + +(a?.length < i) + +(a?.length <= i) + +(a?.length > i) + +(a?.length >= i);
}
function turns(a) {
  try { if (never > 0) throw never; } catch { return -1; }
  let n = 0;
  for (let i = 0; i < a?.length; i++) n++;
  for (let i = 0; i <= a?.length; i++) n += 10;
  for (let i = 3; i > a?.length; i--) n += 100;
  for (let i = 3; i >= a?.length; i--) n += 1000;
  for (let i = 0; !(i < a?.length) && i < 2; i++) n += 10000;
  return n;
}
if (console.log.length > 50) never = 1;
for (let i = -2; i < 5; i++)
  console.log(i, orderings(undefined, i), orderings([], i), orderings([1], i), orderings([1, 2, 3], i), orderings(undefined, i));
console.log(turns(undefined), turns([]), turns([1]), turns([1, 2, 3]), turns(undefined), turns([1, 2]));

// Beyond the end of a text there is no code point.
function againstCodePoints(text, i) {
  try { if (never > 0) throw never; } catch { return ""; }
  let answers = "";
  for (let k = 0; k < 4; k++) {
    const c = String(text).codePointAt(k);
    answers += " " + (i < c ? 1 : 0) + (i <= c ? 1 : 0) + (i > c ? 1 : 0) + (i >= c ? 1 : 0) + (c < i ? 1 : 0) + (c <= i ? 1 : 0) + (c > i ? 1 : 0) + (c >= i ? 1 : 0);
  }
  return answers;
}
console.log(againstCodePoints("ab", 97), againstCodePoints("", 97), againstCodePoints("b\u{1F600}", 98), againstCodePoints("abcd", 1114112), againstCodePoints("a", -1), againstCodePoints("\0", 0));

// Doubles are compared nowhere.
// CALLS- below uses[^;]*fcmp
// CALLS- upTo uses[^;]*fcmp
// CALLS- above uses[^;]*fcmp
// CALLS- from uses[^;]*fcmp
// CALLS- downTo uses[^;]*fcmp
// CALLS- downThrough uses[^;]*fcmp
// CALLS- downToTurnedRound uses[^;]*fcmp
// CALLS- downThroughTurnedRound uses[^;]*fcmp
// CALLS- fromBelowZero uses[^;]*fcmp
// CALLS- againstCodePoints uses[^;]*fcmp
