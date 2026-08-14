// @bun
//@ requireOptions("--useControlFlowProfiler=true", "--useDollarVM=true")

// The function that runs a class's field initializers is synthesized from the source of the scope that
// defines the class and has no positions of its own, so the function range it would record is
// [0, length of that scope's source - 1] and the basic blocks at its start and end would span that whole
// scope. None of that may appear in the profiler's data for the source. The programs are assembled as
// strings so that the lengths involved are under control; loadString() evaluates each as its own program.

var hasBasicBlockExecuted = $vm.hasBasicBlockExecuted;
var basicBlockExecutionCount = $vm.basicBlockExecutionCount;

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

// Widens the "/**/" comment in source until source is exactly length characters long.
function padTo(source, length) {
    assert(source.length <= length, "cannot pad a source of " + source.length + " characters to " + length);
    var padding = "";
    while (source.length + padding.length < length)
        padding += "*";
    return source.replace("/**/", "/*" + padding + "*/");
}

// 1. A class with an instance field that is never instantiated. The initializer's range would be the first
//    makeClass.length characters of the program, i.e. the start of ran, and being shorter than the block
//    that ran's body forms it would be the range consulted for ran's code.
var ran = padTo("function ran() { var x = 1; /**/ return x; }", 400);
var makeClass = padTo("function makeClass() { return class { field = 1; }; /**/ }", 200);
loadString(ran + "\n" + makeClass + "\nran();\nmakeClass();\n");
assert(hasBasicBlockExecuted(globalThis.ran, "var x"), "ran() ran; a class that was never instantiated must not hide that");
assert(hasBasicBlockExecuted(globalThis.makeClass, "return class"), "makeClass() ran");

// 2. The same with a static field, whose initializer runs as soon as the class is defined: the range would
//    now claim that a function that has never been called has executed.
var neverRan = padTo("function neverRan() { var y = 1; /**/ return y; }", 400);
var makeStatic = padTo("function makeStatic() { return class { static field = 1; }; /**/ }", 200);
loadString(neverRan + "\n" + makeStatic + "\nmakeStatic();\n");
assert(!hasBasicBlockExecuted(globalThis.neverRan, "var y"), "neverRan() never ran; a static field initializer must not claim it did");
assert(hasBasicBlockExecuted(globalThis.makeStatic, "return class"), "makeStatic() ran");

// 3. A function that is never called, declared at offset 0, and a function of exactly the same length that
//    instantiates a class with an instance field. Running the initializer would mark [0, length - 1], which
//    is the never-called function's range, as executed.
var makeInstance = "function makeInstance() { return new (class { field = 1; })(); /**/ }";
var neverCalled = padTo("function neverCalled() { return 'never called'; /**/ }", makeInstance.length);
loadString(neverCalled + "\n" + makeInstance + "\nmakeInstance();\n");
assert(!hasBasicBlockExecuted(globalThis.neverCalled, "return 'never called'"), "neverCalled() was never called; instantiating a class must not claim it was");
assert(hasBasicBlockExecuted(globalThis.makeInstance, "return new"), "makeInstance() ran");

// 4. The initializer's own basic block would span the defining scope. When that scope is itself a single
//    basic block (no return statement, no control flow), it would be that very block, and every run of the
//    initializer would count as a run of the scope.
loadString("function definesAndInstantiates() { class C { field = 1; } new C(); new C(); new C(); }\ndefinesAndInstantiates();\n");
assert(basicBlockExecutionCount(globalThis.definesAndInstantiates, "new C()") === 1, "definesAndInstantiates() ran once, however many instances it created");

loadString("function definesWithStaticField() { class C { static field = 1; } var defined = C; }\ndefinesWithStaticField();\n");
assert(basicBlockExecutionCount(globalThis.definesWithStaticField, "var defined") === 1, "definesWithStaticField() ran once; the static initializer running is not a second time");

// 5. Control flow inside an initializer expression delimits blocks that do have positions of their own, and
//    those are still recorded. The blocks before the first and after the last of them would run to the
//    start and to the end of the defining scope, and being narrower than the scope's own block they would
//    be the ranges consulted for the code around the class.
loadString("function definesConditionalField(flag) { var before = 1; class C { field = flag ? 'taken' : 'not taken'; } new C(); new C(); }\ndefinesConditionalField(true);\n");
assert(hasBasicBlockExecuted(globalThis.definesConditionalField, "'taken'"), "the branch the field initializer took is recorded");
assert(basicBlockExecutionCount(globalThis.definesConditionalField, "'taken'") === 2, "the field was initialized once per instance");
assert(!hasBasicBlockExecuted(globalThis.definesConditionalField, "'not taken'"), "the branch the field initializer did not take is recorded");
assert(basicBlockExecutionCount(globalThis.definesConditionalField, "var before") === 1, "the code before the class ran once, not once per instance");
assert(basicBlockExecutionCount(globalThis.definesConditionalField, "new C()") === 1, "the code after the class ran once, not once per instance");
