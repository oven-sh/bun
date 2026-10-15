(function () {
function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function comparesWithInt32(x) { return x < 10 ? "less" : "not less"; }
function comparesInLoop(list) { let n = 0; for (let i = 0; i < list.length; ++i) { if (list[i] >= 3) ++n; } return n; }
function testsObjectOrString(which) { let o = which === 0 ? { a: 1 } : which === 1 ? "" : which === 2 ? "text" : undefined; return o ? "yes" : "no"; }
function negates(x) { if (!(x > 2)) return "small"; return "large"; }
function straightLine(a, b) { return (a | 0) + (b | 0); }
function onlyCalls(f) { return f(); }
function returnsConstant() { return 42; }

const values = [1, 10, 11, 2.5, 10.5, -0, NaN, "9", "10", "x", null, undefined, true, { valueOf() { return 3; } }, 5n, 50n];
check(values.map(comparesWithInt32).join(), "less,not less,not less,less,not less,less,not less,less,not less,not less,less,not less,less,less,less,not less", "compared with 10");
check(values.map(negates).join(), "small,large,large,large,large,small,small,large,large,small,small,small,small,large,large,large", "negated");
check(comparesInLoop([1, 2, 3, 4.5, "5", null, undefined, {}, 3n]), 4, "in a loop");
check([0, 1, 2, 3].map(testsObjectOrString).join(), "yes,no,yes,no", "truthiness");
check(straightLine(2, 3.7), 5, "no branches");
check(onlyCalls(() => 7), 7, "only a call");
check(returnsConstant(), 42, "a constant");
let thrown = "nothing";
try { comparesWithInt32(Symbol()); } catch (error) { thrown = error.constructor.name; }
check(thrown, "TypeError", "a symbol");
})();
console.log("passed");
