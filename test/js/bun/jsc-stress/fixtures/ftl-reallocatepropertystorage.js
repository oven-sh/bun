// @bun
function foo(x){
    x.a0 = 0;
    x.a1 = 1;
    x.a2 = 2;
    x.a3 = 3;
    x.a4 = 4;
    x.a5 = 5;
    x.a6 = 6;
    x.a7 = 7;
    x.a8 = 8;
    x.a9 = 9;
    x.a10 = 10;
}

noInline(foo);

var c = {};
for (var i = 0; i < testLoopCount; ++i) {
    var b = {};
    foo(b);
    c = b;
}

for (var j = 0; j <= 10 ; ++j)
    if (c['a'+j] != j) 
        throw "Error "+c['a'+j];


