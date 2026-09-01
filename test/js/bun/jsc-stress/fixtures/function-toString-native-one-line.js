// Every kind of native function prints the same single-line NativeFunction
// source: `function name() { [native code] }`. This is the shape V8 uses.
//
// Before this, InternalFunction subclasses (Map, Set, WeakMap, DataView, ...)
// printed one line while host functions (NativeExecutable), builtin functions
// (FunctionExecutable), bound functions and remote functions printed
//     function name() {\n    [native code]\n}
// lodash's isNative() builds a RegExp from Object.prototype.hasOwnProperty's
// source and tests Map against it, so the two shapes made lodash believe Map
// was not native and fall back to a linear-scan cache in cloneDeep/memoize.

function shouldBe(actual, expected) {
    if (actual !== expected)
        throw new Error(`bad value: ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

const toString = Function.prototype.toString;
const source = (fn) => toString.call(fn);
const nativeFunction = /^function [^(]*\(\) \{ \[native code\] \}$/;

// Host functions (NativeExecutable).
shouldBe(source(Object.prototype.hasOwnProperty), "function hasOwnProperty() { [native code] }");
shouldBe(source(Array.prototype.push), "function push() { [native code] }");
shouldBe(source(Object.create), "function create() { [native code] }");
shouldBe(source(Math.max), "function max() { [native code] }");
shouldBe(source(Symbol.for), "function for() { [native code] }");

// Constructors that are InternalFunction subclasses.
shouldBe(source(Map), "function Map() { [native code] }");
shouldBe(source(Set), "function Set() { [native code] }");
shouldBe(source(WeakMap), "function WeakMap() { [native code] }");
shouldBe(source(DataView), "function DataView() { [native code] }");
shouldBe(source(Array), "function Array() { [native code] }");
shouldBe(source(Function), "function Function() { [native code] }");

// Constructors that are JSFunction subclasses with a NativeExecutable.
shouldBe(source(Promise), "function Promise() { [native code] }");
shouldBe(source(Number), "function Number() { [native code] }");
shouldBe(source(String), "function String() { [native code] }");
shouldBe(source(Boolean), "function Boolean() { [native code] }");

// Builtin functions written in JavaScript (FunctionExecutable).
shouldBe(source(Array.prototype.map), "function map() { [native code] }");
shouldBe(source(Array.from), "function from() { [native code] }");
shouldBe(source(Promise.prototype.then), "function then() { [native code] }");
shouldBe(source(Function.prototype.call), "function call() { [native code] }");

// Native accessors keep the `get `/`set ` prefix in the name.
shouldBe(source(Object.getOwnPropertyDescriptor(Map.prototype, "size").get), "function get size() { [native code] }");
shouldBe(source(Object.getOwnPropertyDescriptor(RegExp.prototype, "flags").get), "function get flags() { [native code] }");

// Bound functions.
shouldBe(source(function foo() {}.bind(null)), "function foo() { [native code] }");
shouldBe(source(Map.bind(null)), "function Map() { [native code] }");
shouldBe(source(Object.prototype.hasOwnProperty.bind({})), "function hasOwnProperty() { [native code] }");

// Callable objects that are neither JSFunction nor InternalFunction.
shouldBe(nativeFunction.test(source(new Proxy(function () {}, {}))), true);
shouldBe(nativeFunction.test(source(new Proxy(Map, {}))), true);

// The result is cached per executable. The cached string has the same shape.
shouldBe(source(Object.prototype.hasOwnProperty), source(Object.prototype.hasOwnProperty));
shouldBe(source(Array.prototype.map), source(Array.prototype.map));

// lodash's isNative(): a RegExp built from hasOwnProperty's source must match
// every other native function.
const reRegExpChar = /[\\^$.*+?()[\]{}|]/g;
const reIsNative = RegExp("^" + source(Object.prototype.hasOwnProperty).replace(reRegExpChar, "\\$&").replace(/hasOwnProperty|(function).*?(?=\\\()| for .+?(?=\\\])/g, "$1.*?") + "$");
for (const fn of [Map, Set, WeakMap, WeakRef, DataView, Promise, Symbol, Object.create, Array.prototype.map, Function.prototype.bind, Map.prototype.get, Object.prototype.hasOwnProperty.bind({})]) {
    if (!reIsNative.test(source(fn)))
        throw new Error(`${fn.name} did not pass the lodash isNative RegExp: ${JSON.stringify(source(fn))}`);
}

// Everything reachable from the global object that is a native function prints one line.
const seen = new Set();
function visit(object, path, depth) {
    if (object === null || (typeof object !== "object" && typeof object !== "function") || seen.has(object) || depth > 3)
        return;
    seen.add(object);
    if (typeof object === "function") {
        const text = source(object);
        if (text.includes("[native code]") && !nativeFunction.test(text))
            throw new Error(`${path} prints a native function on more than one line: ${JSON.stringify(text)}`);
    }
    let keys;
    try {
        keys = Reflect.ownKeys(object);
    } catch {
        return;
    }
    for (const key of keys) {
        let descriptor;
        try {
            descriptor = Reflect.getOwnPropertyDescriptor(object, key);
        } catch {
            continue;
        }
        if (!descriptor)
            continue;
        const name = typeof key === "symbol" ? `[${key.description}]` : key;
        if ("value" in descriptor)
            visit(descriptor.value, `${path}.${name}`, depth + 1);
        if (descriptor.get)
            visit(descriptor.get, `${path}.${name}[get]`, depth + 1);
        if (descriptor.set)
            visit(descriptor.set, `${path}.${name}[set]`, depth + 1);
    }
}
visit(globalThis, "globalThis", 0);
