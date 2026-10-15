function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function repeat(f) {
    for (let i = 0; i < 200; i++)
        f(i);
}
function throwsTypeError(f, what) {
    try {
        f();
    } catch (error) {
        check(error instanceof TypeError, true, what);
        return;
    }
    throw new Error(what + ": did not throw");
}
function has(key, object) { return key in object; }
noInline(has);

const symbol = Symbol("s"), otherSymbol = Symbol("other");
{
    const object = { a: 1, b: undefined, [symbol]: 1 };
    repeat(() => {
        check(has("a", object), true, "a name that is there");
        check(has("b", object), true, "a name whose value is undefined");
        check(has("c", object), false, "a name that is not there");
        check(has("toString", object), true, "a name that is inherited");
        check(has(symbol, object), true, "a symbol that is there");
        check(has(otherSymbol, object), false, "a symbol that is not there");
        check(has("a" + "", object), true, "a literal that is concatenated");
        check(has(["a"].join(), object), true, "a name that is computed");
        check(has(["c"].join(), object), false, "a name that is computed and not there");
        check(has("__proto__", object), true, "__proto__");
    });
}

{
    const object = { a: 1 };
    repeat(() => check(has("later", object), false, "before the property is added"));
    object.later = 1;
    repeat(() => check(has("later", object), true, "after the property is added"));
    delete object.later;
    repeat(() => check(has("later", object), false, "after the property is deleted"));
    const prototype = { };
    Object.setPrototypeOf(object, prototype);
    repeat(() => check(has("later", object), false, "after the prototype changes"));
    prototype.later = 1;
    repeat(() => check(has("later", object), true, "after the property is added to the new prototype"));
}

{
    const array = [1, , 3];
    repeat(() => {
        check(has(0, array), true, "an index");
        check(has(1, array), false, "a hole");
        check(has(3, array), false, "an index past the end");
        check(has("0", array), true, "an index as a string");
        check(has("1", array), false, "a hole as a string");
        check(has("length", array), true, "length");
        check(has("push", array), true, "a method of arrays");
        check(has(-1, array), false, "a negative number");
        check(has(1.5, array), false, "a fraction");
    });
    const indexed = { 0: "zero", a: 1 };
    repeat(() => {
        check(has("0", indexed), true, "an index of an object as a string");
        check(has(0, indexed), true, "an index of an object");
        check(has("1", indexed), false, "an index that an object does not have");
    });
}

{
    function f() { }
    repeat(() => {
        check(has("prototype", f), true, "prototype of a function");
        check(has("name", f), true, "name of a function");
        check(has("length", f), true, "length of a function");
        check(has("call", f), true, "call of a function");
        check(has("nothing", f), false, "nothing of a function");
    });
    delete f.name;
    repeat(() => check(has("name", f), true, "name of a function, inherited"));
}

{
    let traps = 0;
    const proxy = new Proxy({ a: 1 }, { has(target, key) { traps++; return key in target; } });
    repeat(() => check(has("a", proxy), true, "a proxy"));
    repeat(() => check(has("b", proxy), false, "a proxy that does not have it"));
    check(traps, 400, "traps of the proxy");
    const inheriting = Object.create(proxy);
    repeat(() => check(has("a", inheriting), true, "a proxy in the prototype chain"));
    check(traps, 600, "traps of the proxy in the prototype chain");
}

{
    const dictionary = { };
    for (let i = 0; i < 300; i++)
        dictionary["p" + i] = i;
    for (let i = 0; i < 100; i++)
        delete dictionary["p" + i];
    repeat(() => {
        check(has("p200", dictionary), true, "a dictionary");
        check(has("p50", dictionary), false, "a dictionary that lost it");
    });
    delete dictionary.p200;
    repeat(() => check(has("p200", dictionary), false, "a dictionary that just lost it"));
    dictionary.p50 = 1;
    repeat(() => check(has("p50", dictionary), true, "a dictionary that has it again"));
}

for (const bad of [undefined, null, 5, "text", symbol, true])
    repeat(() => throwsTypeError(() => has("a", bad), "in " + String(bad)));

{
    let conversions = 0;
    const key = { toString() { conversions++; return "a"; } };
    repeat(() => check(has(key, { a: 1 }), true, "a key that is an object"));
    check(conversions, 200, "conversions of the key");
    repeat(() => check(has(null, { null: 1 }), true, "null as the key"));
    repeat(() => check(has(undefined, { }), false, "undefined as the key"));
    repeat(() => check(has(true, { true: 1 }), true, "true as the key"));
}

{
    const shapes = [{ a: 1 }, { b: 1 }, { a: 1, b: 1 }, { b: 1, a: 1 }, { }, Object.create({ a: 1 }), Object.create(null)];
    const expected = [true, false, true, true, false, true, false];
    repeat(i => check(has("a", shapes[i % shapes.length]), expected[i % shapes.length], "shape " + i % shapes.length));
}
console.log("passed");
