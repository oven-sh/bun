// @bun
//@ requireOptions("--useShadowRealm=1")
// The name of a bound function is "bound " and the name that its target has when bind() runs. That holds for a target
// that got its name while the program ran too: from a key in brackets, or as the getter or setter function of a custom
// accessor. Nothing but the "name" property of such a target holds its name, so bind() has to read it.

function shouldBe(actual, expected, what) {
    if (actual !== expected)
        throw new Error(what + ": expected " + JSON.stringify(expected) + " but got " + JSON.stringify(actual));
}

const key = "one";
const symbol = Symbol("s");
const symbolWithoutDescription = Symbol();
const getterOf = (object, property) => Object.getOwnPropertyDescriptor(object, property).get;
const setterOf = (object, property) => Object.getOwnPropertyDescriptor(object, property).set;

// Every producer but the two of the custom accessor makes a new function object each time, so a round binds a target
// whose name nothing has read.
const producers = [
    ["method", "one", () => ({ [key]() { } })[key]],
    ["method with three parameters", "one", () => ({ [key](a, b, c) { } })[key]],
    ["class with two parameters", "one", () => ({ [key]: class { constructor(a, b) { } } })[key]],
    ["method under a literal in brackets", "one", () => ({ ["one"]() { } }).one],
    ["function", "one", () => ({ [key]: function () { } })[key]],
    ["arrow function", "one", () => ({ [key]: () => { } })[key]],
    ["class", "one", () => ({ [key]: class { } })[key]],
    ["generator method", "one", () => ({ *[key]() { } })[key]],
    ["async method", "one", () => ({ async [key]() { } })[key]],
    ["async generator method", "one", () => ({ async *[key]() { } })[key]],
    ["getter", "get one", () => getterOf({ get [key]() { return 1; } }, key)],
    ["setter", "set one", () => setterOf({ set [key](value) { } }, key)],
    ["method of a class", "one", () => (class { [key]() { } }).prototype[key]],
    ["static method", "one", () => (class { static [key]() { } })[key]],
    ["getter of a class", "get one", () => getterOf((class { get [key]() { return 1; } }).prototype, key)],
    ["static setter", "set one", () => setterOf(class { static set [key](value) { } }, key)],
    ["function in a class field", "one", () => new (class { [key] = function () { } })()[key]],
    ["arrow function in a class field", "one", () => new (class { [key] = () => { } })()[key]],
    ["class in a static field", "one", () => (class { static [key] = class { } })[key]],
    ["method under a symbol", "[s]", () => ({ [symbol]() { } })[symbol]],
    ["getter under a symbol", "get [s]", () => getterOf({ get [symbol]() { return 1; } }, symbol)],
    ["method under a symbol without a description", "", () => ({ [symbolWithoutDescription]() { } })[symbolWithoutDescription]],
    ["method under a number", "1", () => ({ [1]() { } })[1]],
    ["getter function of a custom accessor", "get input", () => getterOf(RegExp, "input")],
    ["setter function of a custom accessor", "set input", () => setterOf(RegExp, "input")],
    // These names are in the code. bind() leaves them for the first read of the bound function's name.
    ["method under a plain key", "one", () => ({ one() { } }).one],
    ["function expression with a name", "named", () => function named() { }],
    ["getter under a plain key", "get one", () => getterOf({ get one() { return 1; } }, "one")],
];

const bind = Function.prototype.bind;
// [how bind() is reached, a function that binds, how many arguments it binds]
const entries = [
    ["target.bind()", target => target.bind(null), 0],
    ["target.bind() with an argument", target => target.bind(null, 1), 1],
    ["bind.call(target)", target => bind.call(target, null), 0],
    ["Reflect.apply(bind, target)", target => Reflect.apply(bind, target, [null]), 0],
];

function checkRow([producer, name, make], [entry, bound, boundArguments]) {
    const what = producer + ", " + entry;
    const target = make();
    const first = bound(target);
    const second = bound(first);
    shouldBe(second.name, "bound bound " + name, what + ", bound twice");
    shouldBe(first.name, "bound " + name, what);
    shouldBe(target.name, name, what + ", the target");
    shouldBe(bound(target).name, "bound " + name, what + ", after a read of the target's name");
    // The length of the bound function is the target's, less the bound arguments: before and after a read of the target's.
    const length = Math.max(0, target.length - boundArguments);
    shouldBe(first.length, length, what + ", the length");
    shouldBe(second.length, Math.max(0, length - boundArguments), what + ", the length when bound twice");
    shouldBe(bound(target).length, length, what + ", the length after a read of the target's length");
}

for (const producer of producers) {
    for (const entry of entries)
        checkRow(producer, entry);
}
// Enough rounds for every tier to compile the entries, with each entry seeing every producer.
for (let i = 0; i < testLoopCount; i++)
    checkRow(producers[i % producers.length], entries[Math.floor(i / producers.length) % entries.length]);

// What happens to the target's name, and when.
const makeTarget = () => ({ [key](a, b, c) { } })[key];
const otherRealm = new ShadowRealm();
const lifecycle = {
    "the name is redefined, then bind()"(target) {
        Object.defineProperty(target, "name", { value: "changed" });
        return [target.bind(null).name, "bound changed"];
    },
    "bind(), then the name is redefined"(target) {
        const bound = target.bind(null);
        Object.defineProperty(target, "name", { value: "changed" });
        return [bound.name, "bound one"];
    },
    "the name is read, then redefined, then bind()"(target) {
        shouldBe(target.name, "one", "the target");
        Object.defineProperty(target, "name", { value: "changed" });
        return [target.bind(null).name, "bound changed"];
    },
    "the name is deleted, then bind()"(target) {
        shouldBe(delete target.name, true, "delete");
        return [target.bind(null).name, "bound "];
    },
    "bind(), then the name is deleted"(target) {
        const bound = target.bind(null);
        shouldBe(delete target.name, true, "delete");
        return [bound.name, "bound one"];
    },
    "the name is a getter: bind() calls it once, a read of the bound name does not"(target) {
        let calls = 0;
        Object.defineProperty(target, "name", { get() { return "got" + ++calls; } });
        const bound = target.bind(null);
        shouldBe(calls, 1, "calls of the getter in bind()");
        return [bound.name + bound.name + calls, "bound got1bound got11"];
    },
    "the name is not a string"(target) {
        Object.defineProperty(target, "name", { value: 42 });
        return [target.bind(null).name, "bound "];
    },
    "the name is a string that is not put together yet"(target) {
        const part = "a name of many characters, ";
        Object.defineProperty(target, "name", { value: part + part + part });
        return [target.bind(null).name, "bound " + part + part + part];
    },
    "a class with a static field called name"() {
        const target = ({ [key]: class { static name = "own"; } })[key];
        return [target.bind(null).name, "bound own"];
    },
    // The method is the "name" of the class, and it is not a string. (V8 names the class behind its static elements.)
    "a class with a static method called name"() {
        const target = ({ [key]: class { static name() { } } })[key];
        return [target.bind(null).name, "bound "];
    },
    "a store to the name changes nothing"(target) {
        shouldBe(Reflect.set(target, "name", "stored"), false, "the store");
        return [target.bind(null).name, "bound one"];
    },
    "bound twice, the inner name read last"(target) {
        const first = target.bind(null);
        const second = first.bind(null);
        return [second.name + "|" + first.name, "bound bound one|bound one"];
    },
    "bound many times"(target) {
        let names = "";
        for (let i = 0; i < 3; i++)
            names += target.bind(null).name + "|";
        return [names, "bound one|bound one|bound one|"];
    },
    "a proxy of the target"(target) {
        return [new Proxy(target, { }).bind(null).name, "bound one"];
    },
    "the descriptor of the bound name"(target) {
        return [JSON.stringify(Object.getOwnPropertyDescriptor(target.bind(null), "name")), '{"value":"bound one","writable":false,"enumerable":false,"configurable":true}'];
    },
    // bind() reads no length of such a target. The bound function still gets the length that the target had then.
    "the length"(target) {
        return [target.bind(null).length + "," + target.bind(null, 1).length + "," + target.bind(null, 1, 2, 3, 4).length, "3,2,0"];
    },
    "bind(), then the length is redefined"(target) {
        const bound = target.bind(null, 1);
        Object.defineProperty(target, "length", { value: 10 });
        return [bound.length + "," + bound.name, "2,bound one"];
    },
    "the length is redefined, then bind()"(target) {
        Object.defineProperty(target, "length", { value: 10 });
        const bound = target.bind(null, 1);
        return [bound.length + "," + bound.name, "9,bound one"];
    },
    "the length is deleted, then bind()"(target) {
        shouldBe(delete target.length, true, "delete");
        const bound = target.bind(null, 1);
        return [bound.length + "," + bound.name, "0,bound one"];
    },
    "bound twice, the lengths read last"(target) {
        const first = target.bind(null, 1);
        const second = first.bind(null, 2);
        return [second.name + "," + second.length + "," + first.length, "bound bound one,1,2"];
    },
    // A class under a key in brackets gets its name as the methods above do. A static accessor called length or name
    // takes the place of its own property, and bind() asks the accessor.
    "a class with a static getter called length"() {
        const bound = ({ [key]: class { constructor(a, b) { } static get length() { return 9; } } })[key].bind(null, 1);
        return [bound.name + "," + bound.length, "bound one,8"];
    },
    "a class with a static getter called length in front of a member under a key in brackets"() {
        const bound = ({ [key]: class { constructor(a, b) { } static get length() { return 9; } [key]() { } } })[key].bind(null, 1);
        return [bound.name + "," + bound.length, "bound one,8"];
    },
    "a class with a static getter under the key \"length\" in brackets"() {
        const bound = ({ [key]: class { constructor(a, b) { } static get ["length"]() { return 9; } } })[key].bind(null, 1);
        return [bound.name + "," + bound.length, "bound one,8"];
    },
    "a class with a static setter called length in front of a member under a key in brackets"() {
        const bound = ({ [key]: class { constructor(a, b) { } static set length(value) { } [key]() { } } })[key].bind(null, 1);
        return [bound.name + "," + bound.length, "bound one,0"];
    },
    "a class with a static getter called length that throws"() {
        const target = ({ [key]: class { constructor(a, b) { } static get length() { throw new RangeError("from the getter"); } [key]() { } } })[key];
        try {
            target.bind(null);
        } catch (error) {
            return [error instanceof RangeError && error.message, "from the getter"];
        }
        return ["no error", "from the getter"];
    },
    // The getter is the "name" of the class. (V8 names the class behind its static elements here too.)
    "a class with a static getter called name in front of a member under a key in brackets"() {
        const bound = ({ [key]: class { constructor(a, b) { } static get name() { return "custom"; } [key]() { } } })[key].bind(null, 1);
        return [bound.name + "," + bound.length, "bound custom,1"];
    },
    "a class with a static field called length"() {
        const bound = ({ [key]: class { constructor(a, b) { } static length = 9; } })[key].bind(null, 1);
        return [bound.name + "," + bound.length, "bound one,8"];
    },
    // A function that the program did not write, with a name that the program gave it.
    "a resolving function of a promise with another name"() {
        let resolve;
        new Promise(resolveIt => { resolve = resolveIt; });
        Object.defineProperty(resolve, "name", { value: "renamed" });
        const bound = resolve.bind(null);
        return [bound.name + "," + bound.length + "," + resolve.bind(null, 1, 2).length, "bound renamed,1,0"];
    },
    "a function of another realm, wrapped, with another name"() {
        const wrapped = otherRealm.evaluate("(function inTheOtherRealm(a, b) { })");
        const before = wrapped.bind(null, 1);
        Object.defineProperty(wrapped, "name", { value: "renamed" });
        const bound = wrapped.bind(null, 1);
        return [before.name + "," + before.length + "," + bound.name + "," + bound.length, "bound inTheOtherRealm,1,bound renamed,1"];
    },
};
function checkLifecycle(step) {
    const [actual, expected] = lifecycle[step](makeTarget());
    shouldBe(actual, expected, step);
}
const steps = Object.keys(lifecycle);
for (let i = 0; i < testLoopCount; i++)
    checkLifecycle(steps[i % steps.length]);

// bind() reads no length of a target whose name alone is not the original one: the target has no "length" property
// afterwards. Where the name is gone, bind() goes through every step, and the first of them makes the property.
if (typeof $vm === "object") {
    function boundNameAndWhetherTheTargetHasALength(target) {
        const bound = target.bind(null);
        return bound.name + "," + $vm.getConcurrently(target, "length");
    }
    for (let i = 0; i < testLoopCount; i++) {
        shouldBe(boundNameAndWhetherTheTargetHasALength(makeTarget()), "bound one,0", "a target with a name from a key");
        const renamed = function () { };
        Object.defineProperty(renamed, "name", { value: "renamed" });
        shouldBe(boundNameAndWhetherTheTargetHasALength(renamed), "bound renamed,0", "a target with a name from the program");
        const nameless = makeTarget();
        delete nameless.name;
        shouldBe(boundNameAndWhetherTheTargetHasALength(nameless), "bound ,1", "a target whose name is gone");
    }
}

// Two function objects of one function in the code have a name each.
function methodUnder(name) {
    return ({ [name]() { } })[name];
}
function boundNameOf(target) {
    return target.bind(null).name;
}
for (let i = 0; i < testLoopCount; i++) {
    shouldBe(boundNameOf(methodUnder("a")), "bound a", "the first of two function objects");
    shouldBe(boundNameOf(methodUnder("b")), "bound b", "the second of two function objects");
}

// A bind() that the optimizing tiers compiled for targets with a name in the code meets a target with a name from a key.
function boundNameAtOneSite(target) {
    return target.bind(null).name;
}
function plain() { }
for (let i = 0; i < testLoopCount; i++)
    shouldBe(boundNameAtOneSite(plain), "bound plain", "a target with a name in the code");
for (let i = 0; i < testLoopCount; i++) {
    shouldBe(boundNameAtOneSite(makeTarget()), "bound one", "a target with a name from a key, at the same site");
    shouldBe(boundNameAtOneSite(plain), "bound plain", "a target with a name in the code, again");
}
