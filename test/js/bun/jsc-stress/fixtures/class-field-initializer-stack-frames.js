// @bun
// The fields of a class are evaluated by a function that the bytecode generator synthesizes
// (BytecodeGenerator::emitNewClassFieldInitializerFunction), one for the instance fields and one for
// the static fields and static blocks. Errors created while a field is initialized report that function's
// frame as their position, so:
//
//  1. it has to be visible in stack traces. It used to be ImplementationVisibility::Private, which made an
//     Error created in a field initializer report the position of the constructor that ran the initializer
//     instead (for a default constructor: line 1 of the synthetic "(function () { })" source, with no URL),
//     and made a static field's Error report the position of the class definition. It is named the way V8
//     names these frames: <instance_members_initializer> and <static_initializer>.
//
//  2. its metadata has to describe the source it is compiled from, which is the enclosing scope's whole
//     source. It used to be created with zeroed positions, which linked it to a SourceCode starting at line 1,
//     column 1 even when the enclosing scope is a function that starts somewhere else. Columns of positions
//     on the enclosing function's first line, in the initializer itself and in every function a field
//     creates, were then measured from the start of the function instead of from the start of the line.

let failures = [];

function describeValue(value)
{
    if (typeof value === "function")
        return `function ${value.name}`;
    return String(value);
}

function check(description, actual, expected)
{
    if (actual !== expected)
        failures.push(`${description}: expected ${describeValue(expected)}, got ${describeValue(actual)}`);
}

// The frames of an Error's stack, in both the jsc shell's format (name@url:line:column) and the format used
// by embedders that print a header line followed by "    at name (url:line:column)" lines.
function frames(error)
{
    return error.stack.split("\n").filter(line => line.includes("@") || /^\s+at /.test(line));
}

function checkFrame(description, frame, expectedSubstring)
{
    if (frame === undefined || !frame.includes(expectedSubstring))
        failures.push(`${description}: expected a frame containing ${JSON.stringify(expectedSubstring)}, got ${JSON.stringify(frame)}`);
}

// --- Which frames appear, and in which order. ---

class WithInstanceField {
    field = new Error("instance field");
}

{
    const stack = frames(new WithInstanceField().field);
    checkFrame("instance field, frame 0", stack[0], "<instance_members_initializer>");
    checkFrame("instance field, frame 1", stack[1], "WithInstanceField");
}

class WithExplicitConstructor {
    field = new Error("instance field, explicit constructor");
    constructor() { this.constructed = true; }
}

{
    const stack = frames(new WithExplicitConstructor().field);
    checkFrame("explicit constructor, frame 0", stack[0], "<instance_members_initializer>");
    checkFrame("explicit constructor, frame 1", stack[1], "WithExplicitConstructor");
}

class SuperclassOfDerived { }
class DerivedWithInstanceField extends SuperclassOfDerived {
    field = new Error("derived instance field");
}

{
    const stack = frames(new DerivedWithInstanceField().field);
    checkFrame("derived class, frame 0", stack[0], "<instance_members_initializer>");
    checkFrame("derived class, frame 1", stack[1], "DerivedWithInstanceField");
}

function createErrorForField()
{
    let error = new Error("created by a function the field calls");
    return error;
}

class WithFieldCallingFunction {
    field = createErrorForField();
}

{
    const stack = frames(new WithFieldCallingFunction().field);
    checkFrame("function called by a field, frame 0", stack[0], "createErrorForField");
    checkFrame("function called by a field, frame 1", stack[1], "<instance_members_initializer>");
    checkFrame("function called by a field, frame 2", stack[2], "WithFieldCallingFunction");
}

class WithStaticField {
    static field = new Error("static field");
}

checkFrame("static field, frame 0", frames(WithStaticField.field)[0], "<static_initializer>");

class WithStaticBlock {
    static {
        WithStaticBlock.error = new Error("static block");
    }
}

checkFrame("static block, frame 1", frames(WithStaticBlock.error)[1], "<static_initializer>");

class WithArrowFunctionField {
    createError = () => new Error("arrow function created by a field");
}

{
    // The initializer only created the arrow function; it is not running when the arrow function is called.
    const stack = frames(new WithArrowFunctionField().createError());
    check("arrow function created by a field, frame 0", stack[0].includes("createError"), true);
    check("arrow function created by a field, no initializer frame", stack.some(frame => frame.includes("<instance_members_initializer>") || frame.includes("<static_initializer>")), false);
}

// The initializer function itself is not reachable through Function.prototype.caller: it is class code, so it is
// strict, and a sloppy function it calls sees no caller. (While the initializer was skipped by that walk, the walk
// went on to the constructor that ran it, and a default constructor, whose synthesized source is not marked
// strict, was returned.) The Function constructor makes the sloppy function even if this file is run as strict code.
const reportCaller = Function("return arguments.callee.caller;");

class WithFieldReportingCaller {
    callerOfField = reportCaller();
    static callerOfStaticField = reportCaller();
}

{
    const instance = new WithFieldReportingCaller();
    check("Function.prototype.caller of a function called by an instance field", instance.callerOfField, null);
    check("Function.prototype.caller of a function called by a static field", WithFieldReportingCaller.callerOfStaticField, null);
}

// Once the constructor is hot the initializer is inlined into it (InlineAttribute::Always); its frame is then
// reconstructed from the inlined call frame and has to stay visible.
class ConstructedInALoop {
    field = new Error("constructed in a loop");
}

{
    const iterations = typeof testLoopCount === "number" ? testLoopCount : 10000;
    let last;
    for (let i = 0; i < iterations; ++i)
        last = new ConstructedInALoop();
    const stack = frames(last.field);
    checkFrame("constructed in a loop, frame 0", stack[0], "<instance_members_initializer>");
    checkFrame("constructed in a loop, frame 1", stack[1], "ConstructedInALoop");
}

// An error thrown by the engine while a field is defined originates in the initializer's frame itself.
class ReturningSealedObject {
    constructor() { return Object.preventExtensions({}); }
}

class WithFieldThatCannotBeDefined extends ReturningSealedObject {
    field = 1;
}

{
    let thrown;
    try {
        new WithFieldThatCannotBeDefined();
    } catch (error) {
        thrown = error;
    }
    check("field that cannot be defined throws a TypeError", thrown instanceof TypeError, true);
    const stack = frames(thrown);
    checkFrame("field that cannot be defined, frame 0", stack[0], "<instance_members_initializer>");
    checkFrame("field that cannot be defined, frame 1", stack[1], "WithFieldThatCannotBeDefined");
}

// --- Where the frames are. ---
//
// Every body below stores an Error in `result`: most create it with the `new Error()` they contain, the last ones
// catch the TypeError thrown while a field is defined. Each body runs in several contexts; the Error has to be
// reported at the line and column its `marker` actually has in the source that is evaluated. The column reported
// for a `new Error()` is at a fixed distance from the column the expression starts at; that distance is measured
// once, on an expression outside of any class. A failed definition is reported at the field's name itself.

let result;
const referenceSource = "result = new Error();";
eval(referenceSource);
check("reference line", result.line, 1);
const columnDistance = result.column - referenceSource.indexOf("new Error()");
check("reference column is past the start of the expression", columnDistance > 0, true);

// Base classes whose constructor returns the object the derived class's fields are then defined on.
const sealedBase = "class B { constructor() { return Object.preventExtensions({}); } } ";
const baseWithFixedProperty = "class B { constructor() { return Object.defineProperty({}, \"fixed\", { value: 0 }); } } ";

const bodies = [
    // Positions inside the initializers themselves (visibility).
    { name: "instance field", body: "class C { field = new Error(); } result = new C().field;" },
    { name: "instance field on its own line", body: "class C {\n    field = new Error();\n}\nresult = new C().field;" },
    { name: "instance field with an explicit constructor", body: "class C { field = new Error(); constructor() { this.constructed = true; } } result = new C().field;" },
    { name: "instance field of a derived class", body: "class B { } class C extends B { field = new Error(); } result = new C().field;" },
    { name: "second instance field", body: "class C { first = 1; second = new Error(); } result = new C().second;" },
    { name: "static field", body: "class C { static field = new Error(); } result = C.field;" },
    { name: "static field of a derived class", body: "class B { } class C extends B { static field = new Error(); } result = C.field;" },
    { name: "private instance field", body: "class C { #field = new Error(); get field() { return this.#field; } } result = new C().field;" },
    { name: "computed instance field", body: "class C { [\"field\"] = new Error(); } result = new C().field;" },

    // Positions inside functions created while the initializers run (metadata of the initializer, which those
    // functions are linked against).
    { name: "arrow function created by an instance field", body: "class C { run = () => { result = new Error(); }; } new C().run();" },
    { name: "arrow function created by a static field", body: "class C { static run = () => { result = new Error(); }; } C.run();" },
    { name: "static block", body: "class C { static { result = new Error(); } }" },
    { name: "function expression created by an instance field", body: "class C { run = function () { result = new Error(); }; } new C().run();" },
    { name: "arrow function created by an instance field, on its own line", body: "class C {\n    run = () => { result = new Error(); };\n}\nnew C().run();" },

    // The define step of a public field throwing: the initializer's own frame is where the error originates. With a
    // constant initializer nothing before the definition has a position; the field after a call must not be
    // reported at that call; a numeric name takes the other code path.
    { name: "public field defined on a non-extensible object", marker: "defined = 1", columnOffset: 1,
      body: sealedBase + "class C extends B { defined = 1; } try { new C(); } catch (e) { result = e; }" },
    { name: "public field defined over a non-configurable property, after a field with a call", marker: "fixed = 1", columnOffset: 1,
      body: baseWithFixedProperty + "class C extends B { first = String(1); fixed = 1; } try { new C(); } catch (e) { result = e; }" },
    { name: "public field defined over a non-configurable property, on its own line after a field without an initializer", marker: "fixed = 1", columnOffset: 1,
      body: baseWithFixedProperty + "class C extends B {\n    first;\n    fixed = 1;\n}\ntry { new C(); } catch (e) { result = e; }" },
    { name: "public field with a numeric name defined on a non-extensible object", marker: "0 = 1", columnOffset: 1,
      body: sealedBase + "class C extends B { 0 = 1; } try { new C(); } catch (e) { result = e; }" },
];

const contexts = [
    // The enclosing source starts at line 1, column 1: the initializers were already placed right here.
    { name: "eval code", prefix: "", suffix: "", run: source => eval(source) },

    // The function's source starts in the middle of line 1 and the class is on that line.
    { name: "a function whose body starts on its first line", prefix: "(function () { ", suffix: "\n})", run: source => eval(source)() },

    // The function starts on line 3 and the class is on that line.
    { name: "a function that starts on line 3, whose body starts on its first line", prefix: "\n\n(function () { ", suffix: "\n})", run: source => eval(source)() },

    // The class is on a later line than the function's start: measured from the start of its own line anyway.
    { name: "a function whose body starts on the line after its first line", prefix: "(function () {\n", suffix: "\n})", run: source => eval(source)() },

    // A function nested in another function, both starting on the same line as the class.
    { name: "a function nested in a function, all on one line", prefix: "(function () { return (function () { ", suffix: "\n}); })()", run: source => eval(source)() },
];

for (const { name: contextName, prefix, suffix, run } of contexts) {
    for (const { name: bodyName, body, marker = "new Error()", columnOffset = columnDistance } of bodies) {
        const source = prefix + body + suffix;
        const offset = source.indexOf(marker);
        const linesBefore = source.slice(0, offset).split("\n");
        const expectedLine = linesBefore.length;
        const expectedColumn = linesBefore[linesBefore.length - 1].length + columnOffset;

        result = undefined;
        run(source);
        const description = `${bodyName}, in ${contextName}`;
        if (!(result instanceof Error)) {
            failures.push(`${description}: did not produce an Error`);
            continue;
        }
        check(`${description}: line`, result.line, expectedLine);
        check(`${description}: column`, result.column, expectedColumn);
    }
}

if (failures.length)
    throw new Error(`FAIL:\n${failures.join("\n")}`);
