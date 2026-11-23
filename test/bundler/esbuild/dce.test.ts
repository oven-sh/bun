import { describe, expect } from "bun:test";
import { dedent, itBundled } from "../expectBundled";

// Tests ported from:
// https://github.com/evanw/esbuild/blob/main/internal/bundler_tests/bundler_dce_test.go

// For debug, all files are written to $TEMP/bun-bundle-tests/dce

// To understand what `dce: true` is doing, see ../expectBundled.md's "dce: true" section

// A grid of operators over constant values, for a test that builds it twice: with values that the
// same file declares, which the parser folds, and with the same values imported from another file.
// `ref` is how a row reads a value. `scope` is the parameter that gives `evaluate` those values.
function foldGrid(members: Record<string, string>, ref: (name: string) => string, scope: string) {
  const names = Object.keys(members);
  const rows: { kind: string; text: string }[] = [];
  const add = (template: (...operands: string[]) => string, ...operands: string[]) =>
    rows.push({ kind: template(...operands.map(() => ref("x"))), text: template(...operands.map(ref)) });
  for (const op of ["+", "-", "~", "!", "typeof ", "void "]) {
    for (const a of names) add(v => `${op}${v}`, a);
  }
  for (const op of "+ - * / % ** << >> >>> & | ^ < > <= >= == != === !== && || ??".split(" ")) {
    for (const a of names) for (const b of names) add((l, r) => `${l} ${op} ${r}`, a, b);
  }
  // Through one more operator, and with an operand that only the run knows.
  for (const a of names) {
    add((v, one, three) => `(${v} | ${one}) + ${three}`, a, "One", "Three");
    add((v, one, three) => `${three} * (${v} - ${one})`, a, "One", "Three");
    add(v => `${v} ? "yes" : "no"`, a);
    add((v, one, three) => `!${v} ? ${one} : ${three}`, a, "One", "Three");
    add((v, text, one) => `${v} + ${text} + ${one}`, a, "Text", "One");
    add((v, text, one) => `${one} + ${v} + ${text}`, a, "Text", "One");
    add((v, three) => `unknown + (${v} | ${three})`, a, "Three");
    add(v => `(${v} && unknown) + 1`, a);
    add(v => `(${v} || unknown) + 1`, a);
    add(v => `\`<\${${v}}>\``, a);
  }
  const format = `v => (typeof v === "string" ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : String(v))`;
  const values = Object.fromEntries(names.map(name => [name, (0, eval)(members[name])]));
  // The text of each row, without the comment that names an enum member.
  const printed = (text: string) =>
    text
      .split("\n")
      .filter(line => line.startsWith("t("))
      .map(line => line.replace(/\s*\/\*.*?\*\//g, ""));
  return {
    names,
    body: `
      const out: string[] = [];
      const format = ${format};
      const unknown = Number("4");
      const t = (v: unknown) => out.push(format(v));
      ${rows.map(row => `t(${row.text});`).join("\n")}
      console.log(out.join("\\n"));
    `,
    /** What the rows print when the engine evaluates them. */
    stdout: new Function(scope, "unknown", `return [${rows.map(row => row.text).join(",")}]`)(values, 4)
      .map((0, eval)(format))
      .join("\n"),
    /** The kinds of row that the two outputs print differently. */
    differences(same: string, cross: string) {
      const [sameRows, crossRows] = [printed(same), printed(cross)];
      expect([sameRows.length, crossRows.length]).toEqual([rows.length, rows.length]);
      const kinds: Record<string, { rows: number; example: string }> = {};
      rows.forEach((row, i) => {
        if (sameRows[i] === crossRows[i]) return;
        kinds[row.kind] ??= { rows: 0, example: `${crossRows[i]} where the same file prints ${sameRows[i]}` };
        kinds[row.kind].rows++;
      });
      return kinds;
    },
  };
}

describe("bundler", () => {
  itBundled("dce/PackageJsonSideEffectsFalseKeepNamedImportES6", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "demo-pkg"
        console.log(foo)
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        export const foo = 123
        console.log('hello')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": false
        }
      `,
    },
    run: {
      stdout: "hello\n123",
    },
  });
  itBundled("dce/UnreferencedObjectLiteral", {
    files: {
      "/entry.js": /* js */ `
        ({
            0: 1,
            2: console.log("EFFECT1"),
        });
        ({
            0: 1,
            [console.log("EFFECT2")]: 2,
        });
      `,
    },
    run: {
      stdout: "EFFECT1\nEFFECT2",
    },
  });
  itBundled("dce/PackageJsonSideEffectsFalseKeepNamedImportCommonJS", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "demo-pkg"
        console.log(foo)
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        exports.foo = 123
        console.log('hello')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": false
        }
      `,
    },
    run: {
      stdout: "hello\n123",
    },
  });
  itBundled("dce/PackageJsonSideEffectsFalseKeepStarImportES6", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import * as ns from "demo-pkg"
        console.log(JSON.stringify(ns))
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        export const foo = 123
        console.log('hello')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": false
        }
      `,
    },
    run: {
      stdout: 'hello\n{"foo":123}',
    },
  });
  itBundled("dce/PackageJsonSideEffectsFalseKeepStarImportCommonJS", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import * as ns from "demo-pkg"
        console.log(JSON.stringify(ns))
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        exports.foo = 123
        console.log('hello')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": false
        }
      `,
    },
    run: {
      stdout: 'hello\n{"foo":123}',
    },
  });
  itBundled("dce/PackageJsonSideEffectsTrueKeepES6", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import "demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        export const foo = "FAILED"
        console.log('hello')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": true
        }
      `,
    },
    dce: true,
    run: {
      stdout: "hello\nunused import",
    },
  });
  itBundled("dce/PackageJsonSideEffectsTrueKeepCommonJS", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import "demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        exports.foo = 123
        console.log('hello')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": true
        }
      `,
    },
    dce: true,
    run: {
      stdout: "hello\nunused import",
    },
  });
  itBundled("dce/PackageJsonSideEffectsFalseKeepBareImportAndRequireES6", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import "demo-pkg"
        require('demo-pkg')
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        export const foo = 123
        console.log('hello')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": false
        }
      `,
    },
    dce: true,
    run: {
      stdout: "hello\nunused import",
    },
  });
  itBundled("dce/PackageJsonSideEffectsFalseKeepBareImportAndRequireCommonJS", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import "demo-pkg"
        require('demo-pkg')
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        exports.foo = 123
        console.log('hello')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": false
        }
      `,
    },
    dce: true,
    run: {
      stdout: "hello\nunused import",
    },
  });
  itBundled("dce/PackageJsonSideEffectsFalseRemoveBareImportES6", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import "demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        export const foo = "TEST FAILED"
        console.log('TEST FAILED')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": false
        }
      `,
    },
    dce: true,
    run: {
      stdout: "unused import",
    },
  });
  itBundled("dce/PackageJsonSideEffectsFalseRemoveBareImportCommonJS", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import "demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        exports.foo = "TEST FAILED"
        console.log('TEST FAILED')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": false
        }
      `,
    },
    dce: true,
    run: {
      stdout: "unused import",
    },
  });
  itBundled("dce/PackageJsonSideEffectsFalseRemoveNamedImportES6", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        export const foo = "TEST FAILED"
        console.log('TEST FAILED')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": false
        }
      `,
    },
    dce: true,
    run: {
      stdout: "unused import",
    },
  });
  itBundled("dce/PackageJsonSideEffectsFalseRemoveNamedImportCommonJS", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        exports.foo = "TEST FAILED"
        console.log('TEST FAILED')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": false
        }
      `,
    },
    dce: true,
    run: {
      stdout: "unused import",
    },
  });
  itBundled("dce/PackageJsonSideEffectsFalseRemoveStarImportES6", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import * as ns from "demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        export const foo = "TEST FAILED"
        console.log('TEST FAILED')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": false
        }
      `,
    },
    dce: true,
    run: {
      stdout: "unused import",
    },
  });
  itBundled("dce/PackageJsonSideEffectsFalseRemoveStarImportCommonJS", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import * as ns from "demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        exports.foo = "TEST FAILED"
        console.log('TEST FAILED')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": false
        }
      `,
    },
    dce: true,
    run: {
      stdout: "unused import",
    },
  });
  itBundled("dce/PackageJsonSideEffectsArrayRemove", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        export const foo = "TEST FAILED"
        console.log('hello')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": []
        }
      `,
    },
    dce: true,
    run: {
      stdout: "unused import",
    },
  });
  itBundled("dce/PackageJsonSideEffectsArrayKeep", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        export const foo = "TEST FAILED"
        console.log("hello")
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": ["./index.js"]
        }
      `,
    },
    dce: true,
    run: {
      stdout: "hello\nunused import",
    },
  });
  itBundled("dce/PackageJsonSideEffectsArrayKeepMainUseModule", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index-main.js": /* js */ `
        export const foo = "TEST FAILED"
        console.log('TEST FAILED')
      `,
      "/Users/user/project/node_modules/demo-pkg/index-module.js": /* js */ `
        export const foo = "TEST FAILED"
        console.log('TEST FAILED')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "main": "index-main.js",
          "module": "index-module.js",
          "sideEffects": ["./index-main.js"]
        }
      `,
    },
    dce: true,
    mainFields: ["module"],
    run: {
      stdout: "unused import",
    },
  });
  itBundled("dce/PackageJsonSideEffectsArrayKeepMainUseMain", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index-main.js": /* js */ `
        export const foo = "TEST FAILED"
        console.log('this should be kept')
      `,
      "/Users/user/project/node_modules/demo-pkg/index-module.js": /* js */ `
        export const foo = "TEST FAILED"
        console.log('TEST FAILED')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "main": "index-main.js",
          "module": "index-module.js",
          "sideEffects": ["./index-main.js"]
        }
      `,
    },
    dce: true,
    mainFields: ["main"],
    run: {
      stdout: "this should be kept\nunused import",
    },
  });
  itBundled("dce/PackageJsonSideEffectsArrayKeepMainImplicitModule", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index-main.js": /* js */ `
        export const foo = "TEST FAILED"
        console.log('TEST FAILED')
      `,
      "/Users/user/project/node_modules/demo-pkg/index-module.js": /* js */ `
        export const foo = "TEST FAILED"
        console.log('TEST FAILED')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "main": "index-main.js",
          "module": "index-module.js",
          "sideEffects": ["./index-main.js"]
        }
      `,
    },
    dce: true,
    run: {
      stdout: "unused import",
    },
  });
  itBundled("dce/PackageJsonSideEffectsArrayKeepMainImplicitMain", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "demo-pkg"
        import "./require-demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/src/require-demo-pkg.js": /* js */ `
        // This causes "index-main.js" to be selected
        require('demo-pkg')
      `,
      "/Users/user/project/node_modules/demo-pkg/index-main.js": /* js */ `
        export const foo = "POSSIBLE_REMOVAL"
        console.log('this should be kept')
      `,
      "/Users/user/project/node_modules/demo-pkg/index-module.js": /* js */ `
        export const foo = "TEST FAILED"
        console.log('TEST FAILED')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "main": "index-main.js",
          "module": "index-module.js",
          "sideEffects": ["./index-main.js"]
        }
      `,
    },
    dce: true,
    run: {
      stdout: "this should be kept\nunused import",
    },
  });
  itBundled("dce/PackageJsonSideEffectsArrayKeepModuleUseModule", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index-main.js": /* js */ `
        export const foo = "TEST FAILED"
        console.log('TEST FAILED')
      `,
      "/Users/user/project/node_modules/demo-pkg/index-module.js": /* js */ `
        export const foo = "TEST FAILED"
        console.log('this should be kept')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "main": "index-main.js",
          "module": "index-module.js",
          "sideEffects": ["./index-module.js"]
        }
      `,
    },
    dce: true,
    run: {
      stdout: "this should be kept\nunused import",
    },
  });
  itBundled("dce/PackageJsonSideEffectsArrayKeepModuleUseMain", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index-main.js": /* js */ `
        export const foo = 123
        console.log('TEST FAILED')
      `,
      "/Users/user/project/node_modules/demo-pkg/index-module.js": /* js */ `
        export const foo = 123
        console.log('hello')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "main": "index-main.js",
          "module": "index-module.js",
          "sideEffects": ["./index-module.js"]
        }
      `,
    },
    dce: true,
    run: {
      stdout: "hello\nunused import",
    },
  });
  itBundled("dce/PackageJsonSideEffectsArrayKeepModuleImplicitModule", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index-main.js": /* js */ `
        export const foo = 123
        console.log('TEST FAILED')
      `,
      "/Users/user/project/node_modules/demo-pkg/index-module.js": /* js */ `
        export const foo = 123
        console.log('this should be kept')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "main": "index-main.js",
          "module": "index-module.js",
          "sideEffects": ["./index-module.js"]
        }
      `,
    },
    dce: true,
    run: {
      stdout: "this should be kept\nunused import",
    },
  });
  itBundled("dce/PackageJsonSideEffectsArrayKeepModuleImplicitMain", {
    todo: true,
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "demo-pkg"
        import "./require-demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/src/require-demo-pkg.js": /* js */ `
        // This causes "index-main.js" to be selected
        require('demo-pkg')
      `,
      "/Users/user/project/node_modules/demo-pkg/index-main.js": /* js */ `
        export const foo = "POSSIBLE_REMOVAL"
        console.log('this should be kept')
      `,
      "/Users/user/project/node_modules/demo-pkg/index-module.js": /* js */ `
        export const foo = "TEST FAILED"
        console.log('TEST FAILED')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "main": "index-main.js",
          "module": "index-module.js",
          "sideEffects": ["./index-module.js"]
        }
      `,
    },
    dce: true,
    run: {
      stdout: "this should be kept\nunused import",
    },
  });
  itBundled("dce/PackageJsonSideEffectsArrayGlob", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import "demo-pkg/keep/this/file"
        import "demo-pkg/remove/this/file"
      `,
      "/Users/user/project/node_modules/demo-pkg/keep/this/file.js": `console.log('this should be kept')`,
      "/Users/user/project/node_modules/demo-pkg/remove/this/file.js": `console.log('TEST FAILED')`,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": [
            "./ke?p/*/file.js",
            "./remove/this/file.j",
            "./re?ve/this/file.js"
          ]
        }
      `,
    },
    dce: true,
    run: {
      stdout: "this should be kept",
    },
  });
  itBundled("dce/PackageJsonSideEffectsGlobBasicPattern", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import { used } from "demo-pkg/lib/used.js";
        import { unused } from "demo-pkg/lib/unused.js";
        import { effect } from "demo-pkg/effects/effect.js";
        console.log(used);
      `,
      "/Users/user/project/node_modules/demo-pkg/lib/used.js": `export const used = "used";`,
      "/Users/user/project/node_modules/demo-pkg/lib/unused.js": /* js */ `
        export const unused = "unused";
        console.log("should be tree-shaken");
      `,
      "/Users/user/project/node_modules/demo-pkg/effects/effect.js": /* js */ `
        console.log("side effect preserved");
        export const effect = "effect";
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": ["./effects/*.js"]
        }
      `,
    },
    dce: true,
    run: {
      stdout: "side effect preserved\nused",
    },
  });
  itBundled("dce/PackageJsonSideEffectsGlobQuestionMark", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import { file1 } from "demo-pkg/file1.js";
        import { file2 } from "demo-pkg/file2.js";
        import { fileAB } from "demo-pkg/fileAB.js";
        import { other } from "demo-pkg/other.js";
        console.log("done");
      `,
      "/Users/user/project/node_modules/demo-pkg/file1.js": /* js */ `
        console.log("file1 effect");
        export const file1 = "file1";
      `,
      "/Users/user/project/node_modules/demo-pkg/file2.js": /* js */ `
        console.log("file2 effect");
        export const file2 = "file2";
      `,
      "/Users/user/project/node_modules/demo-pkg/fileAB.js": /* js */ `
        console.log("fileAB effect");
        export const fileAB = "fileAB";
      `,
      "/Users/user/project/node_modules/demo-pkg/other.js": /* js */ `
        console.log("other effect");
        export const other = "other";
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": ["./file?.js"]
        }
      `,
    },
    dce: true,
    run: {
      stdout: "file1 effect\nfile2 effect\ndone",
    },
  });
  itBundled("dce/PackageJsonSideEffectsGlobBraceExpansion", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import { comp } from "demo-pkg/components/comp.js";
        import { util } from "demo-pkg/utils/util.js";
        import { other } from "demo-pkg/other/file.js";
        console.log("done");
      `,
      "/Users/user/project/node_modules/demo-pkg/components/comp.js": /* js */ `
        console.log("component effect");
        export const comp = "comp";
      `,
      "/Users/user/project/node_modules/demo-pkg/utils/util.js": /* js */ `
        console.log("utility effect");
        export const util = "util";
      `,
      "/Users/user/project/node_modules/demo-pkg/other/file.js": /* js */ `
        console.log("other effect");
        export const other = "other";
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": ["./{components,utils}/*.js"]
        }
      `,
    },
    dce: true,
    run: {
      stdout: "component effect\nutility effect\ndone",
    },
  });
  itBundled("dce/PackageJsonSideEffectsGlobMixedPatterns", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import { used } from "demo-pkg/lib/used.js";
        import { specific } from "demo-pkg/lib/specific.js";
        import { glob1 } from "demo-pkg/lib/glob/glob1.js";
        import { glob2 } from "demo-pkg/lib/glob/glob2.js";
        import { other } from "demo-pkg/lib/other.js";
        console.log(used);
      `,
      "/Users/user/project/node_modules/demo-pkg/lib/used.js": `export const used = "used";`,
      "/Users/user/project/node_modules/demo-pkg/lib/specific.js": /* js */ `
        console.log("specific side effect");
        export const specific = "specific";
      `,
      "/Users/user/project/node_modules/demo-pkg/lib/glob/glob1.js": /* js */ `
        console.log("glob1 side effect");
        export const glob1 = "glob1";
      `,
      "/Users/user/project/node_modules/demo-pkg/lib/glob/glob2.js": /* js */ `
        console.log("glob2 side effect");
        export const glob2 = "glob2";
      `,
      "/Users/user/project/node_modules/demo-pkg/lib/other.js": /* js */ `
        console.log("other side effect");
        export const other = "other";
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": ["./lib/specific.js", "./lib/glob/*.js"]
        }
      `,
    },
    dce: true,
    run: {
      stdout: "specific side effect\nglob1 side effect\nglob2 side effect\nused",
    },
  });
  itBundled("dce/PackageJsonSideEffectsGlobDeepPattern", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import "demo-pkg/shallow.js";
        import "demo-pkg/components/effects/deep.js";
        import "demo-pkg/utils/helpers/effects/nested.js";
        console.log("done");
      `,
      "/Users/user/project/node_modules/demo-pkg/shallow.js": /* js */ `
        console.log("shallow side effect - should be tree shaken");
      `,
      "/Users/user/project/node_modules/demo-pkg/components/effects/deep.js": /* js */ `
        console.log("deep side effect - should be preserved");
      `,
      "/Users/user/project/node_modules/demo-pkg/utils/helpers/effects/nested.js": /* js */ `
        console.log("nested side effect - should be preserved");
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": ["./**/effects/*.js"]
        }
      `,
    },
    dce: true,
    run: {
      stdout: "deep side effect - should be preserved\nnested side effect - should be preserved\ndone",
    },
  });
  itBundled("dce/PackageJsonSideEffectsGlobExtensionPattern", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import "demo-pkg/utils/util.js";
        import "demo-pkg/effects/main.effect.js";
        import "demo-pkg/effects/secondary.js";
        console.log("done");
      `,
      "/Users/user/project/node_modules/demo-pkg/utils/util.js": /* js */ `
        console.log("util side effect - should be tree shaken");
      `,
      "/Users/user/project/node_modules/demo-pkg/effects/main.effect.js": /* js */ `
        console.log("main effect - should be preserved");
      `,
      "/Users/user/project/node_modules/demo-pkg/effects/secondary.js": /* js */ `
        console.log("secondary effect - should be tree shaken");
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": ["./**/*.effect.js"]
        }
      `,
    },
    dce: true,
    run: {
      stdout: "main effect - should be preserved\ndone",
    },
  });
  itBundled("dce/PackageJsonSideEffectsGlobInvalidPattern", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import { lib } from "demo-pkg/lib/lib.js";
        console.log(lib);
      `,
      "/Users/user/project/node_modules/demo-pkg/lib/lib.js": /* js */ `
        console.log("lib side effect");
        export const lib = "lib";
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": ["./[unclosed.js", "./lib/*.js"]
        }
      `,
    },
    dce: true,
    run: {
      stdout: "lib side effect\nlib",
    },
  });
  itBundled("dce/PackageJsonSideEffectsGlobNoMatches", {
    todo: true,
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import "./components/comp.js";
        import "./utils/util.js";
        import "./root.js";
        console.log("done");
      `,
      "/Users/user/project/src/components/comp.js": /* js */ `
        console.log("component side effect");
      `,
      "/Users/user/project/src/utils/util.js": /* js */ `
        console.log("utility side effect - should be tree shaken");
      `,
      "/Users/user/project/src/root.js": /* js */ `
        console.log("root side effect - should be tree shaken");
      `,
      "/Users/user/project/package.json": /* json */ `
        {
          "sideEffects": ["src/components/*.js"]
        }
      `,
    },
    dce: true,
    run: {
      stdout: "component side effect\ndone",
    },
  });
  itBundled("dce/PackageJsonSideEffectsNestedDirectoryRemove", {
    todo: true,
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "demo-pkg/a/b/c"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": false
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/a/b/c/index.js": /* js */ `
        export const foo = "TEST FAILED"
        console.log('TEST FAILED')
      `,
    },
    dce: true,
    run: {
      stdout: "unused import",
    },
  });
  itBundled("dce/PackageJsonSideEffectsKeepExportDefaultExpr", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import foo from "demo-pkg"
        console.log(foo)
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": `export default exprWithSideEffects()`,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": false
        }
      `,
    },
    runtimeFiles: {
      "/test.js": /* js */ `
        globalThis.exprWithSideEffects = () => 1;
        await import('./out');
      `,
    },
    run: {
      file: "/test.js",
      stdout: "1",
    },
  });
  itBundled("dce/PackageJsonSideEffectsFalseNoWarningInNodeModulesESBuildIssue999", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import "demo-pkg"
        console.log('used import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        import "demo-pkg2"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg2/index.js": /* js */ `
        export const foo = "FAILED"
        console.log('FAILED')
      `,
      "/Users/user/project/node_modules/demo-pkg2/package.json": /* json */ `
        {
          "sideEffects": false
        }
      `,
    },
    dce: true,
    run: {
      stdout: "unused import\nused import",
    },
  });
  itBundled("dce/PackageJsonSideEffectsFalseIntermediateFilesUnused", {
    files: {
      "/Users/user/project/src/entry.js": `import {foo} from "demo-pkg"`,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        export {foo} from "./foo.js"
        throw 'REMOVE THIS'
      `,
      "/Users/user/project/node_modules/demo-pkg/foo.js": `export const foo = 123`,
      "/Users/user/project/node_modules/demo-pkg/package.json": `{ "sideEffects": false }`,
    },
    dce: true,
    onAfterBundle(api) {
      api.expectFile("/out.js").toBe("");
    },
  });
  itBundled("dce/PackageJsonSideEffectsFalseIntermediateFilesUsed", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "demo-pkg"
        console.log(foo)
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        export {foo} from "./foo.js"
        console.log('hello')
      `,
      "/Users/user/project/node_modules/demo-pkg/foo.js": `export const foo = 123`,
      "/Users/user/project/node_modules/demo-pkg/package.json": `{ "sideEffects": false }`,
    },
    dce: true,
    run: {
      stdout: "hello\n123",
    },
  });
  itBundled("dce/PackageJsonSideEffectsFalseIntermediateFilesChainAll", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "a"
        console.log(foo)
      `,
      "/Users/user/project/node_modules/a/index.js": `export {foo} from "b"`,
      "/Users/user/project/node_modules/a/package.json": `{ "sideEffects": false }`,
      "/Users/user/project/node_modules/b/index.js": /* js */ `
        export {foo} from "c"
        console.log('hello')
      `,
      "/Users/user/project/node_modules/b/package.json": `{ "sideEffects": false }`,
      "/Users/user/project/node_modules/c/index.js": `export {foo} from "d"`,
      "/Users/user/project/node_modules/c/package.json": `{ "sideEffects": false }`,
      "/Users/user/project/node_modules/d/index.js": `export const foo = 123`,
      "/Users/user/project/node_modules/d/package.json": `{ "sideEffects": false }`,
    },
    dce: true,
    run: {
      stdout: "hello\n123",
    },
  });
  itBundled("dce/PackageJsonSideEffectsFalseIntermediateFilesChainOne", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "a"
        console.log(foo)
      `,
      "/Users/user/project/node_modules/a/index.js": `export {foo} from "b"`,
      "/Users/user/project/node_modules/b/index.js": /* js */ `
        export {foo} from "c"
        console.log('hello')
      `,
      "/Users/user/project/node_modules/b/package.json": `{ "sideEffects": false }`,
      "/Users/user/project/node_modules/c/index.js": `export {foo} from "d"`,
      "/Users/user/project/node_modules/d/index.js": `export const foo = 123`,
    },
    dce: true,
    run: {
      stdout: "hello\n123",
    },
  });
  itBundled("dce/PackageJsonSideEffectsFalseIntermediateFilesDiamond", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "a"
        console.log(foo)
      `,
      "/Users/user/project/node_modules/a/index.js": /* js */ `
        export * from "b1"
        export * from "b2"
      `,
      "/Users/user/project/node_modules/b1/index.js": /* js */ `
        export {foo} from "c"
        console.log('hello 1')
      `,
      "/Users/user/project/node_modules/b1/package.json": `{ "sideEffects": false }`,
      "/Users/user/project/node_modules/b2/index.js": /* js */ `
        export {foo} from "c"
        console.log('hello 2')
      `,
      "/Users/user/project/node_modules/b2/package.json": `{ "sideEffects": false }`,
      "/Users/user/project/node_modules/c/index.js": `export {foo} from "d"`,
      "/Users/user/project/node_modules/d/index.js": `export const foo = 123`,
    },
    dce: true,
    run: {
      stdout: "hello 1\nhello 2\n123",
    },
  });
  itBundled("dce/PackageJsonSideEffectsFalseOneFork", {
    files: {
      "/Users/user/project/src/entry.js": `import("a").then(x => console.log(x.foo))`,
      "/Users/user/project/node_modules/a/index.js": `export {foo} from "b"`,
      "/Users/user/project/node_modules/b/index.js": /* js */ `
        export {foo, bar} from "c"
        export {baz} from "d"
      `,
      "/Users/user/project/node_modules/b/package.json": `{ "sideEffects": false }`,
      "/Users/user/project/node_modules/c/index.js": /* js */ `
        export let foo = "foo"
        export let bar = "bar"
      `,
      "/Users/user/project/node_modules/d/index.js": `export let baz = "baz"`,
    },
    dce: true,
    run: {
      stdout: "foo",
    },
  });
  itBundled("dce/PackageJsonSideEffectsFalseAllFork", {
    files: {
      "/Users/user/project/src/entry.js": `import("a").then(x => console.log(x.foo))`,
      "/Users/user/project/node_modules/a/index.js": `export {foo} from "b"`,
      "/Users/user/project/node_modules/b/index.js": /* js */ `
        export {foo, bar} from "c"
        export {baz} from "d"
      `,
      "/Users/user/project/node_modules/b/package.json": `{ "sideEffects": false }`,
      "/Users/user/project/node_modules/c/index.js": /* js */ `
        export let foo = "foo"
        export let bar = "bar"
      `,
      "/Users/user/project/node_modules/c/package.json": `{ "sideEffects": false }`,
      "/Users/user/project/node_modules/d/index.js": `export let baz = "baz"`,
      "/Users/user/project/node_modules/d/package.json": `{ "sideEffects": false }`,
    },
    dce: true,
    run: {
      stdout: "foo",
    },
  });
  itBundled("dce/JSONLoaderRemoveUnused", {
    files: {
      "/entry.js": /* js */ `
        import unused from "./example.json"
        console.log('unused import')
      `,
      "/example.json": `{"data": "FAILED"}`,
    },
    dce: true,
    run: {
      stdout: "unused import",
    },
  });
  itBundled("dce/TextLoaderRemoveUnused", {
    files: {
      "/entry.js": /* js */ `
        import unused from "./example.txt"
        console.log('unused import')
      `,
      "/example.txt": `TEST FAILED`,
    },
    dce: true,
    run: {
      stdout: "unused import",
    },
  });
  itBundled("dce/Base64LoaderRemoveUnused", {
    files: {
      "/entry.js": /* js */ `
        import unused from "./example.data"
        console.log('unused import')
      `,
      "/example.data": `TEST FAILED`,
    },
    dce: true,
    run: {
      stdout: "unused import",
    },
    loader: {
      ".data": "base64",
    },
  });
  itBundled("dce/DataURLLoaderRemoveUnused", {
    files: {
      "/entry.js": /* js */ `
        import unused from "./example.data"
        console.log('unused import')
      `,
      "/example.data": `TEST FAILED`,
    },
    dce: true,
    run: {
      stdout: "unused import",
    },
    loader: {
      ".data": "dataurl",
    },
  });
  itBundled("dce/FileLoaderRemoveUnused", {
    todo: true,
    files: {
      "/entry.js": /* js */ `
        import unused from "./example.data"
        console.log('unused import')
      `,
      "/example.data": `TEST FAILED`,
    },
    dce: true,
    run: {
      stdout: "unused import",
    },
    assetNaming: "[name].[ext]",
    outdir: "/out",
    loader: {
      ".data": "file",
    },
    onAfterBundle(api) {
      const fs = require("fs");
      expect(fs.readdirSync(api.outdir)).toEqual(["entry.js"]);
    },
  });
  itBundled("dce/RemoveUnusedImportMeta", {
    files: {
      "/entry.js": /* js */ `
        function foo() {
          console.log(import.meta.url, import.meta.path, 'FAILED')
        }
        console.log('foo is unused')
      `,
    },
    dce: true,
    run: {
      stdout: "foo is unused",
    },
  });
  for (const { minify, emitDCEAnnotations, name } of [
    { minify: false, emitDCEAnnotations: false, name: "dce/RemoveUnusedPureCommentCalls" },
    { minify: true, emitDCEAnnotations: false, name: "dce/RemoveUnusedPureCommentCallsMinify" },
    { minify: true, emitDCEAnnotations: true, name: "dce/RemoveUnusedPureCommentCallsMinifyExplitOn" },
  ]) {
    itBundled(name, {
      // in this test, the bundler must drop all `_yes` variables entirely, and then
      // preserve the pure comments in the same way esbuild does
      files: {
        "/entry.js": /* js */ `
          function bar() {}
          let bare = foo(bar);

          let at_yes = /* @__PURE__ */ foo(bar);
          let at_no = /* @__PURE__ */ foo(bar());
          let new_at_yes = /* @__PURE__ */ new foo(bar);
          let new_at_no = /* @__PURE__ */ new foo(bar());

          let nospace_at_yes = /*@__PURE__*/ foo(bar);
          let nospace_at_no = /*@__PURE__*/ foo(bar());
          let nospace_new_at_yes = /*@__PURE__*/ new foo(bar);
          let nospace_new_at_no = /*@__PURE__*/ new foo(bar());

          let num_yes = /* #__PURE__ */ foo(bar);
          let num_no = /* #__PURE__ */ foo(bar());
          let new_num_yes = /* #__PURE__ */ new foo(bar);
          let new_num_no = /* #__PURE__ */ new foo(bar());

          let nospace_num_yes = /*#__PURE__*/ foo(bar);
          let nospace_num_no = /*#__PURE__*/ foo(bar());
          let nospace_new_num_yes = /*#__PURE__*/ new foo(bar);
          let nospace_new_num_no = /*#__PURE__*/ new foo(bar());

          let dot_yes = /* @__PURE__ */ foo(sideEffect()).dot(bar);
          let dot_no = /* @__PURE__ */ foo(sideEffect()).dot(bar());
          let new_dot_yes = /* @__PURE__ */ new foo(sideEffect()).dot(bar);
          let new_dot_no = /* @__PURE__ */ new foo(sideEffect()).dot(bar());

          let nested_yes = [1, /* @__PURE__ */ foo(bar), 2];
          let nested_no = [1, /* @__PURE__ */ foo(bar()), 2];
          let new_nested_yes = [1, /* @__PURE__ */ new foo(bar), 2];
          let new_nested_no = [1, /* @__PURE__ */ new foo(bar()), 2];

          let single_at_yes = // @__PURE__
            foo(bar);
          let single_at_no = // @__PURE__
            foo(bar());
          let new_single_at_yes = // @__PURE__
            new foo(bar);
          let new_single_at_no = // @__PURE__
            new foo(bar());

          let single_num_yes = // #__PURE__
            foo(bar);
          let single_num_no = // #__PURE__
            foo(bar());
          let new_single_num_yes = // #__PURE__
            new foo(bar);
          let new_single_num_no = // #__PURE__
            new foo(bar());

          let bad_no = /* __PURE__ */ foo(bar);
          let new_bad_no = /* __PURE__ */ new foo(bar);

          let parens_no = (/* @__PURE__ */ foo)(bar);
          let new_parens_no = new (/* @__PURE__ */ foo)(bar);

          let exp_no = /* @__PURE__ */ foo() ** foo();
          let new_exp_no = /* @__PURE__ */ new foo() ** foo();
        `,
      },
      minifyWhitespace: minify,
      emitDCEAnnotations: emitDCEAnnotations,
      backend: "cli",
      onAfterBundle(api) {
        const code = api.readFile("/out.js");
        expect(code).not.toContain("_yes"); // should not contain any *_yes variables
        expect(code).toContain(minify ? "var bare=foo(bar)" : "var bare = foo(bar)");
        const keep = [
          ["at_no", true],
          ["new_at_no", true],
          ["nospace_at_no", true],
          ["nospace_new_at_no", true],
          ["num_no", true],
          ["new_num_no", true],
          ["nospace_num_no", true],
          ["nospace_new_num_no", true],
          ["dot_no", true],
          ["new_dot_no", true],
          ["nested_no", true],
          ["new_nested_no", true],
          ["single_at_no", true],
          ["new_single_at_no", true],
          ["single_num_no", true],
          ["new_single_num_no", true],
          ["parens_no", false],
          ["new_parens_no", false],
          ["exp_no", true],
          ["new_exp_no", true],
        ];
        for (const [name, pureComment] of keep) {
          const regex = new RegExp(`${name}\\s*=[^\/\n;]*(\\/\\*[^\/\n;]*?PURE[^\/\n;]*?\\*\\/)?`, "g");
          const match = regex.exec(code)!;
          expect(match).toBeTruthy(); // should contain ${name}

          if ((emitDCEAnnotations || !minify) && pureComment) {
            expect(match[1], "should contain pure comment for " + name).toBeTruthy();
          } else {
            expect(match[1], "should not contain pure comment for " + name).toBeFalsy();
          }
        }
      },
    });
  }
  itBundled("dce/TreeShakingReactElements", {
    files: {
      "/entry.jsx": /* jsx */ `
        function Foo() {}
  
        let DROP_a = <div/>
        let DROP_b = <Foo>{DROP_a}</Foo>
        let DROP_c = <>{DROP_b}</>
  
        let d = <div/>
        let e = <Foo>{d}</Foo>
        let f = <>{e}</>
        console.log(JSON.stringify(f))
      `,

      "/node_modules/react/index.js": `export const Fragment = 'F'`,
      "/node_modules/react/jsx-dev-runtime.js": `export const jsxDEV = (a,b) => [a,b]; export const Fragment = 'F'`,
    },
    jsx: {
      runtime: "automatic",
    },
    target: "bun",
    dce: true,
    run: {
      stdout: `["F",{"children":[null,{"children":["div",{}]}]}]`,
    },
  });
  itBundled("dce/DeadCodeFollowingJump", {
    files: {
      "/entry.js": /* js */ `
        function testReturn() {
          if (true) return y + z()
          if (FAIL) return FAIL
          if (x) { var y }
          function z() { KEEP_ME() }
          return FAIL
        }
  
        function testThrow() {
          if (true) throw y + z()
          if (FAIL) return FAIL
          if (x) { var y }
          function z() { KEEP_ME() }
          return FAIL
        }
  
        function testBreak() {
          while (true) {
            if (true) {
              y + z()
              break
            }
            if (FAIL) return FAIL
            if (x) { var y }
            function z() { KEEP_ME() }
            return FAIL
          }
        }
  
        function testContinue() {
          while (true) {
            if (true) {
              y + z()
              continue
            }
            if (FAIL) return FAIL
            if (x) { var y }
            function z() { KEEP_ME() }
            return FAIL
          }
        }
  
        function testStmts() {
          return [a, b, c, d, e, f, g, h, i]
  
          while (x) { var a }
          while (FAIL) { let FAIL }
  
          do { var b } while (x)
          do { let FAIL } while (FAIL)
  
          for (var c; ;) ;
          for (let FAIL; ;) ;
  
          for (var d in x) ;
          for (let FAIL in FAIL) ;
  
          for (var e of x) ;
          for (let FAIL of FAIL) ;
  
          if (x) { var f }
          if (FAIL) { let FAIL }
  
          if (x) ; else { var g }
          if (FAIL) ; else { let FAIL }
  
          { var h }
          { let FAIL }
  
          x: { var i }
          x: { let FAIL }
        }
  
        testReturn()
        testThrow()
        testBreak()
        testContinue()
        testStmts()
      `,
    },
    dce: true,
    minifySyntax: true,
  });
  itBundled("dce/RemoveTrailingReturn", {
    todo: true,
    files: {
      "/entry.js": /* js */ `
        function foo() {
          if (a) b()
          return
        }
        function bar() {
          if (a) b()
          return KEEP_ME
        }
        export default [
          foo,
          bar,
          function () {
            if (a) b()
            return
          },
          function () {
            if (a) b()
            return KEEP_ME
          },
          () => {
            if (a) b()
            return
          },
          () => {
            if (a) b()
            return KEEP_ME
          },
        ]
      `,
    },
    minifySyntax: true,
    dce: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      expect([...code.matchAll(/return/g)]).toHaveLength(2); // should remove 3 trailing returns and the arrow function return
    },
  });
  itBundled("dce/ImportReExportOfNamespaceImport", {
    files: {
      "/Users/user/project/entry.js": /* js */ `
        import * as ns from 'pkg'
        console.log(ns.foo)
      `,
      "/Users/user/project/node_modules/pkg/index.js": /* js */ `
        export { default as foo } from './foo'
        export { default as bar } from './bar'
      `,
      "/Users/user/project/node_modules/pkg/package.json": `{ "sideEffects": false }`,
      "/Users/user/project/node_modules/pkg/foo.js": `module.exports = 123`,
      "/Users/user/project/node_modules/pkg/bar.js": `module.exports = 'FAILED'`,
    },
    dce: true,
    run: {
      stdout: "123",
    },
  });
  itBundled("dce/TreeShakingImportIdentifier", {
    files: {
      "/entry.js": /* js */ `
        import * as a from './a'
        new a.Keep().x().y()
      `,
      "/a.js": /* js */ `
        import * as b from './b'
        export class Keep extends b.Base { y() { console.log(2); return this; } }
        export class REMOVE extends b.Base { y() { console.log(3); return this; } }
      `,
      "/b.js": `export class Base { x() { console.log(1); return this; } }`,
    },
    dce: true,
    dceKeepMarkerCount: false,
    run: {
      stdout: "1\n2",
    },
  });
  itBundled("dce/TreeShakingObjectProperty", {
    files: {
      "/entry.js": /* js */ `
        let remove1 = { x: 'x' }
        let remove2 = { x() {} }
        let remove3 = { get x() {} }
        let remove4 = { set x(_) {} }
        let remove5 = { async x() {} }
        let remove6 = { ['x']: 'x' }
        let remove7 = { ['x']() {} }
        let remove8 = { get ['x']() {} }
        let remove9 = { set ['x'](_) {} }
        let remove10 = { async ['x']() {} }
        let remove11 = { [0]: 'x' }
        let remove12 = { [null]: 'x' }
        let remove13 = { [undefined]: 'x' }
        let remove14 = { [false]: 'x' }
        let remove15 = { [0n]: 'x' }
        let remove16 = { toString() {} }
  
        let keep1 = { x }
        let keep2 = { x: x }
        let keep3 = { ...x }
        let keep4 = { [x]: 'x' }
        let keep5 = { [x]() {} }
        let keep6 = { get [x]() {} }
        let keep7 = { set [x](_) {} }
        let keep8 = { async [x]() {} }
        let keep9 = { [{ toString() {} }]: 'x' }
      `,
    },
    treeShaking: true,
    dce: true,
  });
  itBundled("dce/TreeShakingClassProperty", {
    files: {
      "/entry.js": /* js */ `
        let remove1 = class { x }
        let remove2 = class { x = x }
        let remove3 = class { x() {} }
        let remove4 = class { get x() {} }
        let remove5 = class { set x(_) {} }
        let remove6 = class { async x() {} }
        let remove7 = class { ['x'] = x }
        let remove8 = class { ['x']() {} }
        let remove9 = class { get ['x']() {} }
        let remove10 = class { set ['x'](_) {} }
        let remove11 = class { async ['x']() {} }
        let remove12 = class { [0] = 'x' }
        let remove13 = class { [null] = 'x' }
        let remove14 = class { [undefined] = 'x' }
        let remove15 = class { [false] = 'x' }
        let remove16 = class { [0n] = 'x' }
        let remove17 = class { toString() {} }
        
        let keep1 = class { [x] = 'x' }
        let keep2 = class { [x]() {} }
        let keep3 = class { get [x]() {} }
        let keep4 = class { set [x](_) {} }
        let keep5 = class { async [x]() {} }
        let keep6 = class { [{ toString() { console.log(1); } }] = 'x' }
        let keep7 = class { [{ toString() {} }] = 'x' }
      `,
    },
    treeShaking: true,
    dce: true,
  });
  itBundled("dce/TreeShakingClassStaticProperty", {
    files: {
      "/entry.js": /* js */ `
        let remove1 = class { static x }
        let remove3 = class { static x() {} }
        let remove4 = class { static get x() {} }
        let remove5 = class { static set x(_) {} }
        let remove6 = class { static async x() {} }
        let remove8 = class { static ['x']() {} }
        let remove9 = class { static get ['x']() {} }
        let remove10 = class { static set ['x'](_) {} }
        let remove11 = class { static async ['x']() {} }
        let remove12 = class { static [0] = 'x' }
        let remove13 = class { static [null] = 'x' }
        let remove14 = class { static [undefined] = 'x' }
        let remove15 = class { static [false] = 'x' }
        let remove16 = class { static [0n] = 'x' }
        let remove17 = class { static toString() {} }
  
        let keep1 = class { static x = x }
        let keep2 = class { static ['x'] = x }
        let keep3 = class { static [x] = 'x' }
        let keep4 = class { static [x]() {} }
        let keep5 = class { static get [x]() {} }
        let keep6 = class { static set [x](_) {} }
        let keep7 = class { static async [x]() {} }
        let keep8 = class { static [{ toString() { console.log(1); } }] = 'x' }
        let keep9 = class { static [{ toString() {} }] = 'x' }
      `,
    },
    treeShaking: true,
    dce: true,
  });
  // https://github.com/oven-sh/bun/issues/20866
  itBundled("dce/TreeShakingClassPrivateProperty", {
    files: {
      "/entry.js": /* js */ `
        let remove1 = class { #x }
        let remove2 = class { #x = x }
        let remove3 = class { #x() {} }
        let remove4 = class { get #x() {} }
        let remove5 = class { set #x(_) {} }
        let remove6 = class { async #x() {} }
        let remove7 = class { static #x }
        let remove8 = class { static #x = 1 }
        let remove9 = class { static #x() {} }
        let remove10 = class { static get #x() {} }
        let remove11 = class { static set #x(_) {} }

        let keep1 = class { static #x = x }
        let keep2 = class { #x; static { x() } }
      `,
    },
    treeShaking: true,
    dce: true,
  });
  // https://github.com/oven-sh/bun/issues/20866
  itBundled("dce/TreeShakingClassPrivatePropertyDeclaration", {
    files: {
      "/entry.js": /* js */ `
        class REMOVE1 { #x }
        class REMOVE2 { #x = x }
        class REMOVE3 { #x() {} }
        class REMOVE4 { static #x }
        class REMOVE5 { static #x = 1 }
        class REMOVE6 { static #x() {} }

        class KEEP1 { static #x = x }
      `,
    },
    dce: true,
  });
  // Sibling of edgecase/TsEnumKeyedLiteralObjectTreeShaking#31755 for classes:
  // the computed-key check must unwrap EInlinedEnum before is_primitive_literal.
  itBundled("dce/TreeShakingClassEnumKey", {
    files: {
      "/entry.ts": /* ts */ `
        import { A } from './lib';
        console.log(JSON.stringify(A));
      `,
      "/lib.ts": /* ts */ `
        export enum A { FOO, BAR }
        export const unusedInstanceREMOVE = class { [A.FOO]() {} };
        export const unusedStaticREMOVE = class { static [A.BAR] = 1 };
      `,
    },
    dce: true,
    dceKeepMarkerCount: false,
    run: {
      stdout: `{"0":"FOO","1":"BAR","FOO":0,"BAR":1}`,
    },
  });
  // https://github.com/oven-sh/bun/issues/40114
  // A computed class member key that is a side-effect-free reference (a local
  // const, an import item) must not block tree-shaking of the class.
  itBundled("dce/TreeShakingClassComputedKeyReference", {
    files: {
      "/entry.js": /* js */ `
        import { used } from './lib';
        console.log(used);
      `,
      "/lib.js": /* js */ `
        import * as Other from './other';
        export const used = 1;
        const TypeId = '~lib/TypeId';
        class REMOVE1 { [TypeId]; }
        class REMOVE2 { [TypeId] = 'x' }
        class REMOVE3 { [TypeId]() {} }
        class REMOVE4 { static [TypeId] = 'x' }
        class REMOVE5 {
          [TypeId];
          [Other.TypeId];
          constructor() {
            this[TypeId] = TypeId;
            this[Other.TypeId] = Other.TypeId;
          }
        }
        export const makeREMOVE5 = () => new REMOVE5();
        let keep1 = class { [unboundKEEP] = 'x' };
      `,
      "/other.js": /* js */ `
        export const TypeId = '~other/TypeId';
        export const REMOVE6 = 'only the tree-shaken class references this module';
      `,
    },
    treeShaking: true,
    dce: true,
    dceKeepMarkerCount: 2,
  });
  itBundled("dce/TreeShakingUnaryOperators", {
    files: {
      "/entry.js": /* js */ `
        // These operators may have side effects
        let keep;
        +keep;
        -keep;
        ~keep;
        delete keep;
        ++keep;
        --keep;
        keep++;
        keep--;
  
        // These operators never have side effects
        let REMOVE;
        !REMOVE;
        void REMOVE;
      `,
    },
    format: "iife",
    dce: true,
  });
  itBundled("dce/TreeShakingBinaryOperators", {
    files: {
      "/entry.js": /* js */ `
        // These operators may have side effects
        let keep, keep2;
        keep + keep2;
        keep - keep2;
        keep * keep2;
        keep / keep2;
        keep % keep2;
        keep ** keep2;
        keep < keep2;
        keep <= keep2;
        keep > keep2;
        keep >= keep2;
        keep in keep2;
        keep instanceof keep2;
        keep << keep2;
        keep >> keep2;
        keep >>> keep2;
        keep == keep2;
        keep != keep2;
        keep | keep2;
        keep & keep2;
        keep ^ keep2;
        keep = keep2;
        keep += keep2;
        keep -= keep2;
        keep *= keep2;
        keep /= keep2;
        keep %= keep2;
        keep **= keep2;
        keep <<= keep2;
        keep >>= keep2;
        keep >>>= keep2;
        keep |= keep2;
        keep &= keep2;
        keep ^= keep2;
        keep ??= keep2;
        keep ||= keep2;
        keep &&= keep2;
  
        // These operators never have side effects
        let REMOVE, REMOVE2;
        REMOVE === REMOVE2;
        REMOVE !== REMOVE2;
        REMOVE, REMOVE2;
        REMOVE ?? REMOVE2;
        REMOVE || REMOVE2;
        REMOVE && REMOVE2;
      `,
    },
    dce: true,
    format: "iife",
  });
  itBundled("dce/TreeShakingNoBundleESM", {
    todo: true,
    files: {
      "/entry.js": /* js */ `
        function keep() {}
        function REMOVE() {}
        keep()
      `,
    },
    format: "esm",
    bundling: false,
    treeShaking: true,
    dce: true,
  });
  itBundled("dce/TreeShakingNoBundleCJS", {
    files: {
      "/entry.js": /* js */ `
        function keep() {}
        function REMOVE() {}
        keep()
      `,
    },
    dce: true,
    format: "cjs",
    treeShaking: true,
    bundling: false,
    todo: true,
  });
  itBundled("dce/TreeShakingNoBundleIIFE", {
    files: {
      "/entry.js": /* js */ `
        function keep() {}
        function REMOVE() {}
        keep()
      `,
    },
    dce: true,
    format: "iife",
    treeShaking: true,
    bundling: false,
    todo: true,
  });
  itBundled("dce/TreeShakingInESMWrapper", {
    files: {
      "/entry.js": /* js */ `
        import {keep1} from './lib'
        console.log(JSON.stringify([keep1(), require('./cjs')]))
      `,
      "/cjs.js": /* js */ `
        import {keep2} from './lib'
        export default keep2()
      `,
      "/lib.js": /* js */ `
        export let keep1 = () => 'keep1'
        export let keep2 = () => 'keep2'
        export let REMOVE = () => 'REMOVE'
      `,
    },
    format: "esm",
    dce: true,
    dceKeepMarkerCount: false,
    run: {
      stdout: '["keep1",{"default":"keep2"}]',
    },
  });
  itBundled("dce/DCETypeOf", {
    files: {
      "/entry.js": /* js */ `
        // These should be removed because they have no side effects
        typeof x_REMOVE
        typeof v_REMOVE
        typeof f_REMOVE
        typeof g_REMOVE
        typeof a_REMOVE
        var v_REMOVE
        function f_REMOVE() {}
        function* g_REMOVE() {}
        async function a_REMOVE() {}
  
        // TODO: These technically have side effects due to TDZ, but this is not currently handled
        typeof c_remove
        typeof l_remove
        typeof s_remove
        const c_remove = 0
        let l_remove
        class s_remove {}
      `,
    },
    format: "esm",
    dce: true,
  });
  itBundled("dce/DCETypeOfEqualsString", {
    files: {
      "/entry.js": /* js */ `
        var hasBar = typeof REMOVE !== 'undefined'
        if (false) console.log(hasBar)
      `,
    },
    format: "iife",
    dce: true,
  });
  itBundled("dce/DCETypeOfEqualsStringMangle", {
    files: {
      "/entry.js": /* js */ `
        // Everything here should be removed as dead code due to tree shaking
        var REMOVE1 = typeof REMOVE2 !== 'undefined'
        if (false) console.log(REMOVE1)
      `,
    },
    format: "iife",
    minifySyntax: true,
    dce: true,
  });
  itBundled("dce/DCETypeOfEqualsStringGuardCondition", {
    files: {
      "/entry.js": /* js */ `
        // Everything here should be removed as dead code due to tree shaking
        var REMOVE_1 = typeof x !== 'undefined' ? x : null
        var REMOVE_1 = typeof x != 'undefined' ? x : null
        var REMOVE_1 = typeof x === 'undefined' ? null : x
        var REMOVE_1 = typeof x == 'undefined' ? null : x
        var REMOVE_1 = typeof x !== 'undefined' && x
        var REMOVE_1 = typeof x != 'undefined' && x
        var REMOVE_1 = typeof x === 'undefined' || x
        var REMOVE_1 = typeof x == 'undefined' || x
        var REMOVE_1 = 'undefined' !== typeof x ? x : null
        var REMOVE_1 = 'undefined' != typeof x ? x : null
        var REMOVE_1 = 'undefined' === typeof x ? null : x
        var REMOVE_1 = 'undefined' == typeof x ? null : x
        var REMOVE_1 = 'undefined' !== typeof x && x
        var REMOVE_1 = 'undefined' != typeof x && x
        var REMOVE_1 = 'undefined' === typeof x || x
        var REMOVE_1 = 'undefined' == typeof x || x
  
        // Everything here should be removed as dead code due to tree shaking
        var REMOVE_2 = typeof x === 'object' ? x : null
        var REMOVE_2 = typeof x == 'object' ? x : null
        var REMOVE_2 = typeof x !== 'object' ? null : x
        var REMOVE_2 = typeof x != 'object' ? null : x
        var REMOVE_2 = typeof x === 'object' && x
        var REMOVE_2 = typeof x == 'object' && x
        var REMOVE_2 = typeof x !== 'object' || x
        var REMOVE_2 = typeof x != 'object' || x
        var REMOVE_2 = 'object' === typeof x ? x : null
        var REMOVE_2 = 'object' == typeof x ? x : null
        var REMOVE_2 = 'object' !== typeof x ? null : x
        var REMOVE_2 = 'object' != typeof x ? null : x
        var REMOVE_2 = 'object' === typeof x && x
        var REMOVE_2 = 'object' == typeof x && x
        var REMOVE_2 = 'object' !== typeof x || x
        var REMOVE_2 = 'object' != typeof x || x
  
        // Everything here should be kept as live code because it has side effects
        var keep_1 = typeof x !== 'object' ? x : null
        var keep_1 = typeof x != 'object' ? x : null
        var keep_1 = typeof x === 'object' ? null : x
        var keep_1 = typeof x == 'object' ? null : x
        var keep_1 = typeof x !== 'object' && x
        var keep_1 = typeof x != 'object' && x
        var keep_1 = typeof x === 'object' || x
        var keep_1 = typeof x == 'object' || x
        var keep_1 = 'object' !== typeof x ? x : null
        var keep_1 = 'object' != typeof x ? x : null
        var keep_1 = 'object' === typeof x ? null : x
        var keep_1 = 'object' == typeof x ? null : x
        var keep_1 = 'object' !== typeof x && x
        var keep_1 = 'object' != typeof x && x
        var keep_1 = 'object' === typeof x || x
        var keep_1 = 'object' == typeof x || x
  
        // Everything here should be kept as live code because it has side effects
        var keep_2 = typeof x !== 'undefined' ? y : null
        var keep_2 = typeof x != 'undefined' ? y : null
        var keep_2 = typeof x === 'undefined' ? null : y
        var keep_2 = typeof x == 'undefined' ? null : y
        var keep_2 = typeof x !== 'undefined' && y
        var keep_2 = typeof x != 'undefined' && y
        var keep_2 = typeof x === 'undefined' || y
        var keep_2 = typeof x == 'undefined' || y
        var keep_2 = 'undefined' !== typeof x ? y : null
        var keep_2 = 'undefined' != typeof x ? y : null
        var keep_2 = 'undefined' === typeof x ? null : y
        var keep_2 = 'undefined' == typeof x ? null : y
        var keep_2 = 'undefined' !== typeof x && y
        var keep_2 = 'undefined' != typeof x && y
        var keep_2 = 'undefined' === typeof x || y
        var keep_2 = 'undefined' == typeof x || y
  
        // Everything here should be kept as live code because it has side effects
        var keep_3 = typeof x !== 'undefined' ? null : x
        var keep_3 = typeof x != 'undefined' ? null : x
        var keep_3 = typeof x === 'undefined' ? x : null
        var keep_3 = typeof x == 'undefined' ? x : null
        var keep_3 = typeof x !== 'undefined' || x
        var keep_3 = typeof x != 'undefined' || x
        var keep_3 = typeof x === 'undefined' && x
        var keep_3 = typeof x == 'undefined' && x
        var keep_3 = 'undefined' !== typeof x ? null : x
        var keep_3 = 'undefined' != typeof x ? null : x
        var keep_3 = 'undefined' === typeof x ? x : null
        var keep_3 = 'undefined' == typeof x ? x : null
        var keep_3 = 'undefined' !== typeof x || x
        var keep_3 = 'undefined' != typeof x || x
        var keep_3 = 'undefined' === typeof x && x
        var keep_3 = 'undefined' == typeof x && x
      `,
    },
    format: "iife",
    dce: true,
  });
  itBundled("dce/DCETypeOfCompareStringGuardCondition", {
    files: {
      "/entry.js": /* js */ `
        // Everything here should be removed as dead code due to tree shaking
        var REMOVE_1 = typeof x <= 'u' ? x : null
        var REMOVE_1 = typeof x < 'u' ? x : null
        var REMOVE_1 = typeof x >= 'u' ? null : x
        var REMOVE_1 = typeof x > 'u' ? null : x
        var REMOVE_1 = typeof x <= 'u' && x
        var REMOVE_1 = typeof x < 'u' && x
        var REMOVE_1 = typeof x >= 'u' || x
        var REMOVE_1 = typeof x > 'u' || x
        var REMOVE_1 = 'u' >= typeof x ? x : null
        var REMOVE_1 = 'u' > typeof x ? x : null
        var REMOVE_1 = 'u' <= typeof x ? null : x
        var REMOVE_1 = 'u' < typeof x ? null : x
        var REMOVE_1 = 'u' >= typeof x && x
        var REMOVE_1 = 'u' > typeof x && x
        var REMOVE_1 = 'u' <= typeof x || x
        var REMOVE_1 = 'u' < typeof x || x
  
        // Everything here should be kept as live code because it has side effects
        var keep_1 = typeof x <= 'u' ? y : null
        var keep_1 = typeof x < 'u' ? y : null
        var keep_1 = typeof x >= 'u' ? null : y
        var keep_1 = typeof x > 'u' ? null : y
        var keep_1 = typeof x <= 'u' && y
        var keep_1 = typeof x < 'u' && y
        var keep_1 = typeof x >= 'u' || y
        var keep_1 = typeof x > 'u' || y
        var keep_1 = 'u' >= typeof x ? y : null
        var keep_1 = 'u' > typeof x ? y : null
        var keep_1 = 'u' <= typeof x ? null : y
        var keep_1 = 'u' < typeof x ? null : y
        var keep_1 = 'u' >= typeof x && y
        var keep_1 = 'u' > typeof x && y
        var keep_1 = 'u' <= typeof x || y
        var keep_1 = 'u' < typeof x || y
  
        // Everything here should be kept as live code because it has side effects
        var keep_2 = typeof x <= 'u' ? null : x
        var keep_2 = typeof x < 'u' ? null : x
        var keep_2 = typeof x >= 'u' ? x : null
        var keep_2 = typeof x > 'u' ? x : null
        var keep_2 = typeof x <= 'u' || x
        var keep_2 = typeof x < 'u' || x
        var keep_2 = typeof x >= 'u' && x
        var keep_2 = typeof x > 'u' && x
        var keep_2 = 'u' >= typeof x ? null : x
        var keep_2 = 'u' > typeof x ? null : x
        var keep_2 = 'u' <= typeof x ? x : null
        var keep_2 = 'u' < typeof x ? x : null
        var keep_2 = 'u' >= typeof x || x
        var keep_2 = 'u' > typeof x || x
        var keep_2 = 'u' <= typeof x && x
        var keep_2 = 'u' < typeof x && x
      `,
    },
    format: "iife",
    minifySyntax: true,
    dce: true,
  });
  itBundled("dce/RemoveUnusedImports", {
    todo: true,
    files: {
      "/entry.js": /* js */ `
        import REMOVE1 from 'a'
        import * as REMOVE2 from 'b'
        import {REMOVE3} from 'c'
      `,
    },
    minifySyntax: true,
    dce: true,
    external: ["a", "b", "c"],
    onAfterBundle(api) {
      api.expectFile("/out.js").toBe(
        dedent`
          import "a";
          import "b";
          import "c";
        ` + "\n",
      );
    },
  });
  itBundled("dce/RemoveUnusedImportsEval", {
    files: {
      "/entry.js": /* js */ `
        import keep_a from 'a'
        import * as keep_b from 'b'
        import {keep_c} from 'c'
        eval('foo(keep_a, keep_b, keep_c)')
      `,
    },
    minifySyntax: true,
    bundling: false,
    dce: true,
  });
  itBundled("dce/RemoveUnusedImportsEvalTS", {
    files: {
      "/entry.ts": /* ts */ `
        import drop_a from 'a'
        import * as drop_b from 'b'
        import {drop_c} from 'c'
        eval('foo(a, b, c)')
      `,
    },
    dce: true,
    minifySyntax: true,
    bundling: false,
  });
  itBundled("dce/DCEClassStaticBlocks", {
    files: {
      "/entry.ts": /* ts */ `
        class A_REMOVE {
          static {}
        }
        class B_REMOVE {
          static { 123 }
        }
        class C_REMOVE {
          static { /* @__PURE__*/ foo() }
        }
        class D_REMOVE {
          static { try {} catch {} }
        }
        class E_REMOVE {
          static { try { /* @__PURE__*/ foo() } catch {} }
        }
        class F_REMOVE {
          static { try { 123 } catch { 123 } finally { 123 } }
        }
  
        class A_keep {
          static { foo }
        }
        class B_keep {
          static { this.foo }
        }
        class C_keep {
          static { try { foo } catch {} }
        }
        class D_keep {
          static { try {} finally { foo } }
        }
      `,
    },
    dce: true,
  });
  itBundled("dce/DCEVarExports", {
    files: {
      "/a.js": /* js */ `
        var foo = { keep: 123 }
        module.exports = foo
      `,
      "/b.js": /* js */ `
        var exports = { keep: 123 }
        module.exports = exports
      `,
      "/c.js": /* js */ `
        var module = { keep: 123 }
        exports.foo = module
      `,
    },
    dce: true,
    entryPoints: ["/a.js", "/b.js", "/c.js"],
  });
  itBundled("dce/DCETemplateLiteral", {
    files: {
      "/entry.js":
        "var remove;\n" +
        "var alsoKeep;\n" +
        "let a = `${keep}`\n" +
        "let remove2 = `${123}`\n" +
        "let c = `${keep ? 1 : 2n}`\n" +
        "let remove3 = `${remove ? 1 : 2n}`\n" +
        "let e = `${alsoKeep}`\n",
    },
    dce: true,
  });
  itBundled("dce/DCEOfDestructuring", {
    files: {
      "/entry.js": /* js */ `
        // Identifier bindings
        var remove1
        var remove2 = null
        var KEEP1 = x

        // Array patterns over an array literal use the built-in array iterator
        // and are side-effect free
        var [remove3] = []
        var [remove4 = 0] = [null]
        var [remove5, , remove6] = [null, undefined, 0]
        var [...remove7] = []
        var [KEEP2] = x
        var [KEEP3 = x] = [null]
        var [[KEEP4]] = [[]]
        var [{ KEEP5 }] = [{}]
        var [KEEP6] = {}

        // Object patterns over an object literal are side-effect free when
        // every key names a data property of the literal
        var { remove8 } = { remove8: 1 }
        var { remove9 = 0 } = { remove9: 1 }
        var { remove10: remove11 } = { remove10: 1 }
        var { remove12 } = { remove12() {} }
        var { remove13, remove14 } = { remove13: 1, remove14: 2, other: 3 }
        var { remove15 } = { get remove15() { return 1 }, remove15: 1 }
        var { remove16: { remove17 } } = { remove16: { remove17: 1 } }
        var { remove18: [remove19] } = { remove18: [1] }

        // Anything else in an object pattern can invoke a getter
        var { KEEP7 } = {}
        var { KEEP8 = 0 } = {}
        var { KEEP9 } = x
        var { KEEP10: { KEEP11 } } = {}
        var { ...KEEP12 } = {}
        var { KEEP13 } = { get KEEP13() { return 1 } }
        var { KEEP14 } = { KEEP14: 1, get KEEP14() { return 1 } }
        var { KEEP15 } = { __proto__: null }
        var { KEEP16 } = { other: 1 }
        var { ["KEEP17"]: KEEP18 } = { KEEP17: 1 }
        var { ...KEEP19 } = { KEEP20: 1 }
        var { KEEP21: { KEEP22 } } = { KEEP21: undefined }
        var { KEEP23: [KEEP24] } = { KEEP23: null }
        var { "0": KEEP25 } = { "0": 1, get 0() { return 2 } }
      `,
    },
    dce: true,
  });
  itBundled("dce/DCEOfDestructuringSideEffects", {
    files: {
      "/entry.js": /* js */ `
        const obj = { get x() { console.log("EFFECT1"); return 1 } }
        const { x } = obj
        const { y } = { get y() { console.log("EFFECT2"); return 2 } }
        const iter = { [Symbol.iterator]() { console.log("EFFECT3"); return [][Symbol.iterator]() } }
        const [a] = iter
        const [[b]] = [iter]
        const [{ x: c }] = [obj]
        export function used() {}
      `,
    },
    run: {
      stdout: "EFFECT1\nEFFECT2\nEFFECT3\nEFFECT3\nEFFECT1",
    },
  });
  itBundled("dce/DCEOfDestructuringOfImportNamespace", {
    files: {
      "/entry.js": /* js */ `
        import * as ns from './lib.js'
        import * as cjs from './cjs.js'
        import { sub } from './reexport.js'
        import * as ns2 from './lib3.js'

        // An unused destructuring of a module namespace reads like a member
        // access and is side-effect free
        const { removeMe1 } = ns
        const { shorthand: removeMe2, other: removeMe3 } = ns
        var { x: removeMe4 } = cjs
        let { inner: removeMe5 } = sub

        // Anything that can run user code must stay
        const { [KEEP0]: KEEP1 } = ns2
        const { ...KEEP2 } = ns2
        const { nested: { KEEP3 } } = ns2
        const { withDefault: KEEP4 = keep4() } = ns2
        const plain = keep5()
        const { KEEP6 } = plain
      `,
      "/lib.js": /* js */ `
        export const removeMe1 = 1
        export const shorthand = 2, other = 3
      `,
      "/cjs.js": /* js */ `
        exports.x = 1
      `,
      "/reexport.js": /* js */ `
        export * as sub from './lib2.js'
      `,
      "/lib2.js": /* js */ `
        export const inner = 7
      `,
      "/lib3.js": /* js */ `
        export const nested = { a: 6 }, withDefault = 5
      `,
    },
    dce: true,
  });
  itBundled("dce/DestructuringOfImportNamespaceRuntime", {
    files: {
      "/entry.js": /* js */ `
        import * as ns from './lib.js'
        const { one, two: renamed } = ns
        const { unused } = ns
        console.log(one(), renamed)
      `,
      "/lib.js": /* js */ `
        export function one() { return 1 }
        export const two = 2
        export const unused = 3
      `,
    },
    run: {
      stdout: "1 2",
    },
  });
  itBundled("dce/DCEOfDestructuringOfUnwrappedRequire", {
    files: {
      "/entry.js": /* js */ `
        export {}
        const { x: removeMe1 } = require('react')
        KEEP1()
      `,
      "/node_modules/react/index.js": /* js */ `
        exports.x = 1
      `,
      "/node_modules/react/package.json": `{ "name": "react", "version": "19.0.0" }`,
    },
    dce: true,
  });
  // A direct eval() pins every symbol-declaring part: the eval'd code can
  // reference the destructured binding by name.
  itBundled("dce/DestructuringOfImportNamespaceDirectEval", {
    files: {
      "/entry.js": /* js */ `
        import * as ns from './lib.js'
        const { helper } = ns
        eval('helper()')
      `,
      "/lib.js": /* js */ `
        export function helper() { console.log("HELPER RAN") }
      `,
    },
    run: {
      stdout: "HELPER RAN",
    },
  });
  // A `for (var ns of ...)` head re-initializes the lifted namespace local
  // without an assignment the parser records, so a hoisted symbol is never
  // treated as a namespace and the destructuring stays.
  itBundled("dce/DestructuringOfForOfReboundUnwrappedRequire", {
    files: {
      "/entry.js": /* js */ `
        export {}
        var ns = require('react')
        for (var ns of [{ get x() { console.log("EFFECT") } }]) {}
        const { x } = ns
        console.log("entry")
      `,
      "/node_modules/react/index.js": /* js */ `
        exports.x = 1
      `,
      "/node_modules/react/package.json": `{ "name": "react", "version": "19.0.0" }`,
    },
    run: {
      stdout: "EFFECT\nentry",
    },
  });
  // A lifted require() namespace is an ordinary local. When user code
  // rebinds it, the value can hold getters, so the destructuring must stay.
  itBundled("dce/DestructuringOfReboundUnwrappedRequire", {
    files: {
      "/entry.js": /* js */ `
        export {}
        var ns = require('react')
        ns = { get x() { console.log("EFFECT"); return 2 } }
        const { x } = ns
        console.log("entry")
      `,
      "/node_modules/react/index.js": /* js */ `
        exports.x = 1
      `,
      "/node_modules/react/package.json": `{ "name": "react", "version": "19.0.0" }`,
    },
    run: {
      stdout: "EFFECT\nentry",
    },
  });
  itBundled("dce/TreeShakingLoweredClassStaticField", {
    files: {
      "/entry.js": /* js */ `
        class REMOVE_ME {
          static x = 'x'
          static y = 'y'
          static z = 'z'
        }
        function REMOVE_ME_TOO() {
          new REMOVE_ME()
        }
        class KeepMe1 {
          static x = 'x'
          static y = sideEffects()
          static z = 'z'
        }
        class KeepMe2 {
          static x = 'x'
          static y = 'y'
          static z = 'z'
        }
        new KeepMe2()
      `,
    },
    dce: true,
    dceKeepMarkerCount: 9,
    unsupportedJSFeatures: ["class-field"],
  });
  itBundled("dce/TreeShakingLoweredClassStaticFieldMinified", {
    files: {
      "/entry.js": /* js */ `
        class REMOVE_ME {
          static x = 'x'
          static y = 'y'
          static z = 'z'
        }
        function REMOVE_ME_TOO() {
          new REMOVE_ME()
        }
        class KeepMe1 {
          static x = 'x'
          static y = sideEffects()
          static z = 'z'
        }
        class KeepMe2 {
          static x = 'x'
          static y = 'y'
          static z = 'z'
        }
        new KeepMe2()
      `,
    },
    dce: true,
    dceKeepMarkerCount: 9,
    unsupportedJSFeatures: ["class-field"],
    minifySyntax: true,
  });
  itBundled("dce/TreeShakingLoweredClassStaticFieldAssignment", {
    files: {
      "/entry.ts": /* ts */ `
        class KeepMe1 {
          static x = 'x'
          static y = 'y'
          static z = 'z'
        }
        class KeepMe2 {
          static x = 'x'
          static y = sideEffects_keep()
          static z = 'z'
        }
        class KeepMe3 {
          static x = 'x'
          static y = 'y'
          static z = 'z'
        }
        new KeepMe3()
      `,
    },
    unsupportedJSFeatures: ["class-field"],
    dce: true,
    dceKeepMarkerCount: 14,
  });
  itBundled("dce/InlineIdentityFunctionCalls", {
    todo: true,
    files: {
      "/identity.js": /* js */ `
        function DROP(x) { return x }
        console.log(DROP(1))
        DROP(foo())
        DROP(1)
      `,
      "/identity-last.js": /* js */ `
        function DROP(x) { return [x] }
        function DROP(x) { return x }
        console.log(DROP(1))
        DROP(foo())
        DROP(1)
      `,
      "/identity-cross-module.js": /* js */ `
        import { DROP } from './identity-cross-module-def'
        console.log(DROP(1))
        DROP(foo())
        DROP(1)
      `,
      "/identity-cross-module-def.js": `export function DROP(x) { return x }`,
      "/identity-no-args.js": /* js */ `
        function keep(x) { return x }
        console.log(keep())
        keep()
      `,
      "/identity-two-args.js": /* js */ `
        function keep(x) { return x }
        console.log(keep(1, 2))
        keep(1, 2)
      `,
      "/identity-first.js": /* js */ `
        function keep(x) { return x }
        function keep(x) { return [x] }
        console.log(keep(1))
        keep(foo())
        keep(1)
      `,
      "/identity-generator.js": /* js */ `
        function* keep(x) { return x }
        console.log(keep(1))
        keep(foo())
        keep(1)
      `,
      "/identity-async.js": /* js */ `
        async function keep(x) { return x }
        console.log(keep(1))
        keep(foo())
        keep(1)
      `,
      "/reassign.js": /* js */ `
        function keep(x) { return x }
        keep = reassigned
        console.log(keep(1))
        keep(foo())
        keep(1)
      `,
      "/reassign-inc.js": /* js */ `
        function keep(x) { return x }
        keep++
        console.log(keep(1))
        keep(foo())
        keep(1)
      `,
      "/reassign-div.js": /* js */ `
        function keep(x) { return x }
        keep /= reassigned
        console.log(keep(1))
        keep(foo())
        keep(1)
      `,
      "/reassign-array.js": /* js */ `
        function keep(x) { return x }
        [keep] = reassigned
        console.log(keep(1))
        keep(foo())
        keep(1)
      `,
      "/reassign-object.js": /* js */ `
        function keep(x) { return x }
        ({keep} = reassigned)
        console.log(keep(1))
        keep(foo())
        keep(1)
      `,
      "/not-identity-two-args.js": /* js */ `
        function keep(x, y) { return x }
        console.log(keep(1))
        keep(foo())
        keep(1)
      `,
      "/not-identity-default.js": /* js */ `
        function keep(x = foo()) { return x }
        console.log(keep(1))
        keep(foo())
        keep(1)
      `,
      "/not-identity-array.js": /* js */ `
        function keep([x]) { return x }
        console.log(keep(1))
        keep(foo())
        keep(1)
      `,
      "/not-identity-object.js": /* js */ `
        function keep({x}) { return x }
        console.log(keep(1))
        keep(foo())
        keep(1)
      `,
      "/not-identity-rest.js": /* js */ `
        function keep(...x) { return x }
        console.log(keep(1))
        keep(foo())
        keep(1)
      `,
      "/not-identity-return.js": /* js */ `
        function keep(x) { return [x] }
        console.log(keep(1))
        keep(foo())
        keep(1)
      `,
    },
    entryPoints: [
      "/identity.js",
      "/identity-last.js",
      "/identity-first.js",
      "/identity-generator.js",
      "/identity-async.js",
      "/identity-cross-module.js",
      "/identity-no-args.js",
      "/identity-two-args.js",
      "/reassign.js",
      "/reassign-inc.js",
      "/reassign-div.js",
      "/reassign-array.js",
      "/reassign-object.js",
      "/not-identity-two-args.js",
      "/not-identity-default.js",
      "/not-identity-array.js",
      "/not-identity-object.js",
      "/not-identity-rest.js",
      "/not-identity-return.js",
    ],
    dce: true,
    minifySyntax: false,
    dceKeepMarkerCount: {
      "/out/identity-first.js": 4,
    },
  });
  itBundled("dce/InlineEmptyFunctionCalls", {
    todo: true,
    files: {
      "/empty.js": /* js */ `
        function DROP() {}
        console.log(DROP(foo(), bar()))
        console.log(DROP(foo(), 1))
        console.log(DROP(1, foo()))
        console.log(DROP(1))
        console.log(DROP())
        DROP(foo(), bar())
        DROP(foo(), 1)
        DROP(1, foo())
        DROP(1)
        DROP()
      `,
      "/empty-comma.js": /* js */ `
        function DROP() {}
        console.log((DROP(), DROP(), foo()))
        console.log((DROP(), foo(), DROP()))
        console.log((foo(), DROP(), DROP()))
        for (DROP(); DROP(); DROP()) DROP();
        DROP(), DROP(), foo();
        DROP(), foo(), DROP();
        foo(), DROP(), DROP();
      `,
      "/empty-if-else.js": /* js */ `
        function DROP() {}
        if (foo) { let bar = baz(); bar(); bar() } else DROP();
      `,
      "/empty-last.js": /* js */ `
        function DROP() { return x }
        function DROP() { return }
        console.log(DROP())
        DROP()
      `,
      "/empty-cross-module.js": /* js */ `
        import { DROP } from './empty-cross-module-def'
        console.log(DROP())
        DROP()
      `,
      "/empty-cross-module-def.js": `export function DROP() {}`,
      "/empty-first.js": /* js */ `
        function keep() { return }
        function keep() { return x }
        console.log(keep())
        keep(foo())
        keep(1)
      `,
      "/empty-generator.js": /* js */ `
        function* keep() {}
        console.log(keep())
        keep(foo())
        keep(1)
      `,
      "/empty-async.js": /* js */ `
        async function keep() {}
        console.log(keep())
        keep(foo())
        keep(1)
      `,
      "/reassign.js": /* js */ `
        function keep() {}
        keep = reassigned
        console.log(keep())
        keep(foo())
        keep(1)
      `,
      "/reassign-inc.js": /* js */ `
        function keep() {}
        keep++
        console.log(keep(1))
        keep(foo())
        keep(1)
      `,
      "/reassign-div.js": /* js */ `
        function keep() {}
        keep /= reassigned
        console.log(keep(1))
        keep(foo())
        keep(1)
      `,
      "/reassign-array.js": /* js */ `
        function keep() {}
        [keep] = reassigned
        console.log(keep(1))
        keep(foo())
        keep(1)
      `,
      "/reassign-object.js": /* js */ `
        function keep() {}
        ({keep} = reassigned)
        console.log(keep(1))
        keep(foo())
        keep(1)
      `,
    },
    entryPoints: [
      "/empty.js",
      "/empty-comma.js",
      "/empty-if-else.js",
      "/empty-last.js",
      "/empty-cross-module.js",
      "/empty-first.js",
      "/empty-generator.js",
      "/empty-async.js",
      "/reassign.js",
      "/reassign-inc.js",
      "/reassign-div.js",
      "/reassign-array.js",
      "/reassign-object.js",
    ],
    minifySyntax: true,
    dce: true,
    dceKeepMarkerCount: {
      "/out/empty-first.js": 4,
    },
  });
  itBundled("dce/InlineFunctionCallBehaviorChanges", {
    todo: true,
    files: {
      // At the time of writing, using a template string here triggered a bug in bun's transpiler
      // making it impossible to run the test.
      "/entry.js":
        "function empty_REMOVE() { }\n" +
        "function id_REMOVE(x) { return x }\n" +
        "\n" +
        "export let shouldBeWrapped = [\n" +
        "  id_REMOVE(foo.bar)(),\n" +
        "  id_REMOVE(foo[bar])(),\n" +
        "  id_REMOVE(foo?.bar)(),\n" +
        "  id_REMOVE(foo?.[bar])(),\n" +
        "\n" +
        "  (empty_REMOVE(), foo.bar)(),\n" +
        "  (empty_REMOVE(), foo[bar])(),\n" +
        "  (empty_REMOVE(), foo?.bar)(),\n" +
        "  (empty_REMOVE(), foo?.[bar])(),\n" +
        "\n" +
        "  id_REMOVE(eval)(),\n" +
        "  id_REMOVE(eval)?.(),\n" +
        "  (empty_REMOVE(), eval)(),\n" +
        "  (empty_REMOVE(), eval)?.(),\n" +
        "\n" +
        "  id_REMOVE(foo.bar)``,\n" +
        "  id_REMOVE(foo[bar])``,\n" +
        "  id_REMOVE(foo?.bar)``,\n" +
        "  id_REMOVE(foo?.[bar])``,\n" +
        "\n" +
        "  (empty_REMOVE(), foo.bar)``,\n" +
        "  (empty_REMOVE(), foo[bar])``,\n" +
        "  (empty_REMOVE(), foo?.bar)``,\n" +
        "  (empty_REMOVE(), foo?.[bar])``,\n" +
        "\n" +
        "  delete id_REMOVE(foo),\n" +
        "  delete id_REMOVE(foo.bar),\n" +
        "  delete id_REMOVE(foo[bar]),\n" +
        "  delete id_REMOVE(foo?.bar),\n" +
        "  delete id_REMOVE(foo?.[bar]),\n" +
        "\n" +
        "  delete (empty_REMOVE(), foo),\n" +
        "  delete (empty_REMOVE(), foo.bar),\n" +
        "  delete (empty_REMOVE(), foo[bar]),\n" +
        "  delete (empty_REMOVE(), foo?.bar),\n" +
        "  delete (empty_REMOVE(), foo?.[bar]),\n" +
        "\n" +
        "  delete empty_REMOVE(),\n" +
        "]\n" +
        "\n" +
        "export let shouldNotBeWrapped = [\n" +
        "  id_REMOVE(foo)(),\n" +
        "  (empty_REMOVE(), foo)(),\n" +
        "\n" +
        "  id_REMOVE(foo)``,\n" +
        "  (empty_REMOVE(), foo)``,\n" +
        "]\n" +
        "\n" +
        "export let shouldNotBeDoubleWrapped = [\n" +
        "  delete (empty_REMOVE(), foo(), foo()),\n" +
        "  delete id_REMOVE((foo(), bar())),\n" +
        "]",
    },
    bundling: false,
    minifySyntax: true,
    treeShaking: true,
    dce: true,
  });
  itBundled("dce/InlineFunctionCallForInitDecl", {
    todo: true,
    files: {
      "/entry.js": /* js */ `
        function empty_REMOVE() {}
        function id_REMOVE(x) { return x }
  
        for (var y = empty_REMOVE(); false; ) ;
        for (var z = id_REMOVE(123); false; ) ;
      `,
    },
    minifySyntax: true,
    dce: true,
  });
  itBundled("dce/ConstValueInliningNoBundle", {
    todo: true,
    files: {
      "/top-level.js": /* js */ `
        // These should be kept because they are top-level and tree shaking is not enabled
        const n_keep = null
        const u_keep = undefined
        const i_keep = 1234567
        const f_keep = 123.456
        const s_keep = ''
  
        // Values should still be inlined
        console.log(
          // These are doubled to avoid the "inline const/let into next statement if used once" optimization
          n_keep, n_keep,
          u_keep, u_keep,
          i_keep, i_keep,
          f_keep, f_keep,
          s_keep, s_keep,
        )
      `,
      "/nested-block.js": /* js */ `
        {
          const REMOVE_n = null
          const REMOVE_u = undefined
          const REMOVE_i = 1234567
          const REMOVE_f = 123.456
          const s_keep = '' // String inlining is intentionally not supported right now
          console.log(
            // These are doubled to avoid the "inline const/let into next statement if used once" optimization
            REMOVE_n, REMOVE_n,
            REMOVE_u, REMOVE_u,
            REMOVE_i, REMOVE_i,
            REMOVE_f, REMOVE_f,
            s_keep, s_keep,
          )
        }
      `,
      "/nested-function.js": /* js */ `
        function nested() {
          const REMOVE_n = null
          const REMOVE_u = undefined
          const REMOVE_i = 1234567
          const REMOVE_f = 123.456
          const s_keep = '' // String inlining is intentionally not supported right now
          console.log(
            // These are doubled to avoid the "inline const/let into next statement if used once" optimization
            REMOVE_n, REMOVE_n,
            REMOVE_u, REMOVE_u,
            REMOVE_i, REMOVE_i,
            REMOVE_f, REMOVE_f,
            s_keep, s_keep,
          )
        }
        console.log(nested())
      `,
      "/namespace-export.ts": /* ts */ `
        namespace ns {
          const x_REMOVE = 1
          export const y_keep = 2
          console.log(
            x_REMOVE, x_REMOVE,
            y_keep, y_keep,
          )
        }
      `,
      "/comment-before.js": /* js */ `
        {
          //! comment
          const REMOVE = 1
          x = [REMOVE, REMOVE]
        }
      `,
      "/directive-before.js": /* js */ `
        function nested() {
          'directive'
          const REMOVE = 1
          x = [REMOVE, REMOVE]
        }
      `,
      "/semicolon-before.js": /* js */ `
        {
          ;
          const REMOVE = 1
          x = [REMOVE, REMOVE]
        }
      `,
      "/debugger-before.js": /* js */ `
        {
          debugger
          const REMOVE = 1
          x = [REMOVE, REMOVE]
        }
      `,
      "/type-before.ts": /* ts */ `
        {
          declare let x
          const REMOVE = 1
          x = [REMOVE, REMOVE]
        }
      `,
      "/exprs-before.js": /* js */ `
        function nested() {
          const x = [, '', {}, 0n, /./, function() {}, () => {}]
          const y_REMOVE = 1
          function foo() {
            return y_REMOVE
          }
          console.log(foo)
        }
        console.log(nested());
      `,
      "/disabled-tdz.js": /* js */ `
        console.log(foo())
        const x_keep = 1
        function foo() {
          return x_keep
        }
      `,
      "/backwards-reference-top-level.js": /* js */ `
        const x = y
        const y = 1
        console.log(
          x, x,
          y, y,
        )
      `,
      "/backwards-reference-nested-function.js": /* js */ `
        function foo() {
          const x = y
          const y = 1
          console.log(
            x, x,
            y, y,
          )
        }
        console.log(foo())
      `,
    },
    entryPoints: [
      "/top-level.js",
      "/nested-block.js",
      "/nested-function.js",
      "/namespace-export.ts",
      "/comment-before.js",
      "/directive-before.js",
      "/semicolon-before.js",
      "/debugger-before.js",
      "/type-before.ts",
      "/exprs-before.js",
      "/disabled-tdz.js",
      "/backwards-reference-top-level.js",
      "/backwards-reference-nested-function.js",
    ],
    minifySyntax: true,
    dce: true,
    dceKeepMarkerCount: {
      "/out/top-level.js": 5,
      "/out/nested-function.js": 3,
      "/out/namespace-export.js": 1,
    },
  });
  itBundled("dce/ConstValueInliningBundle", {
    files: {
      "/exported-entry.js": /* js */ `
        const x_REMOVE = 1
        export const y_keep = 2
        console.log(
          x_REMOVE,
          y_keep,
        )
      `,
      "/re-exported-entry.js": /* js */ `
        import { x_REMOVE, y_keep } from './re-exported-constants'
        console.log(x_REMOVE, y_keep)
        export { y_keep }
      `,
      "/re-exported-constants.js": /* js */ `
        export const x_REMOVE = 1
        export const y_keep = 2
      `,
      "/re-exported-2-entry.js": `export { y_keep } from './re-exported-2-constants'`,
      "/re-exported-2-constants.js": /* js */ `
        export const x_REMOVE = 1
        export const y_keep = 2
      `,
      "/re-exported-star-entry.js": `export * from './re-exported-star-constants'`,
      "/re-exported-star-constants.js": /* js */ `
        export const x_keep = 1
        export const y_keep = 2
      `,
      "/cross-module-entry.js": /* js */ `
        import { x_REMOVE, y_keep } from './cross-module-constants'
        console.log(x_REMOVE, y_keep)
      `,
      "/cross-module-constants.js": /* js */ `
        export const x_REMOVE = 1
        foo()
        export const y_keep = 1
        export function foo() {
          return [x_REMOVE, y_keep]
        }
      `,
      "/print-shorthand-entry.js": /* js */ `
        import { foo, _bar } from './print-shorthand-constants'
        // The inlined constants must still be present in the output! We don't
        // want the printer to use the shorthand syntax here to refer to the
        // name of the constant itself because the constant declaration is omitted.
        console.log({ foo, _bar })
      `,
      "/print-shorthand-constants.js": /* js */ `
        export const foo = 123
        export const _bar = -321
      `,
      "/circular-import-entry.js": `import './circular-import-constants'`,
      "/circular-import-constants.js": /* js */ `
        export const foo = 123 // Inlining should be prevented by the cycle
        export function bar() {
          return foo
        }
        import './circular-import-cycle'
      `,
      "/circular-import-cycle.js": /* js */ `
        import { bar } from './circular-import-constants'
        console.log(bar()) // This accesses "foo" before it's initialized
      `,
      "/circular-re-export-entry.js": /* js */ `
        import { baz } from './circular-re-export-constants'
        console.log(baz)
      `,
      "/circular-re-export-constants.js": /* js */ `
        export const foo = 123 // Inlining should be prevented by the cycle
        export function bar() {
          return foo
        }
        export { baz } from './circular-re-export-cycle'
      `,
      "/circular-re-export-cycle.js": /* js */ `
        export const baz = 0
        import { bar } from './circular-re-export-constants'
        console.log(bar()) // This accesses "foo" before it's initialized
      `,
      "/circular-re-export-star-entry.js": `import './circular-re-export-star-constants'`,
      "/circular-re-export-star-constants.js": /* js */ `
        export const foo = 123 // Inlining should be prevented by the cycle
        export function bar() {
          return foo
        }
        export * from './circular-re-export-star-cycle'
      `,
      "/circular-re-export-star-cycle.js": /* js */ `
        import { bar } from './circular-re-export-star-constants'
        console.log(bar()) // This accesses "foo" before it's initialized
      `,
      "/non-circular-export-entry.js": /* js */ `
        import { foo, bar } from './non-circular-export-constants'
        console.log(foo, bar())
      `,
      "/non-circular-export-constants.js": /* js */ `
        const foo = 123 // Inlining should be prevented by the cycle
        function bar() {
          return foo
        }
        export { foo, bar }
      `,
    },
    entryPoints: [
      "/exported-entry.js",
      "/re-exported-entry.js",
      "/re-exported-2-entry.js",
      "/re-exported-star-entry.js",
      "/cross-module-entry.js",
      "/print-shorthand-entry.js",
      "/circular-import-entry.js",
      "/circular-re-export-entry.js",
      "/circular-re-export-star-entry.js",
      "/non-circular-export-entry.js",
    ],
    format: "esm",
    minifySyntax: true,
    dce: true,
    dceKeepMarkerCount: {
      "/out/exported-entry.js": 2,
      "/out/re-exported-entry.js": 2,
      "/out/re-exported-2-entry.js": 2,
      "/out/re-exported-star-entry.js": 4,
      // "y_keep" comes after a call, so it is not in the const prefix.
      "/out/cross-module-entry.js": 3,
    },
    // The three circular entries read "foo" in the file that declares it, before it has a value.
    // esbuild keeps those reads. Bun's parser inlines a read of the same file (#18477), so two of
    // them print 123. The read through the import is not inlined: that file has an import.
    run: [
      { file: "/out/exported-entry.js", stdout: "1 2" },
      { file: "/out/re-exported-entry.js", stdout: "1 2" },
      { file: "/out/cross-module-entry.js", stdout: "1 1" },
      { file: "/out/print-shorthand-entry.js", stdout: "{\n  foo: 123,\n  _bar: -321,\n}" },
      { file: "/out/circular-import-entry.js", stdout: "123" },
      { file: "/out/circular-re-export-entry.js", stdout: "undefined\n0" },
      { file: "/out/circular-re-export-star-entry.js", stdout: "123" },
      { file: "/out/non-circular-export-entry.js", stdout: "123 123" },
    ],
    onAfterBundle(api) {
      api.expectFile("/out/print-shorthand-entry.js").toContain("console.log({ foo: 123, _bar: -321 });");
      api.expectFile("/out/non-circular-export-entry.js").toContain("console.log(123, bar());");
      // A file that has an import can be in a cycle: its constants stay reads.
      api.expectFile("/out/circular-re-export-entry.js").toContain("console.log(baz);");
    },
  });
  // https://github.com/oven-sh/bun/issues/49454
  itBundled("dce/CrossModuleConstInliningIf", {
    files: {
      "/main.js": /* js */ `
        import { DEV } from "./env.js";
        if (DEV) {
          console.log("dev-only branch");
        }
        console.log("always");
      `,
      "/env.js": /* js */ `
        export const DEV = false;
      `,
    },
    minifySyntax: true,
    run: { stdout: "always" },
    onAfterBundle(api) {
      api.expectFile("/out.js").toMatchInlineSnapshot(`
        "// main.js
        console.log("always");
        "
      `);
    },
  });
  // A constant from "define" is a literal when the linker reads it.
  itBundled("dce/CrossModuleConstInliningDefine", {
    files: {
      "/main.js": /* js */ `
        import { DEV } from "./env.js";
        if (DEV) {
          console.log("dev-only branch");
        } else {
          console.log("production branch");
        }
        DEV && console.log("dev-only call");
        console.log(DEV ? "dev value" : "production value");
      `,
      "/env.js": /* js */ `
        export const DEV = process.env.NODE_ENV !== "production";
      `,
    },
    define: { "process.env.NODE_ENV": '"production"' },
    minifySyntax: true,
    run: { stdout: "production branch\nproduction value" },
    onAfterBundle(api) {
      api.expectFile("/out.js").toMatchInlineSnapshot(`
        "// main.js
        console.log("production branch");
        console.log("production value");
        "
      `);
    },
  });
  // Which values are copied: esbuild's ExprToConstValue.
  itBundled("dce/CrossModuleConstInliningValues", {
    files: {
      "/entry.js": /* js */ `
        import { T, F, N, U, INT, NEG, FRAC, S3, S4_keep, BIG_keep, LONG_keep } from "./values.js";
        console.log(T, F, N, U, INT, NEG, FRAC, S3, S4_keep, BIG_keep, LONG_keep);
        console.log({ T, INT, S4_keep }, NEG ** 2, U ** 2, T ** 2, INT | 1, !F, typeof T);
        console.log(N ?? "n", INT.toString(), T ? "a" : "b", S3 + "!", INT === 42, S3 === "abc");
      `,
      "/values.js": /* js */ `
        export const T = true, F = false, N = null, U = undefined, INT = 42, NEG = -1, FRAC = 0.5;
        export const S3 = "abc", S4_keep = "abcd", BIG_keep = 10n;
        export const LONG_keep = 3.14159265358979;
      `,
    },
    minifySyntax: true,
    dce: true,
    dceKeepMarkerCount: 7,
    run: {
      stdout: [
        "true false null undefined 42 -1 0.5 abc abcd 10n 3.14159265358979",
        '{\n  T: true,\n  INT: 42,\n  S4_keep: "abcd",\n} 1 NaN 1 43 true boolean',
        "n 42 a abc! true true",
      ].join("\n"),
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toMatchInlineSnapshot(`
        "// values.js
        var S4_keep = "abcd", BIG_keep = 10n, LONG_keep = 3.14159265358979;

        // entry.js
        console.log(!0, !1, null, void 0, 42, -1, 0.5, "abc", S4_keep, BIG_keep, LONG_keep);
        console.log({ T: !0, INT: 42, S4_keep }, 1, (void 0) ** 2, (!0) ** 2, 43, !0, typeof !0);
        console.log("n", 42 .toString(), "a", "abc!", !0, !0);
        "
      `);
    },
  });
  // Where a constant must be declared: in the const prefix of a file that imports nothing. The
  // prefix ends at the first statement, or the first initializer, that can run code.
  {
    const cases: { before: string; inlined: boolean; ts?: boolean }[] = [
      { before: `"use strict";`, inlined: true },
      { before: `debugger;`, inlined: true },
      { before: `// A comment.`, inlined: true },
      { before: `let uninitialized;`, inlined: true },
      { before: `const text = "abcd";`, inlined: true },
      { before: `const arrow = () => notCalled(), fn = function () {};`, inlined: true },
      { before: `const list = ["a", []], empty = {};`, inlined: true },
      { before: `export const other = 1;`, inlined: true },
      { before: `type T = number; interface I { x: T }`, inlined: true, ts: true },
      { before: `export enum E { A = 1 }`, inlined: true, ts: true },
      { before: `enum Unused { A = 1 }`, inlined: true, ts: true },
      { before: `globalThis.sideEffect = 1;`, inlined: false },
      { before: `function declared() {}`, inlined: false },
      { before: `class C { static { globalThis.sideEffect = 2; } }`, inlined: false },
      { before: `export default Math.random();`, inlined: false },
      { before: `const { a } = globalThis;`, inlined: false },
      { before: `const computed = Math.random();`, inlined: false },
      { before: `let counter = 0;`, inlined: false },
      { before: `export const long = 3.14159265;`, inlined: false },
      { before: `const numbers = [1, 2];`, inlined: false },
      { before: `namespace N { export const a = 1; }`, inlined: false, ts: true },
    ];
    const file = (i: number) => `/case${i}.${cases[i].ts ? "ts" : "js"}`;
    itBundled("dce/CrossModuleConstInliningPrefix", {
      files: {
        "/entry.js": `
          ${cases.map((_, i) => `import { c${i} } from ".${file(i)}";`).join("\n")}
          import { withImport } from "./has-import.js";
          import { notConst, reassign } from "./not-const.js";
          import { notExported } from "./not-exported.js";
          console.log(${cases.map((_, i) => `c${i}`).join(", ")});
          console.log(withImport, notConst, reassign(), notExported());
        `,
        ...Object.fromEntries(cases.map((c, i) => [file(i), `${c.before}\nexport const c${i} = ${i};`])),
        "/has-import.js": `import "./empty.js"; export const withImport = 1;`,
        "/empty.js": "",
        "/not-const.js": `export let notConst = 2; export function reassign() { return ++notConst; }`,
        "/not-exported.js": `const local = 4; export function notExported() { return local; }`,
      },
      minifySyntax: true,
      run: { stdout: `${cases.map((_, i) => i).join(" ")}\n1 2 3 4` },
      onAfterBundle(api) {
        const out = api.readFile("/out.js");
        expect(out).toContain(`console.log(${cases.map((c, i) => (c.inlined ? i : `c${i}`)).join(", ")});`);
        expect(out).toContain("console.log(withImport, notConst, reassign(), notExported());");
      },
    });
  }
  // Which reads are replaced: the ones of an import binding.
  itBundled("dce/CrossModuleConstInliningBindingForms", {
    files: {
      "/entry.js": /* js */ `
        import { X as named } from "./leaf.js";
        import { X as viaBarrel } from "./barrel.js";
        import { X as viaStar } from "./barrel-star.js";
        import * as ns from "./leaf.js";
        import { space } from "./namespace.js";
        const { Y: dynamic } = await import("./dynamic-leaf.js");
        console.log(named, viaBarrel, viaStar, ns.X, space.Z_keep, dynamic);
        export { X } from "./leaf.js";
      `,
      "/leaf.js": /* js */ `
        export const X = 1;
      `,
      "/barrel.js": /* js */ `
        export { X } from "./leaf.js";
      `,
      "/barrel-star.js": /* js */ `
        export * from "./leaf.js";
      `,
      "/namespace.js": /* js */ `
        export * as space from "./namespace-leaf.js";
      `,
      "/namespace-leaf.js": /* js */ `
        export const Z_keep = 2;
      `,
      "/dynamic-leaf.js": /* js */ `
        export const Y = 3;
      `,
    },
    format: "esm",
    minifySyntax: true,
    run: { stdout: "1 1 1 1 2 3" },
    onAfterBundle(api) {
      api.expectFile("/out.js").toMatchInlineSnapshot(`
        "// dynamic-leaf.js
        var Y = 3;

        // leaf.js
        var X = 1;
        // namespace-leaf.js
        var Z_keep = 2;
        // entry.js
        await Promise.resolve();
        console.log(1, 1, 1, 1, Z_keep, Y);
        export {
          X
        };
        "
      `);
    },
  });
  // A file that has a direct eval prints what it printed before constants were inlined: the
  // reads and the declaration stay. esbuild inlines here. Bun does not promise that the code
  // of an eval can read an import. A direct eval in the file that declares the constant
  // changes nothing.
  itBundled("dce/CrossModuleConstInliningDirectEval", {
    files: {
      "/eval-in-importer.js": /* js */ `
        import { X } from "./leaf.js";
        console.log(X, eval("X"));
      `,
      "/eval-in-leaf.js": /* js */ `
        import { Y } from "./eval-leaf.js";
        console.log(Y);
      `,
      "/leaf.js": /* js */ `
        export const X = 1;
      `,
      "/eval-leaf.js": /* js */ `
        export const Y = 2;
        eval("0");
      `,
    },
    entryPoints: ["/eval-in-importer.js", "/eval-in-leaf.js"],
    minifySyntax: true,
    run: [
      { file: "/out/eval-in-importer.js", stdout: "1 1" },
      { file: "/out/eval-in-leaf.js", stdout: "2" },
    ],
    onAfterBundle(api) {
      const importer = api.readFile("/out/eval-in-importer.js");
      expect(importer).toContain("var X = 1");
      expect(importer).toContain('console.log(X, eval("X"))');
      api.expectFile("/out/eval-in-leaf.js").toContain("console.log(2)");
    },
  });
  // A file in an import cycle can be read before it runs. Its constants are
  // not copied: the reader must see what the bundle gives it today.
  itBundled("dce/CrossModuleConstInliningCycle", {
    files: {
      "/entry.js": /* js */ `
        import { X } from "./b.js";
        console.log("entry sees", X);
      `,
      "/b.js": /* js */ `
        import "./c.js";
        export const X = 1;
      `,
      "/c.js": /* js */ `
        import { X } from "./b.js";
        console.log("c sees", X);
      `,
    },
    minifySyntax: true,
    run: { stdout: "c sees undefined\nentry sees 1" },
  });
  // A reader can run before the leaf file: "c.js" is in a cycle with the barrel. It gets the
  // value, as in esbuild. Without the inlining the bundle printed "undefined", and the program
  // that is not bundled throws a ReferenceError.
  itBundled("dce/CrossModuleConstInliningCycleThroughBarrel", {
    files: {
      "/entry.js": /* js */ `
        import { X } from "./barrel.js";
        console.log("entry sees", X);
      `,
      "/barrel.js": /* js */ `
        import "./c.js";
        export { X } from "./leaf.js";
      `,
      "/c.js": /* js */ `
        import { X } from "./barrel.js";
        console.log("c sees", X);
      `,
      "/leaf.js": /* js */ `
        export const X = 1;
      `,
    },
    minifySyntax: true,
    run: { stdout: "c sees 1\nentry sees 1" },
  });
  itBundled("dce/CrossModuleConstInliningSplitting", {
    files: {
      "/a.js": /* js */ `
        import { DEV, shared } from "./env.js";
        if (DEV) console.log("dev a");
        console.log("a", shared.length);
      `,
      "/b.js": /* js */ `
        import { DEV } from "./env.js";
        if (DEV) console.log("dev b");
        console.log("b");
      `,
      "/env.js": /* js */ `
        export const DEV = false;
        export const shared = [DEV];
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    format: "esm",
    minifySyntax: true,
    run: [
      { file: "/out/a.js", stdout: "a 1" },
      { file: "/out/b.js", stdout: "b" },
    ],
    onAfterBundle(api) {
      // "b.js" reads only the constant, so it imports no chunk.
      api.expectFile("/out/b.js").toMatchInlineSnapshot(`
        "// b.js
        console.log("b");
        "
      `);
    },
  });
  itBundled("dce/CrossModuleConstInliningNoMinifySyntax", {
    files: {
      "/main.js": /* js */ `
        import { DEV } from "./env.js";
        if (DEV) {
          console.log("dev-only branch");
        }
        console.log("always");
      `,
      "/env.js": /* js */ `
        export const DEV = false;
      `,
    },
    minifySyntax: false,
    run: { stdout: "always" },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("if (DEV)");
    },
  });
  // "{ __proto__ }" defines a property. "{ __proto__: value }" sets the prototype.
  itBundled("dce/CrossModuleConstInliningProtoShorthand", {
    files: {
      "/entry.js": /* js */ `
        import { __proto__, P } from "./leaf.js";
        const own = { __proto__ };
        const set = { __proto__: P };
        console.log(Object.hasOwn(own, "__proto__"), Object.getPrototypeOf(own) === Object.prototype);
        console.log(Object.hasOwn(set, "__proto__"), Object.getPrototypeOf(set) === null);
      `,
      "/leaf.js": /* js */ `
        export const __proto__ = null, P = null;
      `,
    },
    minifySyntax: true,
    run: { stdout: "true true\nfalse true" },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain(`own = { ["__proto__"]: null }`);
      expect(out).toContain(`set = { __proto__: null }`);
    },
  });
  // In a statement list, nothing is left of a statement that a constant decides.
  itBundled("dce/CrossModuleConstInliningStatements", {
    files: {
      "/entry.js": /* js */ `
        import { DEV, PROD } from "./env.js";
        const log = (...args) => console.log(...args);
        if (DEV) { for (const v of ["DROP"]) log(v); }
        DEV && log("DROP");
        PROD || log("DROP");
        if (PROD) { log("one"); for (const v of ["two"]) log(v); }
        if (PROD) { let scoped = "three"; log(scoped); }
        function inFunction() {
          log("before");
          if (DEV) { for (const v of ["DROP"]) log(v); }
          log("between");
          if (PROD) { for (const v of ["four"]) log(v); }
          switch (1) {
            case 1:
              if (DEV) log("DROP");
              if (PROD) { log("five"); log("six"); }
          }
        }
        inFunction();
      `,
      "/env.js": /* js */ `
        export const DEV = false, PROD = true;
      `,
    },
    minifySyntax: true,
    dce: true,
    run: { stdout: "one\ntwo\nthree\nbefore\nbetween\nfour\nfive\nsix" },
    onAfterBundle(api) {
      api.expectFile("/out.js").toMatchInlineSnapshot(`
        "// entry.js
        var log = (...args) => console.log(...args);
        log("one");
        for (let v of ["two"])
          log(v);
        log("three");
        function inFunction() {
          log("before");
          log("between");
          for (let v of ["four"])
            log(v);
          switch (1) {
            case 1:
              log("five"), log("six");
          }
        }
        inFunction();
        "
      `);
    },
  });
  // Each row must print and run the same for a constant of another file as for one of the same file.
  {
    const members = {
      Zero: "0",
      NegZero: "-0",
      One: "1",
      Three: "3",
      Neg: "-1",
      Half: "0.5",
      U32: "4294967295",
      Inf: "1 / 0",
      NaN_: "0 / 0",
      Text: '"ab"',
      Empty: '""',
      Digits: '"12"',
      True: "true",
      False: "false",
      Null: "null",
      Undefined: "undefined",
    };
    const grid = foldGrid(members, name => name, `{ ${Object.keys(members).join(", ")} }`);
    const declaration = `const ${grid.names.map(name => `${name} = ${members[name]}`).join(", ")};`;
    itBundled("dce/CrossModuleConstInliningMatchesSameFile", {
      files: {
        "/same.ts": `${declaration}\n${grid.body}`,
        "/cross.ts": `import { ${grid.names.join(", ")} } from "./consts";\n${grid.body}`,
        "/consts.ts": `export ${declaration}`,
      },
      entryPoints: ["/same.ts", "/cross.ts"],
      minifySyntax: true,
      run: [
        { file: "/out/same.js", stdout: grid.stdout },
        { file: "/out/cross.js", stdout: grid.stdout },
      ],
      onAfterBundle(api) {
        expect(grid.differences(api.readFile("/out/same.js"), api.readFile("/out/cross.js"))).toMatchInlineSnapshot(`
          {
            "\`<\${x}>\`": {
              "example": "t(\`<\${0}>\`); where the same file prints t("<0>");",
              "rows": 16,
            },
            "typeof x": {
              "example": "t(typeof 0); where the same file prints t("number");",
              "rows": 16,
            },
            "x != x": {
              "example": "t(0 != !0); where the same file prints t(!0);",
              "rows": 102,
            },
            "x !== x": {
              "example": "t(0 !== !0); where the same file prints t(!0);",
              "rows": 127,
            },
            "x == x": {
              "example": "t(0 == !0); where the same file prints t(!1);",
              "rows": 102,
            },
            "x === x": {
              "example": "t(0 === !0); where the same file prints t(!1);",
              "rows": 127,
            },
          }
        `);
      },
    });
  }
  // The other output formats, and a leaf that a require() wraps.
  for (const format of ["cjs", "iife"] as const) {
    itBundled(`dce/CrossModuleConstInliningFormat_${format}`, {
      files: {
        "/entry.js": /* js */ `
          import { DEV, N } from "./env.js";
          import { viaRequire } from "./lazy.js";
          if (DEV) console.log("DROP");
          console.log(N + 1, viaRequire().N, { N });
          export { N };
        `,
        "/lazy.js": /* js */ `
          export const viaRequire = () => require("./env.js");
        `,
        "/env.js": /* js */ `
          export const DEV = false, N = 41;
        `,
      },
      format,
      minifySyntax: true,
      dce: true,
      run: { stdout: "42 41 {\n  N: 41,\n}" },
      onAfterBundle(api) {
        expect(api.readFile("/out.js")).toContain("console.log(42, viaRequire().N, { N: 41 })");
      },
    });
  }
  // An entry point that exports the constant again keeps the declaration, in its own chunk or in
  // a chunk that it shares.
  itBundled("dce/CrossModuleConstInliningSplittingKeepsExport", {
    files: {
      "/a.js": /* js */ `
        import { X } from "./leaf.js";
        console.log("a", X + 1);
        export { X };
      `,
      "/b.js": /* js */ `
        import { X } from "./leaf.js";
        console.log("b", X + 2);
        export * as ns from "./leaf.js";
      `,
      "/c.js": /* js */ `
        import { X } from "./barrel.js";
        console.log("c", X + 3);
      `,
      "/barrel.js": /* js */ `
        export { X } from "./leaf.js";
      `,
      "/leaf.js": /* js */ `
        export const X = 40;
      `,
      "/check.js": /* js */ `
        const a = await import("./out/a.js");
        const b = await import("./out/b.js");
        await import("./out/c.js");
        console.log(a.X, b.ns.X);
      `,
    },
    entryPoints: ["/a.js", "/b.js", "/c.js"],
    splitting: true,
    format: "esm",
    minifySyntax: true,
    run: { file: "/check.js", stdout: "a 41\nb 42\nc 43\n40 40" },
    onAfterBundle(api) {
      api.expectFile("/out/c.js").toContain(`console.log("c", 43)`);
    },
  });
  itBundled("dce/ConstValueInliningAssign", {
    files: {
      "/const-assign.js": /* js */ `
        const x = 1
        x = 2
      `,
      "/const-update.js": /* js */ `
        const x = 1
        x += 2
      `,
    },
    entryPoints: ["/const-assign.js", "/const-update.js"],
    bundleErrors: {
      "/const-update.js": [`Cannot assign to "x" because it is a constant`],
      "/const-assign.js": [`Cannot assign to "x" because it is a constant`],
    },
  });
  itBundled("dce/ConstValueInliningDirectEval", {
    todo: true,
    files: {
      "/top-level-no-eval.js": /* js */ `
        const keep = 1
        console.log(keep, evil('x')) // inline the 1 here
      `,
      "/top-level-eval.js": /* js */ `
        const keep = 1
        console.log(keep, eval('x')) // inline the 1 but keep the const def
      `,
      "/nested-no-eval.js": /* js */ `
        (() => {
          const remove = 1
          console.log(remove, evil('x')) // inline the 1 here and remove the const def
        })()
      `,
      "/nested-eval.js": /* js */ `
        (() => {
          const keep = 1
          console.log(keep, eval('x')) // inline the 1 but keep the const def
        })()
      `,
      "/ts-namespace-no-eval.ts": /* ts */ `
        namespace y {
          export const keep = 1
          console.log(keep, evil('x')) // inline the 1 here
        }
      `,
      "/ts-namespace-eval.ts": /* ts */ `
        namespace z {
          export const keep = 1
          console.log(keep, eval('x'))
        }
      `,
    },
    entryPoints: [
      "/top-level-no-eval.js",
      "/top-level-eval.js",
      "/nested-no-eval.js",
      "/nested-eval.js",
      "/ts-namespace-no-eval.ts",
      "/ts-namespace-eval.ts",
    ],
    bundling: false,
    minifySyntax: true,
    dce: true,
    dceKeepMarkerCount: {
      "/out/top-level-no-eval.js": 1,
      "/out/top-level-eval.js": 1,
      "/out/nested-eval.js": 1,
      "/out/ts-namespace-no-eval.js": 1,
      "/out/ts-namespace-eval.js": 1,
    },
  });
  itBundled("dce/CrossModuleConstantFolding", {
    files: {
      "/enum-constants.ts": /* ts */ `
        export enum remove {
          a = 3,
          b = 6,
        }
      `,
      "/enum-entry.ts": /* ts */ `
        import { remove as x } from './enum-constants'
        console.log([
          +x.b,
          -x.b,
          ~x.b,
          !x.b,
          typeof x.b,
        ], [
          x.a + x.b,
          x.a - x.b,
          x.a * x.b,
          x.a / x.b,
          x.a % x.b,
          x.a ** x.b,
        ], [
          x.a < x.b,
          x.a > x.b,
          x.a <= x.b,
          x.a >= x.b,
          x.a == x.b,
          x.a != x.b,
          x.a === x.b,
          x.a !== x.b,
        ], [
          x.b << 1,
          x.b >> 1,
          x.b >>> 1,
        ], [
          x.a & x.b,
          x.a | x.b,
          x.a ^ x.b,
        ], [
          x.a && x.b,
          x.a || x.b,
          x.a ?? x.b,
        ])
      `,
      "/const-constants.js": /* js */ `
        export const a = 3
        export const b = 6
      `,
      "/const-entry.js": /* js */ `
        import { a, b } from './const-constants'
        console.log([
          +b,
          -b,
          ~b,
          !b,
          typeof b,
        ], [
          a + b,
          a - b,
          a * b,
          a / b,
          a % b,
          a ** b,
        ], [
          a < b,
          a > b,
          a <= b,
          a >= b,
          a == b,
          a != b,
          a === b,
          a !== b,
        ], [
          b << 1,
          b >> 1,
          b >>> 1,
        ], [
          a & b,
          a | b,
          a ^ b,
        ], [
          a && b,
          a || b,
          a ?? b,
        ])
      `,
      "/nested-constants.ts": /* ts */ `
        export const a = 2
        export const b = 4
        export const c = 8
        export enum remove {
          a = 16,
          b = 32,
          c = 64,
        }
      `,
      "/nested-entry.ts": /* ts */ `
        import { a, b, c, remove as x } from './nested-constants'
        console.log({
          'should be 4': ~(~a & ~b) & (b | c),
          'should be 32': ~(~x.a & ~x.b) & (x.b | x.c),
        })
      `,
    },
    entryPoints: ["/enum-entry.ts", "/const-entry.js", "/nested-entry.ts"],
    minifySyntax: true,
    dce: true,
    onAfterBundle(api) {
      expect(api.readFile("/out/enum-entry.js")).toMatchInlineSnapshot(`
        "// enum-entry.ts
        console.log([
          6,
          -6,
          -7,
          !1,
          typeof 6 /* b */
        ], [
          9,
          -3,
          18,
          0.5,
          3,
          729
        ], [
          !0,
          !1,
          !0,
          !1,
          !1,
          !0,
          !1,
          !0
        ], [
          12,
          3,
          3
        ], [
          2,
          7,
          5
        ], [
          6,
          3,
          3
        ]);
        "
      `);
      expect(api.readFile("/out/const-entry.js")).toMatchInlineSnapshot(`
        "// const-entry.js
        console.log([
          6,
          -6,
          -7,
          !1,
          typeof 6
        ], [
          9,
          -3,
          18,
          0.5,
          3,
          729
        ], [
          !0,
          !1,
          !0,
          !1,
          !1,
          !0,
          !1,
          !0
        ], [
          12,
          3,
          3
        ], [
          2,
          7,
          5
        ], [
          6,
          3,
          3
        ]);
        "
      `);
      expect(api.readFile("/out/nested-entry.js")).toContain('"should be 4": 4');
      expect(api.readFile("/out/nested-entry.js")).toContain('"should be 32": 32');
    },
  });
  // The tests below are for `bun_ast::late_fold`: the printer folds what an enum value of another
  // file decides. The parser cannot, because it sees one file at a time.

  // The criterion is the same-file output: each row must print and run the same for an enum that
  // another file declares as for one that the same file declares.
  {
    const members = {
      Zero: "0",
      NegZero: "-0",
      One: "1",
      Three: "3",
      Neg: "-1",
      Half: "0.5",
      I31: "2147483648",
      U32: "4294967295",
      P53: "9007199254740992",
      Inf: "1 / 0",
      NaN_: "0 / 0",
      Text: '"name"',
      Empty: '""',
      Digits: '"12"',
    };
    const grid = foldGrid(members, name => `E.${name}`, "E");
    const declaration = `enum E { ${grid.names.map(name => `${name} = ${members[name]}`).join(", ")} }`;
    itBundled("dce/CrossModuleEnumFoldMatchesSameFile", {
      files: {
        "/same.ts": `${declaration}\n${grid.body}`,
        "/cross.ts": `import { E } from "./enum";\n${grid.body}`,
        "/enum.ts": `export ${declaration}`,
      },
      entryPoints: ["/same.ts", "/cross.ts"],
      minifySyntax: true,
      run: [
        { file: "/out/same.js", stdout: grid.stdout },
        { file: "/out/cross.js", stdout: grid.stdout },
      ],
      onAfterBundle(api) {
        // Where the late fold stops short of the parser.
        expect(grid.differences(api.readFile("/out/same.js"), api.readFile("/out/cross.js"))).toMatchInlineSnapshot(`
          {
            "\`<\${E.x}>\`": {
              "example": "t(\`<\${0}>\`); where the same file prints t("<0>");",
              "rows": 14,
            },
          }
        `);
      },
    });
  }
  {
    const statements = {
      "/entry.ts": /* ts */ `
        import { Flag } from "./flags";
        const log = (...args: unknown[]) => console.log(...args);
        const yes = Number("1") === 1;
        let count = 0;

        // In a statement list.
        if (Flag.Off) { for (const v of ["DROP"]) log(v); }
        if (Flag.On) { for (const v of ["list on"]) log(v); }
        if (Flag.Off) { for (const v of ["DROP"]) log(v); } else { for (const v of ["list else"]) log(v); }
        if (Flag.Empty) { for (const v of ["DROP"]) log(v); } else { for (const v of ["empty string"]) log(v); }
        if (!Flag.On) { for (const v of ["DROP"]) log(v); }
        if (Flag.On === 1 && Flag.Name !== "other") { for (const v of ["compare"]) log(v); }

        // As the body of another statement.
        if (yes) { if (Flag.Off) { for (const v of ["DROP"]) log(v); } }
        if (yes) { if (Flag.On) { for (const v of ["nested on"]) log(v); } }
        if (yes) { if (Flag.Off) { for (const v of ["DROP"]) log(v); } } else { for (const v of ["not run"]) log(v); }
        for (const v of ["for body"]) { if (Flag.On) { for (const w of [v]) log(w); } }
        for (const v of ["not printed"]) { if (Flag.Off) { for (const w of ["DROP"]) log(v, w); } }
        while (count++ < 1) { if (Flag.On) { for (const v of ["while body"]) log(v); } }
        do { if (Flag.Off) { for (const v of ["DROP"]) log(v); } } while (count++ < 2);
        label: if (Flag.Off) { for (const v of ["DROP"]) log(v); }
        label2: if (Flag.On) { for (const v of ["label body"]) log(v); }

        // In an "else if" chain.
        function chain(x: number) {
          if (x === 1) { for (const v of ["one"]) log(v); }
          else if (Flag.Off) { for (const v of ["DROP"]) log(v); }
          else if (x === 2) { for (const v of ["two"]) log(v); }
          else if (Flag.On) { for (const v of ["rest"]) log(v); }
          else { for (const v of ["DROP"]) log(v); }
        }
        chain(1), chain(2), chain(3);
        function lastElse(x: number) {
          if (x === 1) { for (const v of ["first"]) log(v); }
          else if (Flag.Off) { for (const v of ["DROP"]) log(v); }
        }
        lastElse(1), lastElse(2);
        function emptyElse(x: number) {
          if (x === 1) { for (const v of ["x is 1"]) log(v); }
          else if (Flag.On) {}
          else { for (const v of ["DROP"]) log(v); }
        }
        emptyElse(1), emptyElse(2);
        function inSwitch(x: number) {
          switch (x) {
            case 1:
              if (Flag.Off) { for (const v of ["DROP"]) log(v); }
              if (Flag.On) { for (const v of ["case"]) log(v); }
          }
        }
        inSwitch(1);
        // The parser merges a call into the test that follows it: if (log("before"), Flag.Off).
        function merged() {
          log("before");
          if (Flag.Off) { for (const v of ["DROP"]) log(v); }
          log("between");
          if (Flag.On) { for (const v of ["merged on"]) log(v); }
          log("after");
          if (Flag.On) log("merged call");
          for (const v of ["merged body"]) { log(v); if (Flag.Off) log("DROP"); }
        }
        merged();

        // In an expression.
        Flag.On && log("and on");
        Flag.Off || log("or off");
        log(Flag.Off ? "DROP" : "cond off", Flag.On ? "cond on" : "DROP", Flag.Off ?? "DROP", Flag.Empty || "or empty");
        log(Flag.Read | Flag.Write, Flag.Write / Flag.Read, Flag.Read + "px", \`\${Flag.Read}px\`, typeof Flag.Read);
      `,
      "/flags.ts": /* ts */ `
        export enum Flag { Off = 0, On = 1, Read = 2, Write = 4, Name = "name", Empty = "" }
      `,
    };
    const stdout = [
      "list on",
      "list else",
      "empty string",
      "compare",
      "nested on",
      "for body",
      "while body",
      "label body",
      "one",
      "two",
      "rest",
      "first",
      "x is 1",
      "case",
      "before",
      "between",
      "merged on",
      "after",
      "merged call",
      "merged body",
      "and on",
      "or off",
      "cond off cond on 0 or empty",
      "6 2 2px 2px number",
    ].join("\n");
    // The snapshot also shows what the fold leaves: an empty statement where a list had the
    // "if", the block of the branch that runs, a template part and "typeof".
    itBundled("dce/CrossModuleEnumFoldStatements", {
      files: statements,
      minifySyntax: true,
      dce: true,
      run: { stdout },
      onAfterBundle(api) {
        api.expectFile("/out.js").toMatchInlineSnapshot(`
          "// entry.ts
          var log = (...args) => console.log(...args), yes = Number("1") === 1, count = 0;
          for (let v of ["list on"])
            log(v);
          for (let v of ["list else"])
            log(v);
          for (let v of ["empty string"])
            log(v);
          for (let v of ["compare"])
            log(v);
          if (yes)
            ;
          if (yes)
            for (let v of ["nested on"])
              log(v);
          if (yes)
            ;
          else
            for (let v of ["not run"])
              log(v);
          for (let v of ["for body"])
            for (let w of [v])
              log(w);
          for (let v of ["not printed"])
            ;
          while (count++ < 1)
            for (let v of ["while body"])
              log(v);
          do
            ;
          while (count++ < 2);
          label:
            ;
          label2:
            for (let v of ["label body"])
              log(v);
          function chain(x) {
            if (x === 1)
              for (let v of ["one"])
                log(v);
            else if (x === 2)
              for (let v of ["two"])
                log(v);
            else
              for (let v of ["rest"])
                log(v);
          }
          chain(1), chain(2), chain(3);
          function lastElse(x) {
            if (x === 1)
              for (let v of ["first"])
                log(v);
          }
          lastElse(1), lastElse(2);
          function emptyElse(x) {
            if (x === 1)
              for (let v of ["x is 1"])
                log(v);
          }
          emptyElse(1), emptyElse(2);
          function inSwitch(x) {
            switch (x) {
              case 1:
                for (let v of ["case"])
                  log(v);
            }
          }
          inSwitch(1);
          function merged() {
            log("before");
            log("between");
            for (let v of ["merged on"])
              log(v);
            log("after");
            log("merged call");
            for (let v of ["merged body"])
              log(v);
          }
          merged();
          log("and on");
          log("or off");
          log("cond off", "cond on", 0, "or empty");
          log(6, 2, "2px", \`\${2 /* Read */}px\`, typeof 2 /* Read */);
          "
        `);
      },
    });
    itBundled("dce/CrossModuleEnumFoldStatementsMinified", {
      files: statements,
      outdir: "/out",
      minifySyntax: true,
      minifyWhitespace: true,
      minifyIdentifiers: true,
      sourceMap: "external",
      dce: true,
      run: { file: "/out/entry.js", stdout },
    });
  }
  // A fold must not change what a statement declares, or where.
  itBundled("dce/CrossModuleEnumFoldKeepsDeclarations", {
    files: {
      "/entry.ts": /* ts */ `
        import { Flag } from "./flags";
        const log = (...args: unknown[]) => console.log(...args);

        // "var" in a branch that never runs still declares the variable.
        function hoisted() {
          log("before hoisted");
          if (Flag.Off) { var declared = 1; }
          // @ts-ignore
          declared = "assigned";
          // @ts-ignore
          return declared;
        }
        log(hoisted(), typeof (globalThis as any).declared);
        function hoistedElse(x: number) {
          if (x === 1) { for (const v of ["x is 1"]) log(v); }
          else if (Flag.Off) { var inElse = 1; }
          else { for (const v of ["else runs"]) log(v); }
          // @ts-ignore
          inElse = "assigned in else";
          // @ts-ignore
          return inElse;
        }
        log(hoistedElse(1), hoistedElse(2), typeof (globalThis as any).inElse);
        function hoistedLive(x: number) {
          if (x === 1) { for (const v of ["x is 1 again"]) log(v); }
          else if (Flag.On) { for (const v of ["live runs"]) log(v); }
          else { var inDead = 1; }
          // @ts-ignore
          inDead = "assigned in dead";
          // @ts-ignore
          return inDead;
        }
        log(hoistedLive(1), hoistedLive(2), typeof (globalThis as any).inDead);
        function inSwitch(x: number) {
          if (Flag.Off) switch (x) { case 1: var inCase = 1; }
          if (Flag.Off) switch (x) { case 1: log("DROP"); }
          // @ts-ignore
          inCase = "assigned in case";
          // @ts-ignore
          return inCase;
        }
        log(inSwitch(1), typeof (globalThis as any).inCase);

        // The "let" of a branch that runs stays in its block.
        let scoped = 1;
        if (Flag.On) {
          let scoped = 10;
          for (const v of [1, 2]) scoped += v;
          log("inner", scoped);
        }
        log("outer", scoped);

        // The last "else" stays with its own "if".
        function dangling(a: boolean, b: boolean, c: boolean) {
          if (a) {
            if (b) { for (const v of ["b"]) log(v); }
            else if (Flag.On) { for (const v of ["c"]) if (c) { for (const w of [v]) log(w); } }
            else { for (const v of ["DROP"]) log(v); }
          } else { for (const v of ["not a"]) log(v); }
        }
        dangling(true, false, false), dangling(false, false, false), dangling(true, false, true), dangling(true, true, true);
        function danglingThen(a: boolean, c: boolean) {
          if (a) {
            if (Flag.On) { if (c) { for (const v of ["a and c"]) log(v); } }
            else { for (const v of ["DROP"]) log(v); }
          } else { for (const v of ["not a again"]) log(v); }
        }
        danglingThen(true, false), danglingThen(false, false), danglingThen(true, true);
        function emptied(a: boolean, b: boolean) {
          if (a) {
            if (b) { for (const v of ["b again"]) log(v); }
            else if (Flag.On) {}
            else { for (const v of ["DROP"]) log(v); }
          } else { for (const v of ["not a, emptied"]) log(v); }
        }
        emptied(true, false), emptied(false, false), emptied(true, true);
      `,
      "/flags.ts": /* ts */ `
        export enum Flag { Off = 0, On = 1 }
      `,
    },
    minifySyntax: true,
    dce: true,
    run: {
      stdout: [
        "before hoisted",
        "assigned undefined",
        "x is 1",
        "else runs",
        "assigned in else assigned in else undefined",
        "x is 1 again",
        "live runs",
        "assigned in dead assigned in dead undefined",
        "assigned in case undefined",
        "inner 13",
        "outer 1",
        "not a",
        "c",
        "b",
        "not a again",
        "a and c",
        "not a, emptied",
        "b again",
      ].join("\n"),
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toMatchInlineSnapshot(`
        "// entry.ts
        var log = (...args) => console.log(...args);
        function hoisted() {
          if (log("before hoisted"), 0 /* Off */)
            var declared = 1;
          return declared = "assigned", declared;
        }
        log(hoisted(), typeof globalThis.declared);
        function hoistedElse(x) {
          if (x === 1)
            for (let v of ["x is 1"])
              log(v);
          else if (0 /* Off */)
            var inElse = 1;
          else
            for (let v of ["else runs"])
              log(v);
          return inElse = "assigned in else", inElse;
        }
        log(hoistedElse(1), hoistedElse(2), typeof globalThis.inElse);
        function hoistedLive(x) {
          if (x === 1)
            for (let v of ["x is 1 again"])
              log(v);
          else if (1 /* On */)
            for (let v of ["live runs"])
              log(v);
          else
            var inDead = 1;
          return inDead = "assigned in dead", inDead;
        }
        log(hoistedLive(1), hoistedLive(2), typeof globalThis.inDead);
        function inSwitch(x) {
          if (0 /* Off */)
            switch (x) {
              case 1:
                var inCase = 1;
            }
          return inCase = "assigned in case", inCase;
        }
        log(inSwitch(1), typeof globalThis.inCase);
        var scoped = 1;
        {
          let scoped = 10;
          for (let v of [1, 2])
            scoped += v;
          log("inner", scoped);
        }
        log("outer", scoped);
        function dangling(a, b, c) {
          if (a) {
            if (b)
              for (let v of ["b"])
                log(v);
            else
              for (let v of ["c"])
                if (c)
                  for (let w of [v])
                    log(w);
          } else
            for (let v of ["not a"])
              log(v);
        }
        dangling(!0, !1, !1), dangling(!1, !1, !1), dangling(!0, !1, !0), dangling(!0, !0, !0);
        function danglingThen(a, c) {
          if (a) {
            if (c)
              for (let v of ["a and c"])
                log(v);
          } else
            for (let v of ["not a again"])
              log(v);
        }
        danglingThen(!0, !1), danglingThen(!1, !1), danglingThen(!0, !0);
        function emptied(a, b) {
          if (a) {
            if (b)
              for (let v of ["b again"])
                log(v);
          } else
            for (let v of ["not a, emptied"])
              log(v);
        }
        emptied(!0, !1), emptied(!1, !1), emptied(!0, !0);
        "
      `);
    },
  });
  // A fold must not change the value of "this", "typeof" of an undeclared name, or "delete".
  // The target is "bun" so that the runtime does not transpile the output again: its parser
  // folds "(1 && o.m)\`\`" to "o.m\`\`" (#44578).
  itBundled("dce/CrossModuleEnumFoldKeepsSemantics", {
    files: {
      "/entry.ts": /* ts */ `
        import { Flag } from "./flags";
        const log = (...args: unknown[]) => console.log(...args);
        declare const notDeclaredAnywhere: unknown;

        const obj = {
          name: "obj",
          method(this: any, ..._: unknown[]) { return this === undefined ? "no this" : this.name; },
        };
        log((Flag.On && obj.method)(), (Flag.Off || obj.method)(), (Flag.On ? obj.method : obj.method)());
        log((Flag.On && obj.method)\`\`, (Flag.Off || obj.method)\`\`, (Flag.On ? obj.method : obj.method)\`\`);
        log(new (Flag.On && Date)(0).getTime());

        const bag: any = { prop: 1 };
        log(delete (Flag.On && bag.prop), "prop" in bag);
        try {
          log(typeof (Flag.On && notDeclaredAnywhere));
        } catch (e) {
          log((e as Error).name);
        }
        try {
          log((Flag.On && bag?.missing).x);
        } catch (e) {
          log((e as Error).name);
        }
      `,
      "/flags.ts": /* ts */ `
        export enum Flag { Off = 0, On = 1 }
      `,
    },
    target: "bun",
    minifySyntax: true,
    run: {
      stdout: [
        "no this no this no this",
        "no this no this no this",
        "0",
        "true true",
        "ReferenceError",
        "TypeError",
      ].join("\n"),
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toMatchInlineSnapshot(`
        "// @bun
        // entry.ts
        var log = (...args) => console.log(...args), obj = {
          name: "obj",
          method(..._) {
            return this === void 0 ? "no this" : this.name;
          }
        };
        log((1 /* On */ && obj.method)(), (0 /* Off */ || obj.method)(), (1 /* On */ ? obj.method : obj.method)());
        log((1 /* On */ && obj.method)\`\`, (0 /* Off */ || obj.method)\`\`, (1 /* On */ ? obj.method : obj.method)\`\`);
        log(new Date(0).getTime());
        var bag = { prop: 1 };
        log(delete (0, bag.prop), "prop" in bag);
        try {
          log(typeof (0, notDeclaredAnywhere));
        } catch (e) {
          log(e.name);
        }
        try {
          log((bag?.missing).x);
        } catch (e) {
          log(e.name);
        }
        "
      `);
    },
  });
  // A string statement at the start of a function body is a directive. A fold must not make one.
  // The output is strict code in any case, so the text is what shows it.
  itBundled("dce/CrossModuleEnumFoldMakesNoDirective", {
    files: {
      "/entry.ts": /* ts */ `
        import { D } from "./flags";
        function concat(this: unknown) { D.Use + "strict"; try { return this === undefined; } finally {} }
        function logical(this: unknown) { D.On && "use strict"; try { return this === undefined; } finally {} }
        function viaIf(this: unknown) { if (D.On) D.Use + "strict"; try { return this === undefined; } finally {} }
        function viaIfMember(this: unknown) { if (D.On) D.Strict; try { return this === undefined; } finally {} }
        console.log(concat(), logical(), viaIf(), viaIfMember());
      `,
      "/flags.ts": /* ts */ `
        export enum D { On = 1, Use = "use ", Strict = "use strict" }
      `,
    },
    format: "cjs",
    minifySyntax: true,
    run: { stdout: "true true true true" },
    onAfterBundle(api) {
      api.expectFile("/out.js").toMatchInlineSnapshot(`
        "// entry.ts
        function concat() {
          try {
            return this === void 0;
          } finally {}
        }
        function logical() {
          1 /* On */;
          try {
            return this === void 0;
          } finally {}
        }
        function viaIf() {
          if (1 /* On */)
            "use " /* Use */ + "strict";
          try {
            return this === void 0;
          } finally {}
        }
        function viaIfMember() {
          if (1 /* On */)
            "use strict" /* Strict */;
          try {
            return this === void 0;
          } finally {}
        }
        console.log(concat(), logical(), viaIf(), viaIfMember());
        "
      `);
    },
  });
  // A file that has no "import" or "export" statement is not strict. It can still read an enum.
  itBundled("dce/CrossModuleEnumFoldSloppyFile", {
    files: {
      "/entry.js": /* js */ `
        async function main() {
          const { Flag } = await import("./flags.ts");
          if (Flag.Off) { function inDead() {} }
          console.log(typeof inDead);
          if (Flag.Off) { var v = 1; }
          v = "assigned";
          console.log(v, typeof globalThis.v);
          if (Flag.On) function asBody() {}
          console.log(typeof asBody);
          if (Flag.On) { function inLive() {} }
          console.log(typeof inLive);
          if (Flag.Off) console.log("DROP");
        }
        main();
      `,
      "/flags.ts": /* ts */ `
        export enum Flag { Off = 0, On = 1 }
      `,
    },
    minifySyntax: true,
    dce: true,
    run: { stdout: "undefined\nassigned undefined\nfunction\nfunction" },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain("var inDead");
      expect(out).toContain("var v");
    },
  });
  // Each way to read the enum turns the fold on for the file that reads.
  itBundled("dce/CrossModuleEnumFoldReaders", {
    files: {
      "/entry.ts": /* ts */ `
        import { Flag as ReExported } from "./re-export";
        import { Flag as Star } from "./re-export-star";
        import * as ns from "./flags";
        import { inner } from "./not-entry";
        if (ReExported.Off) console.log("DROP");
        if (Star.Off) console.log("DROP");
        if (ns.Flag.Off) console.log("DROP");
        if (ns.Flag["Off"]) console.log("DROP");
        if (ReExported["Off"]) console.log("DROP");
        async function dynamic() {
          const { Flag } = await import("./flags");
          if (Flag.Off) console.log("DROP");
          const all = await import("./flags");
          if (all.Flag.Off) console.log("DROP");
          return Flag.On | 6;
        }
        console.log(inner(), await dynamic(), ReExported.On | 2, Star.On | 4, ns.Flag.On | 8);
      `,
      "/not-entry.ts": /* ts */ `
        import { Flag } from "./flags";
        export const inner = () => { if (Flag.Off) console.log("DROP"); return Flag.On | 6; };
      `,
      "/re-export.ts": `export { Flag } from "./flags";`,
      "/re-export-star.ts": `export * from "./flags";`,
      "/flags.ts": /* ts */ `
        export enum Flag { Off = 0, On = 1 }
      `,
    },
    minifySyntax: true,
    dce: true,
    run: { stdout: "7 7 3 5 9" },
    onAfterBundle(api) {
      expect(api.readFile("/out.js")).toContain("console.log(inner(), await dynamic(), 3, 5, 9)");
    },
  });
  // The fold is a part of --minify-syntax.
  for (const minifyWhitespace of [false, true]) {
    itBundled(`dce/CrossModuleEnumFoldNeedsMinifySyntax${minifyWhitespace ? "Whitespace" : ""}`, {
      files: {
        "/entry.ts": /* ts */ `
          import { Flag } from "./flags";
          if (Flag.Off) console.log("dead");
          console.log(Flag.Read + Flag.Write, Flag.Read | Flag.Write, Flag.Off ? "dead" : "live");
        `,
        "/flags.ts": /* ts */ `
          export enum Flag { Off = 0, Read = 2, Write = 4 }
        `,
      },
      minifySyntax: false,
      minifyWhitespace,
      run: { stdout: "6 6 live" },
      onAfterBundle(api) {
        const out = api.readFile("/out.js");
        if (minifyWhitespace) {
          expect(out).toContain(`if(0)console.log("dead");console.log(2+4,2|4,0?"dead":"live");`);
        } else {
          expect(out).toContain(`if (0 /* Off */)\n  console.log("dead");`);
          expect(out).toContain(
            `console.log(2 /* Read */ + 4 /* Write */, 2 /* Read */ | 4 /* Write */, 0 /* Off */ ? "dead" : "live");`,
          );
        }
      },
    });
  }
  // A long chain must not overflow the stack, and must not copy the string at each step.
  itBundled("dce/CrossModuleEnumFoldLongChain", {
    files: {
      "/entry.ts": /* ts */ `
        import { E } from "./enum";
        const text = ${Array(5000).fill("E.Text").join(" + ")};
        const sum = ${Array(5000).fill("E.One").join(" + ")};
        console.log(text.length, text === "ab".repeat(5000), sum);
      `,
      "/enum.ts": /* ts */ `
        export enum E { One = 1, Text = "ab" }
      `,
    },
    minifySyntax: true,
    run: { stdout: "10000 true 5000" },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain(`"${"ab".repeat(5000)}"`);
      expect(out).toContain("sum = 5000");
    },
  });
  itBundled("dce/MultipleDeclarationTreeShaking", {
    files: {
      "/var2.js": /* js */ `
        var x = 1
        console.log(x)
        var x = 2
      `,
      "/var3.js": /* js */ `
        var x = 1
        console.log(x)
        var x = 2
        console.log(x)
        var x = 3
      `,
      "/function2.js": /* js */ `
        function x() { return 1 }
        console.log(x())
        function x() { return 2 }
      `,
      "/function3.js": /* js */ `
        function x() { return 1 }
        console.log(x())
        function x() { return 2 }
        console.log(x())
        function x() { return 3 }
      `,
    },
    entryPoints: ["/var2.js", "/var3.js", "/function2.js", "/function3.js"],
    dce: true,
    treeShaking: true,
    minifySyntax: false,
    run: [
      { file: "/out/var2.js", stdout: "1" },
      { file: "/out/var3.js", stdout: "1\n2" },
      { file: "/out/function2.js", stdout: "2" },
      { file: "/out/function3.js", stdout: "3\n3" },
    ],
  });
  itBundled("dce/MultipleDeclarationTreeShakingMinifySyntax", {
    files: {
      "/var2.js": /* js */ `
        var x = 1
        console.log(x)
        var x = 2
      `,
      "/var3.js": /* js */ `
        var x = 1
        console.log(x)
        var x = 2
        console.log(x)
        var x = 3
      `,
      "/function2.js": /* js */ `
        function x() { return "REMOVE" }
        console.log(x())
        function x() { return 2 }
      `,
      "/function3.js": /* js */ `
        function x() { return "REMOVE" }
        console.log(x())
        function x() { return "REMOVE" }
        console.log(x())
        function x() { return 3 }
      `,
    },
    entryPoints: ["/var2.js", "/var3.js", "/function2.js", "/function3.js"],
    dce: true,
    treeShaking: true,
    minifySyntax: true,
    run: [
      { file: "/out/var2.js", stdout: "1" },
      { file: "/out/var3.js", stdout: "1\n2" },
      { file: "/out/function2.js", stdout: "2" },
      { file: "/out/function3.js", stdout: "3\n3" },
    ],
  });
  itBundled("dce/PureCallsWithSpread", {
    todo: true,
    files: {
      // this changes to "[...args]"
      "/entry.js": /* js */ `
        /* @__PURE__ */ REMOVE(...args);
        /* @__PURE__ */ new REMOVE(...args);
      `,
    },
    minifySyntax: true,
    dce: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      expect([...code.matchAll(/\[\.\.\.args\]/g)]).toHaveLength(2); // spread should be preserved
    },
  });
  itBundled("dce/TopLevelFunctionInliningWithSpread", {
    todo: true,
    files: {
      "/entry.js": /* js */ `
        function empty1_remove() {}
        function empty2_remove() {}
        function empty3_remove() {}
  
        function identity1(x) { return x }
        function identity2_remove(x) { return x }
        function identity3(x) { return x }
  
        empty1_remove()
        empty2_remove(args)
        empty3_remove(...args)
  
        identity1()
        identity2_remove(args)
        identity3(...args)
      `,
      "/inner.js": /* js */ `
        export function empty1_remove() {}
        export function empty2_remove() {}
        export function empty3_remove() {}
  
        export function identity1(x) { return x }
        export function identity2_remove(x) { return x }
        export function identity3(x) { return x }
      `,
      "/entry-outer.js": /* js */ `
        import {
          empty1_remove,
          empty2_remove,
          empty3_remove,
  
          identity1,
          identity2_remove,
          identity3,
        } from './inner.js'
  
        empty1_remove()
        empty2_remove(args)
        empty3_remove(...args)
  
        identity1()
        identity2_remove(args)
        identity3(...args)
      `,
    },
    dce: true,
    entryPoints: ["/entry.js", "/entry-outer.js"],
    minifySyntax: true,

    runtimeFiles: {
      "/test.js": /* js */ `
        globalThis.args = {
          [Symbol.iterator]() {
            console.log('spread')
            return {
              next() {
                return { done: true, value: undefined }
              }
            }
          }
        };

        await import('./out/entry.js');
        console.log('---')
        await import('./out/entry-outer.js');
      `,
    },
    run: {
      file: "/test.js",
      stdout: "spread\nspread\n---\nspread\nspread",
    },
  });
  itBundled("dce/NestedFunctionInliningWithSpread", {
    files: {
      "/entry.js": /* js */ `
        function empty1() {}
        function empty2() {}
        function empty3() {}
  
        function identity1(x) { return x }
        function identity2(x) { return x }
        function identity3(x) { return x }
  
        check(
          empty1(),
          empty2(args),
          empty3(...args),
  
          identity1(),
          identity2(args),
          identity3(...args),
        )
      `,
      "/inner.js": /* js */ `
        export function empty1() {}
        export function empty2() {}
        export function empty3() {}
  
        export function identity1(x) { return x }
        export function identity2(x) { return x }
        export function identity3(x) { return x }
      `,
      "/entry-outer.js": /* js */ `
        import {
          empty1,
          empty2,
          empty3,
  
          identity1,
          identity2,
          identity3,
        } from './inner.js'
  
        check(
          empty1(),
          empty2(args),
          empty3(...args),
  
          identity1(),
          identity2(args),
          identity3(...args),
        )
      `,
    },
    entryPoints: ["/entry.js", "/entry-outer.js"],
  });
  // im confused what this is testing. cross platform slash? there is none?? not even in the go source
  itBundled("dce/PackageJsonSideEffectsFalseCrossPlatformSlash", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import "demo-pkg/foo"
        import "demo-pkg/bar"
      `,
      "/Users/user/project/node_modules/demo-pkg/foo.js": `console.log('foo')`,
      "/Users/user/project/node_modules/demo-pkg/bar/index.js": `console.log('bar')`,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": [
            "**/foo.js",
            "bar/index.js"
          ]
        }
      `,
    },
    run: {
      stdout: "foo\nbar",
    },
  });
  itBundled("dce/PackageJsonSideEffectsArrayBackslash", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import "demo-pkg/a/index.js"
        import "demo-pkg/b/index.js"
        import "demo-pkg/c/index.js"
        import "demo-pkg/d/index.js"
      `,
      "/Users/user/project/node_modules/demo-pkg/a/index.js": `console.log('a')`,
      "/Users/user/project/node_modules/demo-pkg/b/index.js": `console.log('b')`,
      "/Users/user/project/node_modules/demo-pkg/c/index.js": `console.log('c')`,
      "/Users/user/project/node_modules/demo-pkg/d/index.js": `console.log('d')`,
      "/Users/user/project/node_modules/demo-pkg/package.json": JSON.stringify({
        sideEffects: ["a\\index.js", "\\b\\index.js", "/c\\index.js"],
      }),
    },
    run: {
      stdout: "a\nb\nc",
    },
  });
  itBundled("dce/CallWithNoArg", {
    files: {
      "/entry.js": /* js */ `
        /* @__PURE__ */ noSideEffects();
      `,
    },
    run: {
      stdout: "",
    },
  });
  itBundled("dce/ConstructWithNoArg", {
    files: {
      "/entry.js": /* js */ `
        /* @__PURE__ */ new NoSideEffects();
      `,
    },
    run: {
      stdout: "",
    },
  });
  itBundled("dce/IgnoreAnnotations", {
    files: {
      "/entry.js": /* js */ `
        function noSideEffects() { console.log("PASS"); }
        /* @__PURE__ */ noSideEffects(1);
      `,
    },
    ignoreDCEAnnotations: true,
    run: {
      stdout: "PASS",
    },
  });
  itBundled("dce/IgnoreAnnotationsDoesNotApplyToRuntime", {
    files: {
      "/entry.js": /* js */ `
        import("./other.js").then(m => Object.keys(m));
      `,
      "/other.js": /* js */ `
        export function foo() { }
      `,
    },
    ignoreDCEAnnotations: true,
    onAfterBundle(api) {
      // These symbols technically have side effects, and we use dce annotations
      // to let them tree-shake User-specified --ignore-annotations should not
      // apply to our code.
      api.expectFile("/out.js").not.toContain("__dispose");
      api.expectFile("/out.js").not.toContain("__asyncDispose");
      api.expectFile("/out.js").not.toContain("__require");

      // This assertion catches if the bundler changes in that the runtime is no
      // longer included. If this fails, just adjust the code snippet so some
      // part of runtime.js is used
      api.expectFile("/out.js").toContain("__defProp");
    },
  });
  // itBundled("dce/TreeShakingJSWithAssociatedCSS", {
  //   // TODO: css assertions. this should contain both button and menu
  //   files: {
  //     "/project/test.jsx": /* jsx */ `
  //       import { Button } from 'pkg/button'
  //       import { Menu } from 'pkg/menu'
  //       render(<Button/>)
  //     `,
  //     "/project/node_modules/pkg/button.js": /* js */ `
  //       import './button.css'
  //       export let Button
  //     `,
  //     "/project/node_modules/pkg/button.css": `button { color: red }`,
  //     "/project/node_modules/pkg/menu.js": /* js */ `
  //       import './menu.css'
  //       export let Menu
  //     `,
  //     "/project/node_modules/pkg/menu.css": `menu { color: green }`,
  //   },
  //   external: ["react"],
  // });
  // itBundled("dce/TreeShakingJSWithAssociatedCSSReExportSideEffectsFalse", {
  //   // GENERATED
  //   files: {
  //     "/project/test.jsx": /* jsx */ `
  //       import { Button } from 'pkg'
  //       render(<Button/>)
  //     `,
  //     "/project/node_modules/pkg/entry.js": `export { Button } from './components'`,
  //     "/project/node_modules/pkg/package.json": /* json */ `
  //       {
  //       "main": "./entry.js",
  //       "sideEffects": false
  //     }
  //     `,
  //     "/project/node_modules/pkg/components.jsx": /* jsx */ `
  //       require('./button.css')
  //       export const Button = () => <button/>
  //     `,
  //     "/project/node_modules/pkg/button.css": `button { color: red }`,
  //   },
  // });
  // itBundled("dce/TreeShakingJSWithAssociatedCSSReExportSideEffectsFalseOnlyJS", {
  //   // GENERATED
  //   files: {
  //     "/project/test.jsx": /* jsx */ `
  //       import { Button } from 'pkg'
  //       render(<Button/>)
  //     `,
  //     "/project/node_modules/pkg/entry.js": `export { Button } from './components'`,
  //     "/project/node_modules/pkg/package.json": /* json */ `
  //       {
  //       "main": "./entry.js",
  //       "sideEffects": ["*.css"]
  //     }
  //     `,
  //     "/project/node_modules/pkg/components.jsx": /* jsx */ `
  //       require('./button.css')
  //       export const Button = () => <button/>
  //     `,
  //     "/project/node_modules/pkg/button.css": `button { color: red }`,
  //   },
  // });
  // itBundled("dce/TreeShakingJSWithAssociatedCSSExportStarSideEffectsFalse", {
  //   // GENERATED
  //   files: {
  //     "/project/test.jsx": /* jsx */ `
  //       import { Button } from 'pkg'
  //       render(<Button/>)
  //     `,
  //     "/project/node_modules/pkg/entry.js": `export * from './components'`,
  //     "/project/node_modules/pkg/package.json": /* json */ `
  //       {
  //       "main": "./entry.js",
  //       "sideEffects": false
  //     }
  //     `,
  //     "/project/node_modules/pkg/components.jsx": /* jsx */ `
  //       require('./button.css')
  //       export const Button = () => <button/>
  //     `,
  //     "/project/node_modules/pkg/button.css": `button { color: red }`,
  //   },
  // });
  // itBundled("dce/TreeShakingJSWithAssociatedCSSExportStarSideEffectsFalseOnlyJS", {
  //   // GENERATED
  //   files: {
  //     "/project/test.jsx": /* jsx */ `
  //       import { Button } from 'pkg'
  //       render(<Button/>)
  //     `,
  //     "/project/node_modules/pkg/entry.js": `export * from './components'`,
  //     "/project/node_modules/pkg/package.json": /* json */ `
  //       {
  //       "main": "./entry.js",
  //       "sideEffects": ["*.css"]
  //     }
  //     `,
  //     "/project/node_modules/pkg/components.jsx": /* jsx */ `
  //       require('./button.css')
  //       export const Button = () => <button/>
  //     `,
  //     "/project/node_modules/pkg/button.css": `button { color: red }`,
  //   },
  // });
  // itBundled("dce/TreeShakingJSWithAssociatedCSSUnusedNestedImportSideEffectsFalse", {
  //   // GENERATED
  //   files: {
  //     "/project/test.jsx": /* jsx */ `
  //       import { Button } from 'pkg/button'
  //       render(<Button/>)
  //     `,
  //     "/project/node_modules/pkg/package.json": /* json */ `
  //       {
  //       "sideEffects": false
  //     }
  //     `,
  //     "/project/node_modules/pkg/button.jsx": /* jsx */ `
  //       import styles from './styles'
  //       export const Button = () => <button/>
  //     `,
  //     "/project/node_modules/pkg/styles.js": /* js */ `
  //       import './styles.css'
  //       export default {}
  //     `,
  //     "/project/node_modules/pkg/styles.css": `button { color: red }`,
  //   },
  // });
  // itBundled("dce/TreeShakingJSWithAssociatedCSSUnusedNestedImportSideEffectsFalseOnlyJS", {
  //   // GENERATED
  //   files: {
  //     "/project/test.jsx": /* jsx */ `
  //       import { Button } from 'pkg/button'
  //       render(<Button/>)
  //     `,
  //     "/project/node_modules/pkg/package.json": /* json */ `
  //       {
  //         "sideEffects": ["*.css"]
  //       }
  //     `,
  //     "/project/node_modules/pkg/button.jsx": /* jsx */ `
  //       import styles from './styles'
  //       export const Button = () => <button/>
  //     `,
  //     "/project/node_modules/pkg/styles.js": /* js */ `
  //       import './styles.css'
  //       export default {}
  //     `,
  //     "/project/node_modules/pkg/styles.css": `button { color: red }`,
  //   },
  // });
});
