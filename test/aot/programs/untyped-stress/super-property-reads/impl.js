function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
class Base { constructor(v) { this.v = v; } get() { return this.v; } get twice() { return this.v * 2; } static make() { return "base"; } }
class Derived extends Base { get() { return super.get() + 1; } get twice() { return super.twice + 1; } missing() { return super.nothing; } static make() { return super.make() + "+derived"; } }
class Other { get() { return "other"; } get twice() { return "other twice"; } }
let object = { __proto__: { hello() { return "hello " + this.name; } }, name: "object", hello() { return super.hello() + "!"; } };
function callGet(d) { return d.get(); }
function readTwice(d) { return d.twice; }
function prototypeOf(v) { return Object.getPrototypeOf(v); }
for (let round = 0; round < 3; ++round) {
    check(callGet(new Derived(round)), round + 1, "a method of the superclass");
    check(readTwice(new Derived(round)), round * 2 + 1, "a getter of the superclass gets this");
    check(new Derived(1).missing(), undefined, "nothing there");
    check(Derived.make(), "base+derived", "a static method");
    check(object.hello(), "hello object!", "in an object literal");
}
Base.prototype.get = function () { return 100; };
check(callGet(new Derived(1)), 101, "the method was replaced");
Object.setPrototypeOf(Derived.prototype, Other.prototype);
check(callGet(new Derived(1)), "other1", "the prototype of the home object was replaced");
check(readTwice(new Derived(1)), "other twice1", "and its getter");
check(prototypeOf({}), Object.prototype, "of an object");
check(prototypeOf([]), Array.prototype, "of an array");
check(prototypeOf(Object.create(null)), null, "null");
check(prototypeOf(function () { }), Function.prototype, "of a function");
check(prototypeOf("s"), String.prototype, "of a string");
check(prototypeOf(1), Number.prototype, "of a number");
check(prototypeOf(new Proxy({}, { getPrototypeOf() { return Array.prototype; } })), Array.prototype, "of a proxy");
let threw = false;
try { prototypeOf(null); } catch (e) { threw = e instanceof TypeError; }
check(threw, true, "of null");

class Computed extends Base { get(key) { return super[key](); } }
let viaSuper = Object.getOwnPropertyDescriptor(Derived.prototype, "get").value;
let viaComputedSuper = Object.getOwnPropertyDescriptor(Computed.prototype, "get").value;
function named(f, name) { return { name, __proto__: null, f }; }
check(new Computed(7).get("get"), 100, "a computed name");

(function () {
function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function checkThrows(f, type, what) {
    try {
        f();
    } catch (error) {
        if (!(error instanceof type))
            throw new Error(what + ": threw " + error);
        return;
    }
    throw new Error(what + ": did not throw");
}

const base = {
    value: 2,
    get viaGetter() { return this.own * 10; },
};
const object = {
    __proto__: base,
    own: 7,
    value: "shadows",
    readsValue() { return super.value; },
    readsGetter() { return super.viaGetter; },
    readsMissing() { return super.missing; },
};
for (let i = 0; i < 20; i++) {
    check(object.readsValue(), 2, "a value of the prototype");
    check(object.readsGetter(), 70, "a getter of the prototype, which sees the receiver");
    check(object.readsMissing(), undefined, "what the prototype does not have");
}

base.value = 3;
check(object.readsValue(), 3, "after the value changes");
base.missing = "found";
check(object.readsMissing(), "found", "after the property is added");
Object.defineProperty(base, "value", { get() { return this.own + 1; }, configurable: true });
check(object.readsValue(), 8, "after the value becomes a getter");
Object.defineProperty(base, "viaGetter", { value: "plain", configurable: true });
check(object.readsGetter(), "plain", "after the getter becomes a value");

const other = { value: "other", viaGetter: "other too" };
Object.setPrototypeOf(object, other);
for (let i = 0; i < 20; i++) {
    check(object.readsValue(), "other", "after the prototype changes");
    check(object.readsGetter(), "other too", "after the prototype changes, what was a getter");
    check(object.readsMissing(), undefined, "after the prototype changes, what it does not have");
}

Object.setPrototypeOf(object, null);
for (let i = 0; i < 3; i++) {
    checkThrows(() => object.readsValue(), TypeError, "without a prototype");
    checkThrows(() => object.readsGetter(), TypeError, "without a prototype, what was a getter");
    checkThrows(() => object.readsMissing(), TypeError, "without a prototype, what nothing has");
}
Object.setPrototypeOf(object, base);
check(object.readsValue(), 8, "with the prototype again");

class Parent {
    get doubled() { return this.n * 2; }
    static label = "parent";
}
Parent.prototype.shared = "on the prototype";
class Child extends Parent {
    constructor(n) { super(); this.n = n; }
    get doubled() { return -1; }
    readsDoubled() { return super.doubled; }
    readsShared() { return super.shared; }
    static readsLabel() { return super.label; }
}
let sum = 0;
for (let i = 0; i < 20; i++)
    sum += new Child(i).readsDoubled();
check(sum, 380, "a getter of the parent class");
check(new Child(1).readsShared(), "on the prototype", "a value on the prototype of the parent class");
check(Child.readsLabel(), "parent", "a static field of the parent class");
Object.setPrototypeOf(Child.prototype, null);
checkThrows(() => new Child(1).readsShared(), TypeError, "a class whose prototype has none");
})();
console.log("passed");
