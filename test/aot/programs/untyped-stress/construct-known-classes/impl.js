(function () {
function check(actual, expected, what) {
    if (actual !== expected)
        throw new Error(what + ": " + actual + " instead of " + expected);
}
function checkThrows(f, type, what) {
    try {
        f();
    } catch (error) {
        if (!(error instanceof type))
            throw new Error(what + ": threw " + error);
        return error;
    }
    throw new Error(what + ": did not throw");
}

class Point {
    constructor(x, y) { this.x = x; this.y = y; }
    plus(other) { return new Point(this.x + other.x, this.y + other.y); }
}
function sumsPoints(n) {
    let sum = 0;
    for (let i = 0; i < n; i++)
        sum += new Point(i, 1).x;
    return sum;
}
check(sumsPoints(100), 4950, "points made in a loop");
check(new Point(1, 2).plus(new Point(3, 4)).y, 6, "a point made by a method of its class");
check(new Point(1, 2).plus(new Point(3, 4)) instanceof Point, true, "what a method of the class makes is of the class");
check(Object.getPrototypeOf(new Point(1, 2).plus(new Point(3, 4))), Point.prototype, "its prototype");

class WithoutConstructor {
    twin() { return new WithoutConstructor; }
    value() { return 7; }
}
function makesManyWithoutConstructor(n) {
    let sum = 0;
    let first = new WithoutConstructor;
    for (let i = 0; i < n; i++)
        sum += first.twin().value();
    return sum;
}
check(makesManyWithoutConstructor(20000), 140000, "a class without a constructor, made many times");

class WithFields {
    a = 1;
    #b = 2;
    constructor(c) { this.c = c; }
    sum() { return this.a + this.#b + this.c; }
    twin() { return new WithFields(this.c); }
}
function sumsWithFields(n) {
    let sum = 0;
    for (let i = 0; i < n; i++)
        sum += new WithFields(i).twin().sum();
    return sum;
}
check(sumsWithFields(100), 5250, "fields and private fields");

class Base {
    constructor(v) { this.v = v; this.made = new.target; }
}
class Derived extends Base {
    constructor(v) { super(v + 1); this.w = v; }
}
function sumsDerived(n) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
        let object = new Derived(i);
        sum += object.v + object.w;
        if (object.made !== Derived || Object.getPrototypeOf(object) !== Derived.prototype)
            throw new Error("a derived object is not what it should be");
    }
    return sum;
}
function sumsBase(n) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
        let object = new Base(i);
        sum += object.v;
        if (object.made !== Base)
            throw new Error("new.target is not the class");
    }
    return sum;
}
check(sumsDerived(100), 10000, "a derived class");
check(sumsBase(100), 4950, "new.target in a constructor");
check(Reflect.construct(Base, [1], Derived).made, Derived, "new.target that is not the callee");
check(Object.getPrototypeOf(Reflect.construct(Base, [1], Derived)), Derived.prototype, "the prototype with a new.target that is not the callee");

class ReturnsObject {
    constructor(other) {
        this.own = 1;
        if (other)
            return other;
    }
}
function makesReturnsObject(other) {
    let last;
    for (let i = 0; i < 3; i++)
        last = new ReturnsObject(other);
    return last;
}
let returned = { returned: true };
check(makesReturnsObject(returned), returned, "a constructor that returns an object");
check(makesReturnsObject(null).own, 1, "a constructor that returns nothing");

function Plain(x) { this.x = x; return 5; }
function sumsPlain(n) {
    let sum = 0;
    for (let i = 0; i < n; i++)
        sum += new Plain(i).x;
    return sum;
}
check(sumsPlain(100), 4950, "a function that is not a class and returns a number");

let stored = [];
class WithSetter {
    constructor(x) { this.x = x; this.y = 2; }
    set x(value) { stored.push(value); }
    get x() { return "from the getter"; }
}
function makesWithSetter(n) {
    let last;
    for (let i = 0; i < n; i++)
        last = new WithSetter(i).x;
    return last;
}
check(makesWithSetter(3), "from the getter", "a getter of the class");
check(stored.join(), "0,1,2", "a setter of the class");

class GetsSetterLater {
    constructor(x) { this.late = x; }
}
function makesGetsSetterLater(n) {
    let sum = 0;
    for (let i = 0; i < n; i++)
        sum += new GetsSetterLater(1).late;
    return sum;
}
check(makesGetsSetterLater(200), 200, "before the prototype has a setter");
let storedLater = 0;
Object.defineProperty(GetsSetterLater.prototype, "late", { set(value) { storedLater += value; }, get() { return 10; }, configurable: true });
check(makesGetsSetterLater(200), 2000, "after the prototype has a getter");
check(storedLater, 200, "after the prototype has a setter");
Object.defineProperty(GetsSetterLater.prototype, "late", { value: 3, writable: false, configurable: true });
checkThrows(() => makesGetsSetterLater(1), TypeError, "after the prototype has a property that is read only");
delete GetsSetterLater.prototype.late;
check(makesGetsSetterLater(200), 200, "after the prototype has it no more");

function makesEarly() {
    let last;
    for (let i = 0; i < 2; i++)
        last = new Late(i);
    return last;
}
checkThrows(makesEarly, TypeError, "a variable that has no class yet");
var Late = class { constructor(x) { this.x = x; } };
check(makesEarly().x, 1, "the variable once it has its class");

function makesInDeadZone() {
    let last;
    for (let i = 0; i < 2; i++)
        last = new Later(i);
    return last;
}
checkThrows(makesInDeadZone, ReferenceError, "a class that is not declared yet");
class Later { constructor(x) { this.x = x; } }
check(makesInDeadZone().x, 1, "the class once it is declared");

let Reassigned = class { constructor() { this.which = 1; } };
function makesReassigned() {
    let last;
    for (let i = 0; i < 2; i++)
        last = new Reassigned;
    return last.which;
}
check(makesReassigned(), 1, "a variable before it is given another class");
Reassigned = class { constructor() { this.which = 2; } };
check(makesReassigned(), 2, "a variable after it is given another class");

function makesParameter(C, n) {
    let sum = 0;
    for (let i = 0; i < n; i++)
        sum += new C(i, 1).x;
    return sum;
}
check(makesParameter(Point, 10), 45, "a class that is a parameter");
check(makesParameter(Plain, 10), 45, "a function that is a parameter");
checkThrows(() => makesParameter(() => { }, 1), TypeError, "an arrow function that is a parameter");

class Catches {
    constructor(x) {
        try {
            this.x = x.length;
        } catch {
            this.x = -1;
        }
    }
}
function sumsCatches(n) {
    let sum = 0;
    for (let i = 0; i < n; i++)
        sum += new Catches(i & 1 ? "ab" : null).x;
    return sum;
}
check(sumsCatches(10), 5, "a constructor that catches");

class Throws {
    constructor(x) {
        if (x === 3)
            throw new Error("thrown by the constructor");
        this.x = x;
    }
}
function makesThrows(n) {
    let sum = 0;
    for (let i = 0; i < n; i++)
        sum += new Throws(i).x;
    return sum;
}
check(makesThrows(3), 3, "a constructor that does not throw yet");
let thrown = checkThrows(() => makesThrows(5), Error, "a constructor that throws");
let frames = thrown.stack.split("\n").map(line => line.split("@")[0]);
check(frames[0], "Throws", "the innermost frame of what the constructor throws");
check(frames[1], "makesThrows", "the frame of the caller of the constructor");

class Node {
    constructor(depth) {
        this.depth = depth;
        this.next = depth ? new Node(depth - 1) : null;
    }
}
function countsNodes(depth) {
    let count = 0;
    for (let node = new Node(depth); node; node = node.next)
        count++;
    return count;
}
check(countsNodes(50), 51, "a constructor that makes another of its class");

checkThrows(() => Point(1, 2), TypeError, "a class called without new");
check(new Point(1, 2).constructor, Point, "the constructor property");
})();
console.log("passed");
