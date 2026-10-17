function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
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
console.log("passed");
