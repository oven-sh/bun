(function () {
function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
let calls = 0;
let unknown = { count(x) { calls++; return x; } };

function clamp(x) {
    if (x > 1e9) x = 0;
    if (x < -1e9) x = 1;
    if (x === 771) x = 2;
    if (x === 772) x = 3;
    if (x === 773) x = 4;
    if (x === 774) x = 5;
    if (x === 775) x = 6;
    if (x === 776) x = 7;
    return unknown.count(x);
}
function callsClamp(x) {
    if (x > 2e9) x = 0;
    if (x < -2e9) x = 1;
    if (x === 871) x = 2;
    if (x === 872) x = 3;
    if (x === 873) x = 4;
    if (x === 874) x = 5;
    if (x === 875) x = 6;
    if (x === 876) x = 7;
    return x === -5 ? clamp(0) : clamp(x + 1);
}
check(callsClamp(1) + callsClamp(-5) + clamp(10), 12, "a chain of direct calls");
check(calls, 3, "the calls at the end of the chain");

function countsDown(n, x) {
    if (x > 1e9) x = 0;
    if (x < -1e9) x = 1;
    if (x === 771) x = 2;
    if (x === 772) x = 3;
    if (x === 773) x = 4;
    if (x === 774) x = 5;
    if (x === 775) x = 6;
    if (x === 776) x = 7;
    return n <= 0 ? x : x === -5 ? countsDown(n - 1, 0) : 1 + countsDown(n - 1, x);
}
check(countsDown(100, 0), 100, "a function that calls itself");

function isEven(n, x) {
    if (x > 1e9) x = 0;
    if (x < -1e9) x = 1;
    if (x === 771) x = 2;
    if (x === 772) x = 3;
    if (x === 773) x = 4;
    if (x === 774) x = 5;
    if (x === 775) x = 6;
    if (x === 776) x = 7;
    return n === 0 ? x : x === -5 ? isOdd(n - 1, 0) : 1 + isOdd(n - 1, x);
}
function isOdd(n, x) {
    if (x > 1e9) x = 0;
    if (x < -1e9) x = 1;
    if (x === 871) x = 2;
    if (x === 872) x = 3;
    if (x === 873) x = 4;
    if (x === 874) x = 5;
    if (x === 875) x = 6;
    if (x === 876) x = 7;
    return n === 0 ? -x : x === -5 ? isEven(n - 1, 0) : 1 + isEven(n - 1, x);
}
check(isEven(10, 0), 10, "two functions that call each other");
check(isOdd(3, 0), 3, "entered through the other one");

function first(n, x) {
    if (x > 1e9) x = 0;
    if (x < -1e9) x = 1;
    if (x === 771) x = 2;
    if (x === 772) x = 3;
    if (x === 773) x = 4;
    if (x === 774) x = 5;
    if (x === 775) x = 6;
    if (x === 776) x = 7;
    return x === -5 ? second(n, 0) : 1 + second(n, x);
}
function second(n, x) {
    if (x > 1e9) x = 0;
    if (x < -1e9) x = 1;
    if (x === 871) x = 2;
    if (x === 872) x = 3;
    if (x === 873) x = 4;
    if (x === 874) x = 5;
    if (x === 875) x = 6;
    if (x === 876) x = 7;
    return x === -5 ? third(n, 0) : 1 + third(n, x);
}
function third(n, x) {
    if (x > 1e9) x = 0;
    if (x < -1e9) x = 1;
    if (x === 971) x = 2;
    if (x === 972) x = 3;
    if (x === 973) x = 4;
    if (x === 974) x = 5;
    if (x === 975) x = 6;
    if (x === 976) x = 7;
    return n <= 0 ? x : x === -5 ? first(n - 1, 0) : 1 + first(n - 1, x);
}
check(first(5, 0), 17, "a cycle of three");
check(second(1, 0), 4, "entered in the middle");

function overflows(f, what) {
    for (let attempt = 0; attempt < 3; attempt++) {
        let thrown = null;
        try {
            f();
        } catch (error) {
            thrown = error;
        }
        check(thrown instanceof RangeError, true, what + " runs out of stack");
        check(callsClamp(attempt), attempt + 1, what + ": a call after the exception was caught");
    }
}
overflows(() => countsDown(Infinity, 0), "a function that calls itself");
overflows(() => isEven(-1, 0), "two functions that call each other");
overflows(() => isOdd(-1, 0), "the same two, entered through the other one");
overflows(() => first(Infinity, 0), "a cycle of three");
overflows(() => third(Infinity, 0), "a cycle of three, entered at its end");

function catchesDeepInside(n) {
    if (n > 1e9) n = 0;
    if (n === 771) n = 772;
    if (n === 773) n = 774;
    if (n === 775) n = 776;
    if (n === 777) n = 778;
    if (n === 779) n = 780;
    if (n === 781) n = 782;
    if (n === 783) n = 784;
    try {
        return n === -5 ? catchesDeepInside(0) : catchesDeepInside(n + 1);
    } catch (error) {
        if (!(error instanceof RangeError))
            throw error;
        return n;
    }
}
check(catchesDeepInside(0) > 100, true, "the exception is caught where the stack ran out");
check(catchesDeepInside(0) > 100, true, "and again");

function escapes(x) {
    if (x > 1e9) x = 0;
    if (x < -1e9) x = 1;
    if (x === 771) x = 2;
    if (x === 772) x = 3;
    if (x === 773) x = 4;
    if (x === 774) x = 5;
    if (x === 775) x = 6;
    if (x === 776) x = 7;
    return x === -5 ? clamp(0) : clamp(x + 2);
}
check([1, 2].map(escapes).join(), "3,4", "a function that is passed to a built-in");
check(escapes(3), 5, "and is also called directly");

function* generates(x) {
    yield x === -5 ? clamp(0) : clamp(x + 1);
    yield clamp(x + 2);
}
check([...generates(1), ...generates(5)].join(), "2,3,6,7", "a generator");
let settled = [];
async function waits(x) {
    settled.push(x === -5 ? clamp(0) : clamp(x + 1));
    await undefined;
    settled.push(clamp(x + 2));
}
waits(1);
waits(5);
drainMicrotasks();
check(settled.join(), "2,6,3,7", "an async function");

function Constructed(x) {
    if (x > 1e9) x = 0;
    if (x < -1e9) x = 1;
    if (x === 771) x = 2;
    if (x === 772) x = 3;
    if (x === 773) x = 4;
    if (x === 774) x = 5;
    if (x === 775) x = 6;
    if (x === 776) x = 7;
    this.x = x === -5 ? clamp(0) : clamp(x + 1);
}
check(new Constructed(1).x + new Constructed(2).x, 5, "a constructor");

function hasLargeFrame(a) {
    let v0 = a + 0, v1 = a + 1, v2 = a + 2, v3 = a + 3, v4 = a + 4, v5 = a + 5, v6 = a + 6, v7 = a + 7, v8 = a + 8, v9 = a + 9;
    let w0 = a - 0, w1 = a - 1, w2 = a - 2, w3 = a - 3, w4 = a - 4, w5 = a - 5, w6 = a - 6, w7 = a - 7, w8 = a - 8, w9 = a - 9;
    let x0 = a * 2, x1 = a * 3, x2 = a * 4, x3 = a * 5, x4 = a * 6, x5 = a * 7, x6 = a * 8, x7 = a * 9, x8 = a * 10, x9 = a * 11;
    let y0 = a / 2, y1 = a / 3, y2 = a / 4, y3 = a / 5, y4 = a / 6, y5 = a / 7, y6 = a / 8, y7 = a / 9, y8 = a / 10, y9 = a / 11;
    let z0 = a % 2, z1 = a % 3, z2 = a % 4, z3 = a % 5, z4 = a % 6, z5 = a % 7, z6 = a % 8, z7 = a % 9, z8 = a % 10, z9 = a % 11;
    let c = a === -5 ? clamp(0) : clamp(a);
    return [c, v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, w0, w1, w2, w3, w4, w5, w6, w7, w8, w9, x0, x1, x2, x3, x4, x5, x6, x7, x8, x9,
        y0, y1, y2, y3, y4, y5, y6, y7, y8, y9, z0, z1, z2, z3, z4, z5, z6, z7, z8, z9].length;
}
check(hasLargeFrame(unknown.count(2520)) + hasLargeFrame(unknown.count("a")), 102, "many values that live across a call");

function small(n) { return n > 0 ? small(n - 1) + 1 : 0; }
function takesInSmall(n) {
    let sum = 0;
    for (let i = 0; i < n; i++)
        sum += small(i);
    return sum;
}
check(takesInSmall(4) + takesInSmall(3), 9, "a function that calls itself, as part of its caller");
overflows(() => small(Infinity), "a small function that calls itself");

function link20(x) { if (x > 1e9) x = 0; if (x < -1e9) x = 1; if (x === 771) x = 2; if (x === 772) x = 3; if (x === 773) x = 4; if (x === 774) x = 5; if (x === 775) x = 6; if (x === 776) x = 7; return x === -5 ? clamp(0) : clamp(x + 1); }
function link19(x) { if (x > 1e9) x = 0; if (x < -1e9) x = 1; if (x === 771) x = 2; if (x === 772) x = 3; if (x === 773) x = 4; if (x === 774) x = 5; if (x === 775) x = 6; if (x === 776) x = 7; return x === -5 ? link20(0) : link20(x + 1); }
function link18(x) { if (x > 1e9) x = 0; if (x < -1e9) x = 1; if (x === 771) x = 2; if (x === 772) x = 3; if (x === 773) x = 4; if (x === 774) x = 5; if (x === 775) x = 6; if (x === 776) x = 7; return x === -5 ? link19(0) : link19(x + 1); }
function link17(x) { if (x > 1e9) x = 0; if (x < -1e9) x = 1; if (x === 771) x = 2; if (x === 772) x = 3; if (x === 773) x = 4; if (x === 774) x = 5; if (x === 775) x = 6; if (x === 776) x = 7; return x === -5 ? link18(0) : link18(x + 1); }
function link16(x) { if (x > 1e9) x = 0; if (x < -1e9) x = 1; if (x === 771) x = 2; if (x === 772) x = 3; if (x === 773) x = 4; if (x === 774) x = 5; if (x === 775) x = 6; if (x === 776) x = 7; return x === -5 ? link17(0) : link17(x + 1); }
function link15(x) { if (x > 1e9) x = 0; if (x < -1e9) x = 1; if (x === 771) x = 2; if (x === 772) x = 3; if (x === 773) x = 4; if (x === 774) x = 5; if (x === 775) x = 6; if (x === 776) x = 7; return x === -5 ? link16(0) : link16(x + 1); }
function link14(x) { if (x > 1e9) x = 0; if (x < -1e9) x = 1; if (x === 771) x = 2; if (x === 772) x = 3; if (x === 773) x = 4; if (x === 774) x = 5; if (x === 775) x = 6; if (x === 776) x = 7; return x === -5 ? link15(0) : link15(x + 1); }
function link13(x) { if (x > 1e9) x = 0; if (x < -1e9) x = 1; if (x === 771) x = 2; if (x === 772) x = 3; if (x === 773) x = 4; if (x === 774) x = 5; if (x === 775) x = 6; if (x === 776) x = 7; return x === -5 ? link14(0) : link14(x + 1); }
function link12(x) { if (x > 1e9) x = 0; if (x < -1e9) x = 1; if (x === 771) x = 2; if (x === 772) x = 3; if (x === 773) x = 4; if (x === 774) x = 5; if (x === 775) x = 6; if (x === 776) x = 7; return x === -5 ? link13(0) : link13(x + 1); }
function link11(x) { if (x > 1e9) x = 0; if (x < -1e9) x = 1; if (x === 771) x = 2; if (x === 772) x = 3; if (x === 773) x = 4; if (x === 774) x = 5; if (x === 775) x = 6; if (x === 776) x = 7; return x === -5 ? link12(0) : link12(x + 1); }
function link10(x) { if (x > 1e9) x = 0; if (x < -1e9) x = 1; if (x === 771) x = 2; if (x === 772) x = 3; if (x === 773) x = 4; if (x === 774) x = 5; if (x === 775) x = 6; if (x === 776) x = 7; return x === -5 ? link11(0) : link11(x + 1); }
function link9(x) { if (x > 1e9) x = 0; if (x < -1e9) x = 1; if (x === 771) x = 2; if (x === 772) x = 3; if (x === 773) x = 4; if (x === 774) x = 5; if (x === 775) x = 6; if (x === 776) x = 7; return x === -5 ? link10(0) : link10(x + 1); }
function link8(x) { if (x > 1e9) x = 0; if (x < -1e9) x = 1; if (x === 771) x = 2; if (x === 772) x = 3; if (x === 773) x = 4; if (x === 774) x = 5; if (x === 775) x = 6; if (x === 776) x = 7; return x === -5 ? link9(0) : link9(x + 1); }
function link7(x) { if (x > 1e9) x = 0; if (x < -1e9) x = 1; if (x === 771) x = 2; if (x === 772) x = 3; if (x === 773) x = 4; if (x === 774) x = 5; if (x === 775) x = 6; if (x === 776) x = 7; return x === -5 ? link8(0) : link8(x + 1); }
function link6(x) { if (x > 1e9) x = 0; if (x < -1e9) x = 1; if (x === 771) x = 2; if (x === 772) x = 3; if (x === 773) x = 4; if (x === 774) x = 5; if (x === 775) x = 6; if (x === 776) x = 7; return x === -5 ? link7(0) : link7(x + 1); }
function link5(x) { if (x > 1e9) x = 0; if (x < -1e9) x = 1; if (x === 771) x = 2; if (x === 772) x = 3; if (x === 773) x = 4; if (x === 774) x = 5; if (x === 775) x = 6; if (x === 776) x = 7; return x === -5 ? link6(0) : link6(x + 1); }
function link4(x) { if (x > 1e9) x = 0; if (x < -1e9) x = 1; if (x === 771) x = 2; if (x === 772) x = 3; if (x === 773) x = 4; if (x === 774) x = 5; if (x === 775) x = 6; if (x === 776) x = 7; return x === -5 ? link5(0) : link5(x + 1); }
function link3(x) { if (x > 1e9) x = 0; if (x < -1e9) x = 1; if (x === 771) x = 2; if (x === 772) x = 3; if (x === 773) x = 4; if (x === 774) x = 5; if (x === 775) x = 6; if (x === 776) x = 7; return x === -5 ? link4(0) : link4(x + 1); }
function link2(x) { if (x > 1e9) x = 0; if (x < -1e9) x = 1; if (x === 771) x = 2; if (x === 772) x = 3; if (x === 773) x = 4; if (x === 774) x = 5; if (x === 775) x = 6; if (x === 776) x = 7; return x === -5 ? link3(0) : link3(x + 1); }
function link1(x) { if (x > 1e9) x = 0; if (x < -1e9) x = 1; if (x === 771) x = 2; if (x === 772) x = 3; if (x === 773) x = 4; if (x === 774) x = 5; if (x === 775) x = 6; if (x === 776) x = 7; return x === -5 ? link2(0) : link2(x + 1); }
check(link1(0) + link1(-5), 39, "a chain of twenty functions");
})();
console.log("passed");
