// @bun
function assert(b) {
    if (!b)
        throw new Error("Bad value.")
}
noInline(assert);

var v1 = 100;
var v2 = 200;
var flag = false;
var o1 = {
    get f() {
        if (flag)
            throw new Error("gotcha!");
        return v1;    
    }
}

function a() { return "a"; }
noInline(a);
function b() { return "b"; }
noInline(b);
function c() { return "c"; }
noInline(c);
function d() { return "d"; }
noInline(d);
function e() { return "e"; }
noInline(e);
function f() { return "f"; }
noInline(f);
function g() { return "g"; }
noInline(g);

var o2 = {
    get f() {
        assert(true);
        assert(true);
        assert(true);
        assert(true);
        assert(true);
        assert(true);
        assert(true);
        return v2;
    }
}

function foo(o) {
    try {
        var _a = a();
        var _b = b();
        var _c = c();
        var _d = d();
        var _e = e();
        var _f = f();
        var _g = g();

        o = o.f;

    } catch(e) {
        assert(o === o1);
        assert(_b === "b");
        assert(_c === "c");
        assert(_d === "d");
        assert(_e === "e");
        assert(_f === "f");
        assert(_g === "g");
    }
}
noInline(foo);

for (var i = 0; i < testLoopCount; i++)
    foo(i % 2 ? o1 : o2);
flag = true;
foo(o1);
