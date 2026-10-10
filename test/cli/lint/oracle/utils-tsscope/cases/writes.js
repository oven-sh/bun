var a = 0; a = a + 1;
var b = 0; b += 1; b++;
var c = 0; c = c + 1, c;
var d = 0; foo(d = d + 1);
var e = 0; e = foo(function () { return e; });
var f = 0; f = (function () { return f; })();
var g = 0; g = [function () { return g; }];
var h = 0; h = { m() { return h; } };
var i = 0; i = (1, function () { return i; });
var j = 0; j = (function () { return j; }, 1);
var k = 0; k = x = function () { return k; };
var l = 0; l = tag`${function () { return l; }}`;
var m = 0; function* gen() { m = yield function () { return m; }; }
var n = 0; n = function () { function inner() { return n; } };
var o = 0; o = class { static { function inner() { return o; } } };
var p = 0; for (;;) { p = p + 1; }
var q = 0; function later() { q = q + 1; }
var r = 0; r ||= 1; var s = 0; s &&= 1; var t = 0; t ??= 1;
var u = 0; for (u = 0; ;) {}
var v = 0; for (v in x) return1();
var w; for (w in x) return;
for (var y in x) return;
for (var [z1, z2] of x) { return; }
for (var z3 of x) { return; return; }
var z4; for (z4 of x) { return; }
var z5; for ([z5] of x) return;
var z6 = 0; z6 = z6++;
var z7 = 0; (z7 = 1), (z7 = z7 + 1);
var z8 = 0; z8 = new Foo(function () { return z8; });
var z9 = 0; z9 = new (function () { return z9; })();
var y1 = 0; class Field { x = (y1 = y1 + 1); }
var y2 = 0; y2 = () => y2;
var y3 = 0; [y3 = y3] = x;
var y4 = 0; ({ y4 } = x);
var y5 = 0; y5 = { a: [() => y5] }, 1;
var y6 = 0; with (x) y6 = y6 + 1;
var y7 = 0; y7 = import(function () { return y7; });
var y8 = 0; y8 = ([x = function () { return y8; }] = z);
