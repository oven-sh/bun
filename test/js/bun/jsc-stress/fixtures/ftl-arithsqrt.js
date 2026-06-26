// @bun
function foo(x) {
    return Math.sqrt(x);
}

noInline(foo);

let expected = foo(testLoopCount - 1);
var j = 0;
for (var i = 0; i < testLoopCount; ++i)
    j = foo(i);

if (expected != j) {
    throw "Error"
}
