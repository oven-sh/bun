function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

function putAnything(o, v) { o.x = v; for (let i = 0; i < 0; i++) { } }
function putNumber(o, v) { o.x = v; for (let i = 0; i < 0; i++) { } }
function putFraction(o, v) { o.x = v; for (let i = 0; i < 0; i++) { } }
function putBoolean(o, v) { o.x = v; for (let i = 0; i < 0; i++) { } }
function putUndefined(o, v) { o.x = v; for (let i = 0; i < 0; i++) { } }
function putNull(o, v) { o.x = v; for (let i = 0; i < 0; i++) { } }
function putInt32(o, v) { o.x = v | 0; for (let i = 0; i < 0; i++) { } }
function putDouble(o, v) { o.x = v * 0.5; for (let i = 0; i < 0; i++) { } }
function putComparison(o, v) { o.x = v > 5; for (let i = 0; i < 0; i++) { } }
function putConstant(o) { o.x = 7; for (let i = 0; i < 0; i++) { } }
function putInt32AtDepth(o, v, depth) {
    if (depth > 0) {
        const result = putInt32AtDepth(o, v, depth - 1);
        return result;
    }
    o.x = v | 0;
    for (let i = 0; i < 0; i++) { }
    return 0;
}
function putTwo(o, v) { o.x = v | 0; o.y = v > 5; for (let i = 0; i < 0; i++) { } }
for (const f of [putAnything, putNumber, putFraction, putBoolean, putUndefined, putNull, putInt32, putDouble, putComparison, putConstant, putInt32AtDepth, putTwo])
    noInline(f);

let unique = 0;
function make(name) {
    const result = {};
    result[name] = 0;
    return result;
}
noInline(make);
function overwriteStack(depth) { return depth ? overwriteStack(depth - 1) + 1 : 0; }
noInline(overwriteStack);

const rounds = 12;
function exercise(put, argumentFor, expectedFor, keys, what) {
    const names = [];
    const objects = [];
    for (let round = 0; round < rounds; round++) {
        names.push("u" + unique++);
        objects.push(make(names[round]));
    }
    fullGC();
    for (let round = 0; round < rounds; round++) {
        (function () { put(make(names[round]), argumentFor(round), 2); })();
        put(objects[round], argumentFor(round), 2);
    }
    put(make("u" + unique++), argumentFor(0), 2);
    overwriteStack(200);
    edenGC();
    const others = [];
    for (let i = 0; i < 3000; i++)
        others.push(make("u" + unique++));
    for (let pass = 0; pass < 2; pass++) {
        for (let round = 0; round < rounds; round++) {
            check(Object.keys(objects[round]).join(), names[round] + "," + keys, "the keys of an old object that got " + what);
            check(objects[round].x, expectedFor(round), "the property of an old object that got " + what);
            check(objects[round][names[round]], 0, "the first property of an old object that got " + what);
        }
        fullGC();
    }
    return others.length;
}

exercise(putAnything, round => "s" + round, round => "s" + round, "x", "a string");
exercise(putNumber, round => round, round => round, "x", "an integer");
exercise(putFraction, round => round + 0.5, round => round + 0.5, "x", "a number");
exercise(putBoolean, round => !(round & 1), round => !(round & 1), "x", "a boolean");
exercise(putUndefined, round => undefined, round => undefined, "x", "undefined");
exercise(putNull, round => null, round => null, "x", "null");
exercise(putInt32, round => round + 0.25, round => round, "x", "the result of a bit operation");
exercise(putDouble, round => round, round => round * 0.5, "x", "the result of a multiplication");
exercise(putComparison, round => round, round => round > 5, "x", "the result of a comparison");
exercise(putConstant, round => round, round => 7, "x", "a constant");
exercise(putInt32AtDepth, round => round, round => round, "x", "an integer in a function that calls itself");
exercise(putTwo, round => round, round => round, "x,y", "two properties");
console.log("passed");
