// The probe of source-positions.test.ts. Each template is a statement on one line, in the body of a function `f`. For each place between two of its tokens there is a row with a line break there, and one row has a line break at every such place. A row says which line of its statement the frame of `f` is on.

// The longer ones first: a token is the first of these that the text goes on with.
const punctuators =
  ">>>= ... === !== **= <<= >>= >>> &&= ||= ??= => == != <= >= && || ?? ?. ++ -- += -= *= /= %= &= |= ^= << >> ** { } ( ) [ ] ; , < > + - * / % & | ^ ! ~ ? : = .".split(
    " ",
  );

/** The tokens of a statement. A template is cut behind each `${` and in front of each `}`, so that a value in it takes line breaks too. */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let at = 0;
  while (at < text.length) {
    const char = text[at];
    if (/\s/.test(char)) {
      at++;
      continue;
    }
    const word = /^[A-Za-z_$#][\w$]*/.exec(text.slice(at)) ?? /^\d[\w.]*/.exec(text.slice(at));
    if (word) {
      tokens.push(word[0]);
      at += word[0].length;
      continue;
    }
    if (char === '"' || char === "'") {
      let end = at + 1;
      while (text[end] !== char) end += text[end] === "\\" ? 2 : 1;
      tokens.push(text.slice(at, end + 1));
      at = end + 1;
      continue;
    }
    if (char === "`") {
      let start = at;
      let end = at + 1;
      while (text[end] !== "`") {
        if (text[end] === "\\") {
          end += 2;
        } else if (text.startsWith("${", end)) {
          tokens.push(text.slice(start, end + 2));
          // No template of the probe holds another one.
          let close = end + 2;
          for (let depth = 1; ; close++) {
            if (text[close] === "{") depth++;
            else if (text[close] === "}" && --depth === 0) break;
          }
          tokens.push(...tokenize(text.slice(end + 2, close)));
          start = close;
          end = close + 1;
        } else {
          end++;
        }
      }
      tokens.push(text.slice(start, end + 1));
      at = end + 1;
      continue;
    }
    const punctuator = punctuators.find(punctuator => text.startsWith(punctuator, at));
    if (!punctuator) throw new Error(`no token at ${at} of ${text}`);
    tokens.push(punctuator);
    at += punctuator.length;
  }
  return tokens;
}

/** The statement with a line break behind each token whose index is in `breaks`, and a blank where two tokens would read as one. */
function join(tokens: string[], breaks: Set<number>): string {
  let text = "  ";
  tokens.forEach((token, index) => {
    text += token;
    const next = tokens[index + 1];
    if (next === undefined) return;
    const isOperator = /^[=!<>+\-*/%&|^?:]+$/.test(token) && !["?.", "!", "++", "--", "-", "+"].includes(token);
    const isBeforeOperator = /^[=<>*/%&|^?:]+$|^[!=]==?$|^[+-]=?$|^\?\?$/.test(next) && next !== "?.";
    if (breaks.has(index)) text += "\n    ";
    else if (/[\w$]$/.test(token) && /^[\w$#]/.test(next)) text += " ";
    else if (/[+-]$/.test(token) && /^[+-]/.test(next)) text += " ";
    else if (token === "," || token === ";" || isOperator) text += " ";
    else if (isBeforeOperator && !token.endsWith("${")) text += " ";
  });
  return text;
}

/** The same statement on one line, with ` / ` for each line break. */
function layout(tokens: string[], breaks: Set<number>): string {
  let text = "";
  tokens.forEach((token, index) => {
    text += token;
    const next = tokens[index + 1];
    if (next === undefined) return;
    if (breaks.has(index)) text += " / ";
    else if (/[\w$]$/.test(token) && /^[\w$#]/.test(next)) text += " ";
  });
  return text;
}

// What the statements use. `show` looks for the frame of `f`, which is the function around each statement.
const prelude = `// The first line is a comment: the copy that runs as it is written has \`// @bun\` there.
const line = frame => Number((frame.match(/:(\\d+):\\d+\\)?$/) || [])[1]);
const here = () => line(String(new Error("here").stack).split("\\n")[2]);
const rows = {};
function show(row, base, f) {
  rows[row] = "no throw";
  try {
    f();
  } catch (e) {
    const frame = String(e && e.stack).split("\\n").find(frame => /^\\s+at (new )?f /.test(frame));
    rows[row] = frame ? "line " + (line(frame) - base) : "f is not in the stack";
  }
}
function boom() { throw new Error("m"); }
const use = (...a) => a.length;
const k = "a", kn = "n", kx = "x";
class Base { constructor(v) { this.v = v; } }
const thrower = { valueOf() { return boom(); }, toString() { return boom(); } };
const c = { a() { return this; }, b() { return undefined; }, boom, n: null, u: undefined, get g() { return boom(); }, set s(v) { boom(); }, Boom: function () { boom(); }, tag() { return boom(); }, thrower, notfn: 1, Base, arr: [1], fn() { return boom; }, id(v) { return v; }, Err: class extends Error {} };
`;

/** The program of the probe, which prints what each of `rows` says as JSON. `templates` has a statement a line, and `#` starts a comment. */
export function generate(templates: string): { rows: string[]; program: string } {
  const transpiler = new Bun.Transpiler({ loader: "js" });
  const names = ["c", "use", "boom", "k", "kn", "kx", "thrower", "Base"];
  // A line break makes some statements another program, or none: a row has to parse as the body of a strict function, for JSC and for Bun.
  const parses = (body: string) => {
    try {
      new Function(...names, `"use strict"; return function f() {\n${body}\n}`);
      transpiler.transformSync(`function f() {\n${body}\n}`);
      return true;
    } catch {
      return false;
    }
  };
  const rows: string[] = [];
  let program = prelude;
  for (const template of templates.split("\n").map(line => line.trim())) {
    if (!template || template.startsWith("#")) continue;
    const tokens = tokenize(template);
    const places = tokens.slice(1).map((_, index) => index);
    const seen = new Set<string>();
    const add = (breaks: Set<number>) => {
      const body = join(tokens, breaks);
      if (seen.has(body) || !parses(body)) return seen.has(body);
      seen.add(body);
      const row = `${template} :: ${layout(tokens, breaks)}`;
      rows.push(row);
      program += `show(${JSON.stringify(row)}, here(), function f() {\n${body}\n});\n`;
      return true;
    };
    add(new Set());
    for (const place of places) add(new Set([place]));
    // Where a line break at every place does not parse, the first line breaks are left out, as many as it takes.
    if (!add(new Set(places))) places.some(left => add(new Set(places.slice(left + 1))));
  }
  return { rows, program: program + "console.log(JSON.stringify(rows));\n" };
}
