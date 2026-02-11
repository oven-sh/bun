// @bun
function foo(x){
    return Math.random(x);
}

noInline(foo);

var x = 0;

for (var i = 0 ; i < testLoopCount; i++){
    x = foo(i);
}
