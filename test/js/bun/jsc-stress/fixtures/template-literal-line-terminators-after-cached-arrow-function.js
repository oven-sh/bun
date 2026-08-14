// @bun
// While the code around a function is parsed, every function nested in it is parsed once and gets a
// SourceProviderCache entry; when the enclosing function is compiled on its first call, its body is parsed
// again and each nested function is skipped by resuming the lexer after the nested function's last token.
// For an arrow function with an expression body that last token is the body's last token, and a template
// literal (or a string literal with line continuations) there can span several lines. The cache entry only
// knew the line the token started on, so after the arrow function the lexer continued on that line: every
// position after the arrow function was reported too many lines up, by the number of line terminators inside
// the token, and positions on the token's last line were measured from the wrong line start.
//
// Each body below ends in a statement that creates an Error. The body is run once as eval code (parsed once,
// which is the reference) and then as the body of functions that are called, which is the parse that goes
// through the cache; both have to report the Error at the same place.

const cases = [
    // The token the arrow function body ends in spans lines; the next statement is on the following line.
    { name: "template with one line terminator", line: 3,
      body: "var f = (a) => `x\ny`;\nresult = new Error();" },
    { name: "template with three line terminators", line: 5,
      body: "var f = (a) => `x\n\n\ny`;\nresult = new Error();" },
    { name: "template with CR, CRLF, LS and PS line terminators", line: 6,
      body: "var f = (a) => `x\ry\r\nz\u2028w\u2029v`;\nresult = new Error();" },
    { name: "template with an escaped line terminator", line: 3,
      body: "var f = (a) => `x\\\ny`;\nresult = new Error();" },
    { name: "template tail after a substitution", line: 3,
      body: "var f = (a) => `${a}\ny`;\nresult = new Error();" },
    { name: "tagged template", line: 3,
      body: "var f = (a) => String.raw`x\ny`;\nresult = new Error();" },
    { name: "string with a line continuation", line: 3,
      body: "var f = (a) => 'x\\\ny';\nresult = new Error();" },

    // Other arrow function shapes whose body ends in such a token.
    { name: "single identifier parameter", line: 3,
      body: "var f = a => `x\ny`;\nresult = new Error();" },
    { name: "async arrow function", line: 3,
      body: "var f = async (a) => `x\ny`;\nresult = new Error();" },
    { name: "assignment expression as the body", line: 3,
      body: "var f = (a) => a.p = `x\ny`;\nresult = new Error();" },
    { name: "arrow function returning an arrow function", line: 3,
      body: "var f = (a) => (b) => `x\ny`;\nresult = new Error();" },
    { name: "arrow function as a call argument", line: 3,
      body: "[].map((a) => `x\ny`);\nresult = new Error();" },
    { name: "arrow function ended by automatic semicolon insertion", line: 3,
      body: "var f = (a) => `x\ny`\nresult = new Error()" },
    { name: "two such arrow functions in one statement", line: 4,
      body: "var f = (a) => `x\ny`, g = (a) => `x\ny`;\nresult = new Error();" },
    // Functions declared after the arrow function are recorded as starting on the line the lexer believes it is
    // on, and every position inside them is computed from that line when they are compiled.
    { name: "function declared after such an arrow function", line: 3,
      body: "var f = (a) => `x\ny`;\nfunction g() { result = new Error(); }\ng();" },
    { name: "method declared after such an arrow function class field", line: 4,
      body: "class C {\n  a = () => `x\ny`;\n  m() { result = new Error(); }\n}\nnew C().m();" },

    // In these shapes the eval run takes a cache hit as well, so for them the check of the eval run against the
    // line given here is the one that matters: a class field initializer and a function's parameters are parsed
    // again when the class's initializer function or the function is compiled, and an assignment pattern is first
    // parsed as an expression and then again as a pattern. (The Error is created in a function declared after the
    // arrow function because the jsc shell reports no position for the field initializer itself.)
    { name: "class field initializer continuing after such an arrow function", line: 3,
      body: "class C {\n  a = [() => `x\ny`, () => { result = new Error(); }];\n}\nnew C().a[1]();" },
    { name: "static class field initializer continuing after such an arrow function", line: 3,
      body: "class C {\n  static a = [() => `x\ny`, () => { result = new Error(); }];\n}\nC.a[1]();" },
    { name: "function body after such an arrow function as a parameter default value", line: 2,
      body: "function g(a = () => `x\ny`) { result = new Error(); }\ng();" },
    { name: "arrow function body after such an arrow function as a parameter default value", line: 2,
      body: "var g = (a = () => `x\ny`) => { result = new Error(); };\ng();" },
    { name: "assignment pattern with such an arrow function as a default value", line: 4,
      body: "var a;\n[a = () => `x\ny`] = [];\nresult = new Error();" },

    // The next statement is on the line the token ends on, so its column depends on where that line starts.
    { name: "next statement on the template's last line", line: 2,
      body: "var f = (a) => `x\ny`; result = new Error();" },
    { name: "next statement on the string's last line", line: 2,
      body: "var f = (a) => 'x\\\ny'; result = new Error();" },

    // Shapes whose positions were already right.
    { name: "single-line template", line: 2,
      body: "var f = (a) => `xy`;\nresult = new Error();" },
    { name: "single-line template, next statement on the same line", line: 1,
      body: "var f = (a) => `xy`; result = new Error();" },
    { name: "parenthesized template", line: 3,
      body: "var f = (a) => (`x\ny`);\nresult = new Error();" },
    { name: "block body", line: 3,
      body: "var f = (a) => { return `x\ny`; };\nresult = new Error();" },
    { name: "function expression", line: 3,
      body: "var f = function (a) { return `x\ny`; };\nresult = new Error();" },
    { name: "template outside of any function", line: 3,
      body: "var t = `x\ny`;\nresult = new Error();" },
];

// A global property rather than a top-level var: the functions made by new Function() below live in the global
// scope, so this keeps working when this file itself is run as a module.
globalThis.result = null;

function positionInEval(body)
{
    result = null;
    eval(body);
    return { line: result.line, column: result.column };
}

// The function expression's body is parsed (and the functions in it cached) while the eval code is parsed,
// and parsed again, through the cache, when the function is called.
function positionInCalledFunction(wrapperStart, wrapperEnd, body)
{
    result = null;
    eval(wrapperStart + body + wrapperEnd)();
    return { line: result.line, column: result.column };
}

// new Function() parses its synthesized source once to check it and again when the function is called.
function positionInFunctionConstructorFunction(body)
{
    result = null;
    new Function(body)();
    return { line: result.line, column: result.column };
}

const functionConstructorHeaderLines = positionInFunctionConstructorFunction("result = new Error();").line - 1;
const firstLineWrapperStart = "(function () { ";

const failures = [];
function check(description, actual, expected)
{
    if (actual.line !== expected.line || actual.column !== expected.column)
        failures.push(`${description}: expected ${expected.line}:${expected.column}, got ${actual.line}:${actual.column}`);
}

for (const { name, line, body } of cases) {
    const reference = positionInEval(body);
    check(`${name}, in eval code`, reference, { line, column: reference.column });

    // The body starts on the line after the function's first line, so it keeps its line structure and columns.
    check(`${name}, in a function whose body starts on the next line`,
        positionInCalledFunction("(function () {\n", "\n})", body),
        { line: reference.line + 1, column: reference.column });

    // The body starts on the function's first line. An arrow function on the body's first line then starts on
    // the line the enclosing function starts on, which the cache handles specially because that line's start is
    // recorded differently by the two parses. The Error's column only shifts if it is on that line as well.
    check(`${name}, in a function whose body starts on the function's first line`,
        positionInCalledFunction(firstLineWrapperStart, "\n})", body),
        { line: reference.line, column: reference.column + (reference.line === 1 ? firstLineWrapperStart.length : 0) });

    check(`${name}, in a function created by the Function constructor`,
        positionInFunctionConstructorFunction(body),
        { line: reference.line + functionConstructorHeaderLines, column: reference.column });
}

if (failures.length)
    throw new Error(`FAIL:\n${failures.join("\n")}`);
