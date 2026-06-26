// @bun
function foo(f, p, args) {
    var x = 100;
    var result = 101;
    try {
        x = 102;
        p = 103;
        result = f.apply(this, args);
        f = 104;
        p = 105;
        x = 106;
    } catch (e) {
        return {outcome: "exception", values: [f, p, x, result]};
    }
    return {outcome: "return", values: [f, p, x, result]};
}

noInline(foo);

function bar(a, b, c) {
    return a + b + c;
}

noInline(bar);

// Warm up foo().
for (var i = 0; i < testLoopCount; ++i) {
    var result = foo(bar, null, [105, 1, 1]);
    if (result.outcome !== "return")
        throw "Error in loop: bad outcome: " + result.outcome;
    if (result.values.length !== 4)
        throw "Error in loop: bad number of values: " + result.values.length;
    if (result.values[0] !== 104)
        throw "Error in loop: bad values[0]: " + result.values[0];
    if (result.values[1] !== 105)
        throw "Error in loop: bad values[1]: " + result.values[1];
    if (result.values[2] !== 106)
        throw "Error in loop: bad values[2]: " + result.values[2];
    if (result.values[3] !== 107)
        throw "Error in loop: bad values[3]: " + result.values[3];
}

// Now throw an exception.
bar = function() {
    throw "Error42";
}
var result = foo(bar, 108, [105, 1, 1]);
if (result.outcome !== "exception")
    throw "Error at end: bad outcome: " + result.outcome;
if (result.values.length !== 4)
    throw "Error at end: bad number of values: " + result.values.length;
if (result.values[0] !== bar)
    throw "Error at end: bad values[0]: " + result.values[0];
if (result.values[1] !== 103)
    throw "Error at end: bad values[1]: " + result.values[1];
if (result.values[2] !== 102)
    throw "Error at end: bad values[2]: " + result.values[2];
if (result.values[3] !== 101)
    throw "Error at end: bad values[3]: " + result.values[3];

