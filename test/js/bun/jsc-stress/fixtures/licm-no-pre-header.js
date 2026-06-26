// @bun
//@ runFTLNoCJIT("--createPreHeaders=false")

function foo(array) {
    var result = 0;
    var i = 0;
    if (!array.length)
        array = [1];
    do {
        result += array[i++];
    } while (i < array.length)
    return result;
}

noInline(foo);

for (var i = 0; i < testLoopCount; ++i)
    foo([1, 2, 3]);
