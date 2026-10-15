import * as self from "./impl.js";
import * as other from "./other.js";
function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
export let storedBetweenReads = 0;
{
    const ns = self;
    let wrong = 0;
    for (let i = 1; i <= 200; i++) {
        const before = ns.storedBetweenReads;
        storedBetweenReads = i;
        if (before !== i - 1 || ns.storedBetweenReads !== i)
            wrong++;
        Math.random();
    }
    check(wrong, 0, "two reads around a store to the variable");
}

let local = 0;
export { local as exportedUnderAnotherName };
{
    const ns = self;
    let wrong = 0;
    for (let i = 1; i <= 200; i++) {
        const before = ns.exportedUnderAnotherName;
        local = i;
        if (before !== i - 1 || ns.exportedUnderAnotherName !== i)
            wrong++;
        Math.random();
    }
    check(wrong, 0, "the property has another name than the variable");
}

export let exportedAgain = 0;
{
    const ns = other;
    let wrong = 0;
    for (let i = 1; i <= 200; i++) {
        const before = ns.exportedAgain;
        const beforeUnderAnotherName = ns.exportedAgainUnderAnotherName;
        exportedAgain = i;
        if (before !== i - 1 || beforeUnderAnotherName !== i - 1 || ns.exportedAgain !== i || ns.exportedAgainUnderAnotherName !== i)
            wrong++;
        Math.random();
    }
    check(wrong, 0, "the namespace object of a module that exports the variable again");
}

export let storedToAnotherVariable = 7;
let notExported = 0;
{
    const ns = self;
    let wrong = 0;
    for (let i = 1; i <= 200; i++) {
        const before = ns.storedToAnotherVariable;
        notExported = i;
        if (before !== 7 || ns.storedToAnotherVariable !== 7)
            wrong++;
        Math.random();
    }
    check(wrong, 0, "two reads around a store to another variable of the module");
    check(notExported, 200, "the other variable");
}

export let notStoredBetweenReads = 7;
{
    const ns = self;
    let captured = 0;
    const readCaptured = () => captured;
    let wrong = 0;
    for (let i = 1; i <= 200; i++) {
        const before = ns.notStoredBetweenReads;
        captured = i;
        if (before !== 7 || ns.notStoredBetweenReads !== 7)
            wrong++;
        Math.random();
    }
    check(wrong, 0, "two reads around a store to a variable of a block");
    check(readCaptured(), 200, "the variable of the block");
}

export let initializedLate;
{
    const ns = self;
    let threw = false;
    try {
        ns.declaredLate;
    } catch (error) {
        threw = error instanceof ReferenceError;
    }
    check(threw, true, "a binding that is not initialized yet");
    check(ns.initializedLate, undefined, "a binding without a value");
    initializedLate = "now";
    check(ns.initializedLate, "now", "and with one");
}
export let declaredLate = "now";
check(self.declaredLate, "now", "the binding is initialized");

export let storedInLoop = 0;
{
    const ns = self;
    let wrong = 0;
    for (let round = 0; round < 4; round++) {
        storedInLoop = 0;
        for (let i = 1; i <= 100; i++) {
            if (ns.storedInLoop !== i - 1)
                wrong++;
            storedInLoop = i;
        }
    }
    check(wrong, 0, "one read in a loop that stores to the variable");
}

export let storedBetweenReadsInLoop = 0;
{
    const ns = self;
    let wrong = 0;
    for (let round = 0; round < 4; round++) {
        storedBetweenReadsInLoop = 0;
        for (let i = 1; i <= 100; i++) {
            if (ns.storedBetweenReadsInLoop !== i - 1)
                wrong++;
            storedBetweenReadsInLoop = i;
            if (ns.storedBetweenReadsInLoop !== i)
                wrong++;
        }
    }
    check(wrong, 0, "two reads around a store in a loop");
}

export let storedOnOnePath = 0;
{
    const ns = self;
    let wrong = 0;
    for (let round = 0; round < 4; round++) {
        storedOnOnePath = -1;
        for (let i = 1; i <= 100; i++) {
            if (i & 1) {
                if (ns.storedOnOnePath !== i - 2)
                    wrong++;
                storedOnOnePath = i;
                if (ns.storedOnOnePath !== i)
                    wrong++;
            }
        }
    }
    check(wrong, 0, "two reads around a store on one path through a loop");
}

let localStoredInLoop = 0;
export { localStoredInLoop as storedInLoopUnderAnotherName };
{
    const ns = self;
    let wrong = 0;
    for (let round = 0; round < 4; round++) {
        localStoredInLoop = 0;
        for (let i = 1; i <= 100; i++) {
            if (ns.storedInLoopUnderAnotherName !== i - 1)
                wrong++;
            localStoredInLoop = i;
        }
    }
    check(wrong, 0, "in a loop, the property has another name than the variable");
}

export let invariantInLoop = 7;
export let readTwiceOnOnePath = 7;
{
    const ns = self;
    let captured = 0;
    const readCaptured = () => captured;
    let hits = 0;
    for (let round = 0; round < 4; round++) {
        for (let i = 1; i <= 100; i++) {
            if (ns.invariantInLoop === 7)
                hits++;
            captured = i;
            if (i & 1) {
                if (ns.readTwiceOnOnePath === 7)
                    hits++;
                captured = -i;
                if (ns.readTwiceOnOnePath === 7)
                    hits++;
            }
        }
    }
    check(hits, 800, "reads in a loop that only stores to a variable of a block");
    check(readCaptured(), 100, "the variable of the block, after the loops");
}

export let storedByFunction = 0;
function readsAroundStoreToModuleVariable(ns, i) {
    const before = ns.storedByFunction;
    storedByFunction = i;
    return before === i - 1 && ns.storedByFunction === i;
}
function readsAroundStoreToOwnVariable(ns, i) {
    let captured = 0;
    const readCaptured = () => captured;
    const before = ns.storedByFunction;
    captured = i;
    return before === ns.storedByFunction ? readCaptured : null;
}
function readsAroundCall(ns, i) {
    const before = ns.storedByFunction;
    storesToModuleVariable(i);
    return before === i - 1 && ns.storedByFunction === i;
}
function storesToModuleVariable(i) { storedByFunction = i; }
for (let i = 1; i <= 200; i++)
    check(readsAroundStoreToModuleVariable(self, i), true, "a function stores to the variable between two reads");
for (let i = 1; i <= 200; i++)
    check(readsAroundStoreToOwnVariable(self, i)(), i, "a function stores to a variable of its own between two reads");
storedByFunction = 0;
for (let i = 1; i <= 200; i++)
    check(readsAroundCall(self, i), true, "a function calls one that stores to the variable between two reads");
console.log("passed");
