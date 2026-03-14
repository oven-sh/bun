// @bun
function foo(){
    var count = 100;
    var d = new DataView(new ArrayBuffer(count));

    for (var i = 0; i < count / 4; i++){
        d.setInt32(i, i);
    }

    for (var i = 0; i < count; i++){
        d.setInt8(i, i);
    }
    var result = 0;
    for (var i = 0; i < count; i++){
        result += d.getInt8(i);
    }
    return result;
}

noInline(foo);

var r = 0;
for (var i = 0 ; i < 50000; i++){
    r += foo();
}

if (r != 247500000)
    throw "Bad result: " + r;

