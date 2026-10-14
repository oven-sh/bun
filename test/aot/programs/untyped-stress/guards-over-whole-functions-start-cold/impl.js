const aotRemarks = () => null, isAOTCompiled = () => false, aotFunctionsNamed = () => [], aotOperationCount = () => 0, aotTypeCoverage = () => null, aotSetFamily = () => undefined, aotFamilyOf = () => 0, aotHasDepartedFamily = () => false;
//@ runDefault("--compileMainScriptAheadOfTime=1")
//@ runDefault("--compileMainScriptAheadOfTime=1", "--validateGraphAtEachPhase=1")
//@ runDefault("--compileMainScriptAheadOfTime=1", "--useAOTInlining=0", "--validateGraphAtEachPhase=1", "--validateAOTInferredTypes=1")
//@ runDefault("--compileMainScriptAheadOfTime=1", "--useAOTOperationCounters=1")
//@ runDefault("--compileMainScriptAheadOfTime=1", "--useAOTInlining=0", "--verifyGC=1", "--scribbleFreeCells=1", "--useZombieMode=1", "--slowPathAllocsBetweenGCs=50")
//@ runDefault

function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
const remarksOf = f => typeof aotRemarks === "function" && aotRemarks(f.name) || null;
const options = typeof jscOptions === "function" ? jscOptions() : { };
const isCompiled = !!remarksOf(check);
const isOn = isCompiled && !!options.useAOTDataStubs;
function takesDataAfresh(f, hasGuards, expected) {
    if (!isCompiled)
        return;
    check(remarksOf(f).includes("guards-over-whole-function"), isOn && hasGuards, f.name + " has guards over the whole function");
    check(remarksOf(f).includes("generic-copy-takes-data-afresh"), isOn && expected, f.name + "'s generic copy takes its data afresh");
}

const kept = [];
function keep(o) { kept.push(o); return o; }
noInline(keep);
function build(...pairs) {
    let o = {};
    for (let [name, value] of pairs)
        o[name] = value;
    return keep(o);
}
function Item(tag, key, child, flags) {
    this.tag = tag;
    this.key = key;
    this.child = child;
    this.flags = flags;
}
const makeItem = which => keep(new Item("tag" + which, "key" + which, "child" + which, "flags" + which));

function readsThree(x, y, z) {
    return x.tag + "|" + y.key + "|" + z.child;
}
function readsThreeAndMore(x, y, z, other) {
    let first = x.tag;
    let unknown = other.somethingNobodyIsBornWith;
    let second = y.key;
    other.anotherNameNobodyIsBornWith = first;
    return first + "|" + second + "|" + z.child + "|" + unknown;
}
function readsThreeInLoop(x, y, z, count) {
    let text = "";
    for (let i = 0; i < count; ++i)
        text += keep(x).tag + y.key + z.child;
    return text;
}
function readsOne(x) {
    return x.tag;
}
for (let f of [readsThree, readsThreeAndMore, readsThreeInLoop, readsOne])
    noInline(f);

const odd = [
    ["another order", which => build(["child", "child" + which], ["key", "key" + which], ["filler", 0], ["tag", "tag" + which])],
    ["inherited", which => keep(Object.create(makeItem(which)))],
    ["an accessor", which => keep(Object.defineProperties({}, build(["tag", { get() { return "tag" + which; } }], ["key", { get() { return "key" + which; } }], ["child", { get() { return "child" + which; } }])))],
    ["a Proxy", which => new Proxy(makeItem(which), { })],
];
for (let round = 0; round < 60; ++round) {
    check(readsThree(makeItem(1), makeItem(2), makeItem(3)), "tag1|key2|child3", "readsThree from its first call on");
    for (let [what, make] of odd) {
        check(readsThree(make(1), makeItem(2), makeItem(3)), "tag1|key2|child3", "readsThree, " + what + " first");
        check(readsThree(makeItem(1), make(2), makeItem(3)), "tag1|key2|child3", "readsThree, " + what + " second");
        check(readsThree(makeItem(1), makeItem(2), make(3)), "tag1|key2|child3", "readsThree, " + what + " third");
        let other = build(["somethingNobodyIsBornWith", round]);
        check(readsThreeAndMore(make(1), make(2), make(3), other), "tag1|key2|child3|" + round, "readsThreeAndMore, " + what);
        check(other.anotherNameNobodyIsBornWith, "tag1", "readsThreeAndMore's store, " + what);
    }
    check(readsThreeInLoop(makeItem(1), makeItem(2), makeItem(3), 2), "tag1key2child3tag1key2child3", "readsThreeInLoop");
    check(readsOne(makeItem(round)), "tag" + round, "readsOne");
}
takesDataAfresh(readsThree, true, true);
takesDataAfresh(readsThreeAndMore, true, true);
takesDataAfresh(readsThreeInLoop, true, false);
takesDataAfresh(readsOne, false, false);
console.log("passed");
