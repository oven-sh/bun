// @bun
// A tagged template whose tag is a parenthesized optional chain, (a?.b)`...` or (a?.[k])`...`, must call the
// tag with |this| = a, the same |this| that (a?.b)(...) and a.b`...` get. The parentheses end the optional
// chain, but the expression they wrap is still the property reference a?.b, so EvaluateCall
// (https://tc39.es/ecma262/#sec-evaluatecall, step 1.a.i) uses GetThisValue of that reference. The tag used to
// be called with |this| = undefined, as if the chain had produced a plain value.
//
// Only the lookup of the tag short-circuits. When a is nullish, (a?.b)`...` is a call of undefined: the template
// object and the substitutions are still evaluated (ArgumentListEvaluation comes before the IsCallable check),
// and then a TypeError is thrown.

function shouldBe(actual, expected, message) {
    if (actual !== expected)
        throw new Error(`${message}: got ${String(actual)}, expected ${String(expected)}`);
}

function shouldThrowTypeError(func, message) {
    let error;
    try {
        func();
    } catch (e) {
        error = e;
    }
    if (!(error instanceof TypeError))
        throw new Error(`${message}: expected a TypeError, got ${String(error)}`);
}

// The tag is strict so it sees exactly the |this| it was called with, and it records the call.
function tag(strings) {
    "use strict";
    tag.lastCall = { thisValue: this, strings, values: Array.prototype.slice.call(arguments, 1) };
    return this;
}

const key = "tag";
const symbolKey = Symbol("tag");
const inner = { tag, [symbolKey]: tag, 0: tag };
const object = {
    tag,
    [symbolKey]: tag,
    0: tag,
    inner,
    get getterTag() {
        object.lastGetterReceiver = this;
        return tag;
    },
    getTag() {
        return tag;
    },
    method() {
        return (this?.tag)`x`;
    },
};

shouldBe((object?.tag)`x`, object, "(object?.tag)`x`");
shouldBe((object?.["tag"])`x`, object, "(object?.[\"tag\"])`x`");
shouldBe((object?.[key])`x`, object, "(object?.[key])`x`");
shouldBe((object?.[symbolKey])`x`, object, "(object?.[symbolKey])`x`");
shouldBe((object?.[0])`x`, object, "(object?.[0])`x`");
shouldBe(((object?.tag))`x`, object, "((object?.tag))`x`");
shouldBe(object.method(), object, "(this?.tag)`x` in a method");

// Longer chains: |this| is the base of the last property access.
shouldBe((object?.inner.tag)`x`, inner, "(object?.inner.tag)`x`");
shouldBe((object?.inner?.tag)`x`, inner, "(object?.inner?.tag)`x`");
shouldBe((object.inner?.tag)`x`, inner, "(object.inner?.tag)`x`");
shouldBe((object?.inner?.[key])`x`, inner, "(object?.inner?.[key])`x`");
shouldBe((object?.inner[symbolKey])`x`, inner, "(object?.inner[symbolKey])`x`");

// A getter on the base runs with the base as receiver, and the tag it returns is called with the base too.
shouldBe((object?.getterTag)`x`, object, "(object?.getterTag)`x`");
shouldBe(object.lastGetterReceiver, object, "the getter's receiver");

// The base of the chain can be any expression; it is evaluated once.
let getObjectCalls = 0;
function getObject() {
    getObjectCalls++;
    return object;
}
shouldBe((getObject()?.tag)`x`, object, "(getObject()?.tag)`x`");
shouldBe(getObjectCalls, 1, "the base is evaluated once");

// The template object, its raw strings and the substitutions are passed as for any tagged template, and the
// template object is cached per call site.
function withSubstitutions(a, b) {
    return (object?.tag)`a${a}b${b}c`;
}
shouldBe(withSubstitutions(1, 2), object, "(object?.tag)`a${a}b${b}c`");
{
    const { strings, values } = tag.lastCall;
    shouldBe(strings.length, 3, "strings.length");
    shouldBe(strings.join(","), "a,b,c", "strings");
    shouldBe(strings.raw.join(","), "a,b,c", "strings.raw");
    shouldBe(values.length, 2, "values.length");
    shouldBe(values[0], 1, "values[0]");
    shouldBe(values[1], 2, "values[1]");
    withSubstitutions(3, 4);
    shouldBe(tag.lastCall.strings, strings, "the template object is cached per call site");
    shouldBe(tag.lastCall.values[0], 3, "values[0] of the second call");
}

// Substitutions are evaluated after the tag is looked up, and see the same |this| as the enclosing code.
{
    const log = [];
    const probe = {
        get tag() { log.push("tag"); return tag; },
        m() { return (this?.tag)`${log.push("first")}${this}`; },
    };
    shouldBe(probe.m(), probe, "(this?.tag)`${...}` with substitutions");
    shouldBe(log.join(), "tag,first", "evaluation order");
    shouldBe(tag.lastCall.values[1], probe, "the substitution saw the enclosing this");
}

// Primitive receivers: a strict tag sees the primitive itself.
String.prototype.tag = tag;
Number.prototype.tag = tag;
shouldBe(("str"?.tag)`x`, "str", "(\"str\"?.tag)`x`");
shouldBe(((1)?.tag)`x`, 1, "((1)?.tag)`x`");
shouldBe(("str"?.["tag"])`x`, "str", "(\"str\"?.[\"tag\"])`x`");
delete String.prototype.tag;
delete Number.prototype.tag;

// Private names in the chain.
class WithPrivate {
    #tag = tag;
    #method(strings) { "use strict"; return this; }
    static #staticTag = tag;
    field() { return (this?.#tag)`x`; }
    method() { return (this?.#method)`x`; }
    static staticField() { return (WithPrivate?.#staticTag)`x`; }
    static onInstance(instance) { return (instance?.#tag)`x`; }
}
{
    const instance = new WithPrivate;
    shouldBe(instance.field(), instance, "(this?.#tag)`x`");
    shouldBe(instance.method(), instance, "(this?.#method)`x`");
    shouldBe(WithPrivate.staticField(), WithPrivate, "(WithPrivate?.#staticTag)`x`");
    shouldBe(WithPrivate.onInstance(instance), instance, "(instance?.#tag)`x`");
}

// A super property can be the base of the chain, but not the chain itself.
class Base {
    get inner() { return inner; }
}
class Derived extends Base {
    m() { return (super.inner?.tag)`x`; }
}
shouldBe(new Derived().m(), inner, "(super.inner?.tag)`x`");

// Other contexts that compile the same node.
function* generator() {
    yield (object?.tag)`x`;
}
shouldBe(generator().next().value, object, "(object?.tag)`x` in a generator");
globalThis.taggedTemplateThisObject = object;
shouldBe((0, eval)("(taggedTemplateThisObject?.tag)`x`"), object, "(object?.tag)`x` in indirect eval");
shouldBe(eval("(object?.tag)`x`"), object, "(object?.tag)`x` in direct eval");
shouldBe(new Function("object", "return (object?.tag)`x`")(object), object, "(object?.tag)`x` in new Function");
shouldBe((() => (object?.tag)`x`)(), object, "(object?.tag)`x` in an arrow function");
shouldBe([1].map(() => (object?.tag)`x`)[0], object, "(object?.tag)`x` in a callback");
{
    let result;
    if ((object?.tag)`x`)
        result = "truthy";
    shouldBe(result, "truthy", "(object?.tag)`x` in a condition");
}
shouldBe((object?.tag)`x`.tag, tag, "a property of the result");

// Tags that are not parenthesized optional chains keep their |this|.
shouldBe((object?.inner).tag`x`, inner, "(object?.inner).tag`x`");
shouldBe((object?.inner)[key]`x`, inner, "(object?.inner)[key]`x`");
shouldBe((object?.getTag())`x`, undefined, "(object?.getTag())`x` is a call of a plain value");
shouldBe((object?.tag ?? tag)`x`, undefined, "(object?.tag ?? tag)`x` is a call of a plain value");
shouldBe((object?.tag, tag)`x`, undefined, "(object?.tag, tag)`x` is a call of a plain value");
shouldBe(object.tag`x`, object, "object.tag`x`");
shouldBe(tag`x`, undefined, "tag`x`");

// A nullish base: the tag is undefined and the call throws a TypeError. The key and the rest of the chain are
// skipped, the substitutions are still evaluated, and the tag function is never called.
{
    const log = [];
    tag.lastCall = null;
    const nullish = null;
    shouldThrowTypeError(() => (nullish?.tag)`x`, "(null?.tag)`x`");
    shouldThrowTypeError(() => (undefined?.tag)`x`, "(undefined?.tag)`x`");
    shouldThrowTypeError(() => (nullish?.[log.push("key")])`${log.push("substitution")}`, "(null?.[key])`${...}`");
    shouldBe(log.join(), "substitution", "the key is skipped, the substitution is evaluated");
    shouldThrowTypeError(() => (nullish?.inner.tag)`x`, "(null?.inner.tag)`x`");
    shouldThrowTypeError(() => (object?.missing?.tag)`x`, "(object?.missing?.tag)`x`");
    shouldThrowTypeError(() => (object?.missing.tag)`x`, "(object?.missing.tag)`x` throws on the plain access");
    shouldBe(tag.lastCall, null, "the tag is never called");
}

// A missing tag on a present base is a call of undefined too.
shouldThrowTypeError(() => (object?.missing)`x`, "(object?.missing)`x`");
shouldThrowTypeError(() => (object?.[Symbol("missing")])`x`, "(object?.[missing symbol])`x`");

// Through the JIT tiers.
function dot(o) {
    return (o?.tag)`x`;
}
noInline(dot);
function bracket(o, k) {
    return (o?.[k])`x`;
}
noInline(bracket);
function chain(o) {
    return (o?.inner?.tag)`x`;
}
noInline(chain);
function nullishBase(o) {
    try {
        (o?.tag)`x`;
    } catch (e) {
        return e instanceof TypeError;
    }
    return false;
}
noInline(nullishBase);
for (let i = 0; i < testLoopCount; ++i) {
    shouldBe(dot(object), object, `dot, iteration ${i}`);
    shouldBe(bracket(object, key), object, `bracket, iteration ${i}`);
    shouldBe(chain(object), inner, `chain, iteration ${i}`);
    shouldBe(nullishBase(i & 1 ? null : undefined), true, `nullish base, iteration ${i}`);
}
