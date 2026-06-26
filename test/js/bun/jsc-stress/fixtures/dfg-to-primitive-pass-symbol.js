// @bun
var shouldThrow = false;

// str concat generates op_to_primitive.
function toPrimitiveTarget() {
    if (shouldThrow) {
        return Symbol('Cocoa');
    }
    return 'Cocoa';
}
noInline(toPrimitiveTarget);

function doToPrimitive() {
    var value = toPrimitiveTarget();
    return value + "Cappuccino" + value;
}
noInline(doToPrimitive);

for (var i = 0; i < testLoopCount; ++i) {
    var result = doToPrimitive();
    if (result !== "CocoaCappuccinoCocoa")
        throw "Error: bad result: " + result;
}

shouldThrow = true;

var didThrow;
try {
    shouldThrow = true;
    doToPrimitive();
} catch (e) {
    didThrow = e;
}

if (String(didThrow) !== "TypeError: Cannot convert a symbol to a string")
    throw "Error: didn't throw or threw wrong exception: " + didThrow;
