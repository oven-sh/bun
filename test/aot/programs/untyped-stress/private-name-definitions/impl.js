function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function thrownBy(f, ...args) {
    try {
        f(...args);
    } catch (error) {
        return error.constructor.name;
    }
    return "nothing";
}
const rounds = 300;

class Point {
    #x = 1;
    #y;
    #sum = this.#x + 10;
    constructor(y) { this.#y = y; }
    read() { return this.#x + "," + this.#y + "," + this.#sum; }
    write(x) { this.#x = x; }
    static has(o) { return #x in o; }
}
class Point3D extends Point {
    #z = "z";
    public = "public";
    #w = [this.public];
    readAll() { return this.read() + "," + this.#z + "," + this.#w[0]; }
}
function makesPoint(y) { return new Point(y); }
function makesPoint3D(y) { return new Point3D(y); }
noInline(makesPoint);
noInline(makesPoint3D);
for (let i = 0; i < rounds; ++i) {
    let point = makesPoint(i);
    check(point.read(), "1," + i + ",11", "the private fields of a new object");
    point.write(i);
    check(point.read(), i + "," + i + ",11", "the private fields after a store");
    check(Object.getOwnPropertyNames(point).length, 0, "the visible properties of an object with private fields");
    check(makesPoint3D(i).readAll(), "1," + i + ",11,z,public", "the private fields of an instance of a subclass");
    check(Point.has(point) && Point.has(makesPoint3D(i)) && !Point.has({}), true, "which objects have a private field");
}

class ReturnsArgument { constructor(o) { return o; } }
class Stamper extends ReturnsArgument {
    #stamp = "stamp";
    #second = 2;
    static read(o) { return o.#stamp + o.#second; }
    static has(o) { return #stamp in o; }
    static write(o, value) { o.#stamp = value; }
}
function stamps(o) { return new Stamper(o); }
noInline(stamps);
for (let i = 0; i < rounds; ++i) {
    for (let target of [{}, { a: 1 }, { a: 1, b: 2 }, [], function () { }, new Map(), Object.create(null), new Point(i), Object.freeze({ frozen: true }), Object.preventExtensions({}), Object.seal({ sealed: 1 })]) {
        check(Stamper.has(target), false, "an object that has not been stamped");
        check(thrownBy(Stamper.read, target), "TypeError", "reading a private field that is not there");
        check(thrownBy(Stamper.write, target, 1), "TypeError", "storing to a private field that is not there");
        check(stamps(target), target, "the result of stamping");
        check(Stamper.read(target), "stamp2", "the private fields of a stamped object");
        check(thrownBy(stamps, target), "TypeError", "stamping twice");
        check(Stamper.read(target), "stamp2", "the private fields after stamping has failed");
        Stamper.write(target, i);
        check(Stamper.read(target), i + 2, "a private field of a stamped object after a store");
    }
}
check(Object.isFrozen(stamps(Object.freeze({}))), true, "a frozen object stays frozen");
let trapped = [];
let handler = new Proxy({}, { get(target, name) { trapped.push(name); return undefined; } });
for (let i = 0; i < rounds; ++i) {
    let proxy = new Proxy({}, handler);
    stamps(proxy);
    check(Stamper.read(proxy), "stamp2", "the private fields of a proxy");
    check(Stamper.has(proxy), true, "a proxy that has been stamped");
    check(thrownBy(stamps, proxy), "TypeError", "stamping a proxy twice");
}
check(trapped.length, 0, "traps called for private names");
for (let notObject of [1, "text", undefined, null, Symbol()])
    check(Stamper.has(stamps(notObject)), true, "stamping when the constructor returns a " + typeof notObject);

let dictionary = {};
for (let i = 0; i < 200; ++i)
    dictionary["p" + i] = i;
for (let i = 0; i < 100; ++i)
    delete dictionary["p" + i];
stamps(dictionary);
check(Stamper.read(dictionary), "stamp2", "the private fields of an object in dictionary mode");
check(thrownBy(stamps, dictionary), "TypeError", "stamping an object in dictionary mode twice");

class ManyFields {
    #a = 1; #b = 2; #c = 3; #d = 4; #e = 5; #f = 6; #g = 7; #h = 8; #i = 9; #j = 10; #k = 11; #l = 12; #m = 13; #n = 14; #o = 15; #p = 16; #q = 17; #r = 18; #s = 19; #t = 20;
    sum() { return this.#a + this.#b + this.#c + this.#d + this.#e + this.#f + this.#g + this.#h + this.#i + this.#j + this.#k + this.#l + this.#m + this.#n + this.#o + this.#p + this.#q + this.#r + this.#s + this.#t; }
}
function makesManyFields() { return new ManyFields(); }
noInline(makesManyFields);
for (let i = 0; i < rounds; ++i)
    check(makesManyFields().sum(), 210, "twenty private fields");

function makesClass(tag) {
    return class Made {
        #field = tag;
        #method() { return "method " + tag; }
        read() { return this.#field + "," + this.#method(); }
        static has(o) { return #field in o; }
        static hasMethod(o) { return #method in o; }
    };
}
noInline(makesClass);
let classes = [];
for (let i = 0; i < 40; ++i)
    classes.push(makesClass(i));
for (let round = 0; round < 20; ++round) {
    for (let i = 0; i < classes.length; ++i) {
        let made = new classes[i]();
        check(made.read(), i + ",method " + i, "an instance of one of many classes made by the same code");
        check(classes[i].has(made) && classes[i].hasMethod(made), true, "an instance has the private names of its class");
        let another = classes[(i + 1) % classes.length];
        check(another.has(made) || another.hasMethod(made), false, "an instance lacks the private names of another class");
        check(thrownBy(() => another.prototype.read.call(made)), "TypeError", "a method of another class");
    }
}
for (let round = 0; round < 4; ++round) {
    for (let i = 0; i < 20; ++i) {
        let Temporary = makesClass("temporary " + i);
        for (let j = 0; j < 20; ++j)
            check(new Temporary().read(), "temporary " + i + ",method temporary " + i, "an instance of a class that will die");
    }
    gc();
    check(new classes[round]().read(), round + ",method " + round, "an instance made after other classes have died");
}

class WithMethod {
    #method() { return "method"; }
    get #accessor() { return "accessor"; }
    static #staticMethod() { return "static"; }
    call() { return this.#method() + "," + this.#accessor; }
    static callStatic() { return WithMethod.#staticMethod(); }
    static has(o) { return #method in o; }
}
class WithMethodAndField extends WithMethod {
    #field = "field";
    #another() { return this.#field; }
    callAll() { return this.call() + "," + this.#another(); }
}
function makesWithMethod() { return new WithMethod(); }
function makesWithMethodAndField() { return new WithMethodAndField(); }
noInline(makesWithMethod);
noInline(makesWithMethodAndField);
for (let i = 0; i < rounds; ++i) {
    check(makesWithMethod().call(), "method,accessor", "a private method and a private accessor");
    check(makesWithMethodAndField().callAll(), "method,accessor,field", "private methods of a class and its subclass");
    check(WithMethod.callStatic(), "static", "a static private method");
    check(WithMethod.has(makesWithMethod()) && WithMethod.has(makesWithMethodAndField()) && !WithMethod.has({}), true, "which objects have a private method");
}

class Brander extends ReturnsArgument {
    #method() { return "branded"; }
    static call(o) { return o.#method(); }
    static has(o) { return #method in o; }
}
function brands(o) { return new Brander(o); }
noInline(brands);
for (let i = 0; i < rounds; ++i) {
    for (let target of [{}, { a: 1 }, [], Object.freeze({}), new Proxy({}, handler), new WithMethod(), stamps({})]) {
        check(Brander.has(target), false, "an object that has not been branded");
        check(thrownBy(Brander.call, target), "TypeError", "calling a private method that is not there");
        brands(target);
        check(Brander.call(target), "branded", "a private method of a branded object");
        check(thrownBy(brands, target), "TypeError", "branding twice");
        check(Brander.has(target), true, "an object that has been branded");
    }
}
check(trapped.length, 0, "traps called for private brands");

let kept = [];
for (let round = 0; round < 4; ++round) {
    let old = [];
    for (let i = 0; i < 50; ++i)
        old.push({ i });
    gc();
    for (let o of old) {
        stamps(o);
        brands(o);
        Stamper.write(o, { round });
    }
    edenGC();
    for (let o of old) {
        check(Stamper.has(o) && Brander.has(o), true, "an old object that was stamped and branded");
        check(Brander.call(o), "branded", "a private method of an old object after a collection");
    }
    kept.push(old);
}
gc();
check(kept.every(old => old.every(o => Stamper.has(o) && Brander.call(o) === "branded")), true, "old objects after more collections");
console.log("passed");
