// @bun
function foo(x) {
    return Math.sin(x);
}

noInline(foo);

var j = 0;
let expected = foo(testLoopCount - 1);
for (var i = 0; i < testLoopCount; ++i)
    j = foo(i);

if (expected != j) {
    throw "Error"
}
