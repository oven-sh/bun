// @bun
function foo(a, b) {
    try {
        return a >> b;
    } catch (e) {
        return e;
    }
}

noInline(foo);

for (var i = 0; i < testLoopCount; ++i) {
    var result = foo((i & 1) ? 32 : "32", 2);
    if (result !== 8)
        throw "Error: bad result: " + result;
}

var result = foo({valueOf: function() { throw "error42"; }}, 2);
if (result !== "error42")
    throw "Error: bad result at end: " + result;
