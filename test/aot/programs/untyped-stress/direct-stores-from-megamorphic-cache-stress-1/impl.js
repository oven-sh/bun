function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function describe(object, name) {
    const d = Object.getOwnPropertyDescriptor(object, name);
    if (!d)
        return "absent";
    return ("value" in d ? "value " + String(d.value) : "accessor") + (d.writable ? " writable" : "") + (d.enumerable ? " enumerable" : "") + (d.configurable ? " configurable" : "");
}
const plain = value => "value " + value + " writable enumerable configurable";

function definesSix(e, v) { return { ...e, one: v, two: v + 1, three: v + 2, four: v + 3, five: v + 4, six: v + 5 }; }
function definesOne(e, v) { return { ...e, one: v }; }
function definesOverAccessor(e, v) { return { get one() { return "getter"; }, set one(x) { throw new Error("the setter of the literal was called"); }, ...e, one: v }; }
function definesWithPrototype(prototype, e, v) { return { __proto__: prototype, ...e, one: v }; }
function makesWithPrototype(prototype, e) { return { __proto__: prototype, ...e }; }
function definesProto(e, __proto__) { return { ...e, __proto__ }; }
function assigns(o, v) { o.one = v; return o; }
for (let f of [definesSix, definesOne, definesOverAccessor, definesWithPrototype, makesWithPrototype, definesProto, assigns])
    noInline(f);

const shapes = 40;
function shaped(k, more) {
    const o = {};
    o["s" + k] = k;
    return Object.assign(o, more);
}

{
    const absent = [], present = [];
    for (let k = 0; k < shapes; ++k) {
        absent.push(shaped(k));
        present.push(shaped(k, { one: "a", two: "b", three: "c", four: "d", five: "e", six: "f" }));
    }
    const round = r => {
        for (let k = 0; k < shapes; ++k) {
            const added = definesSix(absent[k], r), replaced = definesSix(present[k], r);
            check(Object.keys(added).join(), "s" + k + ",one,two,three,four,five,six", "the names after six definitions that add");
            check(Object.keys(replaced).join(), "s" + k + ",one,two,three,four,five,six", "the names after six definitions that replace");
            check(added.one + added.six + replaced.one + replaced.six, 4 * r + 10, "the values that were defined");
            check(present[k].one + absent[k]["s" + k], "a" + k, "the sources are as they were");
        }
    };
    for (let r = 0; r < 30; ++r)
        round(r);
    const rounds = 50;
    for (let r = 0; r < rounds; ++r)
        round(r);
}

function manyShapes(use) {
    for (let r = 0; r < 3; ++r) {
        for (let k = 0; k < shapes; ++k)
            use(k);
    }
}

manyShapes(k => check(describe(definesOne(shaped(k), k), "one"), plain(k), "a definition that adds"));
manyShapes(k => check(describe(definesOverAccessor(shaped(k), k), "one"), plain(k), "a definition over an accessor of the literal"));
manyShapes(k => check(describe(definesOverAccessor(shaped(k, { one: "spread" }), k), "one"), plain(k), "a definition over what a spread put over an accessor"));

{
    let called = 0;
    const withSetter = { set one(v) { ++called; }, get one() { return "inherited"; } };
    const readOnly = Object.defineProperty({}, "one", { value: "inherited", writable: false, enumerable: true, configurable: true });
    manyShapes(k => {
        for (let i = 0; i < 4; ++i)
            check(describe(assigns(makesWithPrototype(withSetter, shaped(k)), k), "one"), "absent", "an assignment calls the inherited setter");
        check(describe(definesWithPrototype(withSetter, shaped(k), k), "one"), plain(k), "a definition does not call an inherited setter");
        check(describe(definesWithPrototype(readOnly, shaped(k), k), "one"), plain(k), "a definition is not stopped by an inherited read-only property");
    });
    check(called, 4 * 3 * shapes, "calls of the inherited setter: by the assignments alone");
}

manyShapes(k => {
    const made = definesProto(shaped(k), k);
    check(describe(made, "__proto__"), plain(k), "a shorthand __proto__ defines a property");
    check(Object.getPrototypeOf(made), Object.prototype, "a shorthand __proto__ leaves the prototype");
});

class Base {
    constructor(k, prepare) {
        this["s" + k] = k;
        prepare(this);
    }
}
class WithField extends Base {
    one = "field";
}
noInline(WithField);
function fieldOver(k, prepare) {
    try {
        return describe(new WithField(k, prepare), "one");
    } catch (error) {
        return error.constructor.name;
    }
}
const define = descriptor => o => { Object.defineProperty(o, "one", descriptor); };
manyShapes(k => {
    check(fieldOver(k, o => { }), plain("field"), "a field that adds");
    check(fieldOver(k, o => { o.one = "assigned"; }), plain("field"), "a field over a plain property");
    const hidden = define({ value: "hidden", writable: true, enumerable: false, configurable: true });
    const kept = new Base(k, hidden);
    assigns(kept, "assigned");
    check(describe(kept, "one"), "value assigned writable configurable", "an assignment leaves a property that is not enumerable as it is");
    check(fieldOver(k, hidden), plain("field"), "a field over a property that is not enumerable makes it enumerable");
    check(fieldOver(k, define({ value: "fixed", writable: false, enumerable: true, configurable: true })), plain("field"), "a field over a read-only property makes it writable");
    check(fieldOver(k, define({ get() { return "getter"; }, set(v) { throw new Error("the setter was called"); }, enumerable: true, configurable: true })), plain("field"), "a field over an accessor");
    check(fieldOver(k, define({ value: "stuck", writable: true, enumerable: true, configurable: false })), "TypeError", "a field over a property that is not configurable");
    check(fieldOver(k, o => { Object.preventExtensions(o); }), "TypeError", "a field of an object that is not extensible");
    check(fieldOver(k, o => { o.one = "there"; Object.preventExtensions(o); }), plain("field"), "a field over a plain property of an object that is not extensible");
    check(fieldOver(k, o => { o.one = "there"; Object.seal(o); }), "TypeError", "a field over a property of a sealed object");
    check(fieldOver(k, o => { o.one = "there"; Object.freeze(o); }), "TypeError", "a field over a property of a frozen object");
    const sealed = Object.seal(new Base(k, o => { o.one = "there"; }));
    check(describe(assigns(sealed, "assigned"), "one"), "value assigned writable enumerable", "an assignment to a property of a sealed object");
});

{
    const big = [];
    for (let k = 0; k < shapes; ++k) {
        const o = shaped(k);
        for (let i = 0; i < 3 + (k % 9); ++i)
            o["p" + i] = i;
        big.push(o);
    }
    for (let r = 0; r < 20; ++r) {
        for (let k = 0; k < shapes; ++k) {
            const made = definesSix(big[k], r);
            check(Object.keys(made).length, 1 + 3 + (k % 9) + 6, "the number of names of an object whose storage grows");
            check(made.p2 + made.six + made["s" + k], 2 + r + 5 + k, "what was there before the storage grew, and what was added");
        }
    }
}
console.log("passed");
