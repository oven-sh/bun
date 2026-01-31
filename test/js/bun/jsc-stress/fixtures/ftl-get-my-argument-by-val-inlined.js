// @bun
function foo(i) {
    return arguments[i];
}

function bar(i) {
    return foo(i, "one", 2, "three");
}

noInline(bar);

for (var i = 0; i < testLoopCount; ++i) {
    var thingies = [i % 4, "one", 2, "three"];
    var result = bar(i % 4, "five", 6, "seven");
    if (result != thingies[i % 4])
        throw "Error: bad result for i = " + i + ": " + result;
}
