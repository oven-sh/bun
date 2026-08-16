// @bun
var array = [ "a", "b", "c", "d" ];

function foo(array, s) {
    for (var i = 0; i < array.length; ++i) {
        if (array[i] == s)
            return true;
    }
    return false;
}

noInline(foo);

var result = 0;
for (var i = 0; i < testLoopCount; ++i)
    result += foo(array, "d");

if (result != testLoopCount)
    throw "Bad result: " + result;
