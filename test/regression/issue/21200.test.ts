import { describe } from "bun:test";
import { itBundled } from "../../bundler/expectBundled";

describe("bundler", () => {
  // https://github.com/oven-sh/bun/issues/21200
  // --define with reserved word property names should produce property access, not string literals
  itBundled("regression/21200/DefineReservedWordProperty", {
    files: {
      "entry.js": /* js */ `
        if (VAR1 !== 42) throw 'fail: VAR1=' + VAR1;
        if (VAR2 !== 42) throw 'fail: VAR2=' + VAR2;
        if (VAR3 !== 42) throw 'fail: VAR3=' + VAR3;
        if (VAR4 !== 42) throw 'fail: VAR4=' + VAR4;
        if (VAR5 !== 42) throw 'fail: VAR5=' + VAR5;
        if (VAR6 !== 42) throw 'fail: VAR6=' + VAR6;
      `,
      "entry2.js": /* js */ `
        globalThis.x = { "import": 1, "export": 2, "class": 3, "function": 4, "var": 5, "default": 6 };
        globalThis.a = { b: { c: { "import": 7 } } };
        require("./entry3.js");
      `,
      "entry3.js": /* js */ `
        if (VAR1 !== 1) throw 'fail: VAR1=' + VAR1;
        if (VAR2 !== 2) throw 'fail: VAR2=' + VAR2;
        if (VAR3 !== 3) throw 'fail: VAR3=' + VAR3;
        if (VAR4 !== 4) throw 'fail: VAR4=' + VAR4;
        if (VAR5 !== 5) throw 'fail: VAR5=' + VAR5;
        if (VAR6 !== 6) throw 'fail: VAR6=' + VAR6;
        if (VAR7 !== 7) throw 'fail: VAR7=' + VAR7;
      `,
    },
    entryPoints: ["entry2.js"],
    define: {
      VAR1: "x.import",
      VAR2: "x.export",
      VAR3: "x.class",
      VAR4: "x.function",
      VAR5: "x.var",
      VAR6: "x.default",
      VAR7: "a.b.c.import",
    },
    run: true,
  });
});
