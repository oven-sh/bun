// Writes random functions that assign to a few local variables and read them, in all kinds of control flow: what
// `no-useless-assignment`, `no-useless-return`, `no-unreachable-loop` and `require-atomic-updates` are about. For
// comparing two builds of `bun-lint`, or one with ESLint, on all the messages of these rules.
//
//   bun flows.ts <directory> [files] [first seed]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function functionText(seed: number, name: string): string {
  let state = (seed * 2654435761) >>> 0 || 1;
  const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0), state / 4294967296);
  const chance = (p: number) => random() < p;
  const pick = <T>(...all: T[]): T => all[Math.floor(random() * all.length)];
  const choose = (...all: (() => string)[]) => pick(...all)();
  let fresh = 0;
  const declared = ["x", "y", "z", "p", "q"];
  const variable = () => pick(...declared);

  const expression = (depth: number): string =>
    depth <= 0 || chance(0.45)
      ? choose(variable, variable, variable, () => pick("0", "1", "f()", "g", "true", "null", "''"))
      : choose(
          () => `${expression(depth - 1)} + ${expression(depth - 1)}`,
          () => `f(${expression(depth - 1)})`,
          () => `f(${expression(depth - 1)}, ${expression(depth - 1)})`,
          () => `(${variable()} = ${expression(depth - 1)})`,
          () => `(${variable()} ${pick("+=", "||=", "&&=", "??=")} ${expression(depth - 1)})`,
          () => `${expression(depth - 1)} ${pick("&&", "||", "??")} (${expression(depth - 1)})`,
          () => `(${expression(depth - 1)} ? ${expression(depth - 1)} : ${expression(depth - 1)})`,
          () => `${variable()}${pick("++", "--")}`,
          () => `${variable()}.a`,
          () => `${variable()}?.[${expression(depth - 1)}]`,
          () => `[${expression(depth - 1)}, ${expression(depth - 1)}]`,
          () => (chance(0.15) ? `() => ${expression(depth - 1)}` : variable()),
          () => (chance(0.1) ? `function () { ${statements(1, [], false, false)} }` : variable()),
          () => (isAsync ? `await ${expression(depth - 1)}` : variable()),
        );

  const target = (depth: number): string =>
    depth <= 0 || chance(0.7)
      ? variable()
      : choose(
          () => `[${target(depth - 1)}, ${target(depth - 1)}]`,
          () => `[${target(depth - 1)} = ${expression(1)}, ...${variable()}]`,
          () => `{ a: ${target(depth - 1)}, ${variable()} }`,
          () => `{ ${variable()} = ${expression(1)} }`,
        );

  const block = (depth: number, labels: string[], inLoop: boolean, inSwitch: boolean) =>
    `{ ${statements(depth, labels, inLoop, inSwitch)} }`;
  const body = (depth: number, labels: string[], inLoop: boolean, inSwitch: boolean) =>
    chance(0.75) ? block(depth, labels, inLoop, inSwitch) : statement(depth, labels, inLoop, inSwitch, false);

  function statements(depth: number, labels: string[], inLoop: boolean, inSwitch: boolean): string {
    const before = declared.length;
    let text = "";
    for (let count = Math.floor(random() * 4); count >= 0; count--) text += statement(depth, labels, inLoop, inSwitch, true) + " "; // prettier-ignore
    declared.length = before;
    return text;
  }

  function statement(depth: number, labels: string[], inLoop: boolean, inSwitch: boolean, inList: boolean): string {
    const simple = () =>
      choose(
        () => `${variable()} = ${expression(2)};`,
        () => `${variable()} = ${expression(2)};`,
        () => `${variable()} = ${expression(1)};`,
        () => `${variable()} ${pick("+=", "-=", "||=", "??=")} ${expression(1)};`,
        () => `${variable()}${pick("++", "--")};`,
        () => `f(${variable()});`,
        () => `f(${expression(2)});`,
        () => `${expression(2)};`,
        () => (chance(0.5) ? `[${target(1)}, ${target(1)}] = ${expression(1)};` : `({ a: ${target(1)}, ${variable()} } = ${expression(1)});`), // prettier-ignore
        () => {
          if (!inList) return ";";
          const name = `v${++fresh}`;
          const text = `${pick("let", "const", "var")} ${name} = ${expression(2)};`;
          declared.push(name);
          return text;
        },
        () => {
          if (!inList) return ";";
          const [a, b] = [`v${++fresh}`, `v${++fresh}`];
          const text = choose(
            () => `let ${a}, ${b} = ${expression(1)};`,
            () => `let ${a} = ${expression(1)}, ${b} = ${chance(0.5) ? a : expression(1)};`,
            () => `const { ${a}, k: ${b} = ${expression(1)} } = ${expression(1)};`,
            () => `let [${a}, ${b}] = ${expression(1)};`,
          );
          declared.push(a, b);
          return text;
        },
        () => (chance(0.5) ? "return;" : `return ${expression(1)};`),
        () => (chance(0.3) ? `throw ${expression(1)};` : ";"),
        () => (inLoop || inSwitch ? "break;" : `f(${variable()});`),
        () => (inLoop ? "continue;" : `f(${variable()});`),
        () => (labels.length > 0 ? `break ${pick(...labels)};` : ";"),
      );
    if (depth <= 0 || chance(0.5)) return simple();
    const d = depth - 1;
    return choose(
      () => `if (${expression(1)}) ${body(d, labels, inLoop, inSwitch)}`,
      () => `if (${expression(1)}) ${body(d, labels, inLoop, inSwitch)} else ${body(d, labels, inLoop, inSwitch)}`,
      () => `if (${expression(2)}) ${block(d, labels, inLoop, inSwitch)} else if (${expression(1)}) ${block(d, labels, inLoop, inSwitch)} else ${block(d, labels, inLoop, inSwitch)}`, // prettier-ignore
      () => `while (${chance(0.15) ? "true" : expression(2)}) ${body(d, labels, true, false)}`,
      () => `do ${body(d, labels, true, false)} while (${chance(0.1) ? "true" : expression(1)});`,
      () => `for (${chance(0.7) ? `${variable()} = ${expression(1)}` : ""}; ${chance(0.8) ? expression(1) : ""}; ${chance(0.7) ? pick(`${variable()}++`, `${variable()} = ${expression(1)}`, expression(1)) : ""}) ${body(d, labels, true, false)}`, // prettier-ignore
      () => {
        const name = `v${++fresh}`;
        declared.push(name);
        const text = `for (let ${name} = ${expression(1)}; ${expression(1)}; ${pick(`${name}++`, expression(1), "")}) ${body(d, labels, true, false)}`; // prettier-ignore
        declared.pop();
        return text;
      },
      () => {
        const name = `v${++fresh}`;
        const iterated = expression(1);
        declared.push(name);
        const text = `for (${pick("const", "let", "var")} ${name} ${pick("of", "in")} ${iterated}) ${body(d, labels, true, false)}`; // prettier-ignore
        declared.pop();
        return text;
      },
      () => `for (${target(1)} ${pick("of", "in")} ${expression(1)}) ${body(d, labels, true, false)}`,
      () => {
        let text = `switch (${expression(1)}) { `;
        let hasDefault = false;
        for (let count = Math.floor(random() * 4); count > 0; count--) {
          const isDefault = !hasDefault && chance(0.25);
          hasDefault ||= isDefault;
          text += `${isDefault ? "default" : `case ${expression(1)}`}: ${chance(0.85) ? statements(d, labels, inLoop, true) : ""}${chance(0.6) ? "break; " : ""}`; // prettier-ignore
        }
        return text + "}";
      },
      () => `try ${block(d, labels, inLoop, inSwitch)} catch ${chance(0.5) ? "(e) " : ""}${block(d, labels, inLoop, inSwitch)}`, // prettier-ignore
      () => `try ${block(d, labels, inLoop, inSwitch)} finally ${block(d, labels, inLoop, inSwitch)}`,
      () => `try ${block(d, labels, inLoop, inSwitch)} catch ${block(d, labels, inLoop, inSwitch)} finally ${block(d, labels, inLoop, inSwitch)}`, // prettier-ignore
      () => block(d, labels, inLoop, inSwitch),
      () => {
        const label = `L${++fresh}`;
        return `${label}: ${body(d, [...labels, label], inLoop, inSwitch)}`;
      },
      () => {
        const label = `L${++fresh}`;
        const inner = statements(d, [...labels, label], true, false);
        return `${label}: while (${expression(1)}) { ${inner}${chance(0.4) ? `continue ${label}; ` : ""}}`;
      },
    );
  }

  const isAsync = chance(0.2);
  return `${isAsync ? "async " : ""}function ${name}(p, q = 0) { let x = ${expression(0)}, y; var z = 0; ${statements(3, [], false, false)}${statements(3, [], false, false)}}`; // prettier-ignore
}

const [directory = ".", files = "1000", first = "1"] = process.argv.slice(2);
mkdirSync(directory, { recursive: true });
for (let file = 0; file < Number(files); file++) {
  let text = "";
  for (let i = 0; i < 20; i++) text += functionText(Number(first) + file * 20 + i, `w${i}`) + "\n";
  writeFileSync(join(directory, `flows${file}.js`), text);
}
