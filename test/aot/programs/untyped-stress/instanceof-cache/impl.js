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

class Base { }
class Derived extends Base { }
class Other { }
function Plain() { }

function isBase(v) { return v instanceof Base; }
function isPlain(v) { return v instanceof Plain; }
function isInstance(v, C) { return v instanceof C; }
function noTest(v) { return typeof v; }
for (const f of [isBase, isPlain, isInstance, noTest])
    noInline(f);

{
    const values = [new Base, new Derived, new Other, { }, [], null, undefined, 5, "text", Symbol("s"), () => { }, Object.create(null), Object.create(Base.prototype), Object.create(new Derived)];
    const expected = [true, true, false, false, false, false, false, false, false, false, false, false, true, true];
    repeat(i => check(isBase(values[i % values.length]), expected[i % values.length], "value " + i % values.length));
}

{
    const constructors = [Base, Derived, Other, Plain, Object, Function, Array];
    const value = new Derived;
    const expected = [true, true, false, false, true, false, false];
    repeat(i => check(isInstance(value, constructors[i % constructors.length]), expected[i % constructors.length], "constructor " + i % constructors.length));
}

{
    const before = new Plain;
    repeat(() => check(isPlain(before), true, "before the prototype is replaced"));
    Plain.prototype = { };
    repeat(() => check(isPlain(before), false, "an older object after the prototype is replaced"));
    repeat(() => check(isPlain(new Plain), true, "a newer object after the prototype is replaced"));
    Plain.extra = 1;
    repeat(() => check(isPlain(new Plain), true, "after the constructor gets a property"));
    Plain.prototype = 5;
    repeat(() => throwsTypeError(() => isPlain({ }), "a prototype that is not an object"));
    repeat(() => check(isPlain(5), false, "a primitive, with a prototype that is not an object"));
    Plain.prototype = { };
}

function isCustomized(v) { return v instanceof Customized; }
noInline(isCustomized);
class Customized { }
{
    const value = new Customized;
    repeat(() => check(isCustomized(value), true, "before Symbol.hasInstance is defined"));
    repeat(() => check(isCustomized(5), false, "a number before Symbol.hasInstance is defined"));
    Object.defineProperty(Customized, Symbol.hasInstance, { value: v => v === 5, configurable: true });
    repeat(() => check(isCustomized(value), false, "after Symbol.hasInstance is defined"));
    repeat(() => check(isCustomized(5), true, "a number after Symbol.hasInstance is defined"));
    delete Customized[Symbol.hasInstance];
    repeat(() => check(isCustomized(value), true, "after Symbol.hasInstance is deleted"));
}

function isChild(v) { return v instanceof Child; }
noInline(isChild);
class Parent { }
class Child extends Parent { }
{
    const value = new Child;
    repeat(() => check(isChild(value), true, "before the parent class defines Symbol.hasInstance"));
    Object.defineProperty(Parent, Symbol.hasInstance, { value: () => false, configurable: true });
    repeat(() => check(isChild(value), false, "after the parent class defines Symbol.hasInstance"));
    delete Parent[Symbol.hasInstance];
    repeat(() => check(isChild(value), true, "after the parent class deletes Symbol.hasInstance"));
    Object.setPrototypeOf(Child, { [Symbol.hasInstance]: () => "truthy" });
    repeat(() => check(isChild(5), true, "after the class inherits from something else"));
    Object.setPrototypeOf(Child, Parent);
    repeat(() => check(isChild(value), true, "after the class inherits from its parent again"));
}

function isOf(v, C) { return v instanceof C; }
noInline(isOf);
{
    const bound = Base.bind(null);
    repeat(() => check(isOf(new Derived, bound), true, "a bound function"));
    repeat(() => check(isOf(new Other, bound), false, "a bound function, of something else"));
    let traps = 0;
    const proxied = new Proxy(Base, { get(target, key) { traps++; return target[key]; } });
    repeat(() => check(isOf(new Base, proxied), true, "a proxy of a constructor"));
    check(traps, 400, "traps of the proxy of a constructor");
    const arrow = () => { };
    repeat(() => throwsTypeError(() => isOf({ }, arrow), "an arrow function"));
    repeat(() => check(isOf(5, arrow), false, "an arrow function and a primitive"));
    for (const bad of [undefined, null, 5, "text", Symbol("s")])
        repeat(() => throwsTypeError(() => isOf({ }, bad), "instanceof " + String(bad)));
    repeat(() => throwsTypeError(() => isOf({ }, { }), "instanceof an object that cannot be called"));
    repeat(() => check(isOf(1, { [Symbol.hasInstance]: v => v === 1 }), true, "an object with Symbol.hasInstance"));
}

function isOfProxy(v) { return v instanceof Base; }
noInline(isOfProxy);
{
    let traps = 0;
    const value = new Proxy({ }, { getPrototypeOf() { traps++; return Base.prototype; } });
    repeat(() => check(isOfProxy(value), true, "a proxy as the value"));
    check(traps, 200, "traps of the proxy as the value");
    const inheriting = Object.create(value);
    repeat(() => check(isOfProxy(inheriting), true, "a proxy in the prototype chain"));
}

function isReparented(v) { return v instanceof Base; }
noInline(isReparented);
{
    const value = { };
    repeat(() => check(isReparented(value), false, "before the value's prototype changes"));
    Object.setPrototypeOf(value, Base.prototype);
    repeat(() => check(isReparented(value), true, "after the value's prototype changes"));
    Object.setPrototypeOf(value, null);
    repeat(() => check(isReparented(value), false, "after the value's prototype becomes null"));
}

function isOtherRealm(v, C) { return v instanceof C; }
noInline(isOtherRealm);
{
    const other = createGlobalObject();
    repeat(() => check(isOtherRealm([], other.Array), false, "an array and the Array of another realm"));
    repeat(() => check(isOtherRealm(new other.Array, other.Array), true, "an array of another realm"));
    repeat(() => check(isOtherRealm(new other.Array, Array), false, "an array of another realm and this Array"));
}

function isShortLived(v, C) { return v instanceof C; }
noInline(isShortLived);
for (let round = 0; round < 5; round++) {
    (function () {
        class ShortLived { }
        const value = new ShortLived;
        repeat(() => check(isShortLived(value, ShortLived), true, "a class that is about to die"));
        repeat(() => check(isShortLived({ }, ShortLived), false, "a class that is about to die, of something else"));
    })();
    fullGC();
}
console.log("passed");
