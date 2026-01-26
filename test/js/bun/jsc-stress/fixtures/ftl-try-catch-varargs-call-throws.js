// @bun
function foo(o, a) {
    let resetFlag = false;
    if (flag) {
        resetFlag = true;
        flag = false;
    }
    let x = o(10);
    let y = o(20);
    if (resetFlag)
        flag = true;
    try {
        o.apply(null, a);
    } catch(e) {
        if (x !== 10)
            throw new Error("Not 10")
        return x + y;
    }
}
noInline(foo);
var flag = false;
function f(arg1, arg2, arg3) {
    if (flag)
        throw new Error("blah")
    return arg1;
}
noInline(f);

for (let i = 0; i < testLoopCount; i++) {
    foo(f, [10, 20, 30]);
}
flag = true;
foo(f, [10, 20, 30]);
