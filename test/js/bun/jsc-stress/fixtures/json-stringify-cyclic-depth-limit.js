// The DynamicBuffer FastStringifier bails to the general Stringifier past a
// depth limit, so a cyclic value is rejected after bounded work instead of
// growing the buffer toward the 2GB string length limit. This test checks the
// behavior around that limit: cycles still throw TypeError, and values nested
// deeper than the limit still stringify correctly through the general path.

function shouldThrowTypeError(fn) {
    let threw = null;
    try {
        fn();
    } catch (e) {
        threw = e;
    }
    if (!(threw instanceof TypeError))
        throw new Error("expected TypeError, got " + threw);
}

function makeCyclicObject(keys) {
    const o = {};
    for (let i = 0; i < keys; i++)
        o["k" + i] = "y".repeat(50);
    o.self = o;
    return o;
}

// A payload large enough that the StaticBuffer attempt fails with BufferFull
// and the DynamicBuffer attempt runs.
const bigPayload = "y".repeat(10 * 1024);

// Cyclic values throw, flat and with a gap, through objects and arrays, for
// direct and indirect cycles.
for (const space of [undefined, 2, "\t"]) {
    for (const keys of [0, 8])
        shouldThrowTypeError(() => JSON.stringify(makeCyclicObject(keys), null, space));

    shouldThrowTypeError(() => JSON.stringify([makeCyclicObject(1)], null, space));

    const selfArray = [1];
    selfArray.push(selfArray);
    shouldThrowTypeError(() => JSON.stringify(selfArray, null, space));
}

// Cycles that carry a large payload per revolution.
for (const space of [undefined, 2]) {
    const a = { payload: bigPayload };
    const b = { a };
    a.b = b;
    shouldThrowTypeError(() => JSON.stringify(a, null, space));

    const direct = { payload: bigPayload };
    direct.self = direct;
    shouldThrowTypeError(() => JSON.stringify(direct, null, space));
}

// Acyclic values nested deeper than any reasonable fast path depth limit
// round-trip correctly, flat and with a gap, for objects and arrays, with
// 8-bit and 16-bit content.
for (const space of [undefined, 1]) {
    for (const leafValue of ["eight-bit", "sixte\u00e9n-bit \u2603"]) {
        const depth = 1000;

        let root = {};
        let node = root;
        for (let i = 0; i < depth; i++)
            node = node.x = {};
        node.leaf = leafValue;
        let parsed = JSON.parse(JSON.stringify(root, null, space));
        let p = parsed;
        for (let i = 0; i < depth; i++)
            p = p.x;
        if (p.leaf !== leafValue)
            throw new Error("deep object round-trip broken for space=" + space);

        let arrayRoot = [];
        let arrayNode = arrayRoot;
        for (let i = 0; i < depth; i++) {
            const next = [];
            arrayNode.push(next);
            arrayNode = next;
        }
        arrayNode.push(leafValue);
        parsed = JSON.parse(JSON.stringify(arrayRoot, null, space));
        p = parsed;
        for (let i = 0; i < depth; i++)
            p = p[p.length - 1];
        if (p[0] !== leafValue)
            throw new Error("deep array round-trip broken for space=" + space);
    }
}
