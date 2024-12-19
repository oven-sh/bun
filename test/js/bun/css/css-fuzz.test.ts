import { test, expect } from "bun:test";
import { isCI, isDebug } from "harness";

interface InvalidFuzzOptions {
  maxLength: number;
  strategy: "syntax" | "structure" | "encoding" | "memory" | "all";
  iterations: number;
}

const shutup = process.env.CSS_FUZZ_SHUTUP === "1";
const log = shutup ? () => {} : console.log;

// Collection of invalid CSS generation strategies
const invalidGenerators = {
  // Syntax errors
  syntax: {
    unclosedRules: () => `
      .test { color: red
      .another { padding: 10px }`,
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
  } as const,

  // Structural errors
  structure: {
    nestedRules: () => [
      ".outer { .inner { color: red } }", // Invalid nesting without @rules
      "@media screen { @media print { } ", // Unclosed nested at-rule
      "@keyframes { @keyframes { } }", // Invalid nesting of @keyframes
    ],
    malformedAtRules: () => ["@media ;", "@import url('test.css'", "@{color:red}", "@media screen and and {color:red}"],
    invalidImports: () => ["@import 'file' 'screen';", "@import url(;", "@import url('test.css') print"],
  } as const,

  // Encoding and character issues
  encoding: {
    invalidUTF8: () => [
      `.test{content:"${Buffer.from([0xc0, 0x80]).toString()}"}`,
      `.test{content:"${Buffer.from([0xe0, 0x80, 0x80]).toString()}"}`,
      `.test{content:"${Buffer.from([0xf0, 0x80, 0x80, 0x80]).toString()}"}`,
    ],
    nullBytes: () => [`.test{color:red${"\0"};}`, `.te${"\0"}st{color:red}`, `${"\0"}.test{color:red}`],
    controlCharacters: () => {
      const controls = Array.from({ length: 32 }, (_, i) => String.fromCharCode(i));
      return controls.map(char => `.test{color:${char}red}`);
    },
  } as const,

  // Memory and resource stress
  memory: {
    deepNesting: (depth: number = 300) => {
      let css = "";
      for (let i = 0; i < depth; i++) {
        css += "@media screen {";
      }
      css += ".test{color:red}";
      for (let i = 0; i < depth; i++) {
        css += "}";
      }
      return css;
    },
    longSelectors: (length: number = 100000) => {
      const selector = ".test".repeat(length);
      return `${selector}{color:red}`;
    },
    manyProperties: (count: number = 10000) => {
      const properties = Array(count).fill("color:red;").join("\n");
      return `.test{${properties}}`;
    },
  } as const,
} as const;

// Helper to randomly corrupt CSS
function corruptCSS(css: string): string {
  const corruptions = [
    (s: string) => (s + "").replace(/{/g, "}"),
    (s: string) => (s + "").replace(/}/g, "{"),
    (s: string) => (s + "").replace(/:/g, ";"),
    (s: string) => (s + "").replace(/;/g, ":"),
    (s: string) => (s + "").slice(Math.floor(Math.random() * (s + "").length)),
    (s: string) => s + "" + "}}".repeat(Math.floor(Math.random() * 5)),
    (s: string) => (s + "").split("").reverse().join(""),
    (s: string) => (s + "").replace(/[a-z]/g, c => String.fromCharCode(97 + Math.floor(Math.random() * 26))),
  ];

  const numCorruptions = Math.floor(Math.random() * 3) + 1;
  let corrupted = css;

  for (let i = 0; i < numCorruptions; i++) {
    const corruption = corruptions[Math.floor(Math.random() * corruptions.length)];
    corrupted = corruption(corrupted);
  }

  return corrupted;
}

// TODO:
if (!isCI) {
  // Main fuzzing test suite for invalid inputs
  test.each(
    [["syntax", 1000], ["structure", 1000], ["encoding", 500], !isDebug ? ["memory", 100] : []].filter(
      xs => xs.length > 0,
    ),
  )(
    "CSS Parser Invalid Input Fuzzing - %s (%d iterations)",
    async (strategy, iterations) => {
      const options: InvalidFuzzOptions = {
        maxLength: 10000,
        strategy: strategy as any,
        iterations,
      };

      let crashCount = 0;
      let errorCount = 0;
      const startTime = performance.now();

      for (let i = 0; i < options.iterations; i++) {
        let invalidCSS = "";

        switch (strategy) {
          case "syntax":
            invalidCSS =
              invalidGenerators.syntax[
                Object.keys(invalidGenerators.syntax)[
                  Math.floor(Math.random() * Object.keys(invalidGenerators.syntax).length)
                ]
              ]()[Math.floor(Math.random() * 5)];
            break;

          case "structure":
            invalidCSS =
              invalidGenerators.structure[
                Object.keys(invalidGenerators.structure)[
                  Math.floor(Math.random() * Object.keys(invalidGenerators.structure).length)
                ]
              ]()[Math.floor(Math.random() * 3)];
            break;

          case "encoding":
            invalidCSS =
              invalidGenerators.encoding[
                Object.keys(invalidGenerators.encoding)[
                  Math.floor(Math.random() * Object.keys(invalidGenerators.encoding).length)
                ]
              ]()[0];
            break;

          case "memory":
            const memoryFuncs = Object.keys(invalidGenerators.memory);
            const selectedFunc = memoryFuncs[Math.floor(Math.random() * memoryFuncs.length)];
            invalidCSS = invalidGenerators.memory[selectedFunc]();
            break;
        }

        // Further corrupt the CSS randomly
        if (Math.random() < 0.3) {
          invalidCSS = corruptCSS(invalidCSS);
        }

        log("--- CSS Fuzz ---");
        invalidCSS = invalidCSS + "";
        log(JSON.stringify(invalidCSS, null, 2));
        await Bun.write("invalid.css", invalidCSS);

        try {
          const result = await Bun.build({
            entrypoints: ["invalid.css"],
            experimentalCss: true,
            throw: true,
          });

          // We expect the parser to either throw an error or return a valid result
          // If it returns undefined/null, that's a potential issue
          if (result === undefined || result === null) {
            crashCount++;
            console.error(`Parser returned ${result} for input:\n${invalidCSS.slice(0, 100)}...`);
          }
        } catch (error) {
          // Expected behavior for invalid CSS
          errorCount++;

          // Check for specific error types we want to track
          if (error instanceof RangeError || error instanceof TypeError) {
            console.warn(`Unexpected error type: ${error.constructor.name} for input:\n${invalidCSS.slice(0, 100)}...`);
          }
        }

        // Memory check every 100 iterations
        if (i % 100 === 0) {
          const heapUsed = process.memoryUsage().heapUsed / 1024 / 1024;
          expect(heapUsed).toBeLessThan(500); // Alert if memory usage exceeds 500MB
        }
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      console.log(`
    Strategy: ${strategy}
    Total iterations: ${iterations}
    Crashes: ${crashCount}
    Expected errors: ${errorCount}
    Duration: ${duration.toFixed(2)}ms
    Average time per test: ${(duration / iterations).toFixed(2)}ms
  `);

      // We expect some errors for invalid input, but no crashes
      expect(crashCount).toBe(0);
      expect(errorCount).toBeGreaterThan(0);
    },
    10 * 1000,
  );

  // Additional test for mixed valid/invalid input
  test("CSS Parser Mixed Input Fuzzing", async () => {
    const validCSS = ".test{color:red}";

    for (let i = 0; i < 100; i++) {
      const mixedCSS = `
      ${validCSS}
      ${corruptCSS(validCSS)}
      ${validCSS}
    `;

      console.log("--- Mixed CSS ---");
      console.log(JSON.stringify(mixedCSS, null, 2));
      await Bun.write("invalid.css", mixedCSS);

      try {
        await Bun.build({
          entrypoints: ["invalid.css"],
          experimentalCss: true,
        });
      } catch (error) {
        // Expected to throw, but shouldn't crash
        expect(error).toBeDefined();
      }
    }
  });
}
