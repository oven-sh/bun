// @bun
function foo(f, p) {
    var x = 100;
    var result = 101;
    x = 102;
    p = 103;
    result = f();
    f = 104;
    p = 105;
    x = 106;
    return {outcome: "return", values: [f, p, x, result]};
}

noInline(foo);

function bar() {
    return 107;
}

noInline(bar);

// Warm up foo().
for (var i = 0; i < testLoopCount; ++i) {
    var result = foo(bar);
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
var result;
try {
    bar = function() {
        throw "Error42";
    }
    var result = foo(bar, 108);
} catch (e) {
    if (e != "Error42")
        throw "Error at end: bad exception: " + e;
    result = {outcome: "exception"};
}
if (result.outcome !== "exception")
    throw "Error at end: bad outcome: " + result.outcome;
