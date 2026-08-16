// @bun
function assert(b) {
    if (!b)
        throw new Error("bad value")
}
noInline(assert);

let oThrow = {
    x: 20,
    y: 40,
    z: 50,
    get f() { throw new Error("Hello World!"); }
};

let o1 = {
    x: 20,
    f: 40
};

let o2 = {
    x: 20,
    y: 50,
    f: 500,
    get f() { return 20; }
};

function foo(f) {
    let o = f();
    try {
        o = o.f;
    } catch(e) {
        assert(o === oThrow); // Make sure this is not undefined.
    }
}
noInline(foo);

let i;
let flag = false;
function f() {
    if (flag)
        return oThrow;
    if (i % 2)
        return o1;
    return o2;
}
noInline(f);
for (i = 0; i < testLoopCount; i++) {
    foo(f);
}
flag = true;
foo(f);
