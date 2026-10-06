// @bun
//@ runDefault("--useConcurrentJIT=0")
//@ defaultRun; run("eager-catch-liveness", "--useLazyCatchLiveness=false")

// A catch OSR entrypoint must not give the DFG an operand without a prediction. The DFG takes SpecNone for code that
// never ran: a double use of such a value is DoubleRep(NotCellNorBigIntUse), which is ToNumber, not a check.

function shouldBe(actual, expected, name) {
    if (actual !== expected)
        throw new Error(name + ": expected " + expected + " but got " + actual);
}

function thrower(shouldThrow) {
    if (shouldThrow)
        throw new Error("thrown");
}
noInline(thrower);

const notNumbers = [null, true, undefined, false];

// With Options::useLazyCatchLiveness() these catches run before their value-profile buffer exists and not again
// until the DFG has compiled the function, so the buffer has no sample at all.
const neverSampled = {
    localAfterCatch(value, shouldThrow) {
        const t = value.p;
        try {
            thrower(shouldThrow);
        } catch { }
        return String(t);
    },

    localInFinally(value, shouldThrow) {
        const t = value.p;
        let result;
        try {
            try {
                thrower(shouldThrow);
            } finally {
                result = String(t);
            }
        } catch { }
        return result;
    },

    localInNewArrayInCatch(value, shouldThrow) {
        const t = value.p;
        try {
            thrower(shouldThrow);
        } catch {
            return String([t][0]);
        }
        return t;
    },

    argumentInNewArrayInCatch(value, shouldThrow, t) {
        try {
            thrower(shouldThrow);
        } catch {
            return String([t][0]);
        }
        return t;
    },
};

for (const name in neverSampled) {
    const f = neverSampled[name];
    noInline(f);
    f({ p: 0.5 }, true, 0.5);
    for (let i = 0; i < testLoopCount; ++i)
        f({ p: i + 0.5 }, false, i + 0.5);
    for (const value of notNumbers)
        shouldBe(f({ p: value }, true, value), String(value), name);
}

// With or without the option: the last sample before each update of the prediction has t in its TDZ, the empty value.
function sampledWhileEmpty(skipDeclaration, value, shouldThrow, array) {
    switch (skipDeclaration) {
    case 0:
        let t = value.p;
    case 1:
        try {
            thrower(shouldThrow);
        } catch {
            if (!skipDeclaration) {
                array[0] = t;
                return String(array[0]);
            }
        }
    }
}
noInline(sampledWhileEmpty);

sampledWhileEmpty(0, { p: 0.5 }, true, [0.5]);
for (let i = 0; i < testLoopCount; ++i) {
    sampledWhileEmpty(0, { p: i + 0.5 }, false, [0.5]);
    if (!(i % 20))
        sampledWhileEmpty(1, { p: 0.5 }, true, [0.5]);
}
for (const value of notNumbers)
    shouldBe(sampledWhileEmpty(0, { p: value }, true, [0.5]), String(value), "sampledWhileEmpty");
