function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

(function () {
    function OnlyConstructed(start) {
        var n = start;
        var twice = function twice(x) { return x * 2; };
        this.get = function readsOnlyConstructed() { return twice(n) + 1; };
    }
    check(new OnlyConstructed(3).get(), 7, "only constructed");

    function OnlyCalled(start) {
        var n = start;
        var halves = function halves(x) { return x / 2; };
        return { owner: this, get: function readsOnlyCalled() { return halves(n) + 1; } };
    }
    check(OnlyCalled(4).get(), 3, "only called");

    function Both(start) {
        var m = start;
        var thrice = function thrice(x) { return x * 3; };
        var read = function readsBoth() { return thrice(m) + 1; };
        if (new.target)
            this.read = read;
        return read;
    }
    check(Both(1)(), 4, "called");
    check(new Both(2)(), 7, "constructed");
    check(Both(1.5)(), 5.5, "called with a double");
    check(new Both("2")(), 7, "constructed with a string");

    function Differs() {
        var pick = new.target ? function whenConstructed(x) { return x + 1; } : function whenCalled(x) { return x + 2; };
        return function runsPick(x) { return pick(x); };
    }
    check(Differs()(1), 3, "the function stored by the call");
    check(new Differs()(1), 2, "the function stored by the construction");

    function MakesEither() {
        return new.target ? function madeByConstruction(x) { return x + 1; } : function madeByCall(x) { return x + 2; };
    }
    check(new MakesEither()(1), 2, "a function that only the construction makes");
    check(MakesEither()(1), 3, "a function that only the call makes");

    function MakesWhenConstructed() {
        if (!new.target)
            return null;
        var factor = 2;
        return function madeWhenConstructed(x) {
            return [x].map(function nestedInMadeWhenConstructed(y) { return y * factor; })[0];
        };
    }
    check(new MakesWhenConstructed()(4), 8, "a function, and one nested in it, that the call never makes");
    check(MakesWhenConstructed(), null, "the call makes nothing");

    function KeepsEither() {
        var kept = new.target ? "text" : 1;
        return function readsKept() { return kept + 1; };
    }
    check(KeepsEither()(), 2, "a number from the call");
    check(new KeepsEither()(), "text1", "a string from the construction");

    function KeepsTarget() {
        var target = new.target;
        return function readsTarget() { return typeof target; };
    }
    check(new KeepsTarget()(), "function", "new.target of the construction");
    check(KeepsTarget()(), "undefined", "new.target of the call");

    function KeepsOr() {
        let who = new.target || 1;
        return function readsWho() { return typeof (who + 1); };
    }
    check(KeepsOr()(), "number", "the other operand in the call");
    check(new KeepsOr()(), "string", "new.target in the construction");

    function KeepsCoalesced() {
        let who = new.target ?? 1.5;
        return function readsCoalesced() { return typeof (who + 1); };
    }
    check(KeepsCoalesced()(), "number", "the default in the call");
    check(new KeepsCoalesced()(), "string", "no default in the construction");

    function OnlyConstructedOr() {
        let who = new.target || 1;
        return function readsOnlyConstructedOr() { return typeof (who + 1); };
    }
    check(new OnlyConstructedOr()(), "string", "new.target of a function that is only constructed");

    function InBlock(n) {
        let all = [];
        for (let i = 0; i < n; i++) {
            let who = new.target || i;
            all.push(function readsInBlock() { return typeof (who + 1); });
        }
        return all;
    }
    check(InBlock(2)[1](), "number", "in a block of the call");
    check(new InBlock(2)[1](), "string", "in a block of the construction");

    function NestedOr() {
        let outer = new.target || 1;
        return function MiddleOr() {
            let inner = new.target || 2;
            return function readsNestedOr() { return typeof (outer + 1) + " " + typeof (inner + 1); };
        };
    }
    check(NestedOr()()(), "number number", "called, called");
    check(new (NestedOr())()(), "number string", "called, constructed");
    check(new NestedOr()()(), "string number", "constructed, called");
    check(new (new NestedOr())()(), "string string", "constructed, constructed");

    function WritesOr() {
        let who = 1;
        let write = function writesWho(v) { who = v; };
        write(new.target || 2);
        return function readsWritten() { return typeof (who + 1); };
    }
    check(WritesOr()(), "number", "a closure of the call writes a number");
    check(new WritesOr()(), "string", "a closure of the construction writes new.target");

    function HoldsThis() {
        "use strict";
        return () => this;
    }
    check(HoldsThis()(), undefined, "this of the call");
    check(typeof new HoldsThis()(), "object", "this of the construction");
    check(HoldsThis.call(5)(), 5, "this given to the call");

    function WritesBack(value) {
        var kept = 0;
        var write = function writesKept(v) { kept = v; };
        write(value);
        return new.target ? { kept } : kept;
    }
    check(WritesBack(1.5), 1.5, "written by a closure of the call");
    check(new WritesBack("s").kept, "s", "written by a closure of the construction");

    function InLoop(n) {
        var all = [];
        for (let i = 0; i < n; i++) {
            let j = new.target ? String(i) : i;
            all.push(function readsJ() { return j; });
        }
        return all;
    }
    check(InLoop(2)[1](), 1, "a scope made in a loop of the call");
    check(new InLoop(2)[1](), "1", "a scope made in a loop of the construction");

    function Nested(a) {
        var outer = new.target ? [a] : a;
        return function Middle(b) {
            var inner = new.target ? { b } : b;
            return function readsNested() { return [outer, inner]; };
        };
    }
    check(JSON.stringify(Nested(1)(2)()), "[1,2]", "called, called");
    check(JSON.stringify(new (Nested(1))(2)()), "[1,{\"b\":2}]", "called, constructed");
    check(JSON.stringify(new Nested(1)(2)()), "[[1],2]", "constructed, called");
    check(JSON.stringify(new (new Nested(1))(2)()), "[[1],{\"b\":2}]", "constructed, constructed");

    function Uninitialized(early) {
        var read = function readsLater() { return later; };
        if (early) {
            try {
                read();
            } catch (error) {
                return new.target ? { name: error.name } : error.name;
            }
        }
        let later = new.target ? "constructed" : "called";
        return new.target ? { name: read() } : read();
    }
    check(Uninitialized(true), "ReferenceError", "read too early in the call");
    check(new Uninitialized(true).name, "ReferenceError", "read too early in the construction");
    check(Uninitialized(false), "called", "read in time in the call");
    check(new Uninitialized(false).name, "constructed", "read in time in the construction");
})();
console.log("passed");
