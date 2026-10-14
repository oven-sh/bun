const aotRemarks = () => null, isAOTCompiled = () => false, aotFunctionsNamed = () => [], aotOperationCount = () => 0, aotTypeCoverage = () => null, aotSetFamily = () => undefined, aotFamilyOf = () => 0, aotHasDepartedFamily = () => false;
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
if (aotRemarks("readsNode") && jscOptions().useAOTDataStubs) {
    let has = (name, remark) => aotRemarks(name).includes(remark);
    let applies = (name, remark) => {
        if (!has(name, remark))
            throw new Error(remark + " does not apply to " + name + ": " + aotRemarks(name).join(" | "));
    };
    let hasNoFamily = (name, ...properties) => {
        applies(name, "no-guess:no-family");
        for (let remark of ["no-guess:no-shape", "no-guess:disagree", ...properties.map(property => "guessed-place:" + property)]) {
            if (has(name, remark))
                throw new Error(remark + " applies to " + name + ": " + aotRemarks(name).join(" | "));
        }
    };
    let familyOf = (name, property) => {
        let remark = aotRemarks(name).find(remark => remark.startsWith("guessed-family:") && remark.endsWith(":" + property));
        return remark ? Number(remark.split(":")[1]) : 0;
    };
    applies("readsNode", "guessed-place:nodeKind");
    applies("readsNode", "guessed-family:1:nodeKind");
    applies("readsNode", "guessed-family:1:nodeValue");
    applies("writesNode", "guessed-family:1:nodeNext");
    applies("readsNodeOften", "guessed-family:1:nodeKind");
    check(familyOf("readsFew", "fewSecond") > 1, true, "a family with fewer sites has a higher number");
    check(familyOf("readsPlain", "plainFirst") > 1, true, "the instances of a constructor function are a family");
    check(familyOf("readsPlain", "plainSecond"), familyOf("readsPlain", "plainFirst"), "one value has one family");
    check(familyOf("callsAndReads", "besideIt") > 1, true, "a value with a name that is read has a family");
    check(familyOf("readsReturn", "return") > 1, true, "a field named return");
    check(familyOf("readsGrown", "grownFirst") > 1, true, "a name given at the birth");
    hasNoFamily("readsGrown", "grownLater");
    check(familyOf("readsGrown", "grownLater"), 0, "a name added behind the birth is not what the family promises");
    hasNoFamily("readsSingle", "singleName");
    check(familyOf("readsSingle", "singleName"), 0, "a literal with one name has no Structure of its own to carry a number");
    hasNoFamily("callsOnly", "runIt");
    check(familyOf("callsOnly", "runIt"), 0, "a value whose names are only called has no family");
    hasNoFamily("readsAgreed", "agreedFirst");
    check(familyOf("readsAgreed", "agreedFirst"), 0, "two shapes are no family");
    hasNoFamily("readsDerived", "baseFirst", "derivedFirst");
    check(familyOf("readsDerived", "derivedFirst") + familyOf("readsDerived", "baseFirst"), 0, "the instances of a derived class are born in the constructor of its parent");
}
console.log("passed");
