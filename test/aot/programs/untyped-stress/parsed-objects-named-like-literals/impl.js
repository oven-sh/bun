function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

function makesResult(i) { return { done: false, value: i }; }
function readsValueOfResult(o) { return o.value; }
function writesValueOfResult(o, v) { o.value = v; }
function readsAndWritesResult(o) { o.value = o.value + 1; return o.done ? -1 : o.value; }

function makesWithMethod(i) { return { method: i, value: 1, besideMethod: 2 }; }
function readsMethod(o) { return o.method; }
function readsAllWithMethod(o) { return o.method * 100 + o.value * 10 + o.besideMethod; }

async function* yieldsOnce(i) { yield i; }

for (let i = 0; i < 100; i++) {
    check(readsValueOfResult(makesResult(i)), i, "an object of the program");
    check(readsValueOfResult([i][Symbol.iterator]().next()), i, "the same names in the order of the engine");
    let o = makesResult(i);
    writesValueOfResult(o, i + 1);
    check(o.value, i + 1, "a store to an object of the program");
    check(o.done, false, "the store leaves the neighbour alone");
    o = [i][Symbol.iterator]().next();
    writesValueOfResult(o, i + 1);
    check(o.value, i + 1, "a store to the same names in the order of the engine");
    check(o.done, false, "that store leaves the neighbour alone");
    check(readsMethod(makesWithMethod(i)), i, "an object of the program with one name more than any of the engine's");
    check(readsAllWithMethod(makesWithMethod(i)), i * 100 + 12, "every name of such an object");
    check(readsAndWritesResult(makesResult(i)) + readsAndWritesResult([i][Symbol.iterator]().next()), 2 * i + 2, "reads and a store on both orders");
}
let fromGenerator;
yieldsOnce(7).next().then(result => { fromGenerator = readsValueOfResult(result); });
drainMicrotasks();
check(fromGenerator, 7, "a result that code of the engine written in JavaScript made");

console.log("passed");
