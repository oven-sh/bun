// @bun
function foo(i, x){
    return x.substring( 2 , 5);
}

noInline(foo);

var x = "";

for (var i = 0 ; i < testLoopCount; i++){
    x = foo(i, "lkajsx");
}

if (x != "ajs")
    throw "Error: bad substring: "+ x;

