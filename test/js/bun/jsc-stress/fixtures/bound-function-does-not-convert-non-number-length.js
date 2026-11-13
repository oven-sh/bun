// @bun
//@ requireOptions("--useConcurrentJIT=0")

// Function.prototype.bind takes the length of its result from the "length" of its target only if that value is a
// Number. Any other value is not converted: the length is 0.
//
// The DFG and the FTL call an operation of their own for bind(), with its own copy of these steps. Each caller below
// is one way to write the call for one kind of target, so that it is compiled for targets of one kind and is then
// asked about every length.

function shouldBe(actual, expected, caller, kind, length, what) {
    if (!Object.is(actual, expected))
        throw new Error(`${caller} with ${kind} ${length}: expected ${what} ${String(expected)} but got ${String(actual)}`);
}

let conversions = 0;
let lengthReads = 0;

const withValueOf = {
    valueOf() {
        conversions++;
        return 7;
    },
    toString() {
        conversions++;
        return "7";
    },
};
const withToPrimitive = {
    [Symbol.toPrimitive]() {
        conversions++;
        return 7;
    },
};

const lengths = [
    ["a string", "9"],
    ["an object with valueOf()", withValueOf],
    ["an object with @@toPrimitive", withToPrimitive],
    ["a Number object", new Number(4)],
    ["true", true],
    ["null", null],
    ["undefined", undefined],
    ["a symbol", Symbol("length")],
    ["a BigInt", 3n],
    ["5", 5],
    ["5.7", 5.7],
    ["1", 1],
    ["0", 0],
    ["-0", -0],
    ["-3", -3],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["-Infinity", -Infinity],
    ["2 ** 53", 2 ** 53],
];

// The length that the language gives to a bound function.
function expectedLength(length, boundArgumentCount) {
    if (typeof length !== "number")
        return 0;
    if (length === Infinity)
        return Infinity;
    if (length === -Infinity)
        return 0;
    return Math.max((Math.trunc(length) || 0) - boundArgumentCount, 0);
}

// What the target is, the name of its bound function, how often one bind() asks it for "length", how to make it.
const targetKinds = [
    ["a function whose length is", "bound target", 0, function (length) {
        function target(a, b, c) { }
        Object.defineProperty(target, "length", { value: length });
        return target;
    }],
    ["a function whose length getter returns", "bound target", 1, function (length) {
        function target(a, b, c) { }
        Object.defineProperty(target, "length", {
            get() {
                lengthReads++;
                return length;
            },
        });
        return target;
    }],
    ["a class whose static length is", "bound Target", 0, function (length) {
        return class Target {
            static length = length;
        };
    }],
    ["a bound function whose length is", "bound bound target", 0, function (length) {
        const target = function target(a, b, c) { }.bind(null);
        Object.defineProperty(target, "length", { value: length });
        return target;
    }],
    ["a Proxy whose get trap answers", "bound target", 1, function (length) {
        return new Proxy(function target(a, b, c) { }, {
            get(target, key, receiver) {
                if (key !== "length")
                    return Reflect.get(target, key, receiver);
                lengthReads++;
                return length;
            },
        });
    }],
];

const bind = Function.prototype.bind;
const uncurriedBind = Function.prototype.call.bind(bind);

// The body of a caller, the number of arguments that it binds, and whether there is such a caller for every kind of
// target. The other bodies have one for the first kind.
const callerBodies = [
    ["return f.bind(null);", 0, false],
    // The compiler knows the Structure of f here.
    ["return f.bind(null, 1);", 1, true],
    ["return f.bind(null, 1, 2);", 2, false],
    ["return f.bind(null, 1, 2, 3);", 3, false],
    // More arguments than the operation takes: this call reaches Function.prototype.bind itself in every tier.
    ["return f.bind(null, 1, 2, 3, 4);", 4, false],
    // The compiler does not know the Structure of f here.
    ["return bind.call(f, null, 1);", 1, true],
    ["return bind.apply(f, [null, 1]);", 1, false],
    ["return uncurriedBind(f, null, 1);", 1, false],
    // A tail call.
    ["'use strict'; return f.bind(null, 1);", 1, false],
    // The bound function is not used.
    ["f.bind(null, 1);", 1, false],
];

let callerCount = 0;
function makeCaller(body) {
    // A name of its own, so that no two callers share their code or what it has seen.
    const caller = new Function("bind", "uncurriedBind", `return function caller${callerCount++}(f) { ${body} };`)(bind, uncurriedBind);
    noInline(caller);
    return caller;
}

for (const [body, boundArgumentCount, forEveryKind] of callerBodies) {
    const argumentsOfBind = [null, 1, 2, 3, 4].slice(0, boundArgumentCount + 1);
    for (const [kind, expectedName, readsPerBind, targetWithLength] of forEveryKind ? targetKinds : targetKinds.slice(0, 1)) {
        const caller = makeCaller(body);
        const targets = lengths.map(([, length]) => targetWithLength(length));
        // bind() reads the name of its target, and the first read gives a function a property for its name, so another
        // Structure. A caller that was compiled before that would exit at its check of the Structure from then on,
        // and would leave every bind() to Function.prototype.bind itself.
        for (const target of targets)
            target.bind();
        for (let i = 0; i < testLoopCount; i++) {
            const index = i % lengths.length;
            const [what, length] = lengths[index];
            const target = targets[index];

            const readsBefore = lengthReads;
            const bound = caller(target);
            shouldBe(lengthReads - readsBefore, readsPerBind, body, kind, what, "reads of length:");
            if (bound === undefined)
                continue;
            shouldBe(bound.length, expectedLength(length, boundArgumentCount), body, kind, what, "length");

            // In the last round, when the caller is in its last tier: the name is still read, and
            // Function.prototype.bind itself gives the same length.
            if (i < testLoopCount - lengths.length)
                continue;
            shouldBe(bound.name, expectedName, body, kind, what, "name");
            shouldBe(bound.length, Reflect.apply(bind, target, argumentsOfBind).length, body, kind, what, "the length from Function.prototype.bind itself,");
        }
    }
}
if (conversions)
    throw new Error(`bind() converted a length ${conversions} times`);
