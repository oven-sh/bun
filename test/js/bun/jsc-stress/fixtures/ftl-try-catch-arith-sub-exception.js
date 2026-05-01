// @bun
function assert(b) {
    if (!b)
        throw new Error("uh oh");
}

let flag = false;
let o = {
    valueOf() {
        if (flag)
            throw new Error("by by");
        return 13.5;
    }
};
noInline(o.valueOf);

function baz() { return 1.5; }
noInline(baz);

function foo(x, o) {
    let r = baz();
    try {
        r = x - o - r;
    } catch(e) { }
    return r;
}
noInline(foo);

let x = 20.5;
for (let i = 0; i < testLoopCount; i++) {
    assert(foo(x, o) === 5.5);
}
flag = true;
assert(foo(x, o) === 1.5);


function bar(x, o) {
    let caughtException = false;
    var r = null;
    try {
        // This tests aliasing of left/right with result register in a SubGenerator
        // and ensures that the sub will spill the register properly and that we value
        // recover properly.
        r = x - o;
    } catch(e) {
        caughtException = true;
        assert(r === null);
    }
    if (!caughtException)
        assert(r === 7);
    return caughtException;
} 
noInline(bar);

flag = false;
for (let i = 0; i < testLoopCount; i++) {
    assert(bar(x, o) === false);
}
flag = true;
assert(bar(x, o) === true);
