function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function thrownBy(f) {
    try {
        f();
    } catch (error) {
        return typeof error === "object" ? error.constructor.name : error;
    }
    return "nothing was thrown";
}
function describe(o) { return Object.keys(o).map(k => k + "=" + o[k]).join(); }

function AllInTry(a) {
    try {
        this.x = a;
        this.y = a;
    } catch {
        throw 1;
    }
}
check(describe(new AllInTry(5)), "x=5,y=5", "nothing throws");
Object.defineProperty(AllInTry.prototype, "x", { set(v) { throw "from the setter"; }, configurable: true });
check(thrownBy(() => new AllInTry(5)), 1, "the first store in the try block throws");
delete AllInTry.prototype.x;
Object.defineProperty(AllInTry.prototype, "y", { set(v) { throw "from the setter"; }, configurable: true });
check(thrownBy(() => new AllInTry(5)), 1, "the second store in the try block throws");
delete AllInTry.prototype.y;
check(describe(new AllInTry(6)), "x=6,y=6", "nothing throws any more");

function PartlyInTry(a) {
    this.a = a;
    this.b = a;
    try {
        this.x = a;
        this.y = a;
    } catch {
        throw 2;
    }
}
check(describe(new PartlyInTry(5)), "a=5,b=5,x=5,y=5", "two stores before the try block, two inside");
Object.defineProperty(PartlyInTry.prototype, "x", { set(v) { throw "from the setter of x"; }, configurable: true });
check(thrownBy(() => new PartlyInTry(5)), 2, "a store inside the try block throws");
delete PartlyInTry.prototype.x;
Object.defineProperty(PartlyInTry.prototype, "b", { set(v) { throw "from the setter of b"; }, configurable: true });
check(thrownBy(() => new PartlyInTry(5)), "from the setter of b", "a store before the try block throws");
delete PartlyInTry.prototype.b;

function StrictInTry(a) {
    "use strict";
    try {
        this.x = a;
        this.y = a;
    } catch {
        throw 3;
    }
}
check(describe(new StrictInTry(5)), "x=5,y=5", "strict mode");
Object.defineProperty(StrictInTry.prototype, "y", { value: "fixed", writable: false, configurable: true });
check(thrownBy(() => new StrictInTry(5)), 3, "a read-only property on the prototype, in strict mode");
delete StrictInTry.prototype.y;

class ClassInTry {
    constructor(a) {
        try {
            this.x = a;
            this.y = a;
        } catch {
            throw 4;
        }
    }
    set y(v) { if (v < 0) throw new RangeError("negative"); }
}
check(describe(new ClassInTry(5)), "x=5", "a class whose setter accepts the value");
check(thrownBy(() => new ClassInTry(-5)), 4, "a class whose setter throws");

function NestedTry(a) {
    try {
        this.x = a;
        try {
            this.y = a;
        } catch {
            throw "inner";
        }
    } catch (error) {
        throw "outer after " + error;
    }
}
check(describe(new NestedTry(5)), "x=5,y=5", "one try block in another");
Object.defineProperty(NestedTry.prototype, "y", { set(v) { throw "the setter"; }, configurable: true });
check(thrownBy(() => new NestedTry(5)), "outer after inner", "the store in the inner block throws");
delete NestedTry.prototype.y;
Object.defineProperty(NestedTry.prototype, "x", { set(v) { throw "the setter"; }, configurable: true });
check(thrownBy(() => new NestedTry(5)), "outer after the setter", "the store in the outer block throws");
delete NestedTry.prototype.x;

let log = [];
function Swallows(a) {
    try {
        this.x = a;
        this.y = a;
    } catch {
        log.push("caught");
    }
}
check(describe(new Swallows(5)), "x=5,y=5", "a handler that goes on");
Object.defineProperty(Swallows.prototype, "y", { set(v) { throw "the setter"; }, configurable: true });
check(describe(new Swallows(5)) + log.join(), "x=5caught", "the object has what was stored before the exception");
delete Swallows.prototype.y;

function WithFinally(a) {
    try {
        this.x = a;
        this.y = a;
    } finally {
        log.push("finally");
    }
}
log = [];
check(describe(new WithFinally(5)) + log.join(), "x=5,y=5finally", "a finally block");
Object.defineProperty(WithFinally.prototype, "x", { set(v) { throw "the setter"; }, configurable: true });
log = [];
check(thrownBy(() => new WithFinally(5)) + log.join(), "the setterfinally", "a finally block runs when a store throws");
delete WithFinally.prototype.x;

function NoTry(a, b) {
    this.x = a;
    this.y = b;
    this.z = a;
}
check(describe(new NoTry(1, 2)), "x=1,y=2,z=1", "no try block");
Object.defineProperty(NoTry.prototype, "y", { set(v) { throw "the setter"; }, configurable: true });
check(thrownBy(() => new NoTry(1, 2)), "the setter", "no try block, a store throws");
delete NoTry.prototype.y;

function TryAfterwards(a) {
    this.x = a;
    this.y = a;
    try {
        log.push(a);
    } catch {
        throw 5;
    }
}
check(describe(new TryAfterwards(1)), "x=1,y=1", "a try block after the stores");

function* yieldsInLiteral() {
    try {
        return { a: 1, b: yield "first", c: 3 };
    } catch {
        return { a: "caught", b: yield "second", c: "caught" };
    }
}
{
    let generator = yieldsInLiteral();
    check(generator.next().value, "first", "a literal that yields");
    check(describe(generator.next(2).value), "a=1,b=2,c=3", "and goes on");
    generator = yieldsInLiteral();
    generator.next();
    check(generator.throw(new Error).value, "second", "an exception thrown into a literal");
    check(describe(generator.next(2).value), "a=caught,b=2,c=caught", "and the literal of the handler");
}

console.log("passed");
