import { afterAll, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

// In `out = out && run(out, argument)` in a loop, `argument` is checked while the type that the loop gives `out` is not
// complete. What is found then is not kept, except for what nothing finds again later: the types that the parameter
// gives the argument.
const inLoop = (declarations: string, statement: string, out = "number[] | null") =>
  `export {};\ntype Place = { kind: "place"; id: string };\n${declarations}\n` +
  `export function f(xs: number[], ids: string[]) {\n  let out: ${out} = xs;\n  for (const id of ids) {\n    ${statement}\n  }\n  return out;\n}\n`;
const run = (parameter: string) => `declare function run(xs: number[], step: ${parameter}): number[] | null;`;

// A run that checks nothing reports nothing, so one file always has an error.
const sentinel = {
  source: 'export const sentinel: number = "";\n',
  error: "TS2322: Type 'string' is not assignable to type 'number'.",
};

/** The errors that one `bun check` reports for each of `sources`, without their positions. */
async function errorsOfEach(sources: Record<string, string>, strict = true) {
  const tsconfig = JSON.stringify({
    compilerOptions: { strict, noEmit: true, target: "esnext", lib: ["esnext"], types: [] },
    include: ["*.ts"],
  });
  const files = Object.fromEntries(
    Object.entries({ ...sources, sentinel: sentinel.source }).map(([name, source]) => [`${name}.ts`, source]),
  );
  using dir = tempDir("check-argument-behind-a-name-that-a-loop-assigns", { "tsconfig.json": tsconfig, ...files });
  await using proc = spawn({
    cmd: [bunExe(), "check", "--no-pretty"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const errors: Record<string, string[]> = Object.fromEntries(Object.keys(files).map(name => [name.slice(0, -3), []]));
  for (const [, name, error] of stdout.matchAll(/^(.+)\.ts\(\d+,\d+\): error (TS\d+: .*)$/gm)) errors[name].push(error);
  expect({ sentinel: errors.sentinel, exitCode }).toEqual({ sentinel: [sentinel.error], exitCode: 1 });
  delete errors.sentinel;
  return errors;
}

// A loop inside the argument, and behind it `s` is a string.
const ownLoop = 'let s: string | number = 0; while (typeof s === "number") { s = s > 3 ? "x" : s + 1; }';

// [what the argument is, the type of the parameter, the argument]
const argumentsThatTheParameterTypes: [string, string, string][] = [
  ["an object literal", "Place", '{ kind: "place", id }'],
  ["an object literal in another", "{ inner: { deeper: Place } }", '{ inner: { deeper: { kind: "place", id } } }'],
  ["an object literal in a list", "Place[]", '[{ kind: "place", id }]'],
  ["an object literal in parentheses", "Place", '({ kind: "place", id })'],
  ["one of two object literals", "Place", 'id ? { kind: "place", id } : { kind: "place", id: "" }'],
  ["an object literal with a spread", "Place", '{ kind: "place", ...{ id } }'],
  [
    "an object literal with a computed key",
    '{ kind: "place"; [k: string]: string | number }',
    '{ kind: "place", [id]: 1 }',
  ],
  ["an object literal of a number and a boolean", "{ n: 1; b: true }", "{ n: 1, b: true }"],
  ["an object literal of a template", "{ kind: `p-${string}` }", "{ kind: `p-${id}` }"],
  ["an arrow function that returns a text", '() => "place"', '() => "place"'],
  ["an arrow function with a block", '() => "place"', '() => { return "place"; }'],
  ["an arrow function that returns an object literal", "() => Place", '() => ({ kind: "place", id })'],
  [
    "an arrow function that returns one of two object literals",
    '() => Place | { kind: "skip" }',
    '() => id ? { kind: "place", id } : { kind: "skip" }',
  ],
  [
    "an arrow function with two returns",
    '() => Place | { kind: "skip" }',
    '() => { if (id) return { kind: "place", id }; return { kind: "skip" }; }',
  ],
  ["an arrow function that returns another", '() => () => "place"', '() => () => "place"'],
  [
    "an arrow function with a loop of its own",
    '() => "place"',
    '() => { let n = 0; while (n < 3) n++; return "place"; }',
  ],
  [
    "an arrow function that returns what a loop of its own assigns",
    "() => Place",
    `() => { ${ownLoop} return { kind: "place", id: s }; }`,
  ],
  [
    "an object literal with an arrow function that returns what a loop of its own assigns",
    "{ m: () => Place }",
    `{ m: () => { ${ownLoop} return { kind: "place", id: s }; } }`,
  ],
  ["an arrow function that is not null", '() => "place"', '(() => "place")!'],
  ["an async arrow function", '() => Promise<"place">', 'async () => "place"'],
  ["a function expression", '() => "place"', 'function () { return "place"; }'],
  ["an object literal with a method", '{ m(p: Place): "place" }', "{ m(p) { return p.kind; } }"],
  ["an object literal with an arrow function", '{ m: () => "place" }', '{ m: () => "place" }'],
];

test.concurrent(
  "in a loop, an argument behind the name that the loop assigns has the type that its parameter gives it",
  async () => {
    const sources: Record<string, string> = {};
    argumentsThatTheParameterTypes.forEach(([, parameter, argument], index) => {
      const statement = `out = out && run(out, ${argument});`;
      sources[`one-signature-${index}`] = inLoop(run(parameter), statement);
      // A call with two signatures checks its arguments another way, which already gave them these types.
      sources[`two-signatures-${index}`] = inLoop(
        `${run(parameter)} declare function run(xs: string): null;`,
        statement,
      );
    });
    const errors = await errorsOfEach(sources);
    expect(
      Object.fromEntries(
        argumentsThatTheParameterTypes.map(([title], index) => [
          title,
          { oneSignature: errors[`one-signature-${index}`], twoSignatures: errors[`two-signatures-${index}`] },
        ]),
      ),
    ).toEqual(
      Object.fromEntries(
        argumentsThatTheParameterTypes.map(([title]) => [title, { oneSignature: [], twoSignatures: [] }]),
      ),
    );
  },
);

test.concurrent(
  "in a loop, other calls behind the name that the loop assigns have the errors that TypeScript has",
  async () => {
    const place = '{ kind: "place", id }';
    const current = "const current: number[] | null = out;";
    expect(
      await errorsOfEach({
        issue49219: inLoop(
          "declare function placeOne(xs: number[], step: Place): number[] | null;",
          `out = out && placeOne(out, ${place});`,
        ),
        conditional: inLoop(run("Place"), `out = out ? run(out, ${place}) : null;`),
        whileLoop: inLoop(run("Place"), `while (ids.length) out = out && run(out, ${place});`),
        method: inLoop(
          `declare const o: { ${run("Place").slice("declare function ".length)} };`,
          `out = out && o.run(out, ${place});`,
        ),
        constructed: inLoop(
          "declare class C { constructor(xs: number[], step: Place); v: number[] | null; }",
          `out = out && new C(out, ${place}).v;`,
        ),
        optionalCall: inLoop(
          "declare const maybe: undefined | ((xs: number[], step: Place) => number[] | null);",
          `out = out && (maybe?.(out, ${place}) ?? null);`,
        ),
        memberThatReadsTheName: inLoop(
          run('{ kind: "place"; n: number }'),
          'out = out && run(out, { kind: "place", n: out.length });',
        ),
        immediatelyCalledArrow: inLoop(run("Place"), `out = out && run(out, (() => (${place}))());`),
        // The literal is checked for the first time below the argument, and is not part of it.
        literalOutsideTheCall:
          inLoop(run("unknown"), "out = out && run(out, g());") +
          'function g(): typeof o { return o; }\nconst o = { kind: "place", id: "x" };\n' +
          "type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;\n" +
          "export const same: Equals<ReturnType<typeof g> | typeof o, typeof o> = true;\n",
        wrongText: inLoop(run("Place"), 'out = out && run(out, { kind: "nope", id });'),
        wrongTextFromAnArrow: inLoop(run('() => "place"'), 'out = out && run(out, () => "nope");'),
        wrongTextBehindALoopInTheArrow: inLoop(
          run("() => Place"),
          `out = out && run(out, () => { ${ownLoop} return { kind: "nope", id: s }; });`,
        ),
        excessProperty: inLoop(run("Place"), 'out = out && run(out, { kind: "place", id, extra: 1 });'),
        nameWithoutAType: inLoop(run("Place"), `const next = out && run(out, ${place}); out = next;`),
        nameWithoutATypeInTheArrow: inLoop(
          run("() => number[]"),
          "const current = out; out = out && run(out, () => current);",
        ),
        // What these pass depends on the loop, and TypeScript finds it with the loop complete.
        nameInALiteral: inLoop(run("{ v: number[] }"), `${current} out = out && run(out, { v: current });`),
        arrowInAConstant: inLoop(
          run("() => number[]"),
          `${current} const g = () => current; out = out && run(out, g);`,
        ),
        arrowThatSatisfies: inLoop(
          run("() => number[] | null"),
          `${current} out = out && run(out, (() => current) satisfies () => number[]);`,
        ),
        arrowInALiteralThatSatisfies: inLoop(
          `type Opts = { onDone: () => number[] }; ${run("Opts")}`,
          `${current} out = out && run(out, { onDone: () => current } satisfies Opts);`,
        ),
        arrowThatIsNotNull: inLoop(run("() => number[]"), `${current} out = out && run(out, (() => current)!);`),
        arrowInASpread: inLoop(
          run("{ v: () => number[] }"),
          `${current} out = out && run(out, { ...{ v: () => current } });`,
        ),
        arrowInADefault: inLoop(
          run("() => void"),
          `${current} out = out && run(out, (h: () => number[] = () => current) => {});`,
        ),
        arrowThatIsAwaited: inLoop(
          run("() => Promise<() => number[]>"),
          `${current} out = out && run(out, async () => await (() => current));`,
        ),
      }),
    ).toEqual({
      issue49219: [],
      conditional: [],
      whileLoop: [],
      method: [],
      constructed: [],
      optionalCall: [],
      memberThatReadsTheName: [],
      immediatelyCalledArrow: [],
      literalOutsideTheCall: [],
      wrongText: [`TS2322: Type '"nope"' is not assignable to type '"place"'.`],
      wrongTextFromAnArrow: [`TS2322: Type '"nope"' is not assignable to type '"place"'.`],
      wrongTextBehindALoopInTheArrow: [
        `TS2345: Argument of type '() => { kind: "nope"; id: string; }' is not assignable to parameter of type '() => Place'.`,
      ],
      excessProperty: [
        "TS2353: Object literal may only specify known properties, and 'extra' does not exist in type 'Place'.",
      ],
      nameWithoutAType: [
        "TS7022: 'next' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.",
      ],
      nameWithoutATypeInTheArrow: [
        "TS7022: 'current' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.",
        "TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.",
      ],
      nameInALiteral: ["TS2322: Type 'number[] | null' is not assignable to type 'number[]'."],
      arrowInAConstant: [
        "TS2345: Argument of type '() => number[] | null' is not assignable to parameter of type '() => number[]'.",
      ],
      arrowThatSatisfies: ["TS2322: Type 'number[] | null' is not assignable to type 'number[]'."],
      arrowInALiteralThatSatisfies: ["TS2322: Type 'number[] | null' is not assignable to type 'number[]'."],
      arrowThatIsNotNull: [
        "TS2345: Argument of type '() => number[] | null' is not assignable to parameter of type '() => number[]'.",
      ],
      arrowInASpread: [
        "TS2345: Argument of type '{ v: () => number[] | null; }' is not assignable to parameter of type '{ v: () => number[]; }'.",
      ],
      arrowInADefault: ["TS2322: Type 'number[] | null' is not assignable to type 'number[]'."],
      arrowThatIsAwaited: [
        "TS2322: Type 'Promise<() => number[] | null>' is not assignable to type 'Promise<() => number[]>'.",
      ],
    });
  },
);

test.concurrent(
  "without strictNullChecks, an argument behind the name that the loop assigns has the type that its parameter gives it",
  async () => {
    const runOrText = (parameter: string) => run(parameter).replace("| null", "| string");
    expect(
      await errorsOfEach(
        {
          objectLiteral: inLoop(
            runOrText("Place"),
            'out = typeof out === "string" ? out : run(out, { kind: "place", id });',
            "number[] | string",
          ),
          arrow: inLoop(
            runOrText('() => "place"'),
            'out = (typeof out !== "string" && run(out, () => "place")) || "";',
            "number[] | string",
          ),
        },
        false,
      ),
    ).toEqual({ objectLiteral: [], arrow: [] });
  },
);
