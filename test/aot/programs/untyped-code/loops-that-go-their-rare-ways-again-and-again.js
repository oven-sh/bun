// A loop whose usual way is compiled apart goes a way the compiler took for rare: on some turns, on every turn, from some turn on. It answers as if there were one loop.
function sum(a) { let t = 0; for (let i = 0; i < a.length; i++) t += a[i]; return t; }
function sumOfQuotients(a) { let t = 0; for (let i = 0; i < a.length; i++) { const x = a[i]; t += x / 4; } return t; }
function sumOfFloors(a) { let t = 0; for (let i = 0; i < a.length; i++) { const x = a[i]; t += Math.floor(x / 7); } return t; }
function sumOfRoots(a) { let t = 0; for (let i = 0; i < a.length; i++) t += Math.sqrt(a[i]); return t; }
function greatest(a) { let t = -Infinity; for (let i = 0; i < a.length; i++) t = Math.max(t, a[i]); return t; }
function twoSums(a) { let t = 0, u = 0; for (let i = 0; i < a.length; i++) { const x = a[i]; t += x * 3; u += x - 1; } return t + " " + u; }
function product(a) { let t = 1; for (let i = 0; i < a.length; i++) t *= a[i]; return t; }
function fill(a, from) { let t = from; for (let i = 0; i < a.length; i++) { t += 1; a[i] = t; } return a.join(); }
function fillBeyond(a, n) { for (let i = 0; i < n; i++) a[i] = i * 0.5; return a.length + ":" + a.join(); }
function kinds(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    switch (text.charCodeAt(i)) {
      case 97: n += 1; break; case 98: n += 2; break; case 99: n += 3; break; case 100: n += 5; break; case 101: n += 7; break; case 102: n += 11; break;
      case 103: n += 13; break; case 104: n += 17; break; case 105: n += 19; break; case 106: n += 23; break; case 107: n += 29; break; default: n -= 1;
    }
  }
  return n;
}
function untilNegative(a) { let t = 0; for (let i = 0; i < a.length; i++) { const x = a[i]; if (x < 0) break; if (x > 100) continue; t += x; } return t; }
function shortens(a) { let t = 0; for (let i = 0; i < a.length; i++) { const x = a[i]; if (x === 0.5) a.length = i + 2; t += x; } return t + " " + a.length; }
function changesKind(a) { let t = 0; for (let i = 0; i < a.length; i++) { const x = a[i]; if (x === 3) a[i + 1] = "s"; t += x; } return t; }

const integers = [], halves = [], mixed = [], everyOther = [], late = [];
for (let i = 0; i < 40; i++) { integers.push(i * 7919 % 1000); halves.push(i * 0.5 + 0.25); mixed.push(i % 3 ? i : i + 0.5); everyOther.push(i & 1 ? i : i * 1.5 + 0.25); late.push(i < 30 ? i : i + 0.125); }
const large = [2147483000, 600, 47, 1, -5, 2147483647, 2147483647, -2147483648, -2147483648, -2147483648, 1.5, -0];
const holes = [1, 2, , 4, , 6.5];
console.log(sum(integers), sum(halves), sum(mixed), sum(everyOther), sum(late), sum(large), sum(holes), sum([]), sum([-0]), Object.is(sum([-0, -0]), 0));
console.log(sumOfQuotients(integers), sumOfQuotients(halves), sumOfQuotients(mixed), sumOfQuotients(late), sumOfQuotients(large), sumOfQuotients(holes));
console.log(sumOfFloors(integers), sumOfFloors(halves), sumOfFloors(mixed), sumOfFloors(everyOther), sumOfFloors(large), sumOfFloors(holes));
console.log(sumOfRoots(integers), sumOfRoots(halves), sumOfRoots(late), sumOfRoots([4, 9, -1, 16]));
console.log(greatest(integers), greatest(halves), greatest(mixed), greatest(large), greatest(holes), greatest([]), Object.is(greatest([-0, 0]), 0), Object.is(greatest([-0]), -0));
console.log(twoSums(integers), twoSums(halves), twoSums(everyOther), twoSums(large), twoSums(holes));
console.log(product([1, 2, 3, 4]), product([65536, 65536, 2]), product([3, 0.5, 4]), product([-1, 0]), Object.is(product([-1, 0]), -0), product(large));
console.log(fill([0, 0, 0], 5), fill([0.5, 0.5, 0.5], 5), fill(["a", "b", "c"], 5), fill([0, 0, 0], 2147483645), fill([0.5, 1.5], 0.25), fill([, , 1], 1));
console.log(fillBeyond([], 5), fillBeyond([9, 9], 4), fillBeyond(["x"], 3), fillBeyond([1.5], 0));
console.log(kinds("abcdefghijk"), kinds("kkkkkkkkkk"), kinds("zzzz"), kinds("akzbjyci"), kinds(""), kinds("aሴk"));
console.log(untilNegative([1, 2, 300, 4, -1, 5]), untilNegative([1.5, 200.5, 2.5]), untilNegative([101, 102, 103]), untilNegative(integers));
console.log(shortens([1, 2, 0.5, 4, 5, 6]), shortens([1, 2, 3]), shortens([0.5]), changesKind([1, 2, 3, 4, 5]), changesKind([1.5, 3, 2]), changesKind([3]));

// Longer than a loop goes without asking whether it is to stop.
function longSum(n, step) { let t = 0; for (let i = 0; i < n; i++) t += step; return t; }
function longWalk(a, n) { let t = 0; for (let i = 0; i < n; i++) t += a[i & 7]; return t; }
console.log(longSum(200000, 1), longSum(200000, 0.5), longSum(70000, 40000), longWalk([1, 2, 3, 4, 5, 6, 7, 8], 200000), longWalk([1, 2.5, 3, 4.5, 5, 6.5, 7, 8.5], 200000), longWalk([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], 140000));
