(function () {
    function check(actual, expected, what) {
        if (!Object.is(actual, expected))
            throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
    }
    function describe(o) { return Object.keys(o).map(k => k + "=" + o[k]).join(); }

    function makesCounter() {
        var k = 1;
        function bumps() { k++; }
        function fillsWithCounter(o) { o.a = k; o.b = k; o.c = k; o.d = k; }
        return { fillsWithCounter, bumps };
    }
    {
        let made = makesCounter();
        let plain = {};
        made.fillsWithCounter(plain);
        check(describe(plain), "a=1,b=1,c=1,d=1", "nothing changes the variable");
        let o = { set a(v) { made.bumps(); this._a = v; } };
        made.fillsWithCounter(o);
        check([o._a, o.b, o.c, o.d].join(), "1,2,2,2", "the setter of the first store changes the variable that the others store");
        let twice = { set a(v) { made.bumps(); }, set c(v) { made.bumps(); this._c = v; } };
        made.fillsWithCounter(twice);
        check([twice.b, twice._c, twice.d].join(), "3,3,4", "two setters change it");
    }

    function makesTarget() {
        var other = {};
        var target = { set a(v) { target = other; } };
        function fillsTarget() { target.a = 1; target.b = 2; target.c = 3; target.d = 4; }
        return { fillsTarget, other, first: target };
    }
    {
        let made = makesTarget();
        made.fillsTarget();
        check(JSON.stringify(made.other), '{"b":2,"c":3,"d":4}', "the setter of the first store changes the variable that holds the object");
        check(Object.keys(made.first).join(), "a", "and the first object gets nothing more");
        made.fillsTarget();
        check(JSON.stringify(made.other), '{"b":2,"c":3,"d":4,"a":1}', "afterwards all of them go to the other object");
    }

    var w = 2;
    function storesVariableSecond(o) { o.a = 1; o.b = w; o.c = 3; o.d = 4; return o.b; }
    check(storesVariableSecond({}), 2, "a variable among constants");
    check(storesVariableSecond({ set a(x) { w = 100; } }), 100, "a setter changes it first");
    w = 2;
    check(storesVariableSecond(new Proxy({}, { set(t, key, v) { if (key === "a") w = 7; t[key] = v; return true; } })), 7, "a trap of a proxy changes it first");
    w = 2;
    check(storesVariableSecond(Object.create(new Proxy({}, { set(t, key, v, r) { if (key === "a") w = 8; return Reflect.set(t, key, v, r); } }))), 8, "a trap of a proxy in the prototype chain changes it first");
    w = 2;
    check(storesVariableSecond(Object.create({ set a(x) { w = 9; } })), 9, "an inherited setter changes it first");
    w = 2;

    var variableBase = {};
    var replacement = {};
    function storesToVariable() { variableBase.a = 1; variableBase.b = 2; variableBase.c = 3; variableBase.d = 4; }
    variableBase = { set a(x) { variableBase = replacement; } };
    storesToVariable();
    check(Object.keys(replacement).join(), "b,c,d", "the variable that holds the object, in this scope");

    var v = 1;
    class WithSetter { set a(x) { v = 2; } }
    const instance = new WithSetter;
    function storesToConstant() { instance.a = 0; instance.b = v; instance.c = 3; instance.d = 4; }
    storesToConstant();
    check(instance.b, 2, "the setter of a class changes the variable");

    function makesInstanceInVariable() {
        var other = {};
        class Redirects { set a(x) { held = other; } }
        var held = new Redirects;
        const first = held;
        function storesToInstanceInVariable() { held.a = 0; held.b = 1; held.c = 2; held.d = 3; }
        storesToInstanceInVariable();
        return Object.keys(first).join() + "|" + Object.keys(other).join();
    }
    check(makesInstanceInVariable(), "|b,c,d", "the setter of a class changes the variable that holds the object");

    var dirty = 0;
    class Tracked {
        constructor(value) {
            this.value = value;
            this.wasDirty = dirty;
            this.c = 3;
            this.d = 4;
            this.e = 5;
        }
        set value(x) { dirty++; this._value = x; }
    }
    check(new Tracked(1).wasDirty, 1, "a setter run by a store to this in a constructor");
    check(new Tracked(1).wasDirty, 2, "again");

    var late = "before";
    function usesVariableAfterwards(o) { o.a = 1; o.b = 2; o.c = 3; o.d = 4; return late; }
    check(usesVariableAfterwards({ set d(x) { late = "after"; } }), "after", "a variable that is read after the last store");
    late = "before";

    var seen = "unchanged";
    function throwsHalfWay(o) {
        try {
            o.a = 1; o.b = seen; o.c = 3; o.d = 4;
        } catch (error) {
            return error.message + ":" + seen + ":" + Object.keys(o).join("");
        }
        return "nothing was thrown";
    }
    check(throwsHalfWay({ set a(x) { seen = "changed"; }, set c(x) { throw new RangeError("from c"); } }), "from c:changed:acb", "a setter changes the variable and a later one throws");
    seen = "unchanged";

    var inLiteral = 1;
    function storesLiteralOfVariable(o) { o.a = 1; o.b = { held: inLiteral }; o.c = 3; o.d = 4; return o.b.held; }
    check(storesLiteralOfVariable({}), 1, "a literal that holds the variable");
    check(storesLiteralOfVariable({ set a(x) { inLiteral = 2; } }), 2, "a setter changes it before the literal is made");
    inLiteral = 1;

    var early = 5;
    function readsBeforeStoring(o) { let value = early; o.a = value; o.b = value; o.c = value; o.d = value; return o; }
    check(describe(readsBeforeStoring({})), "a=5,b=5,c=5,d=5", "the variable is read once, before the first store");
    {
        let o = readsBeforeStoring({ set a(x) { early = 6; } });
        check([o.b, o.c, o.d].join(), "5,5,5", "a setter changes it too late");
        early = 5;
    }

    var middle = 5;
    function readsInTheMiddle(o) { o.a = 1; o.b = 2; o.c = 3; o.d = 4; o.e = middle; o.f = 6; o.g = 7; o.h = 8; return o; }
    check(describe(readsInTheMiddle({})), "a=1,b=2,c=3,d=4,e=5,f=6,g=7,h=8", "four stores, the variable, three more");
    check(readsInTheMiddle({ set a(x) { middle = 50; } }).e, 50, "a setter of the first four changes it");
    middle = 5;
    check(readsInTheMiddle({ set f(x) { middle = 50; } }).e, 5, "a setter of the last three changes it too late");
    middle = 5;

    function fillsFromParameters(o, a, b, c, d) { o.a = a; o.b = b; o.c = c; o.d = d; return o; }
    check(describe(fillsFromParameters({}, 1, 2, 3, 4)), "a=1,b=2,c=3,d=4", "values from parameters");
    {
        let log = [];
        fillsFromParameters({ set b(x) { log.push("b=" + x + " sees " + Object.keys(this).join("")); }, set d(x) { log.push("d=" + x + " sees " + Object.keys(this).join("")); } }, 1, 2, 3, 4);
        check(log.join(), "b=2 sees bda,d=4 sees bdac", "setters see what was stored before them");
    }

    function makesFiller(a, b, c, d) {
        const fillsFromCaptures = (o) => { o.a = a; o.b = b; o.c = c; o.d = d; return o; };
        return fillsFromCaptures;
    }
    check(describe(makesFiller(1, 2, 3, 4)({})), "a=1,b=2,c=3,d=4", "values from variables that are never assigned to");
    check(describe(makesFiller(5, 6, 7, 8)({ z: 0 })), "z=0,a=5,b=6,c=7,d=8", "another closure");

    function fillsWhatItCaptures(o, a, b) {
        const keeps = () => a + b;
        o.a = a; o.b = b; o.c = a; o.d = b;
        return keeps;
    }
    {
        let o = {};
        check(fillsWhatItCaptures(o, 1, 2)() + describe(o), "3a=1,b=2,c=1,d=2", "values from variables that a closure made here reads");
    }
})();
console.log("passed");
