function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function repeat(f) {
    for (let i = 0; i < 200; i++)
        f(i);
}
function throwsTypeError(f, what) {
    try {
        f();
    } catch (error) {
        check(error instanceof TypeError, true, what);
        return;
    }
    throw new Error(what + ": did not throw");
}
const ordinary = Function.prototype[Symbol.hasInstance];
const always = () => true;
const never = () => false;

class WritableBase { }
Object.defineProperty(WritableBase, Symbol.hasInstance, { value: ordinary, writable: true, configurable: true });
class InheritsWritable extends WritableBase { }
function inheritsWritable(v) { return v instanceof InheritsWritable; }
noInline(inheritsWritable);
{
    const instance = new InheritsWritable, other = { };
    repeat(() => check(inheritsWritable(instance), true, "an instance, with the ordinary function in a writable property"));
    repeat(() => check(inheritsWritable(other), false, "another object, with the ordinary function in a writable property"));
    WritableBase[Symbol.hasInstance] = always;
    repeat(() => check(inheritsWritable(other), true, "another object, after an assignment"));
    repeat(() => check(inheritsWritable(5), true, "a number, after an assignment"));
    WritableBase[Symbol.hasInstance] = never;
    repeat(() => check(inheritsWritable(instance), false, "an instance, after a second assignment"));
    WritableBase[Symbol.hasInstance] = ordinary;
    repeat(() => check(inheritsWritable(instance), true, "an instance, with the ordinary function again"));
    repeat(() => check(inheritsWritable(other), false, "another object, with the ordinary function again"));
    repeat(() => check(inheritsWritable(5), false, "a number, with the ordinary function again"));
    WritableBase[Symbol.hasInstance] = undefined;
    repeat(() => check(inheritsWritable(instance), true, "an instance, with undefined"));
    repeat(() => check(inheritsWritable(other), false, "another object, with undefined"));
    WritableBase[Symbol.hasInstance] = 5;
    repeat(() => throwsTypeError(() => inheritsWritable(instance), "with a number"));
    WritableBase[Symbol.hasInstance] = ordinary;
    repeat(() => check(inheritsWritable(instance), true, "an instance, with the ordinary function once more"));
    WritableBase[Symbol.hasInstance] = never;
    check(inheritsWritable(instance), false, "an instance, right after the last assignment");
}

function FunctionBase() { }
function InheritsFromFunction() { }
Object.defineProperty(FunctionBase, Symbol.hasInstance, { value: ordinary, writable: true, configurable: true });
Object.setPrototypeOf(InheritsFromFunction, FunctionBase);
function inheritsFromFunction(v) { return v instanceof InheritsFromFunction; }
noInline(inheritsFromFunction);
{
    const other = { };
    repeat(() => check(inheritsFromFunction(other), false, "a function that inherits from a function"));
    FunctionBase[Symbol.hasInstance] = always;
    check(inheritsFromFunction(other), true, "a function that inherits from a function, after an assignment");
}

class ConfigurableBase { }
Object.defineProperty(ConfigurableBase, Symbol.hasInstance, { value: ordinary, writable: false, configurable: true });
class InheritsConfigurable extends ConfigurableBase { }
function inheritsConfigurable(v) { return v instanceof InheritsConfigurable; }
noInline(inheritsConfigurable);
{
    const other = { };
    repeat(() => check(inheritsConfigurable(other), false, "the ordinary function in a read-only, configurable property"));
    Object.defineProperty(ConfigurableBase, Symbol.hasInstance, { value: always });
    check(Object.getOwnPropertyDescriptor(ConfigurableBase, Symbol.hasInstance).writable, false, "the property is still read-only");
    check(inheritsConfigurable(other), true, "after the read-only, configurable property is redefined");
    Object.defineProperty(ConfigurableBase, Symbol.hasInstance, { value: ordinary });
    repeat(() => check(inheritsConfigurable(other), false, "after the read-only, configurable property is redefined again"));
    Object.defineProperty(ConfigurableBase, Symbol.hasInstance, { value: always });
    check(inheritsConfigurable(other), true, "after the read-only, configurable property is redefined a third time");
}

class PermanentlyWritableBase { }
Object.defineProperty(PermanentlyWritableBase, Symbol.hasInstance, { value: ordinary, writable: true, configurable: false });
class InheritsPermanentlyWritable extends PermanentlyWritableBase { }
function inheritsPermanentlyWritable(v) { return v instanceof InheritsPermanentlyWritable; }
noInline(inheritsPermanentlyWritable);
{
    const other = { };
    repeat(() => check(inheritsPermanentlyWritable(other), false, "the ordinary function in a writable property that is not configurable"));
    PermanentlyWritableBase[Symbol.hasInstance] = always;
    check(inheritsPermanentlyWritable(other), true, "after an assignment to the writable property that is not configurable");
}

class Grandparent { }
Object.defineProperty(Grandparent, Symbol.hasInstance, { value: ordinary, writable: true, configurable: true });
class Parent extends Grandparent { }
class Grandchild extends Parent { }
function inheritsFromGrandparent(v) { return v instanceof Grandchild; }
noInline(inheritsFromGrandparent);
{
    const other = { };
    repeat(() => check(inheritsFromGrandparent(other), false, "the ordinary function two classes up"));
    Grandparent[Symbol.hasInstance] = always;
    check(inheritsFromGrandparent(other), true, "after an assignment two classes up");
    Object.defineProperty(Parent, Symbol.hasInstance, { value: ordinary, writable: true, configurable: true });
    repeat(() => check(inheritsFromGrandparent(other), false, "after the class in between gets the ordinary function"));
    Parent[Symbol.hasInstance] = always;
    check(inheritsFromGrandparent(other), true, "after an assignment to the class in between");
    delete Parent[Symbol.hasInstance];
    Grandparent[Symbol.hasInstance] = ordinary;
    repeat(() => check(inheritsFromGrandparent(other), false, "after the class in between loses it"));
    Grandparent[Symbol.hasInstance] = always;
    check(inheritsFromGrandparent(other), true, "after another assignment two classes up");
}

const holder = { __proto__: Function.prototype, [Symbol.hasInstance]: ordinary };
function InheritsFromObject() { }
Object.setPrototypeOf(InheritsFromObject, holder);
function inheritsFromObject(v) { return v instanceof InheritsFromObject; }
noInline(inheritsFromObject);
{
    const other = { };
    repeat(() => check(inheritsFromObject(other), false, "the ordinary function in an object"));
    holder[Symbol.hasInstance] = always;
    check(inheritsFromObject(other), true, "after an assignment to the object");
}

class FrozenBase { }
Object.defineProperty(FrozenBase, Symbol.hasInstance, { value: ordinary, writable: true, configurable: true });
Object.freeze(FrozenBase);
class InBetween extends FrozenBase { }
class InheritsFrozen extends InBetween { }
function inheritsFrozen(v) { return v instanceof InheritsFrozen; }
noInline(inheritsFrozen);
{
    const instance = new InheritsFrozen, other = { };
    repeat(() => check(inheritsFrozen(instance), true, "an instance, with the ordinary function in a frozen class"));
    repeat(() => check(inheritsFrozen(other), false, "another object, with the ordinary function in a frozen class"));
    throwsTypeError(() => Object.defineProperty(FrozenBase, Symbol.hasInstance, { value: always }), "redefining a property of a frozen class");
    repeat(() => check(inheritsFrozen(other), false, "another object, after the frozen class refused"));
    Object.defineProperty(InBetween, Symbol.hasInstance, { value: always, configurable: true });
    repeat(() => check(inheritsFrozen(other), true, "after the class in between defines its own"));
    delete InBetween[Symbol.hasInstance];
    repeat(() => check(inheritsFrozen(other), false, "after the class in between deletes its own"));
    Object.setPrototypeOf(InBetween, { __proto__: Function.prototype, [Symbol.hasInstance]: always });
    repeat(() => check(inheritsFrozen(other), true, "after the class in between inherits from something else"));
    Object.setPrototypeOf(InBetween, FrozenBase);
    repeat(() => check(inheritsFrozen(other), false, "after the class in between inherits from the frozen class again"));
    repeat(() => check(inheritsFrozen(instance), true, "an instance, at the end"));
}

class Usual { }
class InheritsUsual extends Usual { }
function usual(v) { return v instanceof InheritsUsual; }
noInline(usual);
{
    const instance = new InheritsUsual, other = new Usual;
    repeat(() => check(usual(instance), true, "an instance of a usual class"));
    repeat(() => check(usual(other), false, "an instance of its parent"));
    Object.defineProperty(Usual, Symbol.hasInstance, { value: ordinary, writable: true, configurable: true });
    repeat(() => check(usual(other), false, "after the parent gets the ordinary function"));
    Usual[Symbol.hasInstance] = always;
    check(usual(other), true, "after an assignment to the parent");
}

function anyConstructor(v, C) { return v instanceof C; }
noInline(anyConstructor);
{
    class First { }
    class Second { }
    for (const C of [First, Second])
        Object.defineProperty(C, Symbol.hasInstance, { value: ordinary, writable: true, configurable: true });
    class InheritsFirst extends First { }
    class InheritsSecond extends Second { }
    const other = { };
    repeat(i => check(anyConstructor(other, i & 1 ? InheritsFirst : InheritsSecond), false, "two classes at one site"));
    First[Symbol.hasInstance] = always;
    repeat(i => check(anyConstructor(other, i & 1 ? InheritsFirst : InheritsSecond), !!(i & 1), "two classes at one site, after an assignment to the parent of one"));
    Second[Symbol.hasInstance] = always;
    repeat(i => check(anyConstructor(other, i & 1 ? InheritsFirst : InheritsSecond), true, "two classes at one site, after an assignment to both parents"));
}

console.log("passed");
