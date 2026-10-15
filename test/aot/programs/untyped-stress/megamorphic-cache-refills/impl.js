function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

function adds(o, value) {
    o.first = value(o.first); o.second = value(o.second); o.third = value(o.third);
    o.fourth = value(o.fourth); o.fifth = value(o.fifth); o.sixth = value(o.sixth);
    return o;
}
function reads(o) { return o.common + o.absent; }
function storesByKey(o, key, value) { o[key] = value; }
function readsByKey(o, key) { return o[key]; }
for (let f of [adds, reads, storesByKey, readsByKey])
    noInline(f);
const orDefault = x => x === undefined ? "none" : x;

const shapes = 150, keyed = 300, rounds = 12;
const templates = [], held = [], atoms = [];
for (let k = 0; k < shapes; ++k) {
    const o = {};
    o["s" + k] = k;
    o.common = 1;
    templates.push(o);
}
for (let k = 0; k < keyed; ++k) {
    const o = {};
    o["h" + k] = k;
    o["k" + k] = 0;
    held.push(o);
    atoms.push(Object.keys(o)[1]);
}

function round(r, keyOf) {
    for (let k = 0; k < shapes; ++k) {
        const made = adds({ ...templates[k] }, orDefault);
        if (!(k % 50))
            check(Object.keys(made).join(), "s" + k + ",common,first,second,third,fourth,fifth,sixth", "the properties that were added");
        check(reads(made), NaN, "a property that is there and one that is not");
    }
    for (let k = 0; k < keyed; ++k) {
        storesByKey(held[k], keyOf(k), r);
        check(readsByKey(held[k], keyOf(k)), r, "what was stored under a key");
    }
}

function during(keyOf) {
    for (let r = 0; r < rounds; ++r)
        round(r, keyOf);
}

const atom = k => atoms[k];
const rope = k => "k" + k;
for (let r = 0; r < 8; ++r)
    round(r, atom);
during(atom);
during(rope);
during(atom);

console.log("passed");
