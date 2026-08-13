// @bun
//@ requireOptions("--useExplicitResourceManagement=true")

// `using` / `await using` declarations are not allowed directly in a switch case or default clause,
// but a function nested in such a clause is a fresh statement list, so they are allowed at the top
// level of its body. The check happens while the enclosing code is parsed (the nested body is
// syntax-checked as part of it), so every case below goes through eval to exercise that parse.

function shouldBe(actual, expected) {
    if (actual !== expected)
        throw new Error(`bad value: ${String(actual)}, expected: ${String(expected)}`);
}

function shouldThrowSyntaxError(code) {
    let threw = false;
    try {
        (0, eval)(code);
    } catch (e) {
        threw = true;
        if (!(e instanceof SyntaxError))
            throw new Error(`Expected SyntaxError but got ${e.constructor.name}: ${e.message}: ${code}`);
    }
    if (!threw)
        throw new Error(`Expected SyntaxError for: ${code}`);
}

function shouldNotThrowSyntaxError(code) {
    try {
        (0, eval)(code);
    } catch (e) {
        if (e instanceof SyntaxError)
            throw new Error(`Unexpected SyntaxError: ${e.message}: ${code}`);
        throw e;
    }
}

const bodies = [
    // Every kind of function body that parseFunctionBody() handles, each containing a `using`.
    `function f() { using x = null; }`,
    `(function () { using x = null; });`,
    `() => { using x = null; };`,
    `() => (() => { using x = null; })();`,
    `function* g() { using x = null; }`,
    `async function f() { using x = null; }`,
    `({ m() { using x = null; } });`,
    `({ get g() { using x = null; } });`,
    `({ set s(v) { using x = null; } });`,
    `class C { constructor() { using x = null; } }`,
    `class C { m() { using x = null; } }`,
    `class C { static m() { using x = null; } }`,
    `class C { #m() { using x = null; } }`,
    `class C { field = () => { using x = null; }; }`,
    `class C { static field = function () { using x = null; }; }`,
    `function f(a = () => { using x = null; }) { }`,
    // The await form, in every kind of async body.
    `async function f() { await using x = null; }`,
    `(async function () { await using x = null; });`,
    `async () => { await using x = null; };`,
    `async () => (async () => { await using x = null; })();`,
    `async function* g() { await using x = null; }`,
    `({ async m() { await using x = null; } });`,
    `class C { async m() { await using x = null; } }`,
    `class C { static async m() { await using x = null; } }`,
    `class C { field = async () => { await using x = null; }; }`,
];

for (const body of bodies) {
    shouldNotThrowSyntaxError(`switch (0) { case 0: ${body} }`);
    shouldNotThrowSyntaxError(`switch (0) { default: ${body} }`);
    shouldNotThrowSyntaxError(`switch (0) { case 1: break; case 0: ${body} }`);
    shouldNotThrowSyntaxError(`function outer() { switch (0) { case 0: ${body} } }`);
    shouldNotThrowSyntaxError(`async function outer() { switch (0) { case 0: ${body} } }`);
    shouldNotThrowSyntaxError(`(function () { "use strict"; switch (0) { default: ${body} } })`);
}

// Still an error directly in a clause, including right after a nested function has been parsed,
// and in a switch that is itself inside a function nested in a clause.
shouldThrowSyntaxError(`switch (0) { case 0: using x = null; }`);
shouldThrowSyntaxError(`switch (0) { default: using x = null; }`);
shouldThrowSyntaxError(`switch (0) { case 0: function f() { using y = null; } using x = null; }`);
shouldThrowSyntaxError(`switch (0) { case 0: (() => { using y = null; })(); using x = null; }`);
shouldThrowSyntaxError(`switch (0) { case 0: ({ m() { using y = null; } }); using x = null; }`);
shouldThrowSyntaxError(`switch (0) { case 0: class C { m() { using y = null; } } using x = null; }`);
shouldThrowSyntaxError(`switch (0) { case 0: function f() { } case 1: using x = null; }`);
shouldThrowSyntaxError(`switch (0) { case 0: function f() { } default: using x = null; }`);
shouldThrowSyntaxError(`switch (0) { default: function f() { } case 1: using x = null; }`);
shouldThrowSyntaxError(`function f() { switch (0) { case 0: using x = null; } }`);
shouldThrowSyntaxError(`switch (0) { case 0: function f() { switch (1) { case 1: using x = null; } } }`);
shouldThrowSyntaxError(`switch (0) { case 0: (() => { switch (1) { default: using x = null; } })(); }`);
shouldThrowSyntaxError(`switch (0) { case 0: { function f() { } } using x = null; }`);
shouldThrowSyntaxError(`async function f() { switch (0) { case 0: await using x = null; } }`);
shouldThrowSyntaxError(`async function f() { switch (0) { default: await using x = null; } }`);
shouldThrowSyntaxError(`async function f() { switch (0) { case 0: async function g() { await using y = null; } await using x = null; } }`);
shouldThrowSyntaxError(`async function f() { switch (0) { case 0: (async () => { await using y = null; })(); await using x = null; } }`);
shouldThrowSyntaxError(`async function f() { switch (0) { case 0: async function g() { } case 1: await using x = null; } }`);
shouldThrowSyntaxError(`async function f() { switch (0) { case 0: async function g() { switch (1) { case 1: await using x = null; } } } }`);

// The declarations in the nested functions are real `using` declarations: the resources are disposed.
{
    const order = (0, eval)(`
        const order = [];
        switch (0) {
            case 0:
                function f() {
                    using a = { [Symbol.dispose]() { order.push("dispose-a"); } };
                    order.push("body-f");
                }
                const g = () => {
                    using b = { [Symbol.dispose]() { order.push("dispose-b"); } };
                    order.push("body-g");
                };
                f();
                g();
                order.push("after");
        }
        order;
    `);
    shouldBe(order.join(","), "body-f,dispose-a,body-g,dispose-b,after");
}

{
    let result;
    let error;
    (0, eval)(`
        const order = [];
        async function outer() {
            switch (0) {
                default:
                    async function f() {
                        await using a = { [Symbol.asyncDispose]() { order.push("dispose-a"); } };
                        order.push("body-f");
                    }
                    const g = async () => {
                        await using b = { [Symbol.asyncDispose]() { order.push("dispose-b"); } };
                        order.push("body-g");
                    };
                    await f();
                    await g();
                    order.push("after");
            }
            return order.join(",");
        }
        outer();
    `).then(value => { result = value; }, e => { error = e; });
    drainMicrotasks();
    if (error)
        throw error;
    shouldBe(result, "body-f,dispose-a,body-g,dispose-b,after");
}
