// @bun
function foo(x) {
    return Math.tan(x);
}

noInline(foo);

var expected = foo(testLoopCount - 1);
var j = 0;
for (var i = 0; i < testLoopCount; ++i)
    j = foo(i);

if (expected != j){
    throw `Error: ${j}`;
}
