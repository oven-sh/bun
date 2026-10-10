// Seeded fuzz of the transpiler's parser and printer on random valid programs.
// For every program, Bun.Transpiler's output (plain and whitespace-minified)
// must (1) parse with acorn, (2) be a fixed point (transpiling it again
// reproduces it byte for byte) and (3) behave like the input: both are run and
// everything they push to `__out` is compared. Replay a failure with
// BUN_TRANSPILER_FUZZ_SEED=<seed>; soak with BUN_TRANSPILER_FUZZ_ITERS=<n>.
//
// The generator parenthesizes every compound expression, so the printer has to
// decide on its own which parentheses the output needs; that is where (1) and
// (3) bite. Programs are strict-mode clean, always terminate, only `throw`
// inside a `try`, and only use names after they are initialized, so (3) compares
// values rather than exception names.
import { fuzzEnv, Rng } from "_util/fuzz";
import * as acorn from "acorn";
import { expect, test } from "bun:test";

// A debug build spends most of each iteration running acorn and the program itself.
const fuzz = fuzzEnv("BUN_TRANSPILER_FUZZ", 0x78706c72, { release: 300, debug: 10 });

// logLevel "error": transformSync otherwise also throws on lint-style warnings
// (comparing against NaN, for instance), which are deliberate and not under test.
const printer = new Bun.Transpiler({ loader: "js", logLevel: "error" });
const minifier = new Bun.Transpiler({ loader: "js", logLevel: "error", minifyWhitespace: true });

// Every entry is source text for one string literal.
const STRINGS = [
  `"plain"`,
  `'single \\' quote'`,
  `"double \\" quote"`,
  `"both ' and \\" quotes"`,
  `"new\\nline"`,
  `"tab\\tand\\\\backslash"`,
  `"\\u00e9 é 日本 🎉"`,
  `"\\u2028 separator"`,
  `"\\0 nul \\x7f"`,
  `"lone \\uD800 surrogate"`,
  "`back\\`tick and \\${not} a substitution`",
  `"</script>"`,
  `""`,
  `"0"`,
  `"1e3"`,
  `"-0"`,
];

const NUMBERS = [
  "0",
  "1",
  "2",
  "7",
  "255",
  "0.5",
  "0.1",
  ".25",
  "1e3",
  "1.5e-7",
  "1e21",
  "1e22",
  "123456789012345680000",
  "0xff",
  "0o17",
  "0b101",
  "1_000_000",
  "9007199254740993",
  "4294967296",
  "NaN",
  // Known divergence (pinned at the bottom of the file): infinite values are
  // printed as `1 / 0`, which the next pass no longer treats as a primitive.
  // Add "Infinity" and "1e999" here when the pin flips.
];

// `+` is repeated to weight it: it is the operator with the most printing rules
// (string concatenation, `+ +x`, `++`).
const BINARY_OPERATORS = "+ + + - * / % ** == != === !== < > <= >= && || ?? & | ^ << >> >>>".split(" ");
const UNARY_OPERATORS = "- - ! typeof void + ~".split(" ");

const IDENTIFIER = /^\w+$/;

interface Fn {
  name: string;
  arity: number;
}

interface Scope {
  /** Expressions that can be read; identifiers except for `this.v` inside methods. */
  values: string[];
  /** `let` and `var` bindings that may be assigned to. */
  mutable: string[];
  functions: Fn[];
  /** Constructed as `new K(x)`; every instance has `.v` and `.m(y)`, every class has `K.s(y)`. */
  classes: string[];
  /** Block nesting, used to bound the program's size. */
  depth: number;
  inLoop: boolean;
  /** Whether a `throw` here is caught by an enclosing `try`. */
  inTry: boolean;
}

/** A nested scope: declarations made in it do not leak back out. */
function child(scope: Scope, changes: Partial<Scope> = {}): Scope {
  return {
    ...scope,
    values: scope.values.slice(),
    mutable: scope.mutable.slice(),
    functions: scope.functions.slice(),
    classes: scope.classes.slice(),
    depth: scope.depth + 1,
    ...changes,
  };
}

/** Scope for code that runs as its own function: loops and try blocks around it no longer apply. */
function functionScope(scope: Scope, params: readonly string[]): Scope {
  return child(scope, { values: scope.values.concat(params), inLoop: false, inTry: false });
}

/** Scope for code inside a non-arrow function, where `this.v` would no longer mean the instance. */
function rebindsThis(scope: Scope): Scope {
  return { ...scope, values: scope.values.filter(value => IDENTIFIER.test(value)) };
}

class ProgramGenerator {
  private counter = 0;
  /**
   * Known divergence (pinned at the bottom of the file): the unused-expression
   * simplifier needs two passes for a comma inside an unused ternary, so an
   * expression statement (whose value is unused) gets no comma operators.
   * Remove this flag when the pin flips.
   */
  private noComma = false;
  constructor(private rng: Rng) {}

  private fresh(): string {
    return `a${this.counter++}`;
  }

  private list(n: number, make: () => string): string[] {
    const out: string[] = [];
    for (let i = 0; i < n; i++) out.push(make());
    return out;
  }

  private leaf(scope: Scope): string {
    const rng = this.rng;
    if (scope.values.length > 0 && rng.chance(0.45)) return rng.pick(scope.values);
    switch (rng.int(6)) {
      case 0:
        return rng.pick(STRINGS);
      case 1:
        return rng.pick(["true", "false", "null", "undefined"]);
      default:
        return rng.pick(NUMBERS);
    }
  }

  /** An expression; anything with operator precedence of its own comes back parenthesized. */
  private expr(scope: Scope, depth: number): string {
    const rng = this.rng;
    if (depth <= 0) return this.leaf(scope);
    const sub = () => this.expr(scope, depth - 1);
    switch (rng.int(21)) {
      case 0:
      case 1:
      case 2:
        return this.leaf(scope);
      case 3:
      case 4:
      case 5:
        return `(${sub()} ${rng.pick(BINARY_OPERATORS)} ${sub()})`;
      case 6:
        return `(${rng.pick(UNARY_OPERATORS)} ${sub()})`;
      case 7:
        return `(${sub()} ? ${sub()} : ${sub()})`;
      case 8:
        return this.noComma ? sub() : `(${sub()}, ${sub()})`;
      case 9: {
        if (scope.functions.length === 0) return sub();
        const fn = rng.pick(scope.functions);
        const args = this.list(fn.arity, sub);
        if (rng.chance(0.15)) args.push(`...[${sub()}]`);
        return `${fn.name}${rng.chance(0.1) ? "?." : ""}(${args.join(", ")})`;
      }
      case 10: {
        if (scope.classes.length === 0) return sub();
        const cls = rng.pick(scope.classes);
        switch (rng.int(3)) {
          case 0:
            return `new ${cls}(${sub()}).v`;
          case 1:
            return `new ${cls}(${sub()}).m(${sub()})`;
          default:
            return `${cls}.s(${sub()})`;
        }
      }
      case 11: {
        if (scope.mutable.length === 0) return sub();
        const target = rng.pick(scope.mutable);
        if (rng.chance(0.3)) return `(${rng.chance(0.5) ? target + "++" : "--" + target})`;
        return `(${target} ${rng.pick(["=", "+=", "-=", "??=", "||="])} ${sub()})`;
      }
      case 12: {
        const items = this.list(rng.int(4), sub);
        if (rng.chance(0.3)) items.splice(rng.int(items.length + 1), 0, ""); // a hole
        if (rng.chance(0.2)) items.push(`...[${sub()}]`);
        const array = `[${items.join(", ")}]`;
        return rng.chance(0.3) ? `${array}.length` : array;
      }
      case 13: {
        const props = this.list(rng.int(3), () => `${this.fresh()}: ${sub()}`);
        // One key that has to stay quoted and one the printer may unquote.
        if (rng.chance(0.2)) props.push(`"quoted-key": ${sub()}`);
        if (rng.chance(0.2)) props.push(`'${this.fresh()}': ${sub()}`);
        if (rng.chance(0.2)) props.push(`[${sub()}]: ${sub()}`);
        if (rng.chance(0.2))
          props.push(`get ${this.fresh()}() { return ${this.expr(rebindsThis(scope), depth - 1)}; }`);
        if (rng.chance(0.15)) props.push(`...${sub()}`);
        const shorthand = scope.values.filter(v => IDENTIFIER.test(v));
        if (shorthand.length > 0 && rng.chance(0.3)) props.push(rng.pick(shorthand));
        return `({ ${props.join(", ")} })`;
      }
      case 14:
        return `\`${rng.pick(["", "x ", "é "])}\${${sub()}}${rng.pick(["", " y", " $", " \\`", " \\${"])}\``;
      case 15:
        return `${sub()}?.${rng.pick(["length", "v", "[0]"])}`;
      case 16: {
        const param = this.fresh();
        const inner = functionScope(scope, [param]);
        const body = rng.chance(0.3)
          ? `({ ${this.fresh()}: ${this.expr(inner, depth - 1)} })`
          : this.expr(inner, depth - 1);
        return `((${param}) => ${body})(${sub()})`;
      }
      case 17: {
        const inner = rebindsThis(scope);
        const yielded = () => this.expr(inner, depth - 1);
        return `[...(function* () { yield ${yielded()}; yield ${yielded()}; })()]`;
      }
      case 18:
        switch (rng.int(4)) {
          case 0:
            return `/a+b/i.test(String(${sub()}))`;
          case 1:
            return `String(${sub()})`;
          case 2:
            return `Number(${sub()})`;
          default:
            return `Math.max(${sub()}, ${sub()})`;
        }
      case 19:
        return `(${sub()} ${rng.pick(["&&", "||"])} ${sub()} ${rng.pick(["&&", "||"])} ${sub()})`;
      default:
        return `(${sub()} ?? ${sub()})`;
    }
  }

  /** Expression depth for statements: mostly 2, so that programs stay readable when they fail. */
  private depth(): number {
    return this.rng.chance(0.15) ? 3 : this.rng.range(1, 2);
  }

  private block(scope: Scope, changes: Partial<Scope> = {}): string {
    const inner = child(scope, changes);
    return `{\n${this.list(this.rng.range(1, 2), () => this.statement(inner)).join("\n")}\n}`;
  }

  /** A function body in its own scope, ending in a return. */
  private body(scope: Scope, params: readonly string[]): string {
    const inner = functionScope(scope, params);
    const statements = this.list(this.rng.int(3), () => this.statement(inner));
    statements.push(`return ${this.expr(inner, this.depth())};`);
    return `{\n${statements.join("\n")}\n}`;
  }

  /** An expression statement: its value is unused, so the simplifier gets to work on it. */
  private unusedExpression(scope: Scope): string {
    this.noComma = true;
    try {
      return `${this.expr(scope, this.depth())};`;
    } finally {
      this.noComma = false;
    }
  }

  private declaration(scope: Scope): string {
    const name = this.fresh();
    const kind = this.rng.pick(["const", "let", "let", "var"]);
    const code = `${kind} ${name} = ${this.expr(scope, this.depth())};`;
    scope.values.push(name);
    if (kind !== "const") scope.mutable.push(name);
    return code;
  }

  private statement(scope: Scope): string {
    const rng = this.rng;
    const e = () => this.expr(scope, this.depth());
    const push = () => `__out.push(${this.list(rng.range(1, 3), e).join(", ")});`;
    // Deep nesting only gets statements that cannot nest further.
    const kinds = scope.depth > 3 ? 4 : 16;
    switch (rng.int(kinds)) {
      case 0:
      case 1:
        return this.declaration(scope);
      case 2: {
        if (scope.mutable.length === 0) return this.unusedExpression(scope);
        const target = rng.pick(scope.mutable);
        return rng.chance(0.2) ? `${target}++;` : `${target} ${rng.pick(["=", "+=", "*="])} ${e()};`;
      }
      case 3:
        return push();
      case 4:
        return this.unusedExpression(scope);
      case 5: {
        let code = `if (${e()}) ${this.block(scope)}`;
        if (rng.chance(0.3)) code += ` else if (${e()}) ${this.block(scope)}`;
        if (rng.chance(0.5)) code += ` else ${this.block(scope)}`;
        return code;
      }
      case 6: {
        const i = this.fresh();
        const loopBody = { values: scope.values.concat(i), inLoop: true };
        if (rng.chance(0.4))
          return `for (const ${i} of [${this.list(rng.int(4), e).join(", ")}]) ${this.block(scope, loopBody)}`;
        return `for (let ${i} = 0; ${i} < ${rng.int(4)}; ${i}++) ${this.block(scope, loopBody)}`;
      }
      case 7:
        return scope.inLoop ? `if (${e()}) ${rng.pick(["break", "continue"])};` : push();
      case 8:
        return scope.inTry ? `throw ${e()};` : push();
      case 9: {
        // Without a catch clause the try block only runs a finally, so a throw
        // in it would escape.
        const hasCatch = rng.chance(0.85);
        let code = `try ${this.block(scope, { inTry: hasCatch || scope.inTry })}`;
        if (hasCatch) {
          const caught = this.fresh();
          code += rng.chance(0.2)
            ? ` catch ${this.block(scope)}`
            : ` catch (${caught}) ${this.block(scope, { values: scope.values.concat(caught) })}`;
        }
        if (!hasCatch || rng.chance(0.3)) code += ` finally ${this.block(scope)}`;
        return code;
      }
      case 10: {
        // Each case gets its own scope: a binding declared in one case is in
        // its temporal dead zone when the switch jumps straight to another.
        const clause = (label: string) =>
          `${label}:\n${this.statement(child(scope))}${rng.chance(0.7) ? "\nbreak;" : ""}`;
        const clauses = this.list(rng.range(1, 3), () => clause(`case ${this.expr(scope, 2)}`));
        if (rng.chance(0.6)) clauses.splice(rng.int(clauses.length + 1), 0, clause("default"));
        return `switch (${e()}) {\n${clauses.join("\n")}\n}`;
      }
      case 11: {
        // Function declarations stay at the top level: inside a block, sloppy
        // and strict code hoist them differently.
        if (scope.depth > 0) return push();
        const name = this.fresh();
        const names = this.list(rng.int(3), () => this.fresh());
        const params = names.slice();
        // Callers pass only the plain parameters, so a default or rest parameter gets exercised.
        const arity = params.length;
        if (rng.chance(0.2)) {
          names.push(this.fresh());
          params.push(`${names.at(-1)} = ${this.expr(scope, 1)}`);
        }
        if (rng.chance(0.15)) {
          names.push(this.fresh());
          params.push(`...${names.at(-1)}`);
        }
        const code = `function ${name}(${params.join(", ")}) ${this.body(scope, names)}`;
        scope.functions.push({ name, arity });
        return code;
      }
      case 12: {
        const name = this.fresh();
        const params = this.list(rng.int(3), () => this.fresh());
        const head = params.length === 1 && rng.chance(0.5) ? params[0] : `(${params.join(", ")})`;
        const body = rng.chance(0.5) ? this.body(scope, params) : this.expr(functionScope(scope, params), 2);
        scope.functions.push({ name, arity: params.length });
        return `const ${name} = ${head} => ${body};`;
      }
      case 13: {
        const name = this.fresh();
        const [x, y, z] = [this.fresh(), this.fresh(), this.fresh()];
        const inConstructor = functionScope(scope, [x]);
        const inMethod = functionScope(scope, ["this.v", y]);
        const inStatic = functionScope(scope, [z]);
        const code =
          `class ${name} {\n` +
          (rng.chance(0.5) ? `${this.fresh()} = ${this.expr(functionScope(scope, []), 1)};\n` : "") +
          `constructor(${x}) { this.v = ${this.expr(inConstructor, 2)}; }\n` +
          `m(${y}) { return ${this.expr(inMethod, 2)}; }\n` +
          (rng.chance(0.4) ? `get ${this.fresh()}() { return this.v; }\n` : "") +
          `static s(${z}) { return ${this.expr(inStatic, 2)}; }\n` +
          `}`;
        scope.classes.push(name);
        return code;
      }
      case 14: {
        const [p, q, rest] = [this.fresh(), this.fresh(), this.fresh()];
        const code = rng.chance(0.5)
          ? `const [${p}, , ${q} = ${e()}, ...${rest}] = [${this.list(rng.range(1, 4), e).join(", ")}];`
          : `const { k: ${p}, j: ${q} = ${e()}, ...${rest} } = { k: ${e()}${rng.chance(0.5) ? `, j: ${e()}` : ""}, n: ${e()} };`;
        scope.values.push(p, q, rest);
        return code;
      }
      default:
        return this.declaration(scope);
    }
  }

  program(): string {
    const scope: Scope = { values: [], mutable: [], functions: [], classes: [], depth: 0, inLoop: false, inTry: false };
    const statements = this.list(this.rng.range(2, 7), () => this.statement(scope));
    if (scope.values.length > 0) statements.push(`__out.push(${scope.values.join(", ")});`);
    return statements.join("\n") + "\n";
  }
}

/** Serializes a value the program produced; -0, holes and key order are all significant. */
function show(value: unknown, depth = 0): string {
  switch (typeof value) {
    case "number":
      return Object.is(value, -0) ? "-0" : String(value);
    case "string":
      return JSON.stringify(value);
    case "function":
      return "[function]";
    case "object": {
      if (value === null) return "null";
      // A getter can return the object that holds it, so nesting is capped.
      if (depth > 8) return "<deep>";
      if (Array.isArray(value)) {
        const items: string[] = [];
        for (let i = 0; i < value.length; i++) items.push(i in value ? show(value[i], depth + 1) : "<hole>");
        return `[${items.join(", ")}]`;
      }
      const record = value as Record<string, unknown>;
      return `{${Object.keys(record)
        .map(key => `${JSON.stringify(key)}: ${show(record[key], depth + 1)}`)
        .join(", ")}}`;
    }
    default:
      return String(value);
  }
}

const UNCAUGHT = " then uncaught ";

/** Runs a program and returns what it pushed to `__out`, plus the class of any exception that escaped. */
function run(code: string): string {
  const out: unknown[] = [];
  try {
    new Function("__out", code)(out);
  } catch (error: any) {
    return `${show(out)}${UNCAUGHT}${error?.constructor?.name ?? show(error)}`;
  }
  return show(out);
}

function failure(message: string, sections: Record<string, string>): Error {
  let text = message;
  for (const [title, content] of Object.entries(sections)) text += `\n--- ${title} ---\n${content.trimEnd()}`;
  return new Error(text);
}

/** The first line on which two texts differ, for the top of a failure message. */
function firstDifference(a: string, b: string): string {
  const as = a.split("\n");
  const bs = b.split("\n");
  for (let i = 0; i < Math.max(as.length, bs.length); i++) {
    if (as[i] !== bs[i]) return `line ${i + 1}:\n  ${as[i] ?? "<missing>"}\n  ${bs[i] ?? "<missing>"}`;
  }
  return "(identical)";
}

/** The three checks for one transpiler configuration; `expected` is what the source itself produced. */
function check(
  transpiler: Bun.Transpiler,
  title: string,
  source: string,
  expected: string,
  sections: Record<string, string>,
) {
  let output: string;
  try {
    output = transpiler.transformSync(source);
  } catch (error) {
    throw failure(`${title}: transformSync rejected a generated program: ${error}`, sections);
  }
  try {
    acorn.parse(output, { ecmaVersion: "latest", sourceType: "module" });
  } catch (error) {
    throw failure(`${title} output does not parse: ${error}`, { ...sections, [title]: output });
  }
  const again = transpiler.transformSync(output);
  if (again !== output) {
    throw failure(`transpiling the ${title} output changed it, first at ${firstDifference(output, again)}`, {
      ...sections,
      [title]: output,
      [`${title} again`]: again,
    });
  }
  const actual = run(output);
  if (actual !== expected) {
    throw failure(`the ${title} output behaves differently`, {
      ...sections,
      [title]: output,
      "source produced": expected,
      [`${title} produced`]: actual,
    });
  }
}

test(`transpiler output parses, is a fixed point and behaves like its input ${fuzz.label}`, () => {
  const generator = new ProgramGenerator(new Rng(fuzz.seed));
  let completed = 0;
  for (let i = 0; i < fuzz.iters; i++) {
    const source = generator.program();
    const sections = { source, repro: fuzz.repro(i) };
    const expected = run(source);
    if (!expected.includes(UNCAUGHT)) completed++;
    check(printer, "printed", source, expected, sections);
    check(minifier, "minified", source, expected, sections);
  }
  console.log(
    `transpiler-differential-fuzz: ${fuzz.iters} programs checked, ${completed} ran without an uncaught exception`,
  );
  // An escaping exception is compared too, but it cuts the program's output
  // short; the generator is meant to keep programs from throwing at all.
  expect(completed).toBeGreaterThan(fuzz.iters * 0.9);
});

// The programs the generator steers around, put through the same checks. Each
// has a fix in flight; when a pin starts passing, delete it and undo the
// exclusion it names.
function pin(source: string): void {
  const sections = { source };
  const expected = run(source);
  check(printer, "printed", source, expected, sections);
  check(minifier, "minified", source, expected, sections);
}

test.failing("known divergence: comparing against an infinite value is not a fixed point (NUMBERS)", () => {
  pin('__out.push("a" != Infinity);\n');
});

test.failing("known divergence: an unused ternary with a comma test takes two passes to simplify (noComma)", () => {
  pin("let a = 1, b = 2;\nconst f = () => __out.push(a);\n(a, b) ? f() : 0;\n");
});
