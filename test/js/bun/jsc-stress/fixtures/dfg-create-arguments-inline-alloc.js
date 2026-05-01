// @bun
var foo = function(o) {
    var a = Array.prototype.slice.call(arguments);
    var sum = 0;
    for (var i = 0; i < a.length; ++i)
        sum += a[i].x;
    return sum;
};

noInline(foo);

var niters = 10000;
var total = 0;
var o = {x: 42};
for (var i = 0; i < niters; ++i) {
    total += foo(o, o, o);
}

if (total != 42 * 3 * niters)
    throw new Error("Incorrect result!");
