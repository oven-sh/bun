// @bun
function foo(p, o) {
    var q = o.q;
    if (p)
        return q.f;
    return q.g;
}

noInline(foo);

var o = {q: {f: 41, g: 42}};

for (var i = 0; i < testLoopCount; ++i) {
    var result = foo(false, o);
    if (result != 42)
        throw "Error: bad result: " + result;
}

var result = foo(true, o);
if (result != 41)
    throw "Error: bad result at end: " + result;

