// @bun
// A tagged template whose tag is a super property reference, super.tag`...` or super[key]`...`, must call
// the tag with the same |this| as super.tag(...) would: the |this| of the method containing it
// (EvaluateCall, https://tc39.es/ecma262/#sec-evaluatecall, step 1.a.i: GetThisValue of a Super Reference).
// It used to be called with the object the tag was found on, the home object's prototype, as if it were
// written Base.prototype.tag`...`.

function describe(value) {
    if (typeof value === "function")
        return `function ${value.name}`;
    if (typeof value === "object" && value !== null)
        return `[object ${value.constructor ? value.constructor.name : "?"}]`;
    return `${typeof value} ${String(value)}`;
}

function shouldBe(actual, expected, message) {
    if (actual !== expected)
        throw new Error(`${message}: got ${describe(actual)}, expected ${describe(expected)}`);
}

function shouldThrowReferenceError(func, message) {
    let error;
    try {
        func();
    } catch (e) {
        error = e;
    }
    if (!(error instanceof ReferenceError))
        throw new Error(`${message}: expected a ReferenceError, got ${String(error)}`);
}

const failures = [];
function test(name, func) {
    try {
        func();
    } catch (e) {
        failures.push(`${name}: ${e.message}`);
    }
}

// Every tag records the |this| it was called with and returns it, so callers can compare it with `===`.
// All of them are strict, so they see exactly the value they were passed.
function tagStrict(strings) {
    "use strict";
    tagStrict.lastCall = { thisValue: this, strings, values: Array.prototype.slice.call(arguments, 1) };
    return this;
}

class Base {
    tag(strings, ...values) {
        Base.lastCall = { thisValue: this, strings, values };
        return this;
    }
    get getterTag() {
        Base.lastGetterReceiver = this;
        return tagStrict;
    }
    static tag() {
        return this;
    }
}
const key = "tag";
const symbolKey = Symbol("tag");
Base.prototype[symbolKey] = tagStrict;
Base.prototype[0] = tagStrict;

test("super.tag in a method", () => {
    class C extends Base {
        m() { return super.tag`x`; }
        call() { return super.tag(); }
    }
    const c = new C;
    shouldBe(c.m(), c, "super.tag`x` is called with the receiver as this");
    shouldBe(Base.lastCall.strings.length, 1, "the template object is still passed");
    shouldBe(Base.lastCall.strings[0], "x", "the template strings are still passed");
    shouldBe(c.call(), c, "super.tag() is called with the receiver as this");
});

test("super.tag is still looked up on the super base, not on this", () => {
    class C extends Base {
        tag() { throw new Error("C.prototype.tag must not be called by super.tag`x`"); }
        m() { return super.tag`x`; }
    }
    const c = new C;
    shouldBe(c.m(), c, "super.tag`x` resolves to Base.prototype.tag and is called with the receiver");
});

test("super.tag two levels up", () => {
    class Middle extends Base { }
    class C extends Middle {
        m() { return super.tag`x`; }
    }
    const c = new C;
    shouldBe(c.m(), c, "a tag inherited through an intermediate class is called with the receiver");
});

test("super[key] with a variable, a string literal, a symbol and an index", () => {
    class C extends Base {
        variable() { return super[key]`x`; }
        literal() { return super["tag"]`x`; }
        symbol() { return super[symbolKey]`x`; }
        index() { return super[0]`x`; }
    }
    const c = new C;
    shouldBe(c.variable(), c, "super[key]`x`");
    shouldBe(c.literal(), c, "super[\"tag\"]`x`");
    shouldBe(c.symbol(), c, "super[symbolKey]`x`");
    shouldBe(c.index(), c, "super[0]`x`");
});

test("template object and substitutions", () => {
    class C extends Base {
        dot(a, b) { return super.tag`a${a}b${b}c`; }
        bracket(a, b) { return super[key]`a${a}b${b}c`; }
    }
    const c = new C;
    for (const [name, method] of [["super.tag", c.dot], ["super[key]", c.bracket]]) {
        shouldBe(method.call(c, 1, 2), c, `${name} with substitutions is called with the receiver`);
        const { strings, values } = Base.lastCall;
        shouldBe(strings.length, 3, `${name}: strings.length`);
        shouldBe(strings.join(","), "a,b,c", `${name}: strings`);
        shouldBe(strings.raw.join(","), "a,b,c", `${name}: strings.raw`);
        shouldBe(values.length, 2, `${name}: values.length`);
        shouldBe(values[0], 1, `${name}: values[0]`);
        shouldBe(values[1], 2, `${name}: values[1]`);
        method.call(c, 3, 4);
        shouldBe(Base.lastCall.strings, strings, `${name}: the template object is cached per call site`);
    }
});

test("substitutions are evaluated after the tag is looked up and see the same this", () => {
    const log = [];
    class C extends Base {
        get probe() { log.push("substitution"); return this; }
        m() { return super.tag`${this.probe}${log.push("second")}`; }
    }
    const c = new C;
    shouldBe(c.m(), c, "this value");
    shouldBe(log.join(), "substitution,second", "substitution order");
    shouldBe(Base.lastCall.values[0], c, "the substitution saw the receiver");
    shouldBe(Base.lastCall.values[1], 2, "the second substitution");
});

test("getter on the super base", () => {
    class C extends Base {
        dot() { return super.getterTag`x`; }
        bracket() { return super["getterTag"]`x`; }
    }
    const c = new C;
    shouldBe(c.dot(), c, "the function a super getter returns is called with the receiver");
    shouldBe(Base.lastGetterReceiver, c, "super.getterTag invokes the getter with the receiver");
    Base.lastGetterReceiver = null;
    shouldBe(c.bracket(), c, "the same through super[\"getterTag\"]");
    shouldBe(Base.lastGetterReceiver, c, "super[\"getterTag\"] invokes the getter with the receiver");
});

test("static method", () => {
    class C extends Base {
        static dot() { return super.tag`x`; }
        static bracket() { return super[key]`x`; }
    }
    shouldBe(C.dot(), C, "static super.tag`x` is called with the class as this");
    shouldBe(C.bracket(), C, "static super[key]`x` is called with the class as this");
});

test("object literal method", () => {
    const proto = { tag: tagStrict, [symbolKey]: tagStrict };
    const object = {
        __proto__: proto,
        dot() { return super.tag`x`; },
        bracket() { return super[symbolKey]`x`; },
    };
    shouldBe(object.dot(), object, "super.tag`x` in an object literal method");
    shouldBe(object.bracket(), object, "super[key]`x` in an object literal method");

    const inheriting = { __proto__: object };
    shouldBe(inheriting.dot(), inheriting, "the receiver, not the home object, when the method is called through an inheriting object");
    shouldBe(inheriting.bracket(), inheriting, "the same for super[key]");
});

test("primitive receivers are passed through like super.tag() passes them", () => {
    class C extends Base {
        dot() { return super.tag`x`; }
        bracket() { return super[key]`x`; }
        call() { return super.tag(); }
    }
    // Class code is strict, so the primitive reaches the method unconverted and is passed on as is.
    shouldBe(C.prototype.call.call(5), 5, "sanity: super.tag() from a strict method passes the primitive through");
    shouldBe(C.prototype.dot.call(5), 5, "super.tag`x` from a strict method passes the primitive through");
    shouldBe(C.prototype.bracket.call(5), 5, "super[key]`x` from a strict method passes the primitive through");

    // A sloppy method (made with Function so that it is sloppy whatever mode this file runs in) boxes its
    // receiver on entry; the tag has to be called with that box.
    const proto = { tag: tagStrict };
    const sloppy = Function("proto", "return { __proto__: proto, dot() { return super.tag`x`; }, call() { return super.tag(); } };")(proto);
    const boxedByCall = sloppy.call.call(5);
    shouldBe(typeof boxedByCall, "object", "sanity: super.tag() from a sloppy method passes the boxed receiver");
    const boxed = sloppy.dot.call(5);
    shouldBe(typeof boxed, "object", "super.tag`x` from a sloppy method passes the boxed receiver");
    shouldBe(boxed instanceof Number, true, "the box is a Number object");
    shouldBe(boxed.valueOf(), 5, "the box holds the receiver");
});

test("super base replaced after the class was defined", () => {
    class C extends Base {
        m() { return super.tag`x`; }
    }
    Object.setPrototypeOf(C.prototype, { tag: tagStrict });
    const c = new C;
    tagStrict.lastCall = null;
    shouldBe(c.m(), c, "this is still the receiver when the tag comes from the replacement super base");
    shouldBe(tagStrict.lastCall.thisValue, c, "the replacement tag is the one that was called");
});

test("arrow functions inside a method", () => {
    class C extends Base {
        dot() { return (() => super.tag`x`)(); }
        bracket() { return (() => (() => super[key]`x`)())(); }
    }
    const c = new C;
    shouldBe(c.dot(), c, "super.tag`x` inside an arrow function uses the method's this");
    shouldBe(c.bracket(), c, "super[key]`x` inside nested arrow functions uses the method's this");
});

test("direct eval inside a method", () => {
    class C extends Base {
        dot() { return eval("super.tag`x`"); }
        bracket() { return eval("super[key]`x`"); }
    }
    const c = new C;
    shouldBe(c.dot(), c, "super.tag`x` in eval code");
    shouldBe(c.bracket(), c, "super[key]`x` in eval code");
});

test("class field initializers", () => {
    class C extends Base {
        dot = super.tag`x`;
        bracket = super[key]`x`;
        static staticDot = super.tag`x`;
        static staticBracket = super[key]`x`;
    }
    const c = new C;
    shouldBe(c.dot, c, "instance field initializer, super.tag");
    shouldBe(c.bracket, c, "instance field initializer, super[key]");
    shouldBe(C.staticDot, C, "static field initializer, super.tag");
    shouldBe(C.staticBracket, C, "static field initializer, super[key]");
});

test("generator and async methods", () => {
    class C extends Base {
        *generator() { yield super.tag`x`; yield super[key]`x`; }
        async asyncMethod() { return [super.tag`x`, await null, super[key]`x`]; }
    }
    const c = new C;
    const results = Array.from(c.generator());
    shouldBe(results[0], c, "generator method, super.tag");
    shouldBe(results[1], c, "generator method, super[key]");

    let asyncResult;
    let asyncError;
    c.asyncMethod().then((value) => { asyncResult = value; }, (error) => { asyncError = error; });
    drainMicrotasks();
    if (asyncError)
        throw asyncError;
    shouldBe(asyncResult[0], c, "async method, super.tag before an await");
    shouldBe(asyncResult[2], c, "async method, super[key] after an await");
});

test("derived constructor after super()", () => {
    let seen;
    class C extends Base {
        constructor() {
            super();
            seen = [super.tag`x`, super[key]`x`, this];
        }
    }
    const c = new C;
    shouldBe(seen[2], c, "sanity: this is the constructed object");
    shouldBe(seen[0], c, "super.tag`x` after super() is called with the new object");
    shouldBe(seen[1], c, "super[key]`x` after super() is called with the new object");
});

test("derived constructor before super(): this is in its TDZ", () => {
    // Nothing belonging to the tagged template may run before the uninitialized |this| is detected: neither the
    // key of super[key] nor the substitutions. This is the order super[key]() and a plain super[key] read already use.
    const log = [];
    const evaluatedKey = () => { log.push("key"); return "tag"; };
    const substitution = () => { log.push("substitution"); return 1; };
    Base.lastCall = null;

    class Dot extends Base {
        constructor() { super.tag`${substitution()}`; super(); }
    }
    shouldThrowReferenceError(() => new Dot, "super.tag`...` before super()");

    class Bracket extends Base {
        constructor() { super[evaluatedKey()]`${substitution()}`; super(); }
    }
    shouldThrowReferenceError(() => new Bracket, "super[key]`...` before super()");

    class InArrow extends Base {
        constructor() { (() => super[evaluatedKey()]`${substitution()}`)(); super(); }
    }
    shouldThrowReferenceError(() => new InArrow, "super[key]`...` in an arrow function before super()");

    shouldBe(log.length, 0, `neither the key nor the substitutions were evaluated (evaluated: ${log.join()})`);
    shouldBe(Base.lastCall, null, "the tag was never called");
});

test("tags that are not super references keep their this", () => {
    const object = { tag: tagStrict, 0: tagStrict };
    const log = [];
    function base() { log.push("base"); return object; }
    function property() { log.push("key"); return "tag"; }
    shouldBe(object.tag`x`, object, "object.tag`x`");
    shouldBe(object["tag"]`x`, object, "object[\"tag\"]`x`");
    shouldBe(object[0]`x`, object, "object[0]`x`");
    shouldBe(base()[property()]`x`, object, "base()[key()]`x` is called with the base");
    shouldBe(log.join(), "base,key", "base()[key()]`x` evaluates the base before the key");
    shouldBe(tagStrict`x`, undefined, "tag`x` through a binding is called with undefined");
    class C extends Base {
        other() { return object.tag`x`; }
        own() { return this.tag`x`; }
    }
    const c = new C;
    shouldBe(c.other(), object, "object.tag`x` inside a method is called with the object");
    shouldBe(c.own(), c, "this.tag`x` is called with this");
});

test("optimized tiers", () => {
    class C extends Base {
        dot() { return super.tag`x`; }
        bracket() { return super[key]`x`; }
    }
    noInline(C.prototype.dot);
    noInline(C.prototype.bracket);
    const c = new C;
    for (let i = 0; i < testLoopCount; ++i) {
        if (c.dot() !== c)
            throw new Error(`super.tag\`x\` was called with the wrong this on iteration ${i}`);
        if (c.bracket() !== c)
            throw new Error(`super[key]\`x\` was called with the wrong this on iteration ${i}`);
    }
});

if (failures.length)
    throw new Error(`FAIL:\n${failures.join("\n")}`);
