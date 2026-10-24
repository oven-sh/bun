function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

function makesNode(i) { return { nodeKind: i, nodeNext: null, nodeValue: i * 2 }; }
function readsNode(o) { return o.nodeKind + o.nodeValue; }
function writesNode(o, v) { o.nodeNext = v; return o.nodeNext; }
function readsNodeOften(o) { return o.nodeKind + o.nodeValue + o.nodeKind + o.nodeValue + o.nodeKind + o.nodeValue + o.nodeKind + o.nodeValue + o.nodeKind + o.nodeValue + o.nodeKind + o.nodeValue; }

function makesFew(i) { return { fewFirst: i, fewSecond: i }; }
function readsFew(o) { return o.fewSecond; }

function makesGrown(i) {
    let o = { grownFirst: i, grownSecond: i };
    o.grownLater = i;
    return o;
}
function readsGrown(o) { return o.grownFirst + o.grownLater; }

function makesSingle(i) { return { singleName: i }; }
function readsSingle(o) { return o.singleName; }

function makesWithMethod(i) { return { runIt() { return i; }, besideIt: i }; }
function callsOnly(o) { return o.runIt(); }
function callsAndReads(o) { return o.runIt() + o.besideIt; }

function makesAgreedOne(i) { return { agreedFirst: i, onlyInOne: 1 }; }
function makesAgreedOther(i) { return { agreedFirst: i, onlyInOther: 1 }; }
function readsAgreed(o) { return o.agreedFirst; }

function Plain(a) {
    this.plainFirst = a;
    this.plainSecond = a;
}
function readsPlain(o) { return o.plainFirst + o.plainSecond; }

function makesClasses() {
    class Base { constructor(a) { this.baseFirst = a; this.baseSecond = a; } }
    class Derived extends Base { constructor(a) { super(a); this.derivedFirst = a; } }
    return { Base, Derived };
}
let { Base, Derived } = makesClasses();
function readsDerived(o) { return o.baseFirst + o.derivedFirst; }

function makesWithReturn(i) { return { return: i, besideReturn: i }; }
function readsReturn(o) { return o.return + o.besideReturn; }

for (let i = 0; i < 100; i++) {
    check(readsNode(makesNode(i)), 3 * i, "a literal");
    check(writesNode(makesNode(i), i), i, "a store to a literal");
    check(readsNodeOften(makesNode(i)), 18 * i, "many reads of a literal");
    check(readsNode(JSON.parse('{"nodeValue":' + i + ',"nodeKind":' + i + '}')), 2 * i, "another order");
    check(readsNode(Object.defineProperty({ ["node" + "Kind"]: i }, "nodeValue", { get() { return i; } })), 2 * i, "a getter");
    check(readsFew(makesFew(i)), i, "a literal with few sites");
    check(readsGrown(makesGrown(i)), 2 * i, "a name added behind the birth");
    check(readsGrown({ grownFirst: i, grownSecond: i }), NaN, "an object that has not grown");
    check(readsSingle(makesSingle(i)), i, "a literal with one name");
    check(callsOnly(makesWithMethod(i)), i, "a method");
    check(callsAndReads(makesWithMethod(i)), 2 * i, "a method and a field");
    check(readsAgreed(makesAgreedOne(i)) + readsAgreed(makesAgreedOther(i)), 2 * i, "two shapes with one place");
    check(readsPlain(new Plain(i)), 2 * i, "a constructor function");
    check(readsDerived(new Derived(i)), 2 * i, "a derived class");
    check(readsDerived(new Base(i)), NaN, "its parent");
    check(readsReturn(makesWithReturn(i)), 2 * i, "a field named return");
}
console.log("passed");
