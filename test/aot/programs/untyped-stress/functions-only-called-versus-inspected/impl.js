function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

let leaked;
class Catcher { static [Symbol.hasInstance](value) { leaked = value; return true; } }
const builtinsAreFixed = !Object.isExtensible(Object.prototype);
const isSealed = builtinsAreFixed;
let shadowsMethod = false;
if (!isSealed) {
    Object.defineProperty(Function.prototype, "me", { get() { return this; } });
    Object.defineProperty(Function.prototype, "tag", { set(value) { leaked = this; } });
    try {
        Object.defineProperty(Function.prototype, "propertyIsEnumerable", { get() { leaked = this; return () => false; } });
        shadowsMethod = true;
    } catch (error) {
        check(error instanceof TypeError, true, "what shadowing a method of Object.prototype throws");
    }
    check(shadowsMethod, !builtinsAreFixed, "whether Function.prototype can shadow a method of Object.prototype");
    Function.prototype[Symbol.toPrimitive] = function () { leaked = this; return 1; };
    Object.defineProperty(Object.getPrototypeOf(async function () { }), "call", { get() { leaked = this; return Function.prototype.call; } });
}

function onlyCalls() {
    function sumOnlyCalled(n) { return n <= 0 ? 0 : n + sumOnlyCalled(n - 1); }
    return sumOnlyCalled(10);
}
function readsNameAndLength() {
    function sumWithName(n) { return n <= 0 ? 0 : n + sumWithName(n - 1); }
    return sumWithName(10) + sumWithName.name + sumWithName.length;
}
function isRightOfInstanceof(value) {
    function sumAsConstructor(n) { return n <= 0 ? 0 : n + sumAsConstructor(n - 1); }
    return sumAsConstructor(10) + (value instanceof sumAsConstructor ? " is one" : " is none");
}
function isTested() {
    function sumTested(n) { return n <= 0 ? 0 : n + sumTested(n - 1); }
    function sumCompared(n) { return n <= 0 ? 0 : n + sumCompared(n - 1); }
    return [sumTested(10) + sumCompared(1), typeof sumTested, sumTested === sumCompared, sumTested !== sumCompared, sumTested ? "truthy" : "falsy", sumTested == null, sumTested === undefined].join();
}
function readsBuiltinMethods() {
    function sumWithMethods(n) { return n <= 0 ? 0 : n + sumWithMethods(n - 1); }
    let call = sumWithMethods.call, apply = sumWithMethods.apply, bind = sumWithMethods.bind, toString = sumWithMethods.toString, constructor = sumWithMethods.constructor;
    return [sumWithMethods(10), call === Function.prototype.call, apply === Function.prototype.apply, bind === Function.prototype.bind, toString === Function.prototype.toString, constructor === Function].join();
}
function callsThroughCall() {
    function sumThroughCall(n) { return n <= 0 ? 0 : n + sumThroughCall(n - 1); }
    return sumThroughCall.call(null, 10) + sumThroughCall(1);
}
check(onlyCalls(), 55, "a function that is only called");
check(readsNameAndLength(), "55sumWithName1", "name and length");
check(isRightOfInstanceof({ }) + isRightOfInstanceof(5), "55 is none55 is none", "the right operand of instanceof");
check(isTested(), "56,function,false,true,truthy,false,false", "tests of a function");
check(readsBuiltinMethods(), "55,true,true,true,true,true", "methods of Function.prototype");
check(callsThroughCall(), 56, "Function.prototype.call");

function checkSum(name) {
    check(leaked.name, name, "what got out");
    check(leaked("3"), "33", name + " of a string");
    check(leaked(2.5), 4.5, name + " of a fraction");
    check(leaked(null), 0, name + " of null");
    check(leaked({ valueOf() { return 1; } }), 1, name + " of an object");
    leaked = undefined;
}

function leftOfInstanceof() {
    function sumLeftOfInstanceof(n) { return n <= 0 ? 0 : n + sumLeftOfInstanceof(n - 1); }
    let direct = sumLeftOfInstanceof(10);
    sumLeftOfInstanceof instanceof Catcher;
    return direct;
}
check(leftOfInstanceof(), 55, "the left operand of instanceof");
checkSum("sumLeftOfInstanceof");

function throughGetter() {
    function sumThroughGetter(n) { return n <= 0 ? 0 : n + sumThroughGetter(n - 1); }
    leaked = sumThroughGetter.me;
    return sumThroughGetter(10);
}
check(throughGetter(), 55, "a getter of Function.prototype");
if (!isSealed)
    checkSum("sumThroughGetter");

function throughSetter() {
    function sumThroughSetter(n) { return n <= 0 ? 0 : n + sumThroughSetter(n - 1); }
    sumThroughSetter.tag = 1;
    return sumThroughSetter(10);
}
check(throughSetter(), 55, "a setter of Function.prototype");
if (!isSealed)
    checkSum("sumThroughSetter");

function throughGetterByValue(key) {
    function sumThroughGetterByValue(n) { return n <= 0 ? 0 : n + sumThroughGetterByValue(n - 1); }
    leaked = sumThroughGetterByValue[key];
    return sumThroughGetterByValue(10);
}
check(throughGetterByValue("me"), 55, "a getter found by value");
if (!isSealed)
    checkSum("sumThroughGetterByValue");

function throughSetterByValue(key) {
    function sumThroughSetterByValue(n) { return n <= 0 ? 0 : n + sumThroughSetterByValue(n - 1); }
    sumThroughSetterByValue[key] = 1;
    return sumThroughSetterByValue(10);
}
check(throughSetterByValue("tag"), 55, "a setter found by value");
if (!isSealed)
    checkSum("sumThroughSetterByValue");

function throughShadowedMethod() {
    function sumThroughShadowedMethod(n) { return n <= 0 ? 0 : n + sumThroughShadowedMethod(n - 1); }
    let method = sumThroughShadowedMethod.propertyIsEnumerable;
    return sumThroughShadowedMethod(10) + typeof method;
}
check(throughShadowedMethod(), "55function", "a method of Object.prototype that Function.prototype shadows");
if (shadowsMethod)
    checkSum("sumThroughShadowedMethod");
else
    check(leaked, undefined, "what gets out through a method that cannot be shadowed");

function throughPrototype() {
    function sumThroughPrototype(n) { return n <= 0 ? 0 : n + sumThroughPrototype(n - 1); }
    leaked = sumThroughPrototype.prototype.constructor;
    return sumThroughPrototype(10);
}
check(throughPrototype(), 55, "the constructor of the prototype");
checkSum("sumThroughPrototype");

function throughMethodOfPrototype() {
    function sumWithPrototypeMethod(n) { return n <= 0 ? 0 : n + sumWithPrototypeMethod(n - 1); }
    sumWithPrototypeMethod.prototype.method = function () { return this.constructor; };
    leaked = sumWithPrototypeMethod.prototype.method();
    return sumWithPrototypeMethod(10);
}
check(throughMethodOfPrototype(), 55, "a method of the prototype");
checkSum("sumWithPrototypeMethod");

function throughInstance() {
    function sumThroughInstance(n) { return n <= 0 ? 0 : n + sumThroughInstance(n - 1); }
    leaked = new sumThroughInstance(0).constructor;
    return sumThroughInstance(10);
}
check(throughInstance(), 55, "the constructor of an instance");
checkSum("sumThroughInstance");

function throughReflectConstruct() {
    function sumThroughReflect(n) { return n <= 0 ? 0 : n + sumThroughReflect(n - 1); }
    leaked = Reflect.construct(sumThroughReflect, [0]).constructor;
    return sumThroughReflect(10);
}
check(throughReflectConstruct(), 55, "the constructor of an instance made by Reflect.construct");
checkSum("sumThroughReflect");

function throughSubclass() {
    function sumThroughSubclass(n) { return n <= 0 ? 0 : n + sumThroughSubclass(n - 1); }
    class Derived extends sumThroughSubclass { }
    leaked = Object.getPrototypeOf(Derived);
    return sumThroughSubclass(10);
}
check(throughSubclass(), 55, "the prototype of a class that extends it");
checkSum("sumThroughSubclass");

function throughConversion() {
    function sumThroughConversion(n) { return n <= 0 ? 0 : n + sumThroughConversion(n - 1); }
    return sumThroughConversion(10) + (sumThroughConversion + 1);
}
if (!isSealed) {
    check(throughConversion(), 57, "Symbol.toPrimitive");
    checkSum("sumThroughConversion");
}

function throughLooseEquality() {
    function sumThroughLooseEquality(n) { return n <= 0 ? 0 : n + sumThroughLooseEquality(n - 1); }
    return sumThroughLooseEquality(10) + (sumThroughLooseEquality == 1 ? " equal" : " different");
}
if (!isSealed) {
    check(throughLooseEquality(), "55 equal", "loose equality");
    checkSum("sumThroughLooseEquality");
}

function isAskedAbout(key) {
    function sumAskedById(n) { return n <= 0 ? 0 : n + sumAskedById(n - 1); }
    function sumAskedByValue(n) { return n <= 0 ? 0 : n + sumAskedByValue(n - 1); }
    function sumDeletedById(n) { return n <= 0 ? 0 : n + sumDeletedById(n - 1); }
    function sumDeletedByValue(n) { return n <= 0 ? 0 : n + sumDeletedByValue(n - 1); }
    return [sumAskedById(1) + sumAskedByValue(2) + sumDeletedById(3) + sumDeletedByValue(4), "me" in sumAskedById, key in sumAskedByValue, delete sumDeletedById.name, delete sumDeletedByValue[key], sumDeletedById.name].join();
}
check(isAskedAbout("length"), "20," + !isSealed + ",true,true,true,", "in and delete");

function hasStaticProperty() {
    function sumWithStaticProperty(n) { return n <= 0 ? 0 : n + sumWithStaticProperty(n - 1); }
    sumWithStaticProperty.displayName = "sum";
    return sumWithStaticProperty(10) + sumWithStaticProperty.displayName;
}
check(hasStaticProperty(), "55sum", "a property stored on a function");

function asyncThroughGetter() {
    async function kindOfAsync(a) { return typeof a === "number" ? "number" : "other"; }
    let direct = kindOfAsync(1);
    let call = kindOfAsync.call;
    return direct;
}
let settled = [];
asyncThroughGetter().then(value => settled.push(value));
if (!isSealed)
    leaked("x").then(value => settled.push(value));
drainMicrotasks();
check(settled.join(), isSealed ? "number" : "number,other", "a getter of the prototype of async functions");
leaked = undefined;

function add1LeftOfInstanceof() {
    function add1First(a) { return a + 1; }
    let s = add1First(1) + add1First(2);
    add1First instanceof Catcher;
    return s;
}
check(add1LeftOfInstanceof(), 5, "calls that can be inlined, and instanceof");
check(leaked("x") + "," + leaked(0.5), "x1,1.5", "a function whose calls can all be inlined");
function add1ThroughGetter() {
    function add1Second(a) { return a + 1; }
    let s = add1Second(1) + add1Second(2);
    return [s, add1Second.me];
}
if (!isSealed)
    check(add1ThroughGetter()[0] + add1ThroughGetter()[1]("x"), "5x1", "calls that can be inlined, and a getter");
function add1ThroughSetter() {
    function add1Third(a) { return a + 1; }
    let s = add1Third(1) + add1Third(2);
    add1Third.tag = 1;
    return s;
}
if (!isSealed)
    check(add1ThroughSetter() + leaked("x"), "5x1", "calls that can be inlined, and a setter");
function kindThroughPrototype() {
    var kindOf = function (a) { return typeof a === "number" ? "number" : "other"; };
    var direct = kindOf(1);
    return direct + " " + kindOf.prototype.constructor("x");
}
check(kindThroughPrototype(), "number other", "a function expression, and the constructor of its prototype");
function firstThroughPrototype() {
    function firstOf(o) { return o.a; }
    var direct = firstOf({ a: 1, b: 2 });
    var out = firstOf.prototype.constructor;
    return direct + " " + out(5) + " " + out("str");
}
check(firstThroughPrototype(), "1 undefined undefined", "a parameter that is an object at the direct call");
function addThroughPrototype() {
    function addBoth(a, b) { return a + b; }
    var direct = addBoth(1, 2);
    return direct + " " + addBoth.prototype.constructor("x", "y");
}
check(addThroughPrototype(), "3 xy", "a result that is a number at the direct call");
function calledByHasInstance() {
    function readsX(o) { return o.x; }
    class Caller { static [Symbol.hasInstance](value) { return value(5) === undefined; } }
    let sum = 0;
    for (let i = 0; i < 3; i++)
        sum += readsX({ x: i });
    return sum + " " + (readsX instanceof Caller);
}
check(calledByHasInstance(), "3 true", "a function that Symbol.hasInstance calls");

function arrowRightOfInstanceof(value) {
    const sumArrow = n => n <= 0 ? 0 : n + sumArrow(n - 1);
    return sumArrow(10) + (value instanceof sumArrow ? " is one" : " is none");
}
if (!isSealed) {
    Object.defineProperty(Function.prototype, "prototype", { get() { leaked = this; return Object.prototype; } });
    check(arrowRightOfInstanceof({ }), "55 is one", "an arrow function as the right operand of instanceof");
    checkSum("sumArrow");
}

let hasProxy = true;
try {
    Object.setPrototypeOf(Function.prototype, new Proxy(Object.prototype, { get(target, key, receiver) { if (key === "throughProxy") leaked = receiver; return Reflect.get(target, key, receiver); } }));
} catch {
    hasProxy = false;
}
function throughProxy() {
    function sumThroughProxy(n) { return n <= 0 ? 0 : n + sumThroughProxy(n - 1); }
    return sumThroughProxy(10) + String(sumThroughProxy.throughProxy);
}
check(throughProxy(), "55undefined", "a proxy behind Function.prototype");
if (hasProxy)
    checkSum("sumThroughProxy");
check(hasProxy, !isSealed && !builtinsAreFixed, "whether Function.prototype can get another prototype");
console.log("passed");
