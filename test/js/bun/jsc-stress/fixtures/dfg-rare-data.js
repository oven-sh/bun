// @bun
function F () { this.inner = 42; };

for (var i = 0; i < testLoopCount; ++i) {
    var x = new F(false);
    F.prototype = Object; // Force clearing of the function's rare data
    var result = x.inner;
    if (result !== 42)
        throw "Expected 42, got: " + result;
}
