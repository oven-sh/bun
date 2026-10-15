function check(actual, expected, what) {
    if (actual !== expected)
        throw new Error(what + ": " + actual + " instead of " + expected);
}
function linesOf(name, stack) { return stack.split("\n").filter(line => line.startsWith(name + "@")).map(line => Number(line.split(":").slice(-2)[0])); }

function fill(o) {
    o.a = 1;
    o.b = 2;
    o.c = 3;
    o.d = 4;
    return o;
}
function fillStrictly(o) {
    "use strict";
    o.a = 1;
    o.b = 2;
    o.c = 3;
    o.d = 4;
    return o;
}
function lineWhere(f, o) { try { f(o); } catch (error) { return linesOf(f.name, error.stack).join(); } return "no exception"; }
function throwsFor(key) { return Object.create({ set [key](value) { throw new Error(key); } }); }

const first = Number(lineWhere(fill, throwsFor("a")));
check(first > 0, true, "the first store has a line");
check(lineWhere(fill, throwsFor("b")), String(first + 1), "a setter for the second store throws");
check(lineWhere(fill, throwsFor("c")), String(first + 2), "a setter for the third store throws");
check(lineWhere(fill, throwsFor("d")), String(first + 3), "a setter for the last store throws");
check(lineWhere(fill, null), String(first), "no object: the first store throws");

const firstStrict = Number(lineWhere(fillStrictly, throwsFor("a")));
check(lineWhere(fillStrictly, Object.defineProperty({}, "c", { value: 0 })), String(firstStrict + 2), "a read-only property");
check(lineWhere(fillStrictly, Object.preventExtensions({ a: 0, b: 0 })), String(firstStrict + 2), "an object that cannot be extended");
check(lineWhere(fillStrictly, Object.freeze({})), String(firstStrict), "a frozen object");

let seen = [];
fill(Object.create({ set b(value) { seen.push(...linesOf("fill", new Error("b").stack)); }, set d(value) { seen.push(...linesOf("fill", new Error("d").stack)); } }));
check(seen.join(), [first + 1, first + 3].join(), "setters that look at the stack and return");
seen = [];
fill(new Proxy({}, { set(target, key, value) { seen.push(...linesOf("fill", new Error(key).stack)); return true; } }));
check(seen.join(), [first, first + 1, first + 2, first + 3].join(), "a proxy sees every store at its own line");

seen = [];
fill(Object.create({ set c(value) { fill(Object.create({ set b(value) { seen.push(linesOf("fill", new Error("b").stack).join("<")); } })); seen.push(linesOf("fill", new Error("c").stack).join("<")); } }));
check(seen.join(), [(first + 1) + "<" + (first + 2), first + 2].join(), "a run inside a setter of the same run: each activation has its own position");
seen = [];
fill(Object.create({ set b(value) { try { fillStrictly(Object.freeze({})); } catch { } seen.push(...linesOf("fill", new Error("b").stack)); } }));
check(seen.join(), String(first + 1), "after a run inside a setter has thrown");
check(lineWhere(fill, throwsFor("a")), String(first), "nothing is left behind");
check(Object.keys(fill({})).join(""), "abcd", "a plain object");

console.log("passed");
