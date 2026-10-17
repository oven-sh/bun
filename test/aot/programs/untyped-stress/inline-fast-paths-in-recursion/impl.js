function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

(function () {
    function marksTree(node) {
        if (node === null)
            return 0;
        node.isMarked = true;
        return 1 + marksTree(node.left) + marksTree(node.right);
    }
    function marksAfterwards(node) {
        if (node === null)
            return 0;
        const count = 1 + marksAfterwards(node.left) + marksAfterwards(node.right);
        node.count = count;
        return count;
    }
    function dispatchesInFewArms(node, kind) {
        switch (kind) {
        case 0: return node.a + node.b;
        case 1: node.c = node.a; return node.c;
        case 2: node.isVisited = true; return dispatchesInFewArms(node.inner, node.innerKind);
        default: return node.e;
        }
    }
    function dispatchesInManyArms(node, kind) {
        switch (kind) {
        case 0: return node.a + node.b;
        case 1: node.c = node.a; return node.c;
        case 2: node.isVisited = true; return dispatchesInManyArms(node.inner, node.innerKind);
        case 3: node.f3 = node.a + 3; return node.f3;
        case 4: node.f4 = node.a + 4; return node.f4;
        case 5: node.f5 = node.a + 5; return node.f5;
        case 6: node.f6 = node.a + 6; return node.f6;
        case 7: node.f7 = node.a + 7; return node.f7;
        case 8: node.f8 = node.a + 8; return node.f8;
        case 9: node.f9 = node.a + 9; return node.f9;
        case 10: node.f10 = node.a + 10; return node.f10;
        case 11: node.f11 = node.a + 11; return node.f11;
        case 12: node.f12 = node.a + 12; return node.f12;
        case 13: node.f13 = node.a + 13; return node.f13;
        case 14: node.f14 = node.a + 14; return node.f14;
        case 15: node.f15 = node.a + 15; return node.f15;
        case 16: node.f16 = node.a + 16; return node.f16;
        case 17: node.f17 = node.a + 17; return node.f17;
        case 18: node.f18 = node.a + 18; return node.f18;
        case 19: node.f19 = node.a + 19; return node.f19;
        case 20: node.f20 = node.a + 20; return node.f20;
        case 21: node.f21 = node.a + 21; return node.f21;
        case 22: node.f22 = node.a + 22; return node.f22;
        case 23: node.f23 = node.a + 23; return node.f23;
        case 24: node.f24 = node.a + 24; return node.f24;
        case 25: node.f25 = node.a + 25; return node.f25;
        case 26: node.f26 = node.a + 26; return node.f26;
        case 27: node.f27 = node.a + 27; return node.f27;
        case 28: node.f28 = node.a + 28; return node.f28;
        case 29: node.f29 = node.a + 29; return node.f29;
        case 30: node.f30 = node.a + 30; return node.f30;
        case 31: node.f31 = node.a + 31; return node.f31;
        case 32: node.f32 = node.a + 32; return node.f32;
        case 33: node.f33 = node.a + 33; return node.f33;
        case 34: node.f34 = node.a + 34; return node.f34;
        default: return node.e;
        }
    }
    function callsNothing(node) {
        node.c = node.a;
        return node.c;
    }
    function makeTree(depth) { return depth ? { left: makeTree(depth - 1), right: makeTree(depth - 1), isMarked: false, count: 0 } : null; }

    for (let i = 0; i < 20; ++i) {
        const tree = makeTree(5);
        check(marksTree(tree), 31, "the nodes of a tree");
        check(tree.left.right.isMarked, true, "a node is marked");
        check(marksAfterwards(tree), 31, "the nodes of a tree");
        check(tree.left.count, 15, "the count of a subtree");
        for (const dispatches of [dispatchesInFewArms, dispatchesInManyArms]) {
            const node = { a: 1, b: 2, e: 5, inner: { a: 3, b: 4, e: 6 }, innerKind: i & 1 };
            check(dispatches(node, 0), 3, "the first arm");
            check(dispatches(node, 1), 1, "the second arm");
            check(dispatches(node, 2), i & 1 ? 3 : 7, "the arm that calls the function itself");
            check(node.isVisited, true, "the store ahead of that call");
            check(dispatches(node, 99), 5, "the last arm");
        }
        check(dispatchesInManyArms({ a: 1 }, 20), 21, "one of the many arms");
        check(callsNothing({ a: 2 }), 2, "a function that calls nothing");
    }
})();

console.log("passed");
