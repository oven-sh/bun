import { itBundled } from "./expectBundled";
import { describe, expect } from "bun:test";

describe("bundler", () => {
  itBundled("minify/TemplateStringFolding", {
    // TODO: https://github.com/oven-sh/bun/issues/4217
    todo: true,

    files: {
      "/entry.js": /* js */ `
        capture(\`\${1}-\${2}-\${3}-\${null}-\${undefined}-\${true}-\${false}\`);
        capture(\`\\uD83D\\uDE0B \\uD83D\\uDCCB \\uD83D\\uDC4C\`.length)
        capture(\`\\uD83D\\uDE0B \\uD83D\\uDCCB \\uD83D\\uDC4C\`.length === 8)
        capture(\`\\uD83D\\uDE0B \\uD83D\\uDCCB \\uD83D\\uDC4C\`.length == 8)
        capture(\`\\uD83D\\uDE0B \\uD83D\\uDCCB \\uD83D\\uDC4C\`.length === 1)
        capture(\`\\uD83D\\uDE0B \\uD83D\\uDCCB \\uD83D\\uDC4C\`.length == 1)
        capture("\\uD83D\\uDE0B \\uD83D\\uDCCB \\uD83D\\uDC4C".length)
        capture("\\uD83D\\uDE0B \\uD83D\\uDCCB \\uD83D\\uDC4C".length === 8)
        capture("\\uD83D\\uDE0B \\uD83D\\uDCCB \\uD83D\\uDC4C".length == 8)
        capture("\\uD83D\\uDE0B \\uD83D\\uDCCB \\uD83D\\uDC4C".length === 1)
        capture("\\uD83D\\uDE0B \\uD83D\\uDCCB \\uD83D\\uDC4C".length == 1)
        capture('\\uD83D\\uDE0B \\uD83D\\uDCCB \\uD83D\\uDC4C'.length)
        capture('\\uD83D\\uDE0B \\uD83D\\uDCCB \\uD83D\\uDC4C'.length === 8)
        capture('\\uD83D\\uDE0B \\uD83D\\uDCCB \\uD83D\\uDC4C'.length == 8)
        capture('\\uD83D\\uDE0B \\uD83D\\uDCCB \\uD83D\\uDC4C'.length === 1)
        capture('\\uD83D\\uDE0B \\uD83D\\uDCCB \\uD83D\\uDC4C'.length == 1)
        capture(\`😋📋👌\`.length === 6)
        capture(\`😋📋👌\`.length == 6)
        capture(\`😋📋👌\`.length === 2)
        capture(\`😋📋👌\`.length == 2)
      `,
    },
    capture: [
      '"1-2-3-null-undefined-true-false"',
      "8",
      "!0",
      "!0",
      "!1",
      "!1",
      "8",
      "!0",
      "!0",
      "!1",
      "!1",
      "8",
      "!0",
      "!0",
      "!1",
      "!1",
      "!0",
      "!0",
      "!1",
      "!1",
    ],
    minifySyntax: true,
    target: "bun",
  });
  itBundled("minify/StringAdditionFolding", {
    files: {
      "/entry.js": /* js */ `
        capture("Objects are not valid as a React child (found: " + (childString === "[object Object]" ? "object with keys {" + Object.keys(node).join(", ") + "}" : childString) + "). " + "If you meant to render a collection of children, use an array " + "instead.")
      `,
    },
    capture: [
      '"Objects are not valid as a React child (found: " + (childString === "[object Object]" ? "object with keys {" + Object.keys(node).join(", ") + "}" : childString) + "). If you meant to render a collection of children, use an array instead."',
    ],
    minifySyntax: true,
  });
  itBundled("minify/FunctionExpressionRemoveName", {
    todo: true,
    files: {
      "/entry.js": /* js */ `
        capture(function remove() {});
        capture(function() {});
        capture(function rename_me() { rename_me() });
      `,
    },
    // capture is pretty stupid and will stop at first )
    capture: ["function(", "function(", "function e("],
    minifySyntax: true,
    minifyIdentifiers: true,
    target: "bun",
  });
  itBundled("minify/PrivateIdentifiersNameCollision", {
    files: {
      "/entry.js": /* js */ `
        class C {
          ${new Array(500)
            .fill(null)
            .map((_, i) => `#identifier${i} = 123;`)
            .join("\n")}
          a = 456;

          getAllValues() {
            return [
              ${new Array(500)
                .fill(null)
                .map((_, i) => `this.#identifier${i}`)
                .join(",")}
            ]
          }
        }
        
        const values = new C().getAllValues();
        for (const value of values) {
          if(value !== 123) { throw new Error("Expected 123!"); }
        }

        console.log("a = " + new C().a);
      `,
    },
    minifyIdentifiers: true,
    run: { stdout: "a = 456" },
  });
  itBundled("minify/MergeAdjacentVars", {
    files: {
      "/entry.js": /* js */ `
        var a = 1;
        var b = 2;
        var c = 3;
        
        // some code to prevent inlining
        a = 4;
        console.log(a, b, c)
        b = 5;
        console.log(a, b, c)
        c = 6;
        console.log(a, b, c)
      `,
    },
    minifySyntax: true,
    run: { stdout: "4 2 3\n4 5 3\n4 5 6" },
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      expect([...code.matchAll(/var /g)]).toHaveLength(1);
    },
  });
  itBundled("minify/Infinity", {
    files: {
      "/entry.js": /* js */ `
        capture(Infinity);
        capture(-Infinity);
        capture(Infinity + 1);
        capture(-Infinity - 1);
        capture(Infinity / 0);
        capture(-Infinity / 0);
        capture(Infinity * 0);
        capture(-Infinity * 0);
        capture(Infinity % 1);
        capture(-Infinity % 1);
        capture(Infinity ** 1);
        capture(-(Infinity ** 1));
        capture(~Infinity);
        capture(~-Infinity);
      `,
    },
    capture: [
      "1 / 0",
      "-1 / 0",
      "1 / 0",
      "-1 / 0",
      "1 / 0",
      "-1 / 0",
      "NaN",
      "NaN",
      "NaN",
      "NaN",
      "1 / 0",
      "-1 / 0",
      "-1",
      "-1",
    ],
    minifySyntax: true,
  });
  itBundled("minify+whitespace/Infinity", {
    files: {
      "/entry.js": /* js */ `
        capture(Infinity);
        capture(-Infinity);
        capture(Infinity + 1);
        capture(-Infinity - 1);
        capture(Infinity / 0);
        capture(-Infinity / 0);
        capture(Infinity * 0);
        capture(-Infinity * 0);
        capture(Infinity % 1);
        capture(-Infinity % 1);
        capture(Infinity ** 1);
        capture((-Infinity) ** 2);
        capture(~Infinity);
        capture(~-Infinity);
      `,
    },
    capture: ["1/0", "-1/0", "1/0", "-1/0", "1/0", "-1/0", "NaN", "NaN", "NaN", "NaN", "1/0", "1/0", "-1", "-1"],
    minifySyntax: true,
    minifyWhitespace: true,
  });
  itBundled("minify/InlineArraySpread", {
    files: {
      "/entry.js": /* js */ `
        capture([1, 2, ...[3, 4], 5, 6, ...[7, ...[...[...[...[8, 9]]]]], 10, ...[...[...[...[...[...[...[11]]]]]]]]);
        capture([1, 2, ...[3, 4], 5, 6, ...[7, [...[...[...[8, 9]]]]], 10, ...[...[...[...[...[...[...11]]]]]]]);
      `,
    },
    capture: ["[1,2,3,4,5,6,7,8,9,10,11]", "[1,2,3,4,5,6,7,[8,9],10,...11]"],
    minifySyntax: true,
    minifyWhitespace: true,
  });
  itBundled("minify/ForAndWhileLoopsWithMissingBlock", {
    files: {
      "/entry.js": /* js */ `
        {
          var n = 0;
          for (let i = 0; i < 10; i++) i;
        }
        {
          var j = 0;
          for (let i in [1, 2, 3]) i;
        }
        {
          var k = 0;
          for (let i of [1, 2, 3]) i;
        }
        console.log("PASS");
      `,
    },
    minifyWhitespace: true,
    run: {
      stdout: "PASS",
    },
  });
  itBundled("minify/MissingExpressionBlocks", {
    files: {
      "/entry.js": /* js */ `
        var r = 1;
        var g;
        g = () => {
          if (r) {
            undefined;
          }
        };
        
        g = () => {
          if (r) {
          } else if (r) {
            undefined;
          }
        };
        
        g = () => {
          if (r) {
            undefined;
          } else if (r) {
            undefined;
          }
        };
        
        g = () => {
          if (r) {
          } else if (r) {
          } else {
            undefined;
          }
        };
        
        g = () => {
          if (r) {
          } else if (r) {
            undefined;
          } else {
          }
        };
        
        g = () => {
          if (r) {
            undefined;
          } else if (r) {
          } else {
          }
        };
        
        g = () => {
          if (r) {
            undefined;
          } else if (r) {
            undefined;
          } else {
          }
        };
        
        g = () => {
          if (r) {
            undefined;
          } else if (r) {
            undefined;
          } else {
            undefined;
          }
        };
        
        g = () => {
          if (r) {
            undefined;
          } else if (r) {
          } else {
            undefined;
          }
        };
        
        g = () => {
          while (r) {
            undefined;
          }
        };
        
        g = () => {
          do undefined;
          while (r);
        };
        
        g = () => {
          for (;;) undefined;
        };
        
        g = () => {
          for (let i = 0; i < 10; i++) undefined;
        };
        g = () => {
          for (let i in [1, 2, 3]) undefined;
        };
        g = () => {
          for (let i of [1, 2, 3]) undefined;
        };
        
        g = () => {
          switch (r) {
            case 1:
              undefined;
            case 23: {
              undefined;
            }
          }
        };
        
        g = () => {
          let gg;
          gg = () => undefined;
        };
        
        console.log("PASS");
      `,
    },
    minifyWhitespace: true,
    minifySyntax: true,
    run: {
      stdout: "PASS",
    },
  });
  // https://github.com/oven-sh/bun/issues/5501
  itBundled("minify/BunRequireStatement", {
    files: {
      "/entry.js": /* js */ `
        export function test(ident) {
          return require(ident);
        }

        test("fs");
        console.log("PASS");
      `,
    },
    minifyWhitespace: true,
    minifySyntax: true,
    minifyIdentifiers: true,
    target: "bun",
    backend: "cli",
    run: {
      stdout: "PASS",
    },
  });
  // https://github.com/oven-sh/bun/issues/6750
  itBundled("minify/SwitchUndefined", {
    files: {
      "/entry.js": /* js */ `
        switch (1) {
          case undefined: {
          }
        }
        console.log("PASS");
      `,
    },
    minifyWhitespace: true,
    minifySyntax: false,
    minifyIdentifiers: false,
    target: "bun",
    backend: "cli",
    run: {
      stdout: "PASS",
    },
  });
});
