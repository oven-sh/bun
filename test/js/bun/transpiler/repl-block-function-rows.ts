// Rows for the REPL tests of ECMA-262 Annex B.3.3. In sloppy code a function declared in a
// block is also a `var` of its script, and the declaration stores the function to that
// `var` when it runs. A REPL input is such a script, and its `var`s are the names of the
// session.
//
// `f`, `g` and `h` are the names that a row gives the session. A runner that keeps one
// session for all rows gives each row its own (`renameSessionNames`).
//
// Each value is what `node -i` (v26.3.0) gives, except where a comment says otherwise.

/** The inputs of one session, and the value of the last input ("!Name": it throws that error). */
export type Row = [title: string, inputs: string[], expected: unknown];

/** After each of these inputs, `typeof f` is "function" in the next input. */
export const positions = [
  "if (1) { function f() {} }",
  "if (0) {} else { function f() {} }",
  "if (1) function f() {}",
  "if (0) ; else function f() {}",
  "{ function f() {} };",
  "{ { function f() {} } };",
  "try { function f() {} } catch {}",
  "try { throw 1 } catch { function f() {} }",
  "try { throw 1 } catch (e) { function f() {} }",
  "try {} finally { function f() {} }",
  "l: { function f() {} }",
  "switch (1) { case 1: function f() {} }",
  "switch (1) { default: function f() {} }",
  "for (;;) { function f() {} break }",
  "for (const k in { a: 1 }) { function f() {} }",
  "for (const v of [1]) { function f() {} }",
  "while (true) { function f() {} break }",
  "do { function f() {} } while (false)",
  "with ({}) { function f() {} }",
];

export const stored: Row[] = [
  ["is a function in the next input", ['if (typeof f !== "function") { function f() { return 2 } }', "f()"], 2],
  ["is a function after its block in the same input", ["if (1) { function f() { return 1 } } f()"], 1],
  ["is an undefined var before its block", ["var g = f; if (1) { function f() {} } String(g)"], "undefined"],
  ["is not a function before its block", ["f(); if (1) { function f() {} }"], "!TypeError"],
  [
    "is declared when the input throws before its block",
    ["f(); if (1) { function f() {} }", '[typeof f, "f" in globalThis].join()'],
    "undefined,true",
  ],
  [
    "is declared when its block does not run",
    ["if (0) { function f() {} }", '[typeof f, "f" in globalThis].join()'],
    "undefined,true",
  ],
  [
    "leaves an earlier function when its block does not run",
    ["function f() { return 1 }", "if (0) { function f() { return 2 } } f()"],
    1,
  ],
  ["leaves an earlier var when its block does not run", ["var f = 1", "if (0) { function f() {} }", "f"], 1],
  [
    "leaves an earlier function when a break skips its declaration",
    ["function f() { return 1 }", "exit: { break exit; function f() { return 2 } } f()"],
    1,
  ],
  [
    "is not stored when its block throws before its declaration",
    ["try { null.x; function f() {} } catch {}", "typeof f"],
    "undefined",
  ],
  [
    "is stored when its block throws after its declaration",
    ["try { function f() { return 3 } null.x } catch {}", "f()"],
    3,
  ],
  [
    "is stored where it is declared, not at the top of its block",
    ["var g; if (1) { g = typeof globalThis.f; function f() {} } [g, typeof f].join()"],
    "undefined,function",
  ],
  ["is stored with the value that its block gave the name", ["if (1) { f = 5; function f() {} }", "f"], 5],
  ["is not stored again by an assignment in its block", ["if (1) { function f() {} f = 5 }", "typeof f"], "function"],
  [
    "is stored each time its declaration runs",
    [
      "var g = []; for (let i = 0; i < 2; i++) { function f() {} g.push(globalThis.f === f); globalThis.f = 0 } g.join()",
    ],
    "true,true",
  ],
  ["replaces an earlier function", ["function f() { return 1 }", "if (1) { function f() { return 2 } }", "f()"], 2],
  ["replaces an earlier var", ["var f = 1", "if (1) { function f() { return 2 } }", "f()"], 2],
  // The REPL keeps a `let` of an earlier input as a `var`, which can be declared again.
  // In node the second input is a SyntaxError.
  ["replaces an earlier let", ["let f = 1", "if (1) { function f() { return 2 } }", "f()"], 2],
  ["replaces a var of its input", ["var f = 1; if (1) { function f() { return 2 } } f()"], 2],
  ["is replaced by a var of its input after its block", ["if (1) { function f() {} } var f = 3; f"], 3],
  [
    "replaces a top-level function of its input, written before its block, in the next input",
    ["function f() { return 1 } if (1) { function f() { return 2 } }", "f()"],
    2,
  ],
  [
    "declared twice in one block is the last one",
    ["if (1) { function f() { return 1 } function f() { return 2 } } f()"],
    2,
  ],
  [
    "declared twice in one block is stored by its first declaration too",
    ["var g; exit: { function f() { return 1 } g = globalThis.f(); break exit; function f() { return 2 } } g"],
    2,
  ],
  [
    "declared in two blocks is the one of the last block",
    ["if (1) { function f() { return 1 } } if (1) { function f() { return 2 } } f()"],
    2,
  ],
  [
    "declared in two cases of a switch does not throw in the first case",
    ['switch (0) { case 0: function f() { return 1 } break; case 1: function f() { return 2 } } "no error"'],
    "no error",
  ],
  [
    "declared in two cases of a switch is the one of the last case",
    ["switch (1) { case 0: function f() { return 1 } break; case 1: function f() { return 2 } }", "f()"],
    2,
  ],
  ["keeps its name", ["if (1) { function f() {} }", 'f.name === "f"'], true],
  [
    "is declared past a catch parameter of its name",
    ["try { throw 1 } catch (f) { { function f() {} } }", "typeof f"],
    "function",
  ],
  [
    "is stored to the global object, not to the object of a with statement",
    ["var g = { f: 1 }; with (g) { function f() {} } [typeof f, g.f].join()"],
    "function,1",
  ],
  // node prints the function. As a statement, the block has no value.
  ["gives its input no value", ["if (1) { function f() {} }"], undefined],
  // To node and JavaScriptCore this is a function of the input itself, not of a block.
  ["declared after a label is a function in the next input", ["l: function f() {}", "typeof f"], "function"],
  // A block with a direct eval keeps the declaration, so the engine gives the function to
  // the wrapper function of the input as a `var`. The input stores it to the session too.
  ["is a function in the next input beside a direct eval", ['if (1) { function f() { return eval("7") } }', "f()"], 7],
  [
    "is a function in another case of its switch beside a direct eval",
    ['var g; switch (1) { case 1: g = eval("typeof f"); break; default: function f() {} } g'],
    "function",
  ],
  [
    "replaces a top-level function of its input beside a direct eval",
    ['if (1) { eval(""); function f() { return 2 } } function f() { return 1 } f()'],
    2,
  ],
];

/** Annex B.3.3 gives these functions no `var`: they stay in their block. */
export const notStored: Row[] = [
  ["under a let of its input", ["let f = 1; if (1) { function f() {} }", "f"], 1],
  ["under a const of its input", ["const f = 1; if (1) { function f() {} }", "f"], 1],
  ["under a class of its input", ["class f {}; if (1) { function f() {} }", "String(f).slice(0, 5)"], "class"],
  ["under a let of an enclosing block", ["if (1) { let f = 1; { function f() {} } }", "typeof f"], "undefined"],
  [
    "under a let of the loop that holds it",
    ["for (let f = 0; f < 1; f++) { function f() {} }", "typeof f"],
    "undefined",
  ],
  [
    "under a destructured catch parameter",
    ["try { throw {} } catch ({ f = 1 }) { { function f() {} } }", "typeof f"],
    "undefined",
  ],
  // JavaScriptCore and test262 (annexB/language/function-code/block-decl-nested-blocks-with-fun-decl.js).
  // node gives 2 since v20.
  [
    "under a function of an enclosing block",
    ["if (1) { function f() { return 1 } { function f() { return 2 } } }", "f()"],
    1,
  ],
  ["when it is async", ["if (1) { async function f() {} }", "typeof f"], "undefined"],
  ["when it is a generator", ["if (1) { function* f() {} }", "typeof f"], "undefined"],
  ["when it is a class", ["if (1) { class f {} }", "typeof f"], "undefined"],
  ["in a function", ["function g() { if (1) { function f() {} } } g()", "typeof f"], "undefined"],
  ["in an arrow function", ["(() => { if (1) { function f() {} } })()", "typeof f"], "undefined"],
  ["in a class static block", ["class g { static { if (1) { function f() {} } } }", "typeof f"], "undefined"],
  ["in a TypeScript namespace", ["namespace g { if (1) { function f() {} } }", "typeof f"], "undefined"],
];

/** Strict code has no Annex B.3.3. The directive has to be first, so these take no prefix. */
export const strict: Row[] = [
  ["in a strict input", ['"use strict"; if (1) { function f() {} }', "typeof f"], "undefined"],
  // node copies every function of an input with a top-level await to the session.
  [
    "in a strict input with a top-level await",
    ['"use strict"; await 0; if (1) { function f() {} }', "typeof f"],
    "undefined",
  ],
];

/** These rows replace a global that other rows use: each one needs a session of its own. */
export const replacesGlobal: Row[] = [
  ["named arguments", ["if (1) { function arguments() { return 5 } }", "arguments()"], 5],
  ["named eval", ["if (1) { function eval() { return 6 } }", "eval()"], 6],
];

/** Where the REPL still differs from node. Each value is the one of node, so each row fails. */
export const knownDifferences: Row[] = [
  // A top-level function of the input is a local of the wrapper function. Its copy to the
  // session is made where it is declared, not before the input runs.
  [
    "is not replaced by a top-level function of its input that is written after its block",
    ["if (1) { function f() { return 2 } } function f() { return 1 }", "f()"],
    2,
  ],
  [
    "replaces a top-level function of its input for the rest of that input",
    ["function f() { return 1 } if (1) { function f() { return 2 } } f()"],
    2,
  ],
  // The parser gives a function after a label a block of its own.
  [
    "declared after a label is a function before its label runs",
    ["var g = typeof f; l: function f() {} g"],
    "function",
  ],
  [
    "declared after a label does not replace a var that its input assigned before",
    ["var f = 1; l: function f() {}", "typeof f"],
    "number",
  ],
  // The block holds `let f = function() {}`.
  ["has its name in its source text", ["if (1) { function f() {} }", 'String(f).startsWith("function f(")'], true],
  // The wrapper function has the `var` of a declaration that a direct eval keeps.
  [
    "beside a direct eval leaves an earlier function when its block does not run",
    ["function f() { return 1 }", 'if (0) { eval(""); function f() { return 2 } } f()'],
    1,
  ],
  [
    "beside a direct eval stays in its block under a let of its input",
    ['let f = 3; if (1) { function f() {} eval("") }', "f"],
    3,
  ],
  // Without a renamer the parser hoists the first function in the place of the catch
  // binding, so a second function or a `var` of the name meets a function there.
  [
    "declared in two blocks under a catch parameter of its name is the one of the last block",
    ["try { throw 1 } catch (f) { { function f() { return 1 } } { function f() { return 2 } } }", "f()"],
    2,
  ],
  [
    "is declared beside a var of its name under a catch parameter of its name",
    ["try { throw 1 } catch (f) { { { function f() { return 1 } } { var f } } }", "f()"],
    1,
  ],
  // The `let` of a switch is in the case of its last declaration.
  [
    "declared in two cases of a switch is stored by the first case",
    ["switch (0) { case 0: function f() { return 1 } break; case 1: function f() { return 2 } }", "typeof f"],
    "function",
  ],
];

/** Gives the session names of an input (`f`, `g`, `h`) the suffix of their row. */
export function renameSessionNames(input: string, suffix: string | number): string {
  return input.replace(/\b[fgh]\b/g, name => name + suffix);
}
