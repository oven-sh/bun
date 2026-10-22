// A function made of run-time text adds a property to objects below a literal of the program, hundreds of times. The literal has lost a property before, so it takes a new one without changing what describes it. Then it gets the name as an accessor or read-only: the next store sees it.
const make = body => new Function("target", "value", body);
const show = made => Object.keys(made).join() + "/" + made.held;

const addUnderGetter = make("target.held = value; return target;");
const withGetter = {};
Object.defineProperty(withGetter, "held", { value: "loose", writable: true, configurable: true });
addUnderGetter(Object.create(withGetter), 1);
delete withGetter.held;
for (let turn = 0; turn < 300; turn++) addUnderGetter(Object.create(withGetter), turn);
console.log("before the getter:", show(addUnderGetter(Object.create(withGetter), 1)));
Object.defineProperty(withGetter, "held", { get() { return "got"; }, configurable: true });
console.log("a getter:", show(addUnderGetter(Object.create(withGetter), 1)));
delete withGetter.held;
console.log("the getter gone:", show(addUnderGetter(Object.create(withGetter), 1)));

const addUnderReadOnly = make("target.held = value; return target;");
const withReadOnly = {};
Object.defineProperty(withReadOnly, "held", { value: "loose", writable: true, configurable: true });
addUnderReadOnly(Object.create(withReadOnly), 1);
delete withReadOnly.held;
for (let turn = 0; turn < 300; turn++) addUnderReadOnly(Object.create(withReadOnly), turn);
Object.defineProperty(withReadOnly, "held", { value: "fixed", writable: false, configurable: true });
console.log("read-only:", show(addUnderReadOnly(Object.create(withReadOnly), 1)));

const addUnderSetter = make("'use strict'; target.held = value; return target;");
const withSetter = {};
let seen = "nothing";
Object.defineProperty(withSetter, "held", { value: "loose", writable: true, configurable: true });
addUnderSetter(Object.create(withSetter), 1);
delete withSetter.held;
for (let turn = 0; turn < 300; turn++) addUnderSetter(Object.create(withSetter), turn);
Object.defineProperty(withSetter, "held", { set(value) { seen = value; }, configurable: true });
console.log("a setter:", show(addUnderSetter(Object.create(withSetter), 7)), seen);
