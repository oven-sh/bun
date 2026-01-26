// @bun
function assert(b) {
    if (!b)
        throw new Error("bad value")
}
noInline(assert);

function random() { 
    return "blah";
}
noInline(random);

function foo(o, a) {
    let x = o.g;
    let y = o.y;
    let j = random();
    try {
        j = o.f;
    } catch(e) {
        assert(j === "blah");
        return x + y + 1;
    }
    return x + y;
}

noInline(foo);
var flag = false;
function f(arg1, arg2, arg3) {
    if (flag)
        throw new Error("blah")
    return arg1;
}
noInline(f);
let o1 = {
    g: 20,
    y: 40,
    f: "get f"
};

let o2 = {
    g: "g",
    y: "y",
    get f() { 
        if (flag) 
            throw new Error("blah"); 
        return "get f";
    }
}

for (let i = 0; i < testLoopCount; i++) {
    if (i % 2) {
        assert(foo(o1) === 60);
    } else {
        assert(foo(o2) === "gy");
    }
}
flag = true;
assert(foo(o2) === "gy1");
