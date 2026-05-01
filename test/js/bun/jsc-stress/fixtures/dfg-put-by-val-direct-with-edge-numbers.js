// @bun
// Test that a object accepts DFG PutByValueDirect operation with edge numbers.

function lookupWithKey(key) {
    var object = {
        [key]: 42
    };
    return object[key];
}
noInline(lookupWithKey);

for (var i = 0; i < testLoopCount; ++i) {
    [
        // integers
        -0x80000001,  // out of int32_t
        -0x80000000,  // int32_t min
        -1,           // negative
        0,            // zero
        1,            // positive
        0x7fffffff,   // int32_t max
        0x80000000,   // out of int32_t
        0xfffffffd,   // less than array max in JSObject
        0xfffffffe,   // array max in JSObject
        0xffffffff,   // uint32_t max, not array index
        0x100000000,  // out of uint32_t

        // stringified integers
        (-0x80000001).toString(),  // out of int32_t
        (-0x80000000).toString(),  // int32_t min
        (-1).toString(),           // negative
        (0).toString(),            // zero
        (1).toString(),            // positive
        (0x7fffffff).toString(),   // int32_t max
        (0x80000000).toString(),   // out of int32_t
        (0xfffffffd).toString(),   // less than array max in JSObject
        (0xfffffffe).toString(),   // array max in JSObject
        (0xffffffff).toString(),   // (uint32_t max).toString()
        (0x100000000).toString(),  // out of uint32_t

        // doubles
        Number.MIN_VALUE,
        Number.MAX_VALUE,
        Number.MIN_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        Number.NaN,
        Number.EPSILON,
        +0.0,
        -0.0,
        0.1,
        -0.1,
        4.2,
        -4.2,
        0x80000000 + 0.5,   // out of int32_t, double

        // stringified doules
        (Number.MIN_VALUE).toString(),
        (Number.MAX_VALUE).toString(),
        (Number.MIN_SAFE_INTEGER).toString(),
        (Number.MAX_SAFE_INTEGER).toString(),
        (Number.POSITIVE_INFINITY).toString(),
        (Number.NEGATIVE_INFINITY).toString(),
        "NaN",
        (Number.EPSILON).toString(),
        "+0.0",
        "-0.0",
        "0.1",
        "-0.1",
        "4.2",
        "-4.2",
        (0x80000000 + 0.5).toString()
    ].forEach(function (key) {
        var value = lookupWithKey(key);
        if (value !== 42)
            throw new Error('bad value: ' + value);
    });
}

function lookupWithKey2(key) {
    var object = {
        [key]: 42
    };
    return object[key];
}
noInline(lookupWithKey2);

var toStringThrowsError = {
    toString: function () {
        throw new Error('ng');
    }
};

for (var i = 0; i < testLoopCount; ++i) {
    var error = null;
    try {
        lookupWithKey2(toStringThrowsError);
    } catch (e) {
        error = e;
    }
    if (!error)
        throw new Error('not thrown');
    if (String(error) !== 'Error: ng')
        throw new Error('bad error: ' + String(error));
}
