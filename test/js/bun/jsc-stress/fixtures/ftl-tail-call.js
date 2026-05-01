// @bun
"use strict";

function foo(a, b, c) {
    return a + b * 2 + c * 3;
}

noInline(foo);

function bar(a, b, c) {
    return foo(a.f, b.g, c.h);
}

noInline(bar);

for (var i = 0; i < testLoopCount; ++i) {
    var result = bar({f: 4}, {g: 5}, {h: 6});
    if (result != 4 + 5 * 2 + 6 * 3)
        throw "Error: bad result: " + result;
}

