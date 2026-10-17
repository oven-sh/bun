function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function thrown(f) {
    try {
        f();
    } catch (error) {
        return error.constructor.name;
    }
    return "nothing";
}

function Fiber(tag) {
    this.tag = tag;
    this.key = null;
    this.alternate = null;
    this.memoizedProps = null;
    this.memoizedState = null;
    this.pendingProps = null;
    this.child = null;
    this.sibling = null;
    this.return = null;
    this.flags = 0;
}
function FiberInAnotherOrder(tag) {
    this.flags = 0;
    this.return = null;
    this.sibling = null;
    this.child = null;
    this.pendingProps = null;
    this.memoizedState = null;
    this.memoizedProps = null;
    this.alternate = null;
    this.key = null;
    this.tag = tag;
}
function Link(weight, next) {
    this.weight = weight;
    this.extent = 1;
    this.next = next;
}
const inAnotherOrder = ["flags", "return", "sibling", "child", "pendingProps", "memoizedState", "memoizedProps", "alternate", "tag"];
function makeOther(tag) {
    const other = { };
    for (const name of inAnotherOrder)
        other[name] = name === "flags" ? 0 : name === "tag" ? tag : null;
    return other;
}
function set(o, name, value) {
    o[name] = value;
    return o;
}
function build(depth, width, parent, make) {
    const fiber = make(depth);
    set(set(fiber, "return", parent), "pendingProps", depth);
    let previous = null;
    for (let i = 0; depth && i < width; ++i) {
        const child = build(depth - 1, width, fiber, make);
        if (previous)
            set(previous, "sibling", child);
        else
            set(fiber, "child", child);
        previous = child;
    }
    return fiber;
}

function walks(root) {
    let node = root, seen = 0;
    for (;;) {
        ++seen;
        let other = node.alternate;
        if (other !== null)
            node.memoizedProps = other.memoizedProps;
        node.memoizedState = node.pendingProps;
        node.flags = node.flags | 1;
        if (node.child !== null) {
            node.child.return = node;
            node = node.child;
            continue;
        }
        if (node === root)
            return seen;
        while (node.sibling === null) {
            if (node.return === null || node.return === root)
                return seen;
            node = node.return;
        }
        node.sibling.return = node.return;
        node = node.sibling;
    }
}
function sumsSiblings(first) {
    let sum = 0;
    for (let node = first; node !== null; node = node.sibling)
        sum += node.pendingProps + node.flags;
    return sum;
}
const visitors = [node => 1, node => 2];
function walksAndCalls(first, which) {
    let sum = 0;
    for (let node = first; node !== null; node = node.sibling) {
        sum += visitors[which & 1](node);
        sum += node.pendingProps + node.flags;
        node.memoizedState = sum;
    }
    return sum;
}
function sumsLinks(first) {
    let sum = 0;
    for (let link = first; link !== null; link = link.next)
        sum += link.weight + link.extent;
    return sum;
}
function sumsLinksAndCalls(first, which) {
    let sum = 0;
    for (let link = first; link !== null; link = link.next)
        sum += link.weight + link.extent + visitors[which & 1](link);
    return sum;
}
function readsWithoutLoop(node) {
    node.memoizedProps = node.tag;
    return node.pendingProps + node.flags + node.memoizedProps;
}
for (const f of [walks, sumsSiblings, walksAndCalls, sumsLinks, sumsLinksAndCalls, readsWithoutLoop, makeOther, set, build])
    noInline(f);

const root = build(4, 4, null, tag => new Fiber(tag));
const numberOfNodes = 341;
const row = root.child;
const links = new Link(1, new Link(2, new Link(3, null)));
const warmUp = () => {
    for (let i = 0; i < 30; ++i) {
        check(walks(root), numberOfNodes, "nodes seen");
        check(sumsSiblings(row), 16, "sum over siblings");
        check(walksAndCalls(row, i), i & 1 ? 24 : 20, "sum with calls");
        check(readsWithoutLoop(row), 3 + 1 + 3, "reads outside a loop");
        check(sumsLinks(links), 9, "sum over links");
        check(sumsLinksAndCalls(links, i), i & 1 ? 15 : 12, "sum over links with calls");
    }
};
warmUp();

const rounds = 50;
for (const [f, operand, result] of [[walks, root, numberOfNodes], [sumsSiblings, row, 16], [sumsLinks, links, 9]]) {
    for (let i = 0; i < rounds; ++i)
        check(f(operand), result, f.name);
}

{
    const mixed = build(4, 4, null, tag => tag & 1 ? new Fiber(tag) : makeOther(tag));
    const other = build(4, 4, null, makeOther);
    const third = build(4, 4, null, tag => new FiberInAnotherOrder(tag));
    const withAlternates = build(3, 3, null, tag => set(new Fiber(tag), "alternate", set(new Fiber(-tag), "memoizedProps", "props " + tag)));
    const grown = build(3, 3, null, tag => set(new Fiber(tag), "extra", tag));
    const logged = [];
    const watched = build(2, 2, null, tag => {
        let flags = 0;
        return Object.defineProperty(new Fiber(tag), inAnotherOrder[0], { get() { logged.push("get " + tag); return flags; }, set(v) { logged.push("set " + tag); flags = v; } });
    });
    for (let i = 0; i < 40; ++i) {
        check(walks(mixed), numberOfNodes, "fibers of two kinds");
        check(walks(other), numberOfNodes, "fibers of the other kind");
        check(walks(third), numberOfNodes, "fibers of the third kind");
        check(walks(root), numberOfNodes, "fibers of the first kind again");
        check(walks(withAlternates), 40, "fibers with alternates");
        check(withAlternates[inAnotherOrder[3]][inAnotherOrder[6]], "props 2", "what was copied from an alternate");
        check(walks(grown), 40, "fibers with one more property");
        logged.length = 0;
        check(walks(watched), 7, "fibers with an accessor");
        check(logged.join(), "get 2,set 2,get 1,set 1,get 0,set 0,get 0,set 0,get 1,set 1,get 0,set 0,get 0,set 0", "the calls of the accessor");
        check(sumsSiblings(mixed[inAnotherOrder[3]]) + sumsSiblings(other[inAnotherOrder[3]]) + sumsSiblings(grown[inAnotherOrder[3]]), 16 + 16 + 9, "sums over fibers of several kinds");
        check(mixed[inAnotherOrder[3]][inAnotherOrder[3]][inAnotherOrder[5]], 2, "what was stored in a fiber of the other kind");
    }
    check(thrown(() => walks(null)), "TypeError", "no fiber at all");
    check(sumsSiblings(null), 0, "an empty row");
    warmUp();
}

console.log("passed");
