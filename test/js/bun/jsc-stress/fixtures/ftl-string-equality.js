// @bun
function makeString(char) {
    var result = "";
    for (var i = 0; i < 10; ++i)
        result += char;
    return result;
}

var array = [ "a", "b", "c", "d" ];

for (var i = 0; i < array.length; ++i)
    array[i] = makeString(array[i]);

function foo(array, s) {
    for (var i = 0; i < array.length; ++i) {
        if (array[i] == s)
            return i;
    }
    return null;
}

noInline(foo);

var array2 = [ "a", "b", "c", "d", "e" ];

for (var i = 0; i < array2.length; ++i)
    array2[i] = makeString(array2[i]);

for (var i = 0; i < testLoopCount; ++i) {
    var index = i % array2.length;
    var result = foo(array, array2[index]);
    var expected = index >= array.length ? null : index
    if (result !== expected)
        throw "Error: bad result: " + result;
}

