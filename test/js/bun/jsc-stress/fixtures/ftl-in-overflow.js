// @bun
function foo(o) {
    return "foo" in o;
}

noInline(foo);

for (var i = 0; i < testLoopCount; ++i) {
    var o = {};
    o["i" + i] = 42;
    o.foo = 43;
    foo(o);
}

