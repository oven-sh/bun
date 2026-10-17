function putNumber(o) { o.added = 1; }
function putBoolean(o) { o.added = true; }
function putUndefined(o) { o.added = undefined; }
function putAnything(o, v) { o.added = v; }
function addFirst(o) { o.first = 0; }
function addSecond(o) { o.second = 0; }
let unique = 0;
function base() { const o = {}; o["base" + unique] = 0; return o; }
function other() { const o = {}; o["other" + unique] = 0; return o; }
function warm() { const o = {}; o.warm = 0; return o; }
function overwriteStack(depth) { return depth ? overwriteStack(depth - 1) + 1 : 0; }
function structureID(o) { return /StructureID: (\d+)/.exec(describe(o))[1]; }
for (const f of [putNumber, putBoolean, putUndefined, putAnything, addFirst, addSecond, base, other, warm, overwriteStack])
    noInline(f);

function exercise(put, value, what) {
    function transitionOfShortLivedObject() {
        const o = base();
        put(o, value);
        Object.setPrototypeOf(o, null);
    }
    noInline(transitionOfShortLivedObject);
    for (let i = 0; i < 40; i++)
        put(warm(), value);
    const live = [];
    for (let round = 0; round < 10; round++) {
        unique++;
        addFirst(base());
        addSecond(base());
        const old = base();
        live.push(old);
        fullGC();
        transitionOfShortLivedObject();
        put(old, value);
        const id = structureID(old);
        put(other(), value);
        overwriteStack(100);
        edenGC();
        for (let i = 0; i < 4000; i++) {
            unique++;
            if (structureID(other()) === id)
                throw new Error(what + ": the structure of a live object was collected, round " + round);
        }
    }
    for (const o of live) {
        if (!Object.is(o.added, value) || Object.keys(o).length !== 2)
            throw new Error(what + ": bad object " + describe(o));
    }
}
exercise(putNumber, 1, "a number");
exercise(putBoolean, true, "a boolean");
exercise(putUndefined, undefined, "undefined");
exercise(putAnything, 2.5, "a value of unknown type that is a number");
exercise(putAnything, "string", "a value of unknown type that is a cell");
console.log("passed");
