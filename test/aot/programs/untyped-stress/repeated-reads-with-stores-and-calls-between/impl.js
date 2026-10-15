function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

const kept = [];
function keep(o) { kept.push(o); return o; }
function Item(tag, key, child, sibling, flags) {
    this.tag = tag;
    this.key = key;
    this.child = child;
    this.sibling = sibling;
    this.flags = flags;
}
function makeItem(which) { return keep(new Item("tag" + which, "key" + which, "child" + which, "sibling" + which, "flags" + which)); }
function build(...pairs) {
    const o = {};
    for (const [name, value] of pairs)
        o[name] = value;
    return keep(o);
}
function makeOtherShape(which) { return build(["flags", "FLAGS" + which], ["sibling", "SIBLING" + which], ["child", "CHILD" + which], ["key", "KEY" + which], ["tag", "TAG" + which]); }
let calls = 0;
function note(what) { ++calls; return what; }
noInline(note);

const tested = (function () {
    let current = null;
    let other = null;
    let cursor = null;

    function setCurrent(o) { current = o; }
    function setOther(o) { other = o; }
    function setCursor(o) { cursor = o; }

    function readsThree() {
        const first = current.tag;
        const second = current.key;
        const third = current.child;
        return first + "|" + second + "|" + third;
    }
    function readsFourAndOneAgain() {
        const first = current.tag;
        const second = current.key;
        const third = current.child;
        const fourth = current.sibling;
        const again = current.tag;
        return first + "|" + second + "|" + third + "|" + fourth + "|" + again;
    }
    function storesThree(first, second, third) {
        current.tag = first;
        current.key = second;
        current.child = third;
    }
    function readsAcrossStoreToAnotherObject() {
        const first = current.tag;
        other.sibling = "stored";
        const second = current.key;
        const third = current.child;
        return first + "|" + second + "|" + third;
    }
    function readsThroughLocalAcrossCall() {
        const local = current;
        const first = local.tag;
        note(1);
        const second = local.key;
        const third = local.child;
        return first + "|" + second + "|" + third;
    }

    function readsAcrossCall(callee) {
        const first = current.tag;
        callee();
        const second = current.key;
        const third = current.child;
        return first + "|" + second + "|" + third;
    }
    function readsAcrossStoreToVariable(o) {
        const first = current.tag;
        current = o;
        const second = current.key;
        const third = current.child;
        return first + "|" + second + "|" + third;
    }
    function readsAcrossStoreToAnotherVariable(o) {
        const first = current.tag;
        other = o;
        const second = current.key;
        const third = current.child;
        return first + "|" + second + "|" + third;
    }
    function readsAcrossAddition() {
        const sum = current.tag + current.key;
        const third = current.child;
        const fourth = current.sibling;
        return sum + "|" + third + "|" + fourth;
    }
    function readsAcrossUnguardedRead(holder) {
        const first = current.tag;
        const sprung = holder.trap;
        const second = current.key;
        const third = current.child;
        return first + "|" + sprung + "|" + second + "|" + third;
    }
    function readsTwoVariables() {
        const first = current.tag;
        const second = other.key;
        const third = current.child;
        const fourth = other.sibling;
        return first + "|" + second + "|" + third + "|" + fourth;
    }
    function readsOnBothPaths(condition) {
        let first;
        if (condition)
            first = current.tag;
        else
            first = current.tag;
        const second = current.key;
        const third = current.child;
        const fourth = current.sibling;
        return first + "|" + second + "|" + third + "|" + fourth;
    }
    function walksList() {
        let result = "";
        while (cursor !== null) {
            note(0);
            const first = cursor.tag;
            const second = cursor.key;
            cursor = cursor.child;
            result = result + first + second;
        }
        return result;
    }
    return {
        setCurrent, setOther, setCursor, readsThree, readsFourAndOneAgain, storesThree, readsAcrossStoreToAnotherObject, readsThroughLocalAcrossCall, readsAcrossCall, readsAcrossStoreToVariable,
        readsAcrossStoreToAnotherVariable, readsAcrossAddition, readsAcrossUnguardedRead, readsTwoVariables, readsOnBothPaths, walksList,
    };
})();

const plainHolder = build(["trap", "harmless"]);
for (let i = 0; i < 200; ++i) {
    const a = makeItem(i);
    const b = makeItem(i + "b");
    tested.setCurrent(a);
    tested.setOther(b);
    check(tested.readsThree(), "tag" + i + "|key" + i + "|child" + i, "readsThree");
    check(tested.readsFourAndOneAgain(), "tag" + i + "|key" + i + "|child" + i + "|sibling" + i + "|tag" + i, "readsFourAndOneAgain");
    check(tested.readsAcrossStoreToAnotherObject(), "tag" + i + "|key" + i + "|child" + i, "readsAcrossStoreToAnotherObject");
    check(b.sibling, "stored", "what readsAcrossStoreToAnotherObject stored");
    check(tested.readsThroughLocalAcrossCall(), "tag" + i + "|key" + i + "|child" + i, "readsThroughLocalAcrossCall");
    check(tested.readsAcrossCall(note), "tag" + i + "|key" + i + "|child" + i, "readsAcrossCall");
    check(tested.readsAcrossStoreToVariable(b), "tag" + i + "|key" + i + "b|child" + i + "b", "readsAcrossStoreToVariable");
    tested.setCurrent(a);
    check(tested.readsAcrossStoreToAnotherVariable(b), "tag" + i + "|key" + i + "|child" + i, "readsAcrossStoreToAnotherVariable");
    check(tested.readsAcrossAddition(), "tag" + i + "key" + i + "|child" + i + "|sibling" + i, "readsAcrossAddition");
    check(tested.readsAcrossUnguardedRead(plainHolder), "tag" + i + "|harmless|key" + i + "|child" + i, "readsAcrossUnguardedRead");
    check(tested.readsTwoVariables(), "tag" + i + "|key" + i + "b|child" + i + "|stored", "readsTwoVariables");
    check(tested.readsOnBothPaths(i & 1), "tag" + i + "|key" + i + "|child" + i + "|sibling" + i, "readsOnBothPaths");
    tested.setOther(a);
    check(tested.readsTwoVariables(), "tag" + i + "|key" + i + "|child" + i + "|sibling" + i, "readsTwoVariables, both hold one object");
    tested.storesThree("one", "two", "three");
    check(a.tag + a.key + a.child + a.sibling, "onetwothreesibling" + i, "storesThree");
    const last = keep(new Item("x", "y", null, 0, 0));
    tested.setCursor(keep(new Item("p", "q", keep(new Item("r", "s", last, 0, 0)), 0, 0)));
    check(tested.walksList(), "pqrsxy", "walksList");
    kept.length = 0;
}

for (let round = 0; round < 3; ++round) {
    const a = makeItem("a");
    const odd = makeOtherShape(round);
    tested.setCurrent(a);
    check(tested.readsAcrossCall(() => tested.setCurrent(odd)), "taga|KEY" + round + "|CHILD" + round, "the callee puts an object of another shape into the variable");
    tested.setCurrent(a);
    check(tested.readsAcrossStoreToVariable(odd), "taga|KEY" + round + "|CHILD" + round, "an object of another shape is stored into the variable");
    tested.setCurrent(a);
    const holder = Object.defineProperty(build(), "trap", { get() { tested.setCurrent(odd); return "sprung"; }, configurable: true });
    check(tested.readsAcrossUnguardedRead(holder), "taga|sprung|KEY" + round + "|CHILD" + round, "a getter puts an object of another shape into the variable");
    const converts = keep(new Item({ toString() { tested.setCurrent(odd); return "converted"; } }, "keyc", "childc", "siblingc", 0));
    tested.setCurrent(converts);
    check(tested.readsAcrossAddition(), "convertedkeyc|CHILD" + round + "|SIBLING" + round, "a conversion puts an object of another shape into the variable");
    tested.setCurrent(odd);
    check(tested.readsThree(), "TAG" + round + "|KEY" + round + "|CHILD" + round, "readsThree of another shape");
    check(tested.readsFourAndOneAgain(), "TAG" + round + "|KEY" + round + "|CHILD" + round + "|SIBLING" + round + "|TAG" + round, "readsFourAndOneAgain of another shape");
    tested.storesThree("one", "two", "three");
    check(odd.tag + odd.key + odd.child + odd.sibling, "onetwothreeSIBLING" + round, "storesThree to another shape");
    tested.setCurrent(a);
    tested.setOther(odd);
    check(tested.readsTwoVariables(), "taga|two|childa|SIBLING" + round, "readsTwoVariables, the second holds another shape");
    tested.setCursor(keep(new Item("p", "q", build(["key", "s"], ["tag", "r"], ["child", keep(new Item("x", "y", null, 0, 0))]), 0, 0)));
    check(tested.walksList(), "pqrsxy", "walksList over another shape");
}

console.log("passed");
