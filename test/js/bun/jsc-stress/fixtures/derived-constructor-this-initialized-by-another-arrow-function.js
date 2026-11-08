// @bun
//@ defaultRun; run("bytecode-optimizer", "--useBytecodeOptimizer=1")

// |this| of a derived constructor is one binding. An arrow function or eval code of the constructor reads the binding
// where it evaluates |this| or a super property. So it has the value once super() has returned, whichever code of the
// constructor called super(), also if that call came after the arrow function or the eval code started.

const uninitialized = "'super()' must be called in derived constructor before accessing |this| or returning non-object.";
const calledTwice = "'super()' can't be called more than once in a constructor.";

function shouldBe(actual, expected, name)
{
    if (actual !== expected)
        throw new Error(`${name}: expected ${String(expected)} but got ${String(actual)}`);
}

function shouldThrow(run, message, name)
{
    let error = null;
    try {
        run();
    } catch (e) {
        error = e;
    }
    if (!(error instanceof ReferenceError) || error.message !== message)
        throw new Error(`${name}: expected ReferenceError "${message}" but got ${String(error)}`);
}

let baseCalls = 0;

class Base {
    constructor()
    {
        baseCalls++;
        this.own = 1;
    }
    method() { return this; }
    get getter() { return this; }
    set setter(value) { this.stored = value; }
    get tag() { return () => "tagged"; }
}
Base.prototype.count = 1;

// Eval code that reads |this| before and after initialize().
const readBeforeAndAfter = `
    const seen = [];
    for (let i = 0; i < 3; ++i) {
        if (i === 1)
            initialize();
        try {
            seen.push(typeof this);
        } catch (error) {
            seen.push(error.message === uninitialized ? "uninitialized" : String(error));
        }
    }
    seen.join();
`;

// The constructor calls test(readers) before any super(). If test is a string, the constructor evaluates it as eval code.
// initialize() is an arrow function that calls super(). A reader calls it, and then reads.
let evalResult;

class Derived extends Base {
    #field = 7;
    constructor(test)
    {
        const initialize = () => { super(); };
        const initializeInEval = () => eval("super()");
        if (typeof test === "string") {
            evalResult = eval(test);
            return;
        }
        return test({
            initialize,
            read: () => this,

            // Each kind of code that has the |this| of the constructor.
            body: () => { initialize(); return this; },
            nested: () => (() => { initialize(); return this; })(),
            withInnerArrow: () => { const inner = () => 1; initialize(); return inner() && this; },
            initializedInNestedArrow: () => { const inner = () => { super(); }; return (() => { inner(); return this; })(); },
            initializedInEval: () => { initializeInEval(); return this; },
            initializedInGetter: () => { ({ get x() { return initialize(); } }).x; return this; },
            recursive: depth => {
                if (!depth) {
                    initialize();
                    return this;
                }
                readers.recursive(depth - 1);
                return this;
            },
            parameter: (value = (initialize(), this)) => value,
            evalCode: () => eval("initialize(); this"),
            evalCodeBeforeAndAfter: () => eval(readBeforeAndAfter),
            asyncBody: async () => { initialize(); return this; },
            asyncParameter: async (value = (initialize(), this)) => value,
            asyncBodyAfterAwait: async () => { initialize(); await 0; return this; },
            arrowInAsyncBody: async () => { await 0; return (() => { initialize(); return this; })(); },

            // Each kind of read.
            thisProperty: () => { initialize(); return this.own; },
            thisCall: () => { initialize(); return this.method(); },
            thisStore: () => { initialize(); this.value = 2; return this.value; },
            thisPrivateField: () => { initialize(); return this.#field; },
            typeofThis: () => { initialize(); return typeof this; },
            superGet: () => { initialize(); return super.getter; },
            superGetByVal: key => { initialize(); return super[key]; },
            superCall: () => { initialize(); return super.method(); },
            superCallByVal: key => { initialize(); return super[key](); },
            superCallCall: () => { initialize(); return super.method.call(this); },
            superCallApply: () => { initialize(); return super.method.apply(this, []); },
            superTag: () => { initialize(); return super.tag`x`; },
            superPut: value => { initialize(); const result = (super.setter = value); return result + this.stored; },
            superPutByVal: (key, value) => { initialize(); const result = (super[key] = value); return result + this.stored; },
            superPutByValConstant: key => { initialize(); return super[key] = 21; },
            superAdd: () => { initialize(); return super.count += 1; },
            superAddByVal: key => { initialize(); return super[key] += 1; },
            superOr: key => { initialize(); return super[key] ||= 5; },
            superIncrement: key => { initialize(); super[key]++; return this.count; },
            superDecrement: () => { initialize(); return --super.count; },
            superDestructure: () => { initialize(); [super.a, { b: super["b"] }] = [3, { b: 4 }]; return this.a + this.b; },
            superForOf: key => { initialize(); for (super[key] of [5, 6]); return this.last; },
            superForIn: () => { initialize(); for (super.key in { k: 0 }); return this.key; },

            // A read that comes before super() in the order of evaluation.
            readThenInitialize: (first = this, second = initialize()) => first,
            storeThenInitialize: () => { this.early = initialize(); },
            argumentThenInitialize: () => [this, initialize()],
            superCallThenInitialize: () => super.method(initialize()),
            superGetByValThenInitialize: () => super[(initialize(), "count")],
            superPutThenInitialize: () => { super.setter = (initialize(), 1); },
            superPutByValThenInitialize: () => { super[(initialize(), "setter")] = 1; },
            superPutByValValueThenInitialize: key => { super[key] = (initialize(), 1); },
            superAddByValThenInitialize: () => { super[(initialize(), "count")] += 1; },
            superIncrementThenInitialize: () => { super[(initialize(), "count")]++; },
            superDeleteThenInitialize: () => delete super[(initialize(), "count")],
            superTagThenInitialize: () => super[(initialize(), "tag")]`x`,
            superDestructureThenInitialize: () => { [super[(initialize(), "a")]] = [1]; },
            superForOfThenInitialize: () => { for (super[(initialize(), "last")] of [1]); },
            superForInThenInitialize: () => { for (super[(initialize(), "key")] in { k: 0 }); },
            asyncSuperPutByValThenInitialize: async () => { super[(initialize(), "setter")] = 1; },
            asyncSuperPutByValAfterAwaitThenInitialize: async () => { await 0; super[(initialize(), "setter")] = 1; },

            readBeforeAndAfter: () => {
                const seen = [];
                for (let i = 0; i < 3; ++i) {
                    if (i === 1)
                        initialize();
                    try {
                        seen.push(typeof this);
                    } catch (error) {
                        seen.push(error.message === uninitialized ? "uninitialized" : String(error));
                    }
                }
                return seen.join();
            },
            initializeTwice: () => { initialize(); super(); },
        });
    }
}

let readers;

// Calls the reader in a new construction, and checks what it gives against the new object.
function test(name, read, check = (result, instance) => result === instance)
{
    let result;
    const instance = new Derived(typeof read === "string" ? read : scope => {
        readers = scope;
        result = read(scope);
    });
    shouldBe(check(typeof read === "string" ? evalResult : result, instance), true, name);
    shouldBe(instance instanceof Derived && instance.own === 1, true, `${name}: the new object`);
}

function testOnce()
{
    for (const name of ["body", "nested", "withInnerArrow", "initializedInNestedArrow", "initializedInEval", "initializedInGetter", "parameter", "evalCode"])
        test(name, scope => scope[name]());
    test("recursive", scope => scope.recursive(3));

    test("eval code of the constructor", "initialize(); this");
    test("eval code of eval code", "initialize(); eval('this')");
    test("arrow function of eval code", "(() => { initialize(); return this; })()");
    test("eval code of an arrow function of eval code", "(() => eval('initialize(); this'))()");
    test("super property in eval code", "initialize(); super.getter");
    test("eval code, super() in eval code", "initializeInEval(); this");
    test("eval code, assignment to a super property", "initialize(); (super['setter'] = 21)", result => result === 21);

    test("this.property", scope => scope.thisProperty(), result => result === 1);
    test("this.method()", scope => scope.thisCall());
    test("this.property = value", scope => scope.thisStore(), result => result === 2);
    test("this.#field", scope => scope.thisPrivateField(), result => result === 7);
    test("typeof this", scope => scope.typeofThis(), result => result === "object");
    test("super.property", scope => scope.superGet());
    test("super[key]", scope => scope.superGetByVal("getter"));
    test("super.method()", scope => scope.superCall());
    test("super[key]()", scope => scope.superCallByVal("method"));
    test("super.method.call()", scope => scope.superCallCall());
    test("super.method.apply()", scope => scope.superCallApply());
    test("super.tag`x`", scope => scope.superTag(), result => result === "tagged");
    test("super.property = value", scope => scope.superPut(20), result => result === 40);
    test("super[key] = value", scope => scope.superPutByVal("setter", 21), result => result === 42);
    test("super[key] = 21", scope => scope.superPutByValConstant("setter"), (result, instance) => result === 21 && instance.stored === 21);
    test("super.property += value", scope => scope.superAdd(), (result, instance) => result === 2 && instance.count === 2);
    test("super[key] += value", scope => scope.superAddByVal("count"), (result, instance) => result === 2 && instance.count === 2);
    test("super[key] ||= value", scope => scope.superOr("absent"), (result, instance) => result === 5 && instance.absent === 5);
    test("super[key]++", scope => scope.superIncrement("count"), result => result === 2);
    test("--super.property", scope => scope.superDecrement(), (result, instance) => result === 0 && instance.count === 0);
    test("destructuring to super properties", scope => scope.superDestructure(), result => result === 7);
    test("for-of to a super property", scope => scope.superForOf("last"), result => result === 6);
    test("for-in to a super property", scope => scope.superForIn(), result => result === "k");

    // A read that comes before super() throws, and the super() behind it does not run.
    const early = [
        "read", "readThenInitialize", "storeThenInitialize", "argumentThenInitialize", "superCallThenInitialize", "superGetByValThenInitialize",
        "superPutThenInitialize", "superPutByValThenInitialize", "superPutByValValueThenInitialize", "superAddByValThenInitialize", "superIncrementThenInitialize",
        "superDeleteThenInitialize", "superTagThenInitialize", "superDestructureThenInitialize", "superForOfThenInitialize", "superForInThenInitialize",
    ];
    for (const name of early) {
        baseCalls = 0;
        shouldThrow(() => new Derived(scope => { scope[name](name === "superPutByValValueThenInitialize" ? "setter" : undefined); }), uninitialized, name);
        shouldBe(baseCalls, 0, `${name}: calls of the base constructor`);
    }
    shouldThrow(() => new Derived("this"), uninitialized, "eval code before super()");
    shouldThrow(() => new Derived("(() => this)()"), uninitialized, "arrow function of eval code before super()");

    for (const code of ["super[(initialize(), 'setter')] = 1", "super.setter = (initialize(), 1)", "delete super[(initialize(), 'count')]"]) {
        baseCalls = 0;
        shouldThrow(() => new Derived(code), uninitialized, `eval code: ${code}`);
        shouldBe(baseCalls, 0, `eval code: ${code}: calls of the base constructor`);
    }

    // One activation has |this| in both states, and a second super() does not change it.
    test("read, super(), read", scope => scope.readBeforeAndAfter(), result => result === "uninitialized,object,object");
    test("eval code: read, super(), read", readBeforeAndAfter, result => result === "uninitialized,object,object");
    test("eval code of eval code: read, super(), read", "eval(readBeforeAndAfter)", result => result === "uninitialized,object,object");
    test("eval code of an arrow function: read, super(), read", scope => scope.evalCodeBeforeAndAfter(), result => result === "uninitialized,object,object");
    baseCalls = 0;
    let first;
    shouldThrow(() => new Derived(scope => {
        try {
            scope.initializeTwice();
        } finally {
            first = scope.read();
        }
    }), calledTwice, "second super()");
    shouldBe(baseCalls, 2, "second super(): calls of the base constructor");
    shouldBe(first instanceof Derived, true, "second super(): |this| stays the first object");

    // The constructor returns an object and never calls super(). Its arrow functions still have its |this|.
    let escaped;
    const replacement = { };
    shouldBe(new Derived(scope => { escaped = scope; return replacement; }), replacement, "the returned object");
    shouldThrow(() => escaped.read(), uninitialized, "escaped arrow function before super()");
    const late = escaped.body();
    shouldBe(late instanceof Derived && late !== replacement, true, "escaped arrow function calls super() and reads");
    shouldBe(escaped.read(), late, "escaped arrow function after super()");

    // Each construction has its own |this|.
    const scopes = [];
    const initialized = new Derived(scope => {
        scopes.push(scope);
        scope.initialize();
    });
    new Derived(scope => {
        scopes.push(scope);
        return replacement;
    });
    shouldBe(scopes[0].read(), initialized, "the construction that called super()");
    shouldThrow(() => scopes[1].read(), uninitialized, "the construction that did not call super()");
}

for (let i = 0; i < 100; ++i)
    testOnce();

// An async arrow function evaluates its parameters, and a body without await, in the call itself.
{
    const names = ["asyncBody", "asyncParameter", "asyncBodyAfterAwait", "arrowInAsyncBody"];
    const settled = [];
    for (const name of names) {
        for (let i = 0; i < 100; ++i) {
            new Derived(scope => {
                scope[name]().then(value => settled.push(value), error => settled.push(error));
                return { };
            });
        }
    }
    drainMicrotasks();
    shouldBe(settled.length, 100 * names.length, "async arrow functions settle");
    for (const value of settled)
        shouldBe(value instanceof Derived && value.own === 1, true, `async arrow function gives the new object, got ${String(value)}`);
}

// In an async arrow function too, a super property that comes before super() rejects, and the super() behind it does not run.
{
    const names = ["asyncSuperPutByValThenInitialize", "asyncSuperPutByValAfterAwaitThenInitialize"];
    const settled = [];
    for (const name of names) {
        for (let i = 0; i < 100; ++i) {
            baseCalls = 0;
            new Derived(scope => {
                scope[name]().then(() => settled.push("resolved"), error => settled.push(error.message === uninitialized && !baseCalls ? "rejected" : String(error)));
                return { };
            });
            drainMicrotasks();
        }
    }
    shouldBe(settled.length, 100 * names.length, "async arrow functions with a store to a super property settle");
    for (const outcome of settled)
        shouldBe(outcome, "rejected", "async arrow function with a store to a super property before super()");
}

// Eval code in the constructor of a class without a parent has |this| from the start.
{
    class WithoutParent {
        constructor()
        {
            this.fromEval = eval("this");
            this.fromArrowInEval = eval("(() => this)()");
        }
    }
    for (let i = 0; i < 100; ++i) {
        const instance = new WithoutParent;
        shouldBe(instance.fromEval, instance, "eval code in the constructor of a class without a parent");
        shouldBe(instance.fromArrowInEval, instance, "arrow function of eval code in the constructor of a class without a parent");
    }
}

// The reader keeps the scope that has |this| from its start. The scopes that the reader makes and leaves do not change it.
{
    let result;
    class BlockScope extends Base {
        constructor()
        {
            const initialize = () => { super(); };
            const read = () => {
                initialize();
                {
                    let captured = 1;
                    const inner = () => captured;
                    inner();
                    return this;
                }
            };
            result = read();
        }
    }
    class LoopScope extends Base {
        constructor()
        {
            const initialize = () => { super(); };
            const read = () => {
                const closures = [];
                const seen = [];
                for (let i = 0; i < 3; ++i) {
                    closures.push(() => i);
                    if (i === 1)
                        initialize();
                    try {
                        seen.push(typeof this);
                    } catch (error) {
                        seen.push(error.message === uninitialized ? "uninitialized" : String(error));
                    }
                }
                return seen.join();
            };
            shouldBe(read(), "uninitialized,object,object", "reads in a loop with a scope for each iteration");
            result = this;
        }
    }
    class CatchScope extends Base {
        constructor()
        {
            const initialize = () => { super(); };
            const read = () => {
                initialize();
                try {
                    throw 1;
                } catch (error) {
                    const inner = () => error;
                    inner();
                    return super.getter;
                }
            };
            result = read();
        }
    }
    class ParameterScope extends Base {
        constructor()
        {
            const initialize = () => { super(); };
            const read = captured => {
                const inner = () => captured;
                initialize();
                return inner() && this;
            };
            result = read(1);
        }
    }
    // The scope of the constructor has |this| and no variable.
    class NoCapturedVariable extends Base {
        constructor()
        {
            result = ((initialize, enterBlock) => {
                initialize();
                if (enterBlock) {
                    let captured = 1;
                    const inner = () => captured;
                    inner();
                }
                return this;
            })(() => { super(); }, true);
        }
    }
    // Only an eval tells the constructor that its arrow functions read |this| at each use.
    class EvalInArrowFunction extends Base {
        constructor()
        {
            const initialize = () => eval("super()");
            const read = () => { initialize(); return this; };
            result = read();
        }
    }
    class EvalInConstructor extends Base {
        constructor()
        {
            let initialize;
            eval("initialize = () => { super(); }");
            const read = () => { initialize(); return this; };
            result = read();
        }
    }
    // The variable of the eval code is in a scope that is not known before the eval code runs.
    class ArrowFunctionOfEvalCodeWithVariable extends Base {
        constructor()
        {
            const initialize = () => { super(); };
            result = eval("var variable = 1; (() => { initialize(); return this; })()");
        }
    }
    class EvalCodeWithVariable extends Base {
        constructor()
        {
            const initialize = () => { super(); };
            result = eval("var variable = 1; initialize(); this");
        }
    }
    class EvalCodeWithFunction extends Base {
        constructor()
        {
            const initialize = () => { super(); };
            result = eval("function declared() { return 1; } initialize(); declared() && this");
        }
    }
    for (const Class of [BlockScope, LoopScope, CatchScope, ParameterScope, NoCapturedVariable, EvalInArrowFunction, EvalInConstructor, ArrowFunctionOfEvalCodeWithVariable, EvalCodeWithVariable, EvalCodeWithFunction]) {
        for (let i = 0; i < 100; ++i) {
            result = null;
            shouldBe(new Class, result, Class.name);
        }
    }
}

// A bytecode cache keeps what the constructor told its arrow functions: for an arrow function whose code is generated after
// the decode, and for the eval code of a decoded arrow function. The depth is the count of function levels in the cache.
if (typeof builtinFromBytecodeCache === "function") {
    const source = `(function (Base, name) {
        "use strict";
        class Cached extends Base {
            constructor()
            {
                const initialize = () => { super(); };
                const readers = {
                    body: () => { initialize(); return this; },
                    nested: () => (() => { initialize(); return this; })(),
                    evalCode: () => eval("initialize(); this"),
                };
                if (readers[name]() !== this)
                    throw new Error("bytecode cache, " + name + ": not the new object");
            }
        }
        return new Cached;
    })`;
    for (const depth of [1, 2]) {
        for (const name of ["body", "nested", "evalCode"]) {
            const create = builtinFromBytecodeCache(source, true, depth);
            for (let i = 0; i < 2; ++i)
                shouldBe(create(Base, name).own, 1, `bytecode cache of depth ${depth}, ${name}`);
        }
    }
}

// The same in optimized code. One activation of the reader starts before super(), the others after it.
{
    let result;
    class HotArrow extends Base {
        constructor()
        {
            const initialize = () => { super(); };
            const read = shouldInitialize => {
                if (shouldInitialize)
                    initialize();
                return this;
            };
            noInline(read);
            result = read(true);
            for (let i = 0; i < 4; ++i)
                shouldBe(read(false), result, "hot arrow function, a later activation");
        }
    }
    class HotInlinedArrow extends Base {
        constructor()
        {
            const initialize = () => { super(); };
            const read = () => { initialize(); return this.own + super.count; };
            shouldBe(read(), 2, "hot inlined arrow function");
            result = this;
        }
    }
    class HotUninitialized extends Base {
        constructor(callSuperFirst)
        {
            const initialize = () => { super(); };
            const read = () => this;
            if (callSuperFirst)
                initialize();
            else {
                shouldThrow(read, uninitialized, "hot arrow function before super()");
                initialize();
            }
            result = read();
        }
    }
    class HotEval extends Base {
        constructor()
        {
            const initialize = () => { super(); };
            result = eval("initialize(); this");
        }
    }
    class HotEvalInitializedInEval extends Base {
        constructor()
        {
            const initialize = () => eval("super()");
            result = eval("initialize(); this");
        }
    }
    // One activation gets to optimized code in its loop, after its first reads threw and super() ran.
    class HotLoop extends Base {
        constructor()
        {
            const initialize = () => { super(); };
            const read = count => {
                let failed = 0;
                let sum = 0;
                for (let i = 0; i < count; ++i) {
                    if (i === 3)
                        initialize();
                    try {
                        sum += this.own;
                    } catch {
                        failed++;
                    }
                }
                return `${failed},${sum}`;
            };
            noInline(read);
            const count = 2 * testLoopCount;
            shouldBe(read(count), `3,${count - 3}`, "hot loop in an arrow function");
            result = this;
        }
    }
    // The same for eval code with a variable of its own.
    class HotLoopInEvalCodeWithVariable extends Base {
        constructor()
        {
            const initialize = () => { super(); };
            const count = 2 * testLoopCount;
            shouldBe(eval("var sum = 0; initialize(); for (let i = 0; i < count; ++i) sum += this.own; sum"), count, "hot loop in eval code with a variable");
            result = this;
        }
    }
    for (const Hot of [HotLoop, HotLoopInEvalCodeWithVariable]) {
        for (let i = 0; i < 3; ++i) {
            result = null;
            shouldBe(new Hot, result, Hot.name);
        }
    }
    for (const Hot of [HotArrow, HotInlinedArrow, HotUninitialized, HotEval, HotEvalInitializedInEval]) {
        for (let i = 0; i < testLoopCount; ++i) {
            result = null;
            shouldBe(new Hot(i % 3 === 0), result, Hot.name);
        }
    }
}
