function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

function outer(a) {
    function inner(b) { return function innermost(c) { return a + b + c; }; }
    return inner(1)(2);
}
class Point {
    constructor(x, y) { this.x = x; this.y = y; }
    get sum() { return this.x + this.y; }
    static origin() { return new Point(0, 0); }
}
class Point3 extends Point {
    constructor(x, y, z) { super(x, y); this.z = z; }
    get sum() { return super.sum + this.z; }
}
function* yields(n) {
    for (let i = 0; i < n; i++)
        yield i;
}
const matches = text => /^a+b$/.test(text);

check(outer(3), 6, "nested functions");
check(new Point(1, 2).sum, 3, "a class");
check(Point.origin().sum, 0, "a static method");
check(new Point3(1, 2, 3).sum, 6, "a derived class");
check([...yields(3)].join(), "0,1,2", "a generator");
check(matches("aab"), true, "a regular expression");
console.log("passed");
