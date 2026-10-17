import * as self from "./impl.js";
import * as other from "./other.js";
function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
export let counter = 0;
export function bump() { return ++counter; }
export const fixed = "fixed";
function readCounter(ns) { return ns.counter; }
function readFixed(ns) { return ns.fixed; }
function readMissing(ns) { return ns.missing; }
function readValue(ns) { return ns.value; }
function callBump(ns) { return ns.bump(); }
for (let round = 1; round <= 50; ++round) {
    check(callBump(self), round, "a function of the namespace");
    check(readCounter(self), round, "a binding that changes is read again each time");
    check(readFixed(self), "fixed", "a constant");
    check(readMissing(self), undefined, "a name that is not exported");
    check(readValue(other), round - 1, "another module's binding");
    other.increment();
    check(readValue(round & 1 ? other : { value: "object" }), round & 1 ? round : "object", "a namespace or an object at one site");
    check(readFixed(round & 1 ? self : other), round & 1 ? "fixed" : "the other one", "two namespaces at one site");
}
check(Reflect.set(self, "counter", 5), false, "a namespace cannot be written to");
let threw = false;
function readLate(ns) { return ns.late; }
try { readLate(self); } catch (e) { threw = e instanceof ReferenceError; }
check(threw, true, "a binding that is not initialized yet");
export let late = "now";
for (let round = 0; round < 5; ++round)
    check(readLate(self), "now", "and then it is");
check(Object.keys(self).join(), "bump,counter,fixed,late", "its keys");
console.log("passed");
