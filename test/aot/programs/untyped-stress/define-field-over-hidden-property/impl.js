function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function describe(object, name) {
    const descriptor = Object.getOwnPropertyDescriptor(object, name);
    if (!descriptor)
        return "absent";
    return String(descriptor.value) + (descriptor.writable ? "W" : "-") + (descriptor.enumerable ? "E" : "-") + (descriptor.configurable ? "C" : "-");
}
function assign(o, v) { o.x = v; }
noInline(assign);

{
    class Base {
        constructor(hide) {
            if (hide)
                Object.defineProperty(this, "x", { value: 0, writable: true, enumerable: false, configurable: true });
        }
    }
    class Derived extends Base {
        x = 1;
        constructor(hide) { super(hide); }
    }
    assign(Reflect.construct(Base, [true], Derived), 5);
    const first = new Derived(true);
    check(describe(first, "x"), "1WEC", "a field defined over a property that is not enumerable, the first time");
    check(Object.keys(first).join(), "x", "the keys of that object");
    for (let i = 0; i < 2000; i++) {
        assign(Reflect.construct(Base, [true], Derived), i);
        check(describe(new Derived(true), "x"), "1WEC", "a field defined over a property that is not enumerable");
        check(describe(new Derived(false), "x"), "1WEC", "a field defined on an object without the property");
    }
}

{
    class Base {
        constructor(hide) {
            if (hide)
                Object.defineProperty(this, "x", { value: 0, writable: true, enumerable: false, configurable: true });
        }
    }
    class Derived extends Base {
        x = 1;
        constructor(hide) { super(hide); }
    }
    for (let i = 0; i < 2000; i++)
        check(describe(new Derived(false), "x"), "1WEC", "a field defined on an object without the property, many times");
    assign(Reflect.construct(Base, [true], Derived), 5);
    check(describe(new Derived(true), "x"), "1WEC", "a field defined over a hidden property once the site knows another structure");
}

{
    function hidden() {
        const result = { a: 1 };
        Object.defineProperty(result, "x", { value: 0, writable: true, enumerable: false, configurable: true });
        return result;
    }
    class ReturnsArgument { constructor(o) { return o; } }
    class Stamps extends ReturnsArgument {
        x = "stamped";
        constructor(o) { super(o); }
    }
    assign(hidden(), 5);
    const stamped = new Stamps(hidden());
    check(describe(stamped, "x"), "stampedWEC", "a field defined on an object that the base constructor returned");
    check(Object.keys(stamped).join(), "a,x", "the keys of that object");
}

{
    function plain() { return { a: 1, x: 0 }; }
    class ReturnsArgument { constructor(o) { return o; } }
    class Stamps extends ReturnsArgument {
        x = "stamped";
        constructor(o) { super(o); }
    }
    for (let i = 0; i < 2000; i++) {
        assign(plain(), i);
        const stamped = new Stamps(plain());
        check(describe(stamped, "x"), "stampedWEC", "a field defined over a plain property");
        check(Object.keys(stamped).join(), "a,x", "the keys of an object with a field defined over a plain property");
    }
}

{
    let calls = 0;
    class Base { set x(v) { calls++; } }
    class Derived extends Base {
        x = 1;
        constructor() { super(); }
    }
    for (let i = 0; i < 2000; i++) {
        assign(new Base(), i);
        check(describe(new Derived(), "x"), "1WEC", "a field defined on an object that inherits a setter");
    }
    check(calls, 2000, "calls of the setter");
}
console.log("passed");
