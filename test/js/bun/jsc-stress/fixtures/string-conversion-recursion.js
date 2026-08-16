// Bun's JavaScriptCore keeps cycle detection for the array to string conversions (StringRecursionChecker):
// an array whose conversion is already on the stack converts to the empty string instead of recursing
// until the stack overflows, which is what V8 and SpiderMonkey do, so `a = [1]; a[1] = a; a.join()` is
// "1," here exactly as in Node.js. Upstream removed the detection (https://bugs.webkit.org/show_bug.cgi?id=320820)
// and throws a RangeError instead. Everything else follows upstream: only the array conversions take part,
// so Error.prototype.toString and RegExp.prototype.toString cycles overflow the stack, and a conversion that
// is deep but not cyclic overflows it too.

function shouldBe(actual, expected) {
    if (actual !== expected)
        throw new Error(`bad value: expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
}

function shouldThrow(func, errorConstructor, message) {
    let error;
    try {
        func();
    } catch (e) {
        error = e;
    }
    if (!error)
        throw new Error("didn't throw");
    if (!(error instanceof errorConstructor))
        throw new Error(`expected ${errorConstructor.name} but got ${error}`);
    if (message !== undefined)
        shouldBe(error.message, message);
}

function selfContaining() {
    let array = [1];
    array[1] = array;
    return array;
}

// An array that contains itself: the nested conversion of the array is the empty string, through every
// entry point. Array.prototype.toString and ToString / ToPrimitive of an array go through JSArray::fastToString,
// Array.prototype.join and Array.prototype.toLocaleString are checked themselves.
shouldBe(selfContaining().join(), "1,");
shouldBe(selfContaining().join("-"), "1-");
shouldBe(selfContaining().join(""), "1");
shouldBe(selfContaining().toString(), "1,");
shouldBe(selfContaining().toLocaleString(), "1,");
shouldBe(String(selfContaining()), "1,");
shouldBe(`${selfContaining()}`, "1,");
shouldBe(selfContaining() + "", "1,");
shouldBe([selfContaining()].join(), "1,");

{
    let array = [];
    array[0] = array;
    shouldBe(array.join(), "");
    shouldBe(String(array), "");
    shouldBe(array.toLocaleString(), "");
}

// Every occurrence of the array being converted becomes empty; the conversion does not fan out.
{
    let array = selfContaining();
    array[2] = array;
    shouldBe(array.join(), "1,,");
    shouldBe(String(array), "1,,");
    shouldBe(array.toLocaleString(), "1,,");
}

// Only the array whose conversion is in progress becomes empty; everything reachable before the cycle
// closes is converted normally, so the result depends on where the conversion starts.
{
    let a = [1];
    let b = [2, a];
    a.push(b);
    shouldBe(a.join(), "1,2,");
    shouldBe(b.join(), "2,1,");
    shouldBe(String(a), "1,2,");
    shouldBe(String(b), "2,1,");
    shouldBe(a.toLocaleString(), "1,2,");
    shouldBe(b.toLocaleString(), "2,1,");
}

{
    let array = [1, "webkit"];
    array[2] = [3, 4, [5, 6, [array]]];
    shouldBe(array.toString(), "1,webkit,3,4,5,6,");
    shouldBe(array.join("|"), "1|webkit|3,4,5,6,");
}

// The cycle may close through user code that converts the array again.
{
    let array = ["a"];
    array.push({ toString() { return array.join("~"); } });
    shouldBe(array.join("-"), "a-");
    shouldBe(String(array), "a,");
}

{
    let array = ["a"];
    array.push({ toLocaleString() { return array.toLocaleString(); } });
    shouldBe(array.toLocaleString(), "a,");
}

// Array.prototype.toString calling a replaced join still detects the cycle inside that join.
{
    let array = selfContaining();
    array.join = function() { return "J:" + Array.prototype.join.call(this); };
    shouldBe(array.toString(), "J:1,J:");
    shouldBe(String(array), "J:1,J:");
}

// Array-like receivers are tracked too: these take the generic join / toLocaleString paths.
{
    let object = { length: 2, 0: "x" };
    object[1] = { toString() { return Array.prototype.join.call(object, "+"); } };
    shouldBe(Array.prototype.join.call(object, "-"), "x-");
}

{
    let object = { length: 2, 0: 1 };
    object[1] = { toLocaleString() { return Array.prototype.toLocaleString.call(object); } };
    shouldBe(Array.prototype.toLocaleString.call(object), "1,");
}

// Converting the same array twice in a row, or the same array twice within one conversion, is not a cycle.
{
    let array = selfContaining();
    shouldBe(array.join(), "1,");
    shouldBe(array.join(), "1,");
    shouldBe(String(array), "1,");

    let shared = [1, 2];
    shouldBe([shared, shared].toString(), "1,2,1,2");
    shouldBe([shared, shared].toLocaleString(), "1,2,1,2");
    shouldBe([shared, shared].join("|"), "1,2|1,2");
    shouldBe([[1, [2]], [3]].join(), "1,2,3");
}

// Error.prototype.toString and RegExp.prototype.toString do not take part, so applying them to an array that
// is being converted, or converting an array-like from inside them, is not a cycle either.
{
    let array = [];
    array[0] = { toString() { return Error.prototype.toString.call(array); } };
    shouldBe(array.join(), "Error");
}

{
    let array = [];
    array[0] = { toString() { return RegExp.prototype.toString.call(array); } };
    shouldBe(array.join(), "/undefined/undefined");
}

{
    let object = { length: 2, 0: "x", 1: "y" };
    object.name = { toString() { return Array.prototype.join.call(object, "-"); } };
    shouldBe(Error.prototype.toString.call(object), "x-y");
}

{
    let array = ["a"];
    array[1] = { toString() { return Array.prototype.toLocaleString.call({ length: 1, 0: "b" }); } };
    shouldBe(array.join("-"), "a-b");
}

// A conversion that throws must unregister every array it was converting, whether it was the outermost one
// or nested inside another; otherwise the next conversion of the same array would be taken for a cycle.
{
    let thrower = { toString() { throw new Error("boom"); }, toLocaleString() { throw new Error("locale boom"); } };

    let array = [1, thrower];
    shouldThrow(() => array.join(), Error, "boom");
    shouldThrow(() => String(array), Error, "boom");
    shouldThrow(() => array.toLocaleString(), Error, "locale boom");
    array[1] = 2;
    shouldBe(array.join(), "1,2");
    shouldBe(String(array), "1,2");
    shouldBe(array.toLocaleString(), "1,2");

    let inner = [thrower];
    let outer = [inner];
    shouldThrow(() => outer.join(), Error, "boom");
    shouldThrow(() => String(outer), Error, "boom");
    shouldThrow(() => outer.toLocaleString(), Error, "locale boom");
    shouldThrow(() => Array.prototype.join.call({ length: 1, 0: inner }), Error, "boom");
    inner[0] = "i";
    shouldBe(outer.join(), "i");
    shouldBe(String(outer), "i");
    shouldBe(outer.toLocaleString(), "i");
    shouldBe(Array.prototype.join.call({ length: 1, 0: inner }), "i");

    shouldBe(selfContaining().join(), "1,");
}

// Error.prototype.toString and RegExp.prototype.toString cycles behave as upstream: they overflow the stack.
shouldThrow(() => {
    let error = new Error;
    error.name = error;
    error.message = error;
    return `${error}`;
}, RangeError);

shouldThrow(() => {
    let error = new Error;
    error.message = { toString() { return Error.prototype.toString.call(error); } };
    return `${error}`;
}, RangeError);

shouldThrow(() => {
    let regExp = /a/;
    Object.defineProperty(regExp, "source", { get() { return regExp; } });
    return `${regExp}`;
}, RangeError);

shouldThrow(() => {
    let regExp = /a/;
    Object.defineProperty(regExp, "flags", { get() { return RegExp.prototype.toString.call(regExp); } });
    return `${regExp}`;
}, RangeError);

// Cycle detection does not replace the stack check: a nesting that is deep but acyclic still overflows (the
// shallowest overflowing depth is around 1000 arrays in a debug ASan build and around 5000 in release), and
// the overflow unwinding through thousands of conversions leaves every array convertible again.
{
    let deepest = [0];
    let top = deepest;
    for (let i = 0; i < 100000; ++i)
        top = [top];
    let second = top[0];

    shouldThrow(() => String(top), RangeError);
    shouldThrow(() => top.join(), RangeError);
    shouldThrow(() => top.toLocaleString(), RangeError);

    top[0] = "top";
    shouldBe(String(top), "top");
    second[0] = "second";
    shouldBe(String([second]), "second");
    shouldBe([second, deepest].join("-"), "second-0");
    shouldBe(selfContaining().join(), "1,");
}

// The DFG and FTL compile Array.prototype.join on an array with the original structure into their own operation
// and reach ToString / ToPrimitive of an array through their own paths. Warm the call sites up on an acyclic
// array with the same (contiguous) shape, then the cyclic array must convert exactly as it does in the
// interpreter, and the acyclic one must still convert afterwards.
{
    const join = array => array.join("-");
    const convert = array => `${array}`;
    const toLocale = array => array.toLocaleString();
    noInline(join);
    noInline(convert);
    noInline(toLocale);

    let acyclic = [1, [2, 3], "x"];
    for (let i = 0; i < testLoopCount; ++i) {
        shouldBe(join(acyclic), "1-2,3-x");
        shouldBe(convert(acyclic), "1,2,3,x");
        shouldBe(toLocale(acyclic), "1,2,3,x");
    }

    let cyclic = selfContaining();
    for (let i = 0; i < 10; ++i) {
        shouldBe(join(cyclic), "1-");
        shouldBe(convert(cyclic), "1,");
        shouldBe(toLocale(cyclic), "1,");
    }

    shouldBe(join(acyclic), "1-2,3-x");
    shouldBe(convert(acyclic), "1,2,3,x");
    shouldBe(toLocale(acyclic), "1,2,3,x");
}
