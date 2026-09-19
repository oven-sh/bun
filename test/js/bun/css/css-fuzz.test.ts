import { describe, expect, test } from "bun:test";
import { isASAN, isCI, isDebug } from "harness";

const shutup = process.env.CSS_FUZZ_SHUTUP === "1";
const log = shutup ? () => {} : console.log;

// Virtual path of the fuzzed stylesheet, handed to Bun.build through `files` instead of being
// written to disk. It has to be absolute: the bundler asserts that entry points are absolute.
const entrypoint = "/css-fuzz/invalid.css";

// Every generator returns the full list of inputs it contributes; the tables are flattened before
// anything picks from them, so generators are free to contribute any number of inputs.
//
// Inputs are byte strings: each char is one byte of the stylesheet (see expectBuildToFinish). That is
// what lets the encoding strategy feed the parser real invalid UTF-8 rather than the U+FFFD that
// decoding it into a JS string would turn it into.
const invalidGenerators = {
  // Syntax errors
  syntax: {
    unclosedRules: () => [
      `
      .test { color: red
      .another { padding: 10px }`,
    ],
    invalidSelectors: () => [
      "}{color:red}",
      "&*#@.class{color:red}",
      "..double.dot{color:red}",
      ".{color:red}",
      "#{color:red}",
    ],
    malformedProperties: () => [
      ".test{color:}",
      ".test{:red}",
      ".test{color::red}",
      ".test{;color:red}",
      ".test{color:red;;;}",
    ],
    unclosedComments: () => [
      "/* unclosed comment .test{color:red}",
      ".test{color:red} /* unclosed",
      "/**//**//* .test{color:red}",
    ],
  },

  // Structural errors
  structure: {
    nestedRules: () => [
      ".outer { .inner { color: red } }", // Invalid nesting without @rules
      "@media screen { @media print { } ", // Unclosed nested at-rule
      "@keyframes { @keyframes { } }", // Invalid nesting of @keyframes
    ],
    malformedAtRules: () => ["@media ;", "@import url('test.css'", "@{color:red}", "@media screen and and {color:red}"],
    invalidImports: () => ["@import 'file' 'screen';", "@import url(;", "@import url('test.css') print"],
  },

  // Encoding and character issues
  encoding: {
    // Overlong encodings of U+0000: the lead byte announces 2, 3 and 4 byte sequences.
    invalidUTF8: () => [
      '.test{content:"\xc0\x80"}',
      '.test{content:"\xe0\x80\x80"}',
      '.test{content:"\xf0\x80\x80\x80"}',
    ],
    nullBytes: () => [".test{color:red\0;}", ".te\0st{color:red}", "\0.test{color:red}"],
    controlCharacters: () => Array.from({ length: 32 }, (_, i) => `.test{color:${String.fromCharCode(i)}red}`),
  },

  // Memory and resource stress
  memory: {
    deepNesting: () => ["@media screen {".repeat(300) + ".test{color:red}" + "}".repeat(300)],
    longSelectors: () => [`${".test".repeat(100000)}{color:red}`],
    manyProperties: () => [`.test{${Array(10000).fill("color:red;").join("\n")}}`],
  },
} satisfies Record<string, Record<string, () => string[]>>;

type Strategy = keyof typeof invalidGenerators;

// The memory inputs only run on plain release builds: the 300-deep @media input overflows the parser
// thread's stack under ASAN, and the 500 KB selector takes over a second per build on a debug build.
const strategies = (Object.keys(invalidGenerators) as Strategy[]).filter(
  strategy => strategy !== "memory" || !(isDebug || isASAN),
);

function inputsOf(strategy: Strategy): { label: string; css: string }[] {
  return Object.entries(invalidGenerators[strategy]).flatMap(([name, generate]) =>
    generate().map((css, i) => ({ label: `${name}[${i}]`, css })),
  );
}

function describeInput(css: string): string {
  const limit = 100;
  const shown = JSON.stringify(css.slice(0, limit)).replace(
    /[\x7f-\xff]/g,
    byte => `\\x${byte.charCodeAt(0).toString(16)}`,
  );
  return css.length > limit ? `${shown}... (${css.length} bytes)` : shown;
}

// The parser has to finish on every input, either with the one output a single entrypoint produces
// or with a reported error. A crash takes the process down, and a JS exception escaping Bun.build
// rejects even with `throw: false`; both fail the test.
async function expectBuildToFinish(css: string): Promise<"built" | "rejected"> {
  const result = await Bun.build({
    entrypoints: [entrypoint],
    // latin1 maps every char of the byte string to the byte it stands for.
    files: { [entrypoint]: Buffer.from(css, "latin1") },
    throw: false,
  });
  if (result.success) {
    expect(result.outputs).toHaveLength(1);
    return "built";
  }
  expect(result.logs).not.toBeEmpty();
  return "rejected";
}

// Helper to randomly corrupt CSS
function corruptCSS(css: string): string {
  const corruptions = [
    (s: string) => s.replace(/{/g, "}"),
    (s: string) => s.replace(/}/g, "{"),
    (s: string) => s.replace(/:/g, ";"),
    (s: string) => s.replace(/;/g, ":"),
    (s: string) => s.slice(Math.floor(Math.random() * s.length)),
    (s: string) => s + "}}".repeat(Math.floor(Math.random() * 5)),
    (s: string) => s.split("").reverse().join(""),
    (s: string) => s.replace(/[a-z]/g, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))),
  ];

  const numCorruptions = Math.floor(Math.random() * 3) + 1;
  let corrupted = css;

  for (let i = 0; i < numCorruptions; i++) {
    const corruption = corruptions[Math.floor(Math.random() * corruptions.length)];
    corrupted = corruption(corrupted);
  }

  return corrupted;
}

// Every generated input as written, built once each. Unlike the random corruptions below these are
// fixed inputs, so they also run in CI.
describe.each(strategies)("CSS Parser Invalid Input - %s", strategy => {
  test.each(inputsOf(strategy).map(({ label, css }) => [`${label} ${describeInput(css)}`, css]))(
    "%s",
    async (_label, css) => {
      await expectBuildToFinish(css);
    },
  );
});

if (!isCI) {
  // Every iteration is one Bun.build call: about 1ms on a release build and about 50ms on a debug
  // build, where the release counts would run past the test timeout.
  const releaseIterations: Record<Strategy, number> = { syntax: 1000, structure: 1000, encoding: 500, memory: 100 };

  test.each(strategies.map(strategy => [strategy, isDebug ? 50 : releaseIterations[strategy]] as const))(
    "CSS Parser Invalid Input Fuzzing - %s (%d iterations)",
    async (strategy, iterations) => {
      const inputs = inputsOf(strategy);
      const outcomes = { built: 0, rejected: 0 };
      const startTime = performance.now();

      for (let i = 0; i < iterations; i++) {
        const { label, css } = inputs[Math.floor(Math.random() * inputs.length)];
        const corrupted = corruptCSS(css);
        // Logged before the build so that a crash can be traced back to its input.
        log(`--- CSS Fuzz: ${strategy} ${label} ---\n${describeInput(corrupted)}`);
        outcomes[await expectBuildToFinish(corrupted)]++;
      }

      const duration = performance.now() - startTime;
      console.log(`
    Strategy: ${strategy}
    Total iterations: ${iterations}
    Built: ${outcomes.built}
    Rejected: ${outcomes.rejected}
    Duration: ${duration.toFixed(2)}ms
    Average time per test: ${(duration / iterations).toFixed(2)}ms
  `);
    },
  );

  // Additional test for mixed valid/invalid input
  test("CSS Parser Mixed Input Fuzzing", async () => {
    const validCSS = ".test{color:red}";

    for (let i = 0; i < (isDebug ? 10 : 100); i++) {
      const mixedCSS = `
      ${validCSS}
      ${corruptCSS(validCSS)}
      ${validCSS}
    `;

      log(`--- Mixed CSS ---\n${describeInput(mixedCSS)}`);
      await expectBuildToFinish(mixedCSS);
    }
  });
}
