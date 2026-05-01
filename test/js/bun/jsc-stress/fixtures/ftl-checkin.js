// @bun
function foo(x){
    var t = "s" in x; 
    return t;
}

noInline(foo);

var r;
for (var i = 0; i < testLoopCount; ++i) {
    var z = { 'y' : i, 's' : i + 1 };
    z.s = 10;
    r = foo(z);
}

if (!r) {
    print ("Error: " + r);
}
