const aotRemarks = () => null, isAOTCompiled = () => false, aotFunctionsNamed = () => [], aotOperationCount = () => 0, aotTypeCoverage = () => null, aotSetFamily = () => undefined, aotFamilyOf = () => 0, aotHasDepartedFamily = () => false;

function shouldBe(actual, expected, what)
{
    if (actual !== expected)
        throw new Error(what + ": " + actual + " instead of " + expected);
}

function remarksOf(f)
{
    return typeof aotRemarks === "function" && isAOTCompiled(f) ? aotRemarks(f.name) : null;
}

function readsProperty(o) { return o.property; }
readsProperty({ property: 1 });
const usesDataStubs = (remarksOf(readsProperty) || []).includes("calls:GetById");
const counts = usesDataStubs && typeof aotOperationCount === "function" && aotOperationCount("operationAOTCreateThisWithProperties") !== null;

function applies(name, remark)
{
    const remarks = typeof aotRemarks === "function" ? aotRemarks(name) : null;
    if (remarks && remarks.length && !remarks.includes(remark))
        throw new Error(name + " lacks the remark " + remark + ": " + remarks.join(" "));
}

function arrivals(operation, run)
{
    const before = counts ? aotOperationCount(operation) : 0;
    run();
    return counts ? aotOperationCount(operation) - before : null;
}

function atMost(actual, limit, what)
{
    if (actual !== null && actual > limit)
        throw new Error(what + ": " + actual + " arrivals, at most " + limit + " expected");
}

function atLeast(actual, limit, what)
{
    if (actual !== null && actual < limit)
        throw new Error(what + ": " + actual + " arrivals, at least " + limit + " expected");
}

(function () {
    class Point {
        constructor(x, y)
        {
            this.x = x;
            this.y = y;
        }
    }

    function sumOfPoints(count)
    {
        let sum = 0;
        for (let i = 0; i < count; ++i) {
            const point = new Point(i, 1);
            if (point.x !== i)
                throw new Error("x is " + point.x + " instead of " + i);
            sum += point.y;
        }
        return sum;
    }

    function manyTimes(rounds)
    {
        let sum = 0;
        for (let i = 0; i < rounds; ++i)
            sum += sumOfPoints(100);
        return sum;
    }

    applies("Point", "planned-construction");
    atLeast(arrivals("operationAOTCreateThisWithProperties", () => shouldBe(manyTimes(400), 40000, "first points")), 1, "the first constructions fill the cache");
    for (let collection = 0; collection < 4; ++collection) {
        gc();
        atMost(arrivals("operationAOTCreateThisWithProperties", () => shouldBe(manyTimes(100), 10000, "points after a collection")), 60, "constructions after collection " + collection);
    }
    atLeast(counts ? aotOperationCount("operationAOTCreateThisWithProperties:valid-cache") : null, 4, "an empty free list leaves the cache as it is");
    atMost(counts ? aotOperationCount("operationAOTCreateThisWithProperties:valid-cache-after-replay") : null, 0, "a valid cache is used without replaying the plan");
})();

(function () {
    class Parent {
        constructor(value)
        {
            this.value = value;
            this.other = 1;
        }
    }
    class First extends Parent { }
    class Second extends Parent { }
    class Third extends Parent { }

    function makesAll(count)
    {
        let sum = 0;
        for (let i = 0; i < count; ++i) {
            const first = new First(i), second = new Second(i + 1), third = new Third(i + 2);
            if (!(first instanceof First) || !(second instanceof Second) || !(third instanceof Third) || second instanceof First)
                throw new Error("an object of the wrong class");
            sum += first.value + second.value + third.value + first.other + second.other + third.other;
        }
        return sum;
    }

    applies("Parent", "planned-construction");
    for (let i = 0; i < 100; ++i)
        shouldBe(makesAll(10), 195, "objects of three classes");
    for (let collection = 0; collection < 3; ++collection) {
        gc();
        atMost(arrivals("operationAOTCreateThisWithProperties", () => {
            for (let i = 0; i < 300; ++i)
                shouldBe(makesAll(10), 195, "objects of three classes after a collection");
        }), 60, "constructions by three classes after collection " + collection);
    }
    atLeast(counts ? aotOperationCount("operationAOTCreateThisWithProperties:valid-megamorphic-entry") : null, 1, "an empty free list leaves the entries of the other classes as they are");
})();

(function () {
    class Starved {
        constructor(value) { this.value = value; }
    }
    const kept = [null, null, null, null];
    const object = { property: 1 };

    function alternates(count, others)
    {
        let found = 0;
        for (let i = 0; i < count; ++i) {
            kept[i & 3] = new Starved(i);
            for (let k = 0; k < others; ++k) {
                if (delete object.absent)
                    found++;
            }
        }
        return found;
    }

    applies("Starved", "planned-construction");
    for (let i = 0; i < 100; ++i)
        alternates(0, 0);
    for (const others of [1, 3, 7]) {
        const name = "a constructor that alternates with " + others + " other operations";
        atMost(arrivals("operationAOTCreateThisWithProperties", () => shouldBe(alternates(10000, others), 10000 * others, name)), 100, name);
    }
    atLeast(arrivals("operationAOTDelById", () => alternates(100, 1)), 100, "an operation without a fast path is counted every time");
})();

(function () {
    function callsIt(f, box) { return f(box.value); }
    function makeAdder(n) { return value => value + n; }
    const adders = [];
    for (let i = 0; i < 200; ++i)
        adders.push(makeAdder(i));
    const box = { value: 1 };
    if (usesDataStubs)
        applies("callsIt", "cached-call");

    function callsFixed()
    {
        let sum = 0;
        for (let i = 0; i < 1000; ++i)
            sum += callsIt(adders[1], box);
        return sum;
    }

    function callsMany(count)
    {
        let sum = 0;
        for (let i = 0; i < count; ++i)
            sum += callsIt(adders[i], box);
        return sum;
    }

    let seen = 0;
    function triesSinceLastAsked()
    {
        if (!counts)
            return null;
        const before = seen;
        seen = aotOperationCount("operationAOTCacheCallee");
        return seen - before;
    }

    function exactly(expected, what)
    {
        const tries = triesSinceLastAsked();
        if (tries !== null)
            shouldBe(tries, expected, what);
    }

    triesSinceLastAsked();
    let sum = callsMany(200);
    const firstTries = triesSinceLastAsked();
    shouldBe(sum, 200 + 199 * 100, "many callees");
    atLeast(firstTries, 2, "a call site tries to remember its callee");
    atMost(firstTries, 8, "a call site that sees many callees stops trying");
    triesSinceLastAsked();
    sum = callsFixed();
    exactly(0, "a call site that stopped trying does not try before a collection");
    shouldBe(sum, 2000, "one callee after many");
    for (let collection = 0; collection < 3; ++collection) {
        gc();
        triesSinceLastAsked();
        sum = callsFixed();
        exactly(1, "a call site tries once after collection " + collection);
        shouldBe(sum, 2000, "one callee after a collection");
        triesSinceLastAsked();
        sum = callsFixed();
        exactly(0, "a call site remembers its one callee after collection " + collection);
        shouldBe(sum, 2000, "one callee that is remembered");
        triesSinceLastAsked();
        sum = callsMany(20);
        exactly(1, "a call site that sees many callees again stops at once after collection " + collection);
        shouldBe(sum, 20 + 19 * 10, "many callees again");
    }
})();

(function () {
    class Base {
        method() { return 1; }
    }
    function callsMethod(o) { return o.method() + (o.absent === undefined ? 1 : 0); }
    function stores(o, value) { o.stored = value; return o; }

    function burst(name)
    {
        let sum = 0;
        for (let i = 0; i < 300; ++i) {
            const object = new Base;
            object[name] = i;
            sum += callsMethod(stores(object, i));
        }
        return sum;
    }

    for (let collection = 0; collection < 8; ++collection) {
        shouldBe(burst("transient" + collection), 600, "objects of a shape that dies");
        gc();
    }
    Base.prototype.method = function () { return 2; };
    shouldBe(burst("transient"), 900, "a method that was replaced");
    Base.prototype.absent = 1;
    shouldBe(burst("transient"), 600, "a property that is no longer absent");
})();

(function () {
    function addsMany(o)
    {
        o.a = 1; o.b = 2; o.c = 3; o.d = 4; o.e = 5; o.f = 6; o.g = 7; o.h = 8; o.i = 9;
        return o;
    }
    for (let collection = 0; collection < 3; ++collection) {
        for (let i = 0; i < 300; ++i) {
            const object = addsMany({});
            shouldBe(object.a + object.g + object.h + object.i, 25, "properties that make the storage grow");
        }
        gc();
    }
})();
console.log("passed");
