// Random programs of functions in functions, for `bun-lint ast bind-check`: which function encloses a function, and which
// function a `return` or a `yield` belongs to.
//
//   bun functions.ts <count> [seed] > inputs.jsonl
//
// Every kind of function in every place where one can be written: as a statement, as an argument, called at once, returned
// with and without a `;`, as the body of an arrow function, as a member of a class or of an object literal, in a computed key,
// in a decorator, in the default of a parameter or of a part of a pattern, in a static block, in a type.

const [count, seed] = [Number(process.argv[2] ?? 1000), Number(process.argv[3] ?? 1)];
let state = (seed * 2654435761) >>> 0 || 1;
function random(below: number): number {
  state ^= state << 13;
  state >>>= 0;
  state ^= state >>> 17;
  state ^= state << 5;
  state >>>= 0;
  return state % below;
}
const pick = <T>(...all: T[]): T => all[random(all.length)];
const maybe = (text: () => string, one_in = 2) => (random(one_in) === 0 ? text() : "");
const many = (most: number, one: () => string, between = " ") =>
  Array.from({ length: random(most + 1) }, one).join(between);

/// `generator`: a `yield` can be written here. `returns`: so can a `return`.
type Context = { typescript: boolean; generator: boolean; returns: boolean };
let names = 0;
const name = () => `n${names++ % 7}`;
/// What is evaluated once, where it is written, by the function around it.
const outside = (c: Context): Context => c;
/// What is in a function of its own.
const inside = (c: Context, generator = false): Context => ({ ...c, generator, returns: true });
/// The initializer of a field, a static block, a namespace.
const apart = (c: Context): Context => ({ ...c, generator: false, returns: false });

/// `of_member`: of a method or a constructor of a class, where TypeScript has decorators.
function params(depth: number, c: Context, of_member = false): string {
  const p = { ...c, generator: false };
  const decorator = () => (of_member && c.typescript ? maybe(() => `@(${expr(depth - 1, p)}) `, 4) : "");
  const one = () =>
    decorator() +
    pick(
      () => name(),
      () => `${name()} = ${expr(depth - 1, p)}`,
      () => `{ ${name()} = ${expr(depth - 1, p)}, [${expr(depth - 1, p)}]: ${name()} }`,
      () => `[${name()} = ${expr(depth - 1, p)}, [${name()}]]`,
      () => (c.typescript ? `${name()}: ${type(depth - 1, p)}` : name()),
    )();
  return many(2, one, ", ");
}

function type(depth: number, c: Context): string {
  if (depth <= 0) return "T";
  return pick(
    () => "T",
    () => `(${name()}: T) => ${type(depth - 1, c)}`,
    () => `new () => ${type(depth - 1, c)}`,
    () => `{ m(${name()}: ${type(depth - 1, c)}): T; (): T; [k: string]: T; [${expr(depth - 1, apart(c))}]: T }`,
    () => `typeof ${name()}.a`,
    () => `T extends infer U ? ${type(depth - 1, c)} : T`,
  )();
}

function body(depth: number, c: Context): string {
  return `{ ${many(3, () => stmt(depth - 1, c), "\n")} }`;
}

/// The part of a function from its parameters on.
function rest(depth: number, c: Context, generator: boolean, of_member = false): string {
  const result = c.typescript ? maybe(() => `: ${type(depth - 1, c)}`, 4) : "";
  return `(${params(depth, inside(c, generator), of_member)})${result} ${body(depth, inside(c, generator))}`;
}

function members(depth: number, c: Context): string {
  const key = () => pick(name, name, () => `[${expr(depth - 1, outside(c))}]`, () => `#p${names++}`)();
  const decorator = () => maybe(() => `@(${expr(depth - 1, outside(c))}) `, 6);
  const one = () => {
    const generator = random(4) === 0;
    return (
      decorator() +
      maybe(() => "static ", 4) +
      pick(
        () => `${maybe(() => "async ", 5)}${generator ? "*" : ""}${key()}${rest(depth, c, generator, true)}`,
        () => `get ${key()}() ${body(depth, inside(c))}`,
        () => `set ${key()}(${name()}) ${body(depth, inside(c))}`,
        () => `${key()} = ${expr(depth - 1, apart(c))};`,
        () => `${key()};`,
      )()
    );
  };
  const others = [
    () => `static ${body(depth, apart(c))}`,
    () => (c.typescript ? `[k: string]: ${type(depth - 1, c)};` : ""),
  ];
  const constructor = maybe(() => `constructor${rest(depth, c, false, true)}\n`, 4);
  return constructor + many(3, () => (random(5) === 0 ? pick(...others)() : one()), "\n");
}

const heritage = (depth: number, c: Context) => maybe(() => ` extends (${expr(depth - 1, outside(c))})`, 3);

function expr(depth: number, c: Context): string {
  if (depth <= 0) return pick(name(), "1", "this", c.generator ? "(yield)" : "0");
  const e = () => expr(depth - 1, c);
  const generator = random(4) === 0;
  const arrow = () =>
    `${maybe(() => "async ", 5)}${pick(
      () => `(${params(depth, inside(c))})`,
      () => name(),
    )()} => ${pick(
      () => expr(depth - 1, inside(c)),
      () => body(depth, inside(c)),
      () => `(${expr(depth - 1, inside(c))})`,
    )()}`;
  const func = () =>
    `${maybe(() => "async ", 5)}function${generator ? "*" : ""} ${maybe(name)}${rest(depth, c, generator)}`;
  return pick(
    () => name(),
    () => (c.generator ? pick(`(yield ${e()})`, "(yield)", `(yield* ${e()})`) : e()),
    () => `(${arrow()})`,
    () => `(${func()})`,
    () => `(${func()})(${e()})`,
    () => `(${func()}())`,
    () => `(${arrow()})()`,
    () => `${name()}(${many(2, () => pick(e, arrow, func)(), ", ")})`,
    () => `new (${e()})(${e()})`,
    () => `(class ${maybe(name)}${heritage(depth, c)} { ${members(depth, c)} })`,
    () =>
      `({ ${many(
        3,
        () =>
          pick(
            () => `${name()}: ${pick(e, arrow, func)()}`,
            () => `[${e()}]: ${e()}`,
            () => `${generator ? "*" : ""}${pick(name(), `[${e()}]`)}${rest(depth, c, generator)}`,
            () => `get ${pick(name(), `[${e()}]`)}() ${body(depth, inside(c))}`,
            () => `set ${name()}(${name()}) ${body(depth, inside(c))}`,
            () => `...${e()}`,
            () => name(),
          )(),
        ", ",
      )} })`,
    () => `[${many(3, e, ", ")}]`,
    () => `\`a\${${e()}}b\``,
    () => `${name()}\`\${${e()}}\``,
    () => `(${e()} ${pick("+", "&&", "||", ",")} ${e()})`,
    () => `(${e()} ? ${e()} : ${e()})`,
    () => `([${name()} = ${e()}] = ${e()})`,
    () => `${name()}.a?.[${e()}]`,
    () => (c.typescript ? `(${e()} as ${type(depth - 1, c)})` : e()),
    () => (c.typescript ? `(<T,>(${name()}: T) => ${expr(depth - 1, inside(c))})` : e()),
  )();
}

/// What can be the body of an `if` or of a loop. It ends so that anything can follow on the next line.
function simple(depth: number, c: Context): string {
  const e = () => expr(depth, c);
  const returned = () => pick(e, e, () => `function () ${body(depth, inside(c))}`, () => `() => ${expr(depth, inside(c))}`)();
  return pick(
    () => `${e()};`,
    () => (c.returns ? pick(`return ${returned()};`, `return ${returned()}`, "return;", "return") : ";"),
    () => (c.returns ? pick(`return ${returned()};`, `return ${returned()}`, "return;", "return") : `${e()};`),
    () => body(depth, c),
  )();
}

function stmt(depth: number, c: Context): string {
  if (depth <= 0) return simple(0, c);
  const e = () => expr(depth, c);
  const s = () => simple(depth - 1, c);
  const generator = random(4) === 0;
  const unique = () => `u${names++}`;
  return pick(
    s,
    s,
    () => `if (${e()}) ${s()}\nelse ${s()}`,
    () => `if (${e()}) ${s()}`,
    () => `for (const ${name()} of ${e()}) ${s()}`,
    () => `for (let ${name()} = ${e()}; ${e()}; ${e()}) ${s()}`,
    () => `while (${e()}) ${s()}`,
    () => `try ${body(depth, c)} catch (${name()}) ${body(depth, c)} finally ${body(depth, c)}`,
    () => `switch (${e()}) { case ${e()}: ${s()}\ndefault: ${s()} }`,
    () => `l${names++}: ${body(depth, c)}`,
    () => `${maybe(() => "async ", 5)}function${generator ? "*" : ""} ${unique()}${rest(depth, c, generator)}`,
    () => `${maybe(() => `@(${e()}) `, 6)}class ${unique()}${heritage(depth, c)} { ${members(depth, c)} }`,
    () => `var ${pick(name(), `{ ${name()} = ${e()} }`, `[${name()} = ${e()}]`)} = ${e()};`,
    () => `${pick("let", "const")} ${pick(unique(), `{ ${unique()} = ${e()} }`, `[${unique()} = ${e()}]`)} = ${e()};`,
    () => (c.typescript ? `enum ${unique()} { a = ${expr(depth, apart(c))} }` : s()),
    () => (c.typescript && !c.returns ? `namespace ${unique()} ${body(depth, apart(c))}` : s()),
    () => (c.typescript ? `interface ${unique()} { m(${name()}: ${type(depth, c)}): T; [${expr(depth, apart(c))}]: T }` : s()),
    () => (c.typescript ? `type ${unique()} = ${type(depth, c)};` : s()),
    () => (c.typescript && !c.returns ? `declare function ${unique()}(${name()}: ${type(depth, c)}): T;` : s()),
  )();
}

for (let i = 0; i < count; i++) {
  const typescript = random(2) === 0;
  const code = many(3, () => stmt(2 + random(3), { typescript, generator: false, returns: false }), "\n") + "\n";
  console.log(
    JSON.stringify({
      id: `functions-${seed}-${i}`,
      filename: typescript ? "file.ts" : "file.js",
      code,
      sourceType: pick("module", "script", "commonjs"),
    }),
  );
}
