// @bun
function foo(s) {
    return /foo/.test(s);
}

noInline(foo);

for (var i = 0; i < testLoopCount; ++i) {
    if (!foo("foo"))
        throw "Error: bad result for foo";
    if (foo("bar"))
        throw "Error: bad result for bar";
}
