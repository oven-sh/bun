function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

(function () {
function small(a, b) { return a + b; }
function callsSmall(count) { let sum = 0; for (let i = 0; i < count; i++) sum += small(i, 1); return sum; }
function callsSmallAgain(count) { let sum = 0; for (let i = 0; i < count; i++) sum += small(i, 2); return sum; }
check(callsSmall(4), 10, "a small callee");
check(callsSmallAgain(4), 14, "a small callee, its second site");

function big(a, b, c) {
    let t = a * 2 + b; if (t > c) t -= c; else t += c; t = (t ^ a) + (b | c); if (t < 0) t = -t; t = t % 1000;
    t += (a & b) + (b & c) + (a | c) - (t >> 1); if (t > c) t -= c; else t += c; t = (t ^ a) + (b | c); if (t < 0) t = -t;
    return t % 1000 + (a & b) + (b & c) + (a | c) - (t >> 1);
}
function callsBig(count) { let sum = 0; for (let i = 0; i < count; i++) sum += big(i, 3, 5); return sum; }
function callsBigAgain(count) { let sum = 0; for (let i = 0; i < count; i++) sum += big(i, 4, 6); return sum; }
check(callsBig(3), big(0, 3, 5) + big(1, 3, 5) + big(2, 3, 5), "a big callee");
check(callsBigAgain(3), big(0, 4, 6) + big(1, 4, 6) + big(2, 4, 6), "a big callee, its second site");

function catches(a) { try { return a.length; } catch { return -1; } }
function callsCatches(count) { let sum = 0; for (let i = 0; i < count; i++) sum += catches(i ? "ab" : null); return sum; }
check(callsCatches(3), 3, "a callee that catches");

function readsArguments() { let all = arguments; return all[0] + all.length; }
function callsReadsArguments(count) { let sum = 0; for (let i = 0; i < count; i++) sum += readsArguments(i, i); return sum; }
check(callsReadsArguments(3), 9, "a callee that reads its arguments object");

function down(n) { return n ? down(n - 1) + 1 : 0; }
function callsDown(count) { let sum = 0; for (let i = 0; i < count; i++) sum += down(i); return sum; }
check(callsDown(4), 6, "a callee that calls itself");

function loops(n) { let sum = 0; for (let i = 0; i < n; i++) sum += i; return sum; }
function callsLoops(count) { let sum = 0; for (let i = 0; i < count; i++) sum += loops(i); return sum; }
function callsLoopsAgain(count) { let sum = 0; for (let i = 0; i < count; i++) sum += loops(i + 1); return sum; }
check(callsLoops(4), 4, "a callee with a loop, called in a loop");
check(callsLoopsAgain(3), 4, "a callee with a loop, called in a loop, its second site");
})();
console.log("passed");
