class C {
    y: number;
    constructor(y: number) { } // ok
}

var c: C;
var r = c.y;

class D {
    y: number;
    constructor(public y: number) { }
}

var d: D;
var r2 = d.y;

class E {
    y: number;
    constructor(private y: number) { }
}

var e: E;
var r3 = e.y; // error

class F {
    y: number;
    constructor(protected y: number) { }
}

var f: F;
var r4 = f.y; // error
