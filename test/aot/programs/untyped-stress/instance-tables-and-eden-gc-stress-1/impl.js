(function () {
    function shouldBe(actual, expected, what) {
        if (actual !== expected)
            throw new Error(what + ": " + actual + " instead of " + expected);
    }
    function tag(strings) { return strings; }
    function keysOf(object) { return Object.keys(object).join(); }

    function literal0(x) { return { alpha0: x, beta0: x + 1, gamma0: x + 2 }; }
    function large0(x) { return { a0: x, b0: x, c0: x, d0: x, e0: x, f0: x, g0: x, h0: x, i0: x }; }
    function copy0(x) { const source = { left0: x, right0: x }; return { ...source }; }
    function run0(x) { const object = {}; object.first0 = x; object.second0 = x; object.third0 = x; object.fourth0 = x; return object; }
    function template0() { return tag`one0${1}two0`; }
    class Point0 { constructor(x) { this.x0 = x; this.y0 = x; this.z0 = 0; } }
    function construct0(x) { return new Point0(x); }
    function closure0(x) { return () => x + 0; }
    function assign0(x) { return Object.assign({ kept0: 0 }, { given0: x, taken0: x }); }

    function literal1(x) { return { alpha1: x, beta1: x + 1, gamma1: x + 2 }; }
    function large1(x) { return { a1: x, b1: x, c1: x, d1: x, e1: x, f1: x, g1: x, h1: x, i1: x }; }
    function copy1(x) { const source = { left1: x, right1: x }; return { ...source }; }
    function run1(x) { const object = {}; object.first1 = x; object.second1 = x; object.third1 = x; object.fourth1 = x; return object; }
    function template1() { return tag`one1${1}two1`; }
    class Point1 { constructor(x) { this.x1 = x; this.y1 = x; this.z1 = 0; } }
    function construct1(x) { return new Point1(x); }
    function closure1(x) { return () => x + 1; }
    function assign1(x) { return Object.assign({ kept1: 0 }, { given1: x, taken1: x }); }

    function literal2(x) { return { alpha2: x, beta2: x + 1, gamma2: x + 2 }; }
    function large2(x) { return { a2: x, b2: x, c2: x, d2: x, e2: x, f2: x, g2: x, h2: x, i2: x }; }
    function copy2(x) { const source = { left2: x, right2: x }; return { ...source }; }
    function run2(x) { const object = {}; object.first2 = x; object.second2 = x; object.third2 = x; object.fourth2 = x; return object; }
    function template2() { return tag`one2${1}two2`; }
    class Point2 { constructor(x) { this.x2 = x; this.y2 = x; this.z2 = 0; } }
    function construct2(x) { return new Point2(x); }
    function closure2(x) { return () => x + 2; }
    function assign2(x) { return Object.assign({ kept2: 0 }, { given2: x, taken2: x }); }

    function literal3(x) { return { alpha3: x, beta3: x + 1, gamma3: x + 2 }; }
    function large3(x) { return { a3: x, b3: x, c3: x, d3: x, e3: x, f3: x, g3: x, h3: x, i3: x }; }
    function copy3(x) { const source = { left3: x, right3: x }; return { ...source }; }
    function run3(x) { const object = {}; object.first3 = x; object.second3 = x; object.third3 = x; object.fourth3 = x; return object; }
    function template3() { return tag`one3${1}two3`; }
    class Point3 { constructor(x) { this.x3 = x; this.y3 = x; this.z3 = 0; } }
    function construct3(x) { return new Point3(x); }
    function closure3(x) { return () => x + 3; }
    function assign3(x) { return Object.assign({ kept3: 0 }, { given3: x, taken3: x }); }

    const groups = [
        { literal: literal0, large: large0, copy: copy0, run: run0, template: template0, construct: construct0, closure: closure0, assign: assign0, number: 0 },
        { literal: literal1, large: large1, copy: copy1, run: run1, template: template1, construct: construct1, closure: closure1, assign: assign1, number: 1 },
        { literal: literal2, large: large2, copy: copy2, run: run2, template: template2, construct: construct2, closure: closure2, assign: assign2, number: 2 },
        { literal: literal3, large: large3, copy: copy3, run: run3, template: template3, construct: construct3, closure: closure3, assign: assign3, number: 3 },
    ];

    function check(group, x) {
        const n = group.number;
        shouldBe(keysOf(group.literal(x)), `alpha${n},beta${n},gamma${n}`, "literal");
        shouldBe(group.literal(x)["gamma" + n], x + 2, "value in a literal");
        shouldBe(keysOf(group.large(x)), "abcdefghi".split("").map(name => name + n).join(), "large literal");
        shouldBe(keysOf(group.copy(x)), `left${n},right${n}`, "copy");
        shouldBe(keysOf(group.run(x)), `first${n},second${n},third${n},fourth${n}`, "run of properties");
        shouldBe(group.run(x)["fourth" + n], x, "value in a run of properties");
        shouldBe(group.template(), group.template(), "template object");
        shouldBe(group.template().join(), `one${n},two${n}`, "strings of a template object");
        shouldBe(group.template().raw.length, 2, "raw strings of a template object");
        shouldBe(keysOf(group.construct(x)), `x${n},y${n},z${n}`, "constructed object");
        shouldBe(group.closure(x)(), x + n, "closure");
        shouldBe(keysOf(group.assign(x)), `kept${n},given${n},taken${n}`, "assigned properties");
    }

    function makeOtherStructures(round) {
        for (let i = 0; i < 3000; ++i) {
            const object = {};
            object["other" + round + "x" + i] = i;
            object["more" + i] = [i];
        }
    }

    fullGC();
    const templates = [];
    for (let round = 0; round < groups.length; ++round) {
        const group = groups[round];
        for (let i = 0; i < (round & 1 ? 1 : 20); ++i)
            check(group, i);
        templates.push(group.template());
        edenGC();
        makeOtherStructures(round);
        edenGC();
        makeOtherStructures(round + 100);
        for (let earlier = 0; earlier <= round; ++earlier) {
            check(groups[earlier], round);
            shouldBe(groups[earlier].template(), templates[earlier], "template object after collections");
        }
        if (round === 1)
            fullGC();
    }
    fullGC();
    makeOtherStructures(1000);
    edenGC();
    for (const group of groups)
        check(group, 7);
})();
console.log("passed");
