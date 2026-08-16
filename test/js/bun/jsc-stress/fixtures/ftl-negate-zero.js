// @bun
function foo(x) {
    return -x;
}

noInline(foo);

for (var i = 0; i < testLoopCount; ++i) {
    var result = foo(0);
    if (1 / result != "-Infinity")
        throw "Error: bad result: " + result;
}

