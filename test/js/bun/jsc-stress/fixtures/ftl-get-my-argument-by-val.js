// @bun
function foo(i) {
    return arguments[i];
}

noInline(foo);

for (var i = 0; i < testLoopCount; ++i) {
    var thingies = [i % 4, "one", 2, "three"];
    var result = foo(i % 4, "one", 2, "three");
    if (result != thingies[i % 4])
        throw "Error: bad result for i = " + i + ": " + result;
}
