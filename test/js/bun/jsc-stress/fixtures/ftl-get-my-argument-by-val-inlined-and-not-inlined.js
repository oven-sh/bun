// @bun
function foo(i) {
    return arguments[i];
}

function bar(i) {
    return [arguments[i], foo(i, "one", 2, "three"), arguments[i]];
}

noInline(bar);

function arraycmp(a, b) {
    if (a.length != b.length)
        return false;
    for (var i = 0; i < a.length; ++i) {
        if (a[i] != b[i])
            return false;
    }
    return true;
}

for (var i = 0; i < testLoopCount; ++i) {
    var thingies = [i % 4, "one", 2, "three"];
    var otherThingies = [i % 4, "five", 6, "seven"];
    var result = bar(i % 4, "five", 6, "seven");
    if (!arraycmp(result, [otherThingies[i % 4], thingies[i % 4], otherThingies[i % 4]]))
        throw "Error: bad result for i = " + i + ": " + result;
}
