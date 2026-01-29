// @bun
function assert(actual, expected) {
    for (let i = 0; i < actual.length; i++) {
        if (actual[i] != expected[i])
            throw new Error("bad actual=" + actual[i] + " but expected=" + expected[i]);
    }
}

function func1(a) {
    for (let i = 0; i < 4; i++) {
        a[i] = 1;
    }
    return a;
}
noInline(func1);

function func2(a) {
    for (let i = 0; i < 4; i++) {
        a[i] = 1;
        for (let i = 0; i < 4; i++) {
            a[i] = 1;
        }
    }
    return a;
}
noInline(func2);

function func3(a) {
    for (let i = 0; i < 4; i++) {
        if (i % 2 == 0)
            a[i] = 1;
        else
            a[i] = 2;
    }
    return a;
}
noInline(func3);

function func4(s) {
    let len = 4;
    var a = new Array(len);
    for (var i = 0; i < len; i++) {
        a[i] = s[i];
    }
    s[0] = a[0] ^ a[1];
    return s;
}
noInline(func4);

function func5(a) {
    for (let i = 0; i < 4;) {
        a[i] = 1;
        if (i > -1)
            i += 1;
    }
    return a;
}
noInline(func5);

function func6(a) {
    for (let i = 3; i > 1; i /= 2) {
        a[i] = 1;
    }
    return a;
}
noInline(func6);

function func7(a) {
    for (let i = 3; i < 4; i /= 0) {
        a[i] = 1;
    }
    return a;
}
noInline(func7);

function test(func) {
    let expected;
    for (let i = 0; i < testLoopCount; i++) {
        let a = [0, 0, 0, 0];
        let res = func(a);
        if (i == 0)
            expected = res;
        assert(res, expected);
    }
}

test(func1);
test(func2);
test(func3);
test(func4);
test(func5);
test(func6);
test(func7);
