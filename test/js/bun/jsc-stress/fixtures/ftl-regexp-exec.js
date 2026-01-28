// @bun
function foo(s) {
    return /foo/.exec(s);
}

noInline(foo);

for (var i = 0; i < testLoopCount; ++i) {
    var result = foo("foo");
    if (!result)
        throw "Error: bad result for foo";
    if (result.length != 1)
        throw "Error: bad result for foo: " + result;
    if (result[0] != "foo")
        throw "Error: bad result for foo: " + result;
    if (foo("bar"))
        throw "Error: bad result for bar";
}
