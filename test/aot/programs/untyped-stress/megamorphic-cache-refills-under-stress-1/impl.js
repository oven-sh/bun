const aotRemarks = () => null, isAOTCompiled = () => false, aotFunctionsNamed = () => [], aotOperationCount = () => 0, aotTypeCoverage = () => null, aotSetFamily = () => undefined, aotFamilyOf = () => 0, aotHasDepartedFamily = () => false;

function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function atMost(actual, limit, what) {
    if (actual > limit)
        throw new Error(what + ": " + actual + ", not at most " + limit);
}
function atLeast(actual, limit, what) {
    if (actual < limit)
        throw new Error(what + ": " + actual + ", not at least " + limit);
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

const counts = typeof aotOperationCount === "function" && aotOperationCount("operationAOTPutById") !== null && isAOTCompiled(adds) && (aotRemarks("adds") || []).includes("calls:PutById");
function count(name) { return counts ? aotOperationCount(name) || 0 : 0; }

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

const names = ["operationAOTPutById", "operationAOTPutByVal", "MegamorphicCache::replace:new-pair", "MegamorphicCache::replace:pair-again", "MegamorphicCache::store:present"];
function during(keyOf) {
    const before = names.map(count);
    for (let r = 0; r < rounds; ++r)
        round(r, keyOf);
    const [stores, keyedStores, newPairs, pairsAgain, present] = names.map((name, i) => count(name) - before[i]);
    return { stores, keyedStores, fills: newPairs + pairsAgain, present };
}

const atom = k => atoms[k];
const rope = k => "k" + k;
for (let r = 0; r < 8; ++r)
    round(r, atom);
const withAtoms = during(atom);
const withRopes = during(rope);
const withAtomsAgain = during(atom);

if (counts) {
    const all = rounds * keyed;
    atMost(withAtoms.keyedStores, all / 4, "stores under a key that is an atom are served from the cache");
    check(withRopes.keyedStores, all, "a store under a key that is a rope arrives each time");
    atLeast(withRopes.present, all * 3 / 4, "arrivals that find their entry in the cache");
    atMost(withRopes.fills, all / 4, "entries filled by arrivals under keys that are ropes");
    const usual = Math.max(withAtoms.stores, withAtomsAgain.stores);
    atMost(withRopes.stores, usual * 1.3 + 40, "other stores that miss while entries that are there are asked for again (" + usual + " while they are not)");
}
console.log("passed");
