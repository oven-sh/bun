// @bun
function foo(arg) {
    try {
        return new Array(arg);
    } catch (e) {
        return "error42";
    }
}

noInline(foo);

for (var i = 0; i < testLoopCount; ++i) {
    var result = foo(1);
    if (result.length != 1)
        throw "Error: bad result: " + result;
}

var result = foo(-1);
if (result != "error42")
    throw "Error: bad result at end: " + result;

