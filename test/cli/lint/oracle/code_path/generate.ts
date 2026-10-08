// Random programs that are dense in what the code path analysis cares about: branches, loops, labels, `try`, optional
// chains, default values, generators, classes, and names in every place where ESLint takes one for a reference.
import type { Case } from "../tokens/corpus";

type Scope = {
  /** How much deeper the syntax may nest. */
  depth: number;
  typescript: boolean;
  inFunction: boolean;
  inGenerator: boolean;
  inAsync: boolean;
  inLoop: boolean;
  inSwitch: boolean;
  /** `#p` is declared. */
  inClass: boolean;
  inDerivedConstructor: boolean;
  labels: { name: string; isLoop: boolean }[];
};

export function generate(seed: number, typescript: boolean): string {
  // mulberry32
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const below = (n: number) => Math.floor(random() * n);
  const chance = (p: number) => random() < p;
  const pick = <T>(...them: T[]): T => them[below(them.length)];
  const choose = (...them: (() => string)[]): string => them[below(them.length)]();
  const many = (min: number, max: number, make: () => string, separator: string) =>
    Array.from({ length: min + below(max - min + 1) }, make).join(separator);
  let names = 0;
  const fresh = (prefix = "v") => `${prefix}${++names}`;
  const name = () => pick("a", "b", "c", "d", "e");
  const deeper = (s: Scope, more: Partial<Scope> = {}): Scope => ({ ...s, depth: s.depth - 1, ...more });
  const body = (s: Scope, more: Partial<Scope>): Scope =>
    deeper(s, { inFunction: true, inGenerator: false, inAsync: false, inLoop: false, inSwitch: false, inDerivedConstructor: false, labels: [], ...more }); // prettier-ignore

  const type = (s: Scope): string =>
    s.depth <= 0
      ? pick("T", "number", "A.B", "any")
      : choose(
          () => pick("T", "number", "string", "A.B", "A.B.C", "this", "1", "'x'", "-1", "`a`", "unique symbol"),
          () => `T<${type(deeper(s))}>`,
          () => `${type(deeper(s))}[]`,
          () => `${type(deeper(s))} | ${type(deeper(s))}`,
          () => `typeof ${pick("a", "a.b", "a.b.c")}`,
          () => `{ p: ${type(deeper(s))}; m(q: T): void; [k: string]: any; 'x': 1; readonly r?: T }`,
          () => `(x: ${type(deeper(s))}, ...r: any[]) => ${pick("void", "x is T", "asserts x")}`,
          () => `new () => ${type(deeper(s))}`,
          () => `[n: ${type(deeper(s))}, o?: T, ...T[]]`,
          () => `[${type(deeper(s))}, T?]`,
          () => `{ [K in ${type(deeper(s))}]: K }`,
          () => `${type(deeper(s))} extends infer U ? U : never`,
          () => `import('m').X`,
          () => `keyof ${type(deeper(s))}`,
          () => `T[${type(deeper(s))}]`,
          () => `<G extends T = any>(g: G) => G`,
        );
  const annotation = (s: Scope) => (s.typescript && chance(0.3) ? `: ${type(deeper(s))}` : "");

  const literal = () =>
    pick(
      "0",
      "1",
      "''",
      "'x'",
      "true",
      "false",
      "null",
      "0n",
      "1n",
      "0x0n",
      "/r/",
      "`t`",
      "``",
      "NaN",
      "-1",
      "0.0",
      "1e3",
    );

  const bindingPattern = (s: Scope): string =>
    s.depth <= 0
      ? fresh()
      : choose(
          () => fresh(),
          () => fresh(),
          () =>
            `{ ${many(0, 3, () => `${bindingProperty(deeper(s))}, `, "")}${chance(0.2) ? `...${fresh()}` : ""} }`,
          () =>
            `[${many(0, 3, () => (chance(0.15) ? "" : bindingElement(deeper(s))), ", ")}${chance(0.2) ? `, ...${bindingPattern(deeper(s))}` : ""}]`,
        );
  const bindingElement = (s: Scope) => bindingPattern(s) + (chance(0.4) ? ` = ${expression(deeper(s))}` : "");
  const bindingProperty = (s: Scope) =>
    choose(
      () => fresh(),
      () => `${fresh()} = ${expression(deeper(s))}`,
      () => `${name()}: ${bindingElement(s)}`,
      () => `[${expression(deeper(s))}]: ${bindingElement(s)}`,
      () => `'k': ${bindingElement(s)}`,
    );

  const simpleTarget = (s: Scope) =>
    choose(
      () => name(),
      () => `${name()}.${name()}`,
      () => `${name()}[${expression(deeper(s))}]`,
      () => `${primary(deeper(s))}.${name()}`,
    );
  const assignmentTarget = (s: Scope): string =>
    s.depth <= 0
      ? simpleTarget(s)
      : choose(
          () => simpleTarget(s),
          () =>
            `[${many(0, 3, () => (chance(0.15) ? "" : assignmentElement(deeper(s))), ", ")}${chance(0.2) ? `, ...${assignmentTarget(deeper(s))}` : ""}]`,
          () =>
            `{ ${many(0, 3, () => `${assignmentProperty(deeper(s))}, `, "")}${chance(0.2) ? `...${simpleTarget(s)}` : ""} }`,
        );
  const assignmentElement = (s: Scope) => assignmentTarget(s) + (chance(0.4) ? ` = ${expression(deeper(s))}` : "");
  const assignmentProperty = (s: Scope) =>
    choose(
      () => name(),
      () => `${name()} = ${expression(deeper(s))}`,
      () => `${name()}: ${assignmentElement(s)}`,
      () => `[${expression(deeper(s))}]: ${assignmentElement(s)}`,
    );

  const args = (s: Scope) => many(0, 2, () => (chance(0.15) ? "..." : "") + expression(deeper(s)), ", ");
  const chain = (s: Scope): string => {
    let text = chance(0.7) ? name() : primary(deeper(s));
    for (let i = 1 + below(4); i > 0; i--) {
      text += choose(
        () => `.${name()}`,
        () => `?.${name()}`,
        () => `[${expression(deeper(s))}]`,
        () => `?.[${expression(deeper(s))}]`,
        () => `(${args(s)})`,
        () => `?.(${args(s)})`,
        () => (s.inClass ? pick(".#p", "?.#p") : `.${name()}`),
        () => (s.typescript ? "!" : `?.${name()}`),
        () => (s.typescript ? `<T>(${args(s)})` : "()"),
      );
      if (chance(0.1)) text = `(${text})`;
    }
    return text;
  };

  const parameters = (s: Scope) => many(0, 3, () => bindingElementWithType(s), ", ") + "";
  const bindingElementWithType = (s: Scope) => {
    const pattern = bindingPattern(deeper(s));
    return pattern + annotation(s) + (chance(0.3) ? ` = ${expression(deeper(s))}` : "");
  };
  const block = (s: Scope) => `{ ${many(0, 3, () => statement(deeper(s)), " ")} }`;
  const func = (s: Scope, head: string, more: Partial<Scope> = {}) => {
    const inner = body(s, more);
    return `${head}(${parameters(body(s, {}))})${s.typescript && chance(0.2) ? `: ${type(deeper(s))}` : ""} ${block(inner)}`;
  };
  const functionExpression = (s: Scope) =>
    choose(
      () => func(s, `function ${chance(0.5) ? fresh("f") : ""}`),
      () => func(s, `function* ${chance(0.5) ? fresh("f") : ""}`, { inGenerator: true }),
      () => func(s, "async function ", { inAsync: true }),
      () => func(s, "async function* ", { inAsync: true, inGenerator: true }),
    );
  const arrow = (s: Scope) => {
    const isAsync = chance(0.2);
    const inner = body(s, { inAsync: isAsync, inFunction: s.inFunction });
    const head = `${isAsync ? "async " : ""}(${parameters(body(s, { inFunction: s.inFunction }))}) => `;
    return head + (chance(0.5) ? block(inner) : operand(inner));
  };
  const key = (s: Scope) =>
    choose(
      name,
      name,
      () => `[${expression(deeper(s))}]`,
      () => "'s'",
      () => "1",
      () => "['t']",
    );
  const classBody = (s: Scope, isDerived: boolean) => {
    const inner = deeper(s, { inClass: true });
    const member = () =>
      choose(
        () =>
          `${chance(0.3) ? "static " : ""}${key(inner)}${annotation(s)}${chance(0.7) ? ` = ${expression(body(inner, { inFunction: true }))}` : ""};`,
        () => `static ${block(body(inner, { inFunction: false }))}`,
        () =>
          func(inner, `${chance(0.3) ? "static " : ""}${pick("", "", "get ", "async ", "*")}${key(inner)}`).replace(
            /^(static )?get ([^(]*)\([^]*?\)(: [^{]*)? \{/,
            "$1get $2() {",
          ),
        () => (s.typescript ? `accessor ${name()}${chance(0.5) ? ` = ${expression(body(inner, {}))}` : ""};` : ";"),
        () => (s.typescript ? `${name()}(): void;` : ";"),
        () => (s.typescript ? `[k: string]: any;` : ";"),
        () => (s.typescript ? `declare ${name()}: T;` : ";"),
      );
    const constructor = chance(0.4)
      ? func(inner, "constructor", { inDerivedConstructor: isDerived }).replace(/\): [^{]* \{/, ") {")
      : "";
    return `{ #p = 1; ${constructor} ${many(0, 3, member, " ")} }`;
  };
  const classTail = (s: Scope) => {
    const isDerived = chance(0.5);
    const heritage = isDerived ? ` extends ${chance(0.6) ? name() : `(${expression(deeper(s))})`}` : "";
    return `${heritage}${s.typescript && chance(0.2) ? " implements I, A.B" : ""} ${classBody(s, isDerived)}`;
  };

  const primary = (s: Scope): string =>
    s.depth <= 0
      ? choose(name, literal)
      : choose(
          name,
          name,
          literal,
          () => "this",
          () => `(${expression(deeper(s))})`,
          () => `[${many(0, 3, () => (chance(0.1) ? "" : (chance(0.15) ? "..." : "") + expression(deeper(s))), ", ")}]`,
          () =>
            `({ ${many(
              0,
              3,
              () =>
                choose(
                  name,
                  () => `${key(s)}: ${expression(deeper(s))}`,
                  () => `...${expression(deeper(s))}`,
                  () => func(s, key(s)),
                  () => `get ${key(s)}() ${block(body(s, {}))}`,
                ),
              ", ",
            )} })`,
          () => `(${functionExpression(s)})`,
          () => `(class ${chance(0.5) ? fresh("C") : ""}${classTail(s)})`,
          () => `\`x\${${expression(deeper(s))}}y\${${expression(deeper(s))}}\``,
          () => `${name()}\`q\${${expression(deeper(s))}}\``,
          () => (s.inFunction ? "new.target" : "import.meta"),
          () => "import.meta",
          () => `import(${expression(deeper(s))})`,
          () => `new ${name()}${chance(0.7) ? `(${args(s)})` : ""}`,
          () => `new ${name()}.${name()}(${args(s)})`,
          () => (s.inDerivedConstructor ? `super(${args(s)})` : name()),
          () => (s.inClass && s.inFunction ? `super.${name()}` : name()),
          () => (s.inClass ? `(#p in ${name()})` : name()),
        );
  /** Something that can be an operand of any operator. */
  const operand = (s: Scope): string => (s.depth <= 0 ? primary(s) : choose(() => primary(s), () => chain(s), () => chain(s), () => `(${expression(s)})`)); // prettier-ignore
  const expression = (s: Scope): string =>
    s.depth <= 0
      ? primary(s)
      : choose(
          () => operand(s),
          () => chain(s),
          () => {
            const operator = pick("&&", "||", "??");
            return many(2, 3, () => operand(deeper(s)), ` ${operator} `);
          },
          () => `${operand(deeper(s))} ${pick("+", "===", "<", "in", "instanceof", "**", "|")} ${operand(deeper(s))}`,
          () => `${operand(deeper(s))} ? ${expression(deeper(s))} : ${expression(deeper(s))}`,
          () =>
            `${simpleTarget(s)} ${pick("=", "+=", "&&=", "||=", "??=", "&&=", "||=", "??=")} ${expression(deeper(s))}`,
          () => {
            const target = assignmentTarget(s);
            return `${target.startsWith("{") ? "(" : ""}${target} = ${expression(deeper(s))}${target.startsWith("{") ? ")" : ""}`;
          },
          () => `(${many(2, 4, () => expression(deeper(s)), ", ")})`,
          () => `${pick("!", "-", "typeof ", "void ", "delete ")}${operand(deeper(s))}`,
          () => pick(`++${name()}`, `${name()}--`, `${name()}.${name()}++`),
          () => arrow(s),
          () =>
            s.inGenerator
              ? `(yield${chance(0.8) ? `${chance(0.2) ? "*" : ""} ${expression(deeper(s))}` : ""})`
              : operand(s),
          () => (s.inAsync ? `await ${operand(deeper(s))}` : operand(s)),
          () =>
            s.typescript
              ? choose(
                  () => `${operand(deeper(s))} as ${type(deeper(s))}`,
                  () => `${operand(deeper(s))} as const`,
                  () => `<${pick("const", "T", "A.B")}>${operand(deeper(s))}`,
                  () => `${operand(deeper(s))} satisfies ${type(deeper(s))}`,
                  () => `${operand(deeper(s))}!`,
                  () => `${name()}<${type(deeper(s))}>`,
                )
              : operand(s),
        );

  const test = (s: Scope) => (chance(0.3) ? literal() : expression(deeper(s)));
  const loopBody = (s: Scope, more: Partial<Scope> = {}) => statement(deeper(s, { inLoop: true, ...more }));
  const declaration = (s: Scope) =>
    `${pick("var", "let", "const")} ${many(1, 2, () => `${bindingPattern(deeper(s))}${annotation(s)} = ${expression(deeper(s))}`, ", ")}`;
  const loop = (s: Scope, more: Partial<Scope> = {}): string =>
    choose(
      () => `while (${test(s)}) ${loopBody(s, more)}`,
      () => `do ${loopBody(s, more)} while (${test(s)});`,
      () =>
        `for (${choose(
          () => "",
          () => declaration(s),
          () => many(1, 3, () => expression(deeper(s)), ", ").replace(/\bin\b/g, "<"),
        )}; ${chance(0.7) ? test(s) : ""}; ${chance(0.7) ? many(1, 2, () => expression(deeper(s)), ", ") : ""}) ${loopBody(s, more)}`,
      () =>
        `for (${choose(
          () => `${pick("var", "let", "const")} ${bindingPattern(deeper(s))}`,
          () => assignmentTarget(s),
        )} ${pick("in", "of")} ${operand(deeper(s))}) ${loopBody(s, more)}`,
      () =>
        s.inAsync
          ? `for await (const ${bindingPattern(deeper(s))} of ${operand(deeper(s))}) ${loopBody(s, more)}`
          : `for (;;) ${loopBody(s, more)}`,
    );
  const jump = (s: Scope): string =>
    choose(
      () => (s.inLoop || s.inSwitch ? "break;" : ";"),
      () => (s.inLoop ? "continue;" : ";"),
      () => (s.labels.length ? `break ${pick(...s.labels).name};` : ";"),
      () => {
        const loops = s.labels.filter(it => it.isLoop);
        return loops.length ? `continue ${pick(...loops).name};` : ";";
      },
      () =>
        s.inFunction ? `return${chance(0.6) ? ` ${expression(deeper(s))}` : ""};` : `throw ${expression(deeper(s))};`,
      () => `throw ${expression(deeper(s))};`,
    );
  const statement = (s: Scope): string =>
    s.depth <= 0
      ? choose(
          () => `${name()};`,
          () => `${name()}();`,
          () => jump(s),
          () => ";",
        )
      : choose(
          () => `${expression(s).replace(/^(\{|function|class|let\b|async function)/, "0, $1")};`,
          () => `${expression(s).replace(/^(\{|function|class|let\b|async function)/, "0, $1")};`,
          () =>
            `${many(2, 4, () => expression(deeper(s)), ", ").replace(/^(\{|function|class|let\b|async function)/, "0, $1")};`,
          () => `${declaration(s)};`,
          () => `if (${test(s)}) ${statement(deeper(s))}${chance(0.5) ? ` else ${statement(deeper(s))}` : ""}`,
          () => `if (${test(s)}) ${jump(s)}${chance(0.3) ? ` else ${jump(s)}` : ""}`,
          () => loop(s),
          () => loop(s),
          () => {
            const label = fresh("L");
            return `${label}: ${loop(s, { labels: [...s.labels, { name: label, isLoop: true }] })}`;
          },
          () => {
            const label = fresh("L");
            const inner = deeper(s, { labels: [...s.labels, { name: label, isLoop: false }] });
            return `${label}: ${choose(
              () => block(inner),
              () => statement(inner),
              () => switchStatement(inner),
            )}`;
          },
          () => switchStatement(s),
          () => tryStatement(s),
          () => tryStatement(s),
          () => tryStatement(s),
          () => block(s),
          () => jump(s),
          () => jump(s),
          () => func(s, `function ${fresh("f")}`),
          () => func(s, `function* ${fresh("f")}`, { inGenerator: true }),
          () => func(s, `async function ${fresh("f")}`, { inAsync: true }),
          () => `class ${fresh("C")}${classTail(s)}`,
          () =>
            s.typescript
              ? choose(
                  () => `type ${fresh("T")}<P = any> = ${type(deeper(s))};`,
                  () => `interface ${fresh("I")} extends J, A.B { p: ${type(deeper(s))}; m(): void }`,
                  () => `enum ${fresh("E")} { X, Y = ${expression(deeper(s))}, 'z' = 1 }`,
                  () => `abstract class ${fresh("C")} { abstract p: T; abstract m(): void; abstract accessor q: T; }`,
                  () => `let ${fresh()}: ${type(deeper(s))};`,
                  () => `declare const ${fresh()}: ${type(deeper(s))};`,
                  () => {
                    const f = fresh("f");
                    return `function ${f}(x: T): void; function ${f}(x: any) {}`;
                  },
                )
              : ";",
        );
  const switchStatement = (s: Scope) => {
    const inner = deeper(s, { inSwitch: true });
    let hasDefault = false;
    const clause = () => {
      const isDefault = !hasDefault && chance(0.25);
      hasDefault ||= isDefault;
      return `${isDefault ? "default" : `case ${expression(deeper(inner))}`}: ${many(0, 2, () => statement(inner), " ")}`;
    };
    return `switch (${expression(deeper(s))}) { ${many(0, 4, clause, " ")} }`;
  };
  const tryStatement = (s: Scope) => {
    const kind = below(3);
    const handler =
      kind === 1
        ? ""
        : ` catch ${chance(0.7) ? `(${bindingPattern(deeper(s))}${s.typescript && chance(0.2) ? ": unknown" : ""}) ` : ""}${block(s)}`;
    return `try ${block(s)}${handler}${kind === 0 ? "" : ` finally ${block(s)}`}`;
  };

  const top: Scope = { depth: 3 + below(3), typescript, inFunction: false, inGenerator: false, inAsync: false, inLoop: false, inSwitch: false, inClass: false, inDerivedConstructor: false, labels: [] }; // prettier-ignore
  return many(1, 4, () => statement(top), "\n");
}

export function generatedCases(count: number, firstSeed = 1): Case[] {
  return Array.from({ length: count }, (_, i) => {
    const typescript = i % 2 === 1;
    return {
      id: `generated#${firstSeed + i}`,
      path: typescript ? "file.ts" : "file.js",
      code: generate(firstSeed + i, typescript),
      parser: typescript ? "typescript" : "espree",
      ecmaVersion: 2026,
      sourceType: "module",
      jsx: false,
    };
  });
}

if (import.meta.main) console.log(generate(Number(process.argv[2] ?? 1), process.argv[3] === "ts"));
