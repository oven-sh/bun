// @bun
// The init of a for statement is parsed with [~In] so that `for (x in y)` can be told apart from a
// C-style loop. That restriction does not extend into the constructs nested in the init that the
// grammar parses with [+In] again: the block body and the parameters of an arrow function, and the
// inside of a destructuring pattern. It does extend into an arrow function's expression body. And
// nothing nested in the init may turn `in` back on for the rest of the init.
//
// The parser checks nested function bodies while it parses the enclosing code, so every shape goes
// through eval, both at the top level of a script and inside a function that is then called (the
// function body is parsed a second time when it is called).

function shouldBe(actual, expected) {
    if (actual !== expected)
        throw new Error(`bad value: ${String(actual)}, expected: ${String(expected)}`);
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

const accepted = [
    // `in` in the block body of an arrow function in the init, in every kind of statement.
    `for (var f = () => { return 'a' in {}; }; false;) {}`,
    `for (var f = () => { 'a' in {}; }; false;) {}`,
    `for (var f = () => { x: 'a' in {}; }; false;) {}`,
    `for (var f = () => { var x = 'a' in {}; }; false;) {}`,
    `for (var f = () => { let x = 'a' in {}; }; false;) {}`,
    `for (var f = () => { if ('a' in {}) {} }; false;) {}`,
    `for (var f = () => { while ('a' in {}) {} }; false;) {}`,
    `for (var f = () => { do {} while ('a' in {}); }; false;) {}`,
    `for (var f = () => { switch ('a' in {}) {} }; false;) {}`,
    `for (var f = () => { for (var k in {}) {} 'a' in {}; }; false;) {}`,
    `for (var f = () => { function g() { return 'a' in {}; } }; false;) {}`,
    `for (var f = () => { class C { ['a' in {}]() {} } }; false;) {}`,
    `for (var f = () => { for (var g = () => { return 'a' in {}; }; false;) {} }; false;) {}`,
    // Every position an arrow function can take in the init.
    `for (let f = () => { return 'a' in {}; }; false;) {}`,
    `for (const f = () => { return 'a' in {}; }; false;) {}`,
    `var f; for (f = () => { return 'a' in {}; }; false;) {}`,
    `for (() => { return 'a' in {}; }; false;) {}`,
    `for (var f = x => { return x in {}; }; false;) {}`,
    `for (var f = (x, y) => { return x in y; }; false;) {}`,
    `for (var f = async () => { return 'a' in {}; }; false;) {}`,
    `for (var f = async x => { return x in {}; }; false;) {}`,
    `for (var x = 0, f = () => { return 'a' in {}; }; false;) {}`,
    `var x, f; for (x = 0, f = () => { return 'a' in {}; }; false;) {}`,
    `for (var f = false ? null : () => { return 'a' in {}; }; false;) {}`,
    `for (var f = () => () => { return 'a' in {}; }; false;) {}`,
    `for (var f = () => (x = 'a' in {}) => x; false;) {}`,
    `for (var f = async () => async () => { return 'a' in {}; }; false;) {}`,
    `function* g() { for (var f = yield () => { return 'a' in {}; }; false;) {} }`,
    // `in` in the parameters of an arrow function in the init.
    `for (var f = (x = 'a' in {}) => {}; false;) {}`,
    `for (var f = (x = 'a' in {}) => x; false;) {}`,
    `for (var f = (x, y = x in {}) => y; false;) {}`,
    `for (var f = ({ x = 'a' in {} }) => x; false;) {}`,
    `for (var f = ([x = 'a' in {}]) => x; false;) {}`,
    `for (var f = ({ ['a' in {}]: x }) => x; false;) {}`,
    `for (var f = (...[x = 'a' in {}]) => x; false;) {}`,
    `for (var f = async (x = 'a' in {}) => x; false;) {}`,
    `for (var f = async ({ x = 'a' in {} }) => x; false;) {}`,
    `for (var f = (g = (x = 'a' in {}) => x) => g; false;) {}`,
    `for (var f = (g = () => { return 'a' in {}; }) => g; false;) {}`,
    `for (var f = ({ g = (x = 'a' in {}) => x }) => g; false;) {}`,
    `var f; for (f = (x = 'a' in {}) => x; false;) {}`,
    // `in` inside a destructuring assignment pattern in the init.
    `var x; for ({ x = 'a' in {} } = {}; false;) {}`,
    `var x; for ([x = 'a' in {}] = []; false;) {}`,
    `var x; for ({ ['a' in {}]: x } = {}; false;) {}`,
    `var o = {}; for ([o['a' in {}]] = []; false;) {}`,
    `var o = {}; for ({ x: o['a' in {}] } = {}; false;) {}`,
    `var x; for ({ y: { x = 'a' in {} } = {} } = {}; false;) {}`,
    `var x; for ([[x = 'a' in {}] = []] = []; false;) {}`,
    `var x, y; for (y = 0, { x = 'a' in {} } = {}; false;) {}`,
    `var o = {}; for ([...o['a' in {}]] = []; false;) {}`,
    `var o = {}; for ({ ...o['a' in {}] } = {}; false;) {}`,
    // Parentheses did not help in the two places that parse a member expression directly: the
    // target of a pattern element and the heritage of a class declaration in the arrow function's body.
    `var o = {}; for ([('a' in {} ? o : o).x] = []; false;) {}`,
    `for (var f = () => { class C extends ('a' in {} ? Object : Object) {} }; false;) {}`,
    // A for statement in the arrow function's body, then a construct later in the init that needs
    // [+In]. The inner for statement used to leave `in` enabled, so these parsed where they are
    // written. They then failed when the enclosing function was first called: that parse takes the
    // arrow function from the function cache and skips its body.
    `for (var f = () => { for (var k in {}) {} }, g = (x = 'a' in {}) => x; false;) {}`,
    `for (var f = () => { for (var i = 0; false;) {} return 'a' in {}; }, g = (x = 'a' in {}) => x; false;) {}`,
    `var x, f; for (f = () => { for (var k in {}) {} }, [x = 'a' in {}] = []; false;) {}`,
    // What a minifier writes when it moves the `var` statements in front of a loop into its init.
    `for (var o = { a: 1 }, f = () => { for (var k of ['a', 'b']) if (k in o) return k; return null; }, i = 0; i < 1; i++) f();`,
    `for (var o = { a: 1 }, f = (x = 'a' in o) => x, i = 0; i < 1; i++) f();`,
    // These already worked: the [+In] context is reached through a parenthesized expression, a
    // primary expression or a declaration's binding pattern.
    `for (var f = (() => { return 'a' in {}; }); false;) {}`,
    `for (var f = () => { return ('a' in {}); }; false;) {}`,
    `for (var f = () => ('a' in {}); false;) {}`,
    `for (var f = function () { return 'a' in {}; }; false;) {}`,
    `for (var f = { m() { return 'a' in {}; } }; false;) {}`,
    `for (var f = class { m() { return 'a' in {}; } }; false;) {}`,
    `for (var f = [() => { return 'a' in {}; }]; false;) {}`,
    `for (var f = (0, () => { return 'a' in {}; }); false;) {}`,
    `for (var { x = 'a' in {} } = {}; false;) {}`,
    `for (let [x = 'a' in {}] = []; false;) {}`,
    `for (var x = true ? 'a' in {} : 0; false;) {}`,
    `for (var f = () => true ? 'a' in {} : 0; false;) {}`,
    `for (var f = () => \`\${'a' in {}}\`; false;) {}`,
    // `in` outside the init is unaffected by what the init contains.
    `for (var f = () => { for (var k in {}) {} }; 'a' in {};) { break; }`,
    `var x; for (var f = () => { for (var k in {}) {} }; false; x = 'a' in {}) {}`,
    `for (var f = () => { for (var k in {}) {} }; false;) {} 'a' in {};`,
];

for (const code of accepted) {
    shouldNotThrowSyntaxError(code);
    shouldNotThrowSyntaxError(`"use strict"; ${code}`);
    shouldNotThrowSyntaxError(`function outer() { ${code} } outer();`);
    shouldNotThrowSyntaxError(`function outer() { "use strict"; ${code} } outer();`);
    shouldNotThrowSyntaxError(`async function outer() { ${code} } outer();`);
    shouldNotThrowSyntaxError(`function* outer() { ${code} } outer().next();`);
}

// Annex B.3.5, sloppy mode only: `for (var x = initializer in expression)`. The arrow function is
// the initializer, and an expression body still stops in front of the `in`.
const acceptedSloppy = [
    `for (var f = () => {} in {}) {}`,
    `for (var f = () => { for (var k in {}) {} } in {}) {}`,
    `for (var f = (x = 'a' in {}) => {} in {}) {}`,
    `for (var f = () => 'a' in {}) {}`,
];

for (const code of acceptedSloppy) {
    shouldNotThrowSyntaxError(code);
    shouldNotThrowSyntaxError(`function outer() { ${code} } outer();`);
}

const rejected = [
    // `in` at the level of the init itself.
    `for (var x = 'a' in {}; false;) {}`,
    `var x; for (x = 'a' in {}; false;) {}`,
    `for (var x = 0, y = 'a' in {}; false;) {}`,
    `for (var [x] = 'a' in {}; false;) {}`,
    `var x; for ([x] = 'a' in {}; false;) {}`,
    `var x; for ({ x } = 'a' in {}; false;) {}`,
    // An arrow function's expression body inherits [~In].
    `for (var f = () => 'a' in {}; false;) {}`,
    `for (var f = x => x in {}; false;) {}`,
    `for (var f = async () => 'a' in {}; false;) {}`,
    `for (var f = (x = 'a' in {}) => x in {}; false;) {}`,
    `for (var f = () => () => 'a' in {}; false;) {}`,
    `for (var f = false ? null : () => 'a' in {}; false;) {}`,
    `var f; for (f = () => 'a' in {}; false;) {}`,
    // Whatever re-enabled `in` inside the init switches it off again when it ends. The shapes with a
    // for statement inside the arrow function's body used to be accepted: that for statement left
    // `in` enabled for the rest of the outer init.
    `for (var f = () => {}, x = 'a' in {}; false;) {}`,
    `for (var f = () => { return 'a' in {}; }, x = 'a' in {}; false;) {}`,
    `for (var f = () => { for (var k in {}) {} }, x = 'a' in {}; false;) {}`,
    `for (var f = () => { for (var i = 0; false;) {} }, x = 'a' in {}; false;) {}`,
    `for (var f = () => { for (let i = 0; false;) {} }, x = 'a' in {}; false;) {}`,
    `var i; for (var f = () => { for (i = 0; false;) {} }, x = 'a' in {}; false;) {}`,
    `for (var f = () => { for (var k of []) {} }, x = 'a' in {}; false;) {}`,
    `for (var f = x => { for (var k in {}) {} }, y = 'a' in {}; false;) {}`,
    `for (var f = async () => { for (var k in {}) {} }, x = 'a' in {}; false;) {}`,
    `var f, x; for (f = () => { for (var k in {}) {} }, x = 'a' in {}; false;) {}`,
    `var f, x; for (f = () => { for (var i = 0; false;) {} }, x = 'a' in {}; false;) {}`,
    `var f, x; for (f = () => () => { for (var k in {}) {} }, x = 'a' in {}; false;) {}`,
    `for (var f = (x = 'a' in {}) => {}, y = 'a' in {}; false;) {}`,
    `for (var f = ({ x = 'a' in {} }) => {}, y = 'a' in {}; false;) {}`,
    `for (var f = ({ x = 'a' in {} }) => x in {}; false;) {}`,
    `for (var f = ([x]) => x in {}; false;) {}`,
    `var x, y; for ({ x = 'a' in {} } = {}, y = 'a' in {}; false;) {}`,
    `var x, y; for ([x] = [], y = 'a' in {}; false;) {}`,
    `var x; for ({ x = 'a' in {} } = 'a' in {}; false;) {}`,
    `var x; for ([x = 'a' in {}] = 'a' in {}; false;) {}`,
    `for (var { x = 'a' in {} } = {}, y = 'a' in {}; false;) {}`,
    `for (var f = function () { for (var k in {}) {} }, x = 'a' in {}; false;) {}`,
    `for (var f = (() => { for (var k in {}) {} }), x = 'a' in {}; false;) {}`,
];

for (const code of rejected) {
    shouldThrowSyntaxError(code);
    shouldThrowSyntaxError(`"use strict"; ${code}`);
    shouldThrowSyntaxError(`function outer() { ${code} }`);
    shouldThrowSyntaxError(`async function outer() { ${code} }`);
}

// The functions and patterns parsed this way mean the usual thing.
shouldBe((0, eval)(`for (var f = () => { return 'a' in { a: 0 }; }; false;) {} f();`), true);
shouldBe((0, eval)(`for (var f = (x = 'a' in { a: 0 }) => x; false;) {} f();`), true);
shouldBe((0, eval)(`for (var f = ({ x = 'b' in { a: 0 } }) => x; false;) {} f({});`), false);
shouldBe((0, eval)(`var x; for ({ x = 'a' in { a: 0 } } = {}; false;) {} x;`), true);
shouldBe((0, eval)(`var o = {}; for ([o['a' in {}]] = [1]; false;) {} o.false;`), 1);
shouldBe((0, eval)(`var n = 0; for (var f = () => { for (var k in { p: 0 }) n++; return n; }; false;) {} f();`), 1);
shouldBe((0, eval)(`for (var f = () => 'a' in {}) {} f();`), "a");
shouldBe((0, eval)(`
    var log = [];
    function outer() {
        for (var f = (x = 'x' in log) => { log.push(x); return 'length' in log; }; false;) {}
        return f();
    }
    outer() && outer() && log.join();
`), "false,false");
shouldBe((0, eval)(`
    function twice() {
        for (var f = () => { for (var k in { p: 0 }) return k; }, g = (x = f() in { p: 0 }) => x; false;) {}
        return g();
    }
    twice() && twice();
`), true);
shouldBe((0, eval)(`var o = { p: 0 }; for ([('p' in o ? o : null).q] = [2]; false;) {} o.q;`), 2);
