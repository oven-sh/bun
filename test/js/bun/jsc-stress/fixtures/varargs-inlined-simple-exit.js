// @bun
function foo(a, b) {
    return a + b;
}

var global;
function bar() {
    var a = arguments;
    var tmp = global + 1;
    return tmp + foo.apply(null, a);
}

function baz(a, b) {
    return bar(a, b);
}

noInline(baz);

for (var i = 0; i < testLoopCount; ++i) {
    global = i;
    var result = baz(1, 2);
    if (result != i + 1 + 1 + 2)
        throw "Error: bad result: " + result;
}

global = 1.5;
var result = baz(1, 2);
if (result != 1.5 + 1 + 1 + 2)
    throw "Error: bad result at end: " + result;
