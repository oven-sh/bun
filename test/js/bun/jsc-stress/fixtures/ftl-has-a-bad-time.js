// @bun
function foo(p) {
    return p ? [42] : null;
}

noInline(foo);

// Make sure we think that foo() allocates int arrays.
for (var i = 0; i < 100; ++i)
    foo(true);

// Now have a bad time.
var array = new Array();
Array.prototype.__defineSetter__("0", function() { });

// Finally, get foo() to compile in the FTL. But don't allocate anymore arrays.
for (var i = 0; i < testLoopCount; ++i)
    foo(false);

