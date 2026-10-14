const aotRemarks = () => null, isAOTCompiled = () => false, aotFunctionsNamed = () => [], aotOperationCount = () => 0, aotTypeCoverage = () => null, aotSetFamily = () => undefined, aotFamilyOf = () => 0, aotHasDepartedFamily = () => false;
function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function remarksOf(f) {
    let remarks = aotRemarks(f.name);
    if (!remarks && isAOTCompiled(f))
        throw new Error("no remarks for " + f.name);
    return remarks;
}
function matches(remark, pattern) { return remark === pattern || remark.startsWith(pattern + ":"); }
function applies(f, ...patterns) {
    let remarks = remarksOf(f);
    for (let pattern of remarks ? patterns : []) {
        if (!remarks.some(remark => matches(remark, pattern)))
            throw new Error(pattern + " does not apply to " + f.name + ": " + remarks.join(" "));
    }
}
function doesNotApply(f, ...patterns) {
    let remarks = remarksOf(f);
    for (let pattern of remarks ? patterns : []) {
        if (remarks.some(remark => matches(remark, pattern)))
            throw new Error(pattern + " applies to " + f.name + ": " + remarks.join(" "));
    }
}
function makeArrow(k) { return x => x + k; }
function makeFunction(k) { return function named(x, y) { return x + y + k; }; }
function makeMethod(k) { return { method(x) { return x * k; } }.method; }
function callIt(f, x) { return f(x); }
function construct(F) { return new F(1, 2); }
function Point(x, y) { this.x = x; this.y = y; }
function makeConstructor() { return function Made(x, y) { this.sum = x + y; }; }
let results = [];
for (let round = 0; round < 3; ++round) {
    let arrow = makeArrow(round);
    check(callIt(arrow, 1), 1 + round, "an arrow function");
    check(arrow.name, "", "its name");
    check(arrow.length, 1, "its length");
    check("prototype" in arrow, false, "it has no prototype");
    check(callIt(arrow, 2), 2 + round, "called again after it was looked at");
    let f = makeFunction(round);
    check(f(1, 2), 3 + round, "a function expression");
    check(f.name, "named", "its name");
    check(f.length, 2, "its length");
    check(typeof f.prototype, "object", "its prototype");
    check(f.prototype.constructor, f, "its prototype's constructor");
    check(f(1, 2), 3 + round, "called again");
    let method = makeMethod(3);
    check(method(2), 6, "a method");
    check(method.name, "method", "its name");
    let threw = false;
    try { new method(); } catch (e) { threw = e instanceof TypeError; }
    check(threw, true, "a method is not a constructor");
    threw = false;
    try { new arrow(); } catch (e) { threw = e instanceof TypeError; }
    check(threw, true, "an arrow function is not a constructor");
    let Made = makeConstructor();
    check(construct(Made).sum, 3, "constructing a function that was never called");
    check(construct(Made) instanceof Made, true, "instanceof");
    check(construct(Point).y, 2, "a declaration");
    let bound = makeArrow(10).bind(null, 5);
    check(bound(), 15, "bound");
    check(makeFunction(1).call(null, 2, 3), 6, "Function.prototype.call");
    check(makeFunction(1).apply(null, [2, 3]), 6, "Function.prototype.apply");
    check([3, 1, 2].sort(makeFunctionComparator()).join(), "1,2,3", "called by a builtin");
    check([1, 2, 3].map(makeArrow(1)).join(), "2,3,4", "passed to map");
    Promise.resolve(round).then(makeArrow(100)).then(v => results.push(v));
    check(String(makeArrow(1)).length > 0, true, "toString");
    check(Object.keys(makeArrow(1)).length, 0, "no enumerable properties");
    let withProperty = makeArrow(1);
    withProperty.extra = 7;
    check(withProperty.extra + withProperty(1), 9, "a property of its own");
    check(makeArrow(1) === makeArrow(1), false, "each is another object");
    let many = [];
    for (let i = 0; i < 2000; ++i)
        many.push(makeArrow(i));
    gc();
    let sum = 0;
    for (let i = 0; i < many.length; ++i)
        sum += many[i](1);
    check(sum, 2000 * 1999 / 2 + 2000, "after a collection");
    check(many[1999].length, 1, "looked at after a collection");
}
function makeFunctionComparator() { return (a, b) => a - b; }
drainMicrotasks();
check(results.join(), "100,101,102", "called from a microtask");
let other = createGlobalObject();
check(other.Function("f", "return f(41)")(makeArrow(1)), 42, "called from another realm");

function makeGenerator() { return function* () { yield 1; }; }
function makeAsync() { return async function () { return 1; }; }
function makeAsyncArrow() { return async () => 1; }
function makeClass() { return class { }; }
function makeGetter() { return Object.getOwnPropertyDescriptor({ get x() { return 1; } }, "x").get; }
if (isAOTCompiled(makeArrow)) {
    for (let make of [makeArrow, makeFunction, makeMethod, makeConstructor, makeFunctionComparator]) {
        let f = make(1);
        check(hasExecutable(f), false, "what " + make.name + " returns has no executable");
        if (make != makeConstructor) {
            f(1, 2);
            check(hasExecutable(f), false, "nor after it was called from compiled code");
        }
    }
    for (let make of [makeGenerator, makeAsync, makeAsyncArrow, makeClass])
        check(hasExecutable(make()), true, "what " + make.name + " returns has an executable");
    check(hasExecutable(print), true, "a host function has one");
    check(hasExecutable(Array.prototype.map), true, "a builtin has one");
    check(hasExecutable(makeArrow(1).bind(null)), true, "a bound function has one");
    for (let [what, use] of [["name", f => f.name], ["length", f => f.length], ["toString", f => String(f)], ["prototype", f => f.prototype], ["new", f => new f], ["a property", f => { f.x = 1; }]]) {
        let f = makeFunction(1);
        use(f);
        check(f(1, 2), 4, "a function still works after " + what);
    }
    let called = makeArrow(1);
    [1].map(called);
    check(called(1), 2, "a function still works after a builtin called it");
}
console.log("passed");
