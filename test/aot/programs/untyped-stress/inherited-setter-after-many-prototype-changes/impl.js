function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
let log = [];
function logged() {
    const result = log.join();
    log = [];
    return result;
}
function stores(o, v) { o.x = v; }
noInline(stores);

const changesBeforeLooking = 32500;
const steps = 500;

function changeOften(prototype) {
    for (let i = 0; i < changesBeforeLooking; i++) {
        prototype.changing = 1;
        delete prototype.changing;
    }
}

{
    const holder = { set x(v) { log.push("setter " + v); }, get x() { return "getter"; } };
    const middle = Object.create(holder);
    const leaves = [];
    for (let i = 0; i < 2 * steps + 2; i++)
        leaves.push(Object.create(middle));
    let next = 0;
    for (let i = 0; i < 20; i++) {
        stores(leaves[next], i);
        check(logged(), "setter " + i, "an inherited setter");
    }
    next++;
    Object.defineProperty(middle, "x", { value: 0, writable: true, enumerable: true, configurable: true });
    const storeToNextLeaf = (value, when) => {
        const leaf = leaves[next++];
        stores(leaf, value);
        check(logged(), "", "calls of a setter that is shadowed, " + when);
        check(Object.getOwnPropertyDescriptor(leaf, "x").value, value, "the own property made in place of calling the setter, " + when);
    };
    storeToNextLeaf("first", "right away");
    changeOften(holder);
    for (let i = 0; i < steps; i++) {
        holder.changing = 1;
        storeToNextLeaf(i, "after many changes and an addition");
        delete holder.changing;
        storeToNextLeaf(-i, "after many changes and a deletion");
    }
}

{
    const holder = { set x(v) { log.push("first " + v); } };
    const leaf = Object.create(Object.create(holder));
    for (let i = 0; i < 20; i++) {
        stores(leaf, i);
        check(logged(), "first " + i, "an inherited setter of another chain");
    }
    changeOften(holder);
    for (let i = 0; i < steps; i++) {
        holder.changing = 1;
        stores(leaf, i);
        check(logged(), "first " + i, "a setter that is still there after many changes and an addition");
        delete holder.changing;
        stores(leaf, -i);
        check(logged(), "first " + -i, "a setter that is still there after many changes and a deletion");
    }
}
console.log("passed");
