// The projects and command lines that eslint-cli.mjs compares. `files`: path -> text, or `{ link }` for a symbolic link.

const config = rules => `export default [{ rules: ${JSON.stringify(rules)} }];\n`;
const basic = config({
  "no-debugger": "error",
  "no-unused-vars": "warn",
  eqeqeq: "error",
  semi: "error",
  "no-var": "warn",
});

const bad = "var a = 1\nif (a == 2) { debugger; }\n";
const good = "export const a = 1;\n";

const project = {
  "eslint.config.js": basic,
  "a.js": bad,
  "b.js": good,
  "src/c.js": "debugger;\n",
  "src/d.mjs": "let unused = 1;\n",
  "src/e.cjs": "var x = require('x');\nmodule.exports = x\n",
  "src/f.ts": "debugger;\n",
  "src/deep/er/g.js": "if (a == b) {}\n",
  "src/.hidden/h.js": "debugger;\n",
  "src/.dot.js": "debugger;\n",
  "lib/i.jsx": "debugger;\n",
  "lib/readme.md": "# debugger\n",
  "vendor/node_modules/pkg/j.js": "debugger;\n",
};

const typed = {
  "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, target: "es2022", module: "esnext", moduleResolution: "bundler", noEmit: true, types: [] }, include: ["src"] }),
  "eslint.config.mjs": `import tseslint from "typescript-eslint";
export default tseslint.config(
  ...tseslint.configs.recommendedTypeChecked,
  { languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } } },
  { files: ["**/*.mjs"], ...tseslint.configs.disableTypeChecked },
);
`,
  "src/a.ts": `import { later } from "./b";
export function run() {
  later();
  const x: any = 1;
  const y: string = x;
  return y as string;
}
export async function nothing() {
  return 1;
}
`,
  "src/b.ts": `export async function later(): Promise<number> {
  return await Promise.resolve(1);
}
const s = "a" as string;
export const t = s as string;
`,
};

export const cases = [
  // ───────────── which files ─────────────
  { name: "no arguments", files: project, args: [] },
  { name: "dot", files: project, args: ["."] },
  { name: "one file", files: project, args: ["a.js"] },
  { name: "two files", files: project, args: ["b.js", "a.js"] },
  { name: "the same file twice", files: project, args: ["a.js", "./a.js"] },
  { name: "a directory", files: project, args: ["src"] },
  { name: "a directory with a slash", files: project, args: ["src/"] },
  { name: "a nested directory", files: project, args: ["src/deep"] },
  { name: "a directory and a file in it", files: project, args: ["src", "src/c.js"] },
  { name: "glob star", files: project, args: ["*.js"] },
  { name: "glob globstar", files: project, args: ["**/*.js"] },
  { name: "glob in a directory", files: project, args: ["src/**/*.js"] },
  { name: "glob braces", files: project, args: ["src/*.{js,mjs}"] },
  { name: "glob of directories", files: project, args: ["s*"] },
  { name: "glob question mark", files: project, args: ["?.js"] },
  { name: "glob class", files: project, args: ["[ab].js"] },
  { name: "glob that matches files without configuration", files: project, args: ["src/*.ts"] },
  { name: "glob that matches some files without configuration", files: project, args: ["src/*"] },
  { name: "glob that matches nothing", files: project, args: ["nothing/**/*.js"] },
  {
    name: "glob that matches nothing, tolerated",
    files: project,
    args: ["--no-error-on-unmatched-pattern", "nothing/**/*.js"],
  },
  { name: "two globs, one matches nothing", files: project, args: ["*.js", "*.nothing"] },
  { name: "a file that does not exist", files: project, args: ["nothing.js"] },
  {
    name: "a file that does not exist, tolerated",
    files: project,
    args: ["--no-error-on-unmatched-pattern", "nothing.js", "a.js"],
  },
  { name: "a file without configuration", files: project, args: ["src/f.ts"] },
  { name: "a file without configuration, no warning", files: project, args: ["--no-warn-ignored", "src/f.ts"] },
  { name: "a file in node_modules", files: project, args: ["vendor/node_modules/pkg/j.js"] },
  { name: "a directory in node_modules", files: project, args: ["vendor/node_modules/pkg"] },
  { name: "a directory that has only node_modules", files: project, args: ["vendor"] },
  { name: "a directory without files to lint", files: project, args: ["lib"] },
  { name: "ext", files: project, args: ["--ext", ".ts,jsx", "."] },
  { name: "ext twice", files: project, args: ["--ext", ".ts", "--ext", ".jsx", "lib", "src"] },
  { name: "ext empty", files: project, args: ["--ext", "", "."] },
  { name: "ext with an empty element", files: project, args: ["--ext", "ts,,jsx", "."] },
  { name: "from a subdirectory", files: project, cwd: "src", args: [] },
  { name: "from a subdirectory, the parent", files: project, cwd: "src", args: [".."] },
  { name: "from a subdirectory, a file above", files: project, cwd: "src/deep", args: ["../../a.js"] },
  { name: "pass on no patterns", files: project, args: ["--pass-on-no-patterns"] },
  { name: "after two dashes", files: { ...project, "--fix.js": bad }, args: ["--", "--fix.js"] },
  { name: "a link to a file", files: { ...project, "src/link.js": { link: "../a.js" } }, args: ["src"] },
  { name: "a link to a directory", files: { ...project, "linked": { link: "src" } }, args: ["."] },
  { name: "a link to a directory, named", files: { ...project, "linked": { link: "src" } }, args: ["linked"] },
  {
    name: "paths that sort differently",
    files: {
      "eslint.config.js": basic,
      "a-b.js": "debugger;",
      "a/b.js": "debugger;",
      "a.js": "debugger;",
      "A.js": "debugger;",
      "é.js": "debugger;",
      "a_b.js": "debugger;",
    },
    args: ["."],
  },

  // ───────────── ignoring ─────────────
  { name: "ignore pattern", files: project, args: ["--ignore-pattern", "src/", "."] },
  { name: "ignore pattern file", files: project, args: ["--ignore-pattern", "**/c.js", "."] },
  {
    name: "ignore patterns",
    files: project,
    args: ["--ignore-pattern", "a.js", "--ignore-pattern", "src/deep/**", "."],
  },
  { name: "ignore pattern with a comma", files: project, args: ["--ignore-pattern", "a.js,b.js", "."] },
  { name: "ignore pattern, the file is named", files: project, args: ["--ignore-pattern", "a.js", "a.js"] },
  {
    name: "ignore pattern, the file is named, no warning",
    files: project,
    args: ["--ignore-pattern", "a.js", "--no-warn-ignored", "a.js"],
  },
  { name: "ignore pattern and no-ignore", files: project, args: ["--ignore-pattern", "a.js", "--no-ignore", "a.js"] },
  { name: "ignore pattern from a subdirectory", files: project, cwd: "src", args: ["--ignore-pattern", "c.js", "."] },
  {
    name: "ignore pattern negated",
    files: project,
    args: ["--ignore-pattern", "src/**", "--ignore-pattern", "!src/c.js", "."],
  },
  { name: "unignore node_modules", files: project, args: ["--ignore-pattern", "!**/node_modules/", "vendor"] },
  { name: "everything ignored", files: project, args: ["--ignore-pattern", "**", "."] },
  { name: "all that a glob matches is ignored", files: project, args: ["--ignore-pattern", "src/", "src/*.js"] },
  {
    name: "global ignores",
    files: {
      ...project,
      "eslint.config.js": `export default [{ ignores: ["src/deep/", "**/*.mjs"] }, { rules: { "no-debugger": 2 } }];`,
    },
    args: ["."],
  },
  {
    name: "global ignores, no-ignore",
    files: {
      ...project,
      "eslint.config.js": `export default [{ ignores: ["src/deep/", "**/*.mjs", "a.js"] }, { rules: { "no-debugger": 2 } }];`,
    },
    args: ["--no-ignore", "."],
  },
  {
    name: "global ignores, a file is named",
    files: {
      ...project,
      "eslint.config.js": `export default [{ ignores: ["src/deep/", "a.js"] }, { rules: { "no-debugger": 2 } }];`,
    },
    args: ["a.js", "src/deep/er/g.js", "src/c.js"],
  },
  {
    name: "ignores of an object with rules",
    files: { ...project, "eslint.config.js": `export default [{ ignores: ["src/**"], rules: { "no-debugger": 2 } }];` },
    args: ["."],
  },
  {
    name: "files of an object",
    files: {
      ...project,
      "eslint.config.js": `export default [{ files: ["src/**/*.ts", "lib/*.jsx"], rules: { "no-debugger": 2 } }, { files: ["**/*.jsx"], languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } } }];`,
    },
    args: ["."],
  },
  { name: "eslintignore is not read", files: { ...project, ".eslintignore": "a.js\n" }, args: ["a.js"] },
  { name: "gitignore is not read", files: { ...project, ".gitignore": "a.js\nsrc\n" }, args: ["."] },

  // ───────────── which configuration ─────────────
  { name: "config mjs", files: { "eslint.config.mjs": basic, "a.js": bad }, args: ["."] },
  {
    name: "config cjs",
    files: { "eslint.config.cjs": `module.exports = [{ rules: { "no-debugger": 2 } }];`, "a.js": bad },
    args: ["."],
  },
  {
    name: "config ts",
    files: {
      "eslint.config.ts": `const severity: number = 2;\nexport default [{ rules: { "no-debugger": severity } }];`,
      "a.js": bad,
    },
    args: ["."],
  },
  {
    name: "config js wins over mjs",
    files: {
      "eslint.config.js": config({ "no-debugger": 2 }),
      "eslint.config.mjs": config({ eqeqeq: 2 }),
      "a.js": bad,
    },
    args: ["."],
  },
  {
    name: "config is an object",
    files: { "eslint.config.js": `export default { rules: { "no-debugger": 2 } };`, "a.js": bad },
    args: ["."],
  },
  {
    name: "config is a promise",
    files: { "eslint.config.js": `export default Promise.resolve([{ rules: { "no-debugger": 2 } }]);`, "a.js": bad },
    args: ["."],
  },
  { name: "config is empty", files: { "eslint.config.js": `export default [];`, "a.js": bad }, args: ["."] },
  {
    name: "config prints",
    files: {
      "eslint.config.js": `console.error("hello");\nexport default [{ rules: { "no-debugger": 2 } }];`,
      "a.js": bad,
    },
    args: ["."],
  },
  { name: "config throws", files: { "eslint.config.js": `throw new Error("no");`, "a.js": bad }, args: ["."] },
  { name: "config above", files: project, cwd: "src/deep/er", args: ["."] },
  {
    name: "nested configs",
    files: {
      ...project,
      "src/eslint.config.js": config({ eqeqeq: "warn" }),
      "src/deep/er/eslint.config.mjs": config({ "no-empty": "error" }),
    },
    args: ["."],
  },
  {
    name: "nested config whose directory the parent ignores",
    files: {
      ...project,
      "eslint.config.js": `export default [{ ignores: ["src/"] }, { rules: { "no-debugger": 2 } }];`,
      "src/eslint.config.js": config({ "no-debugger": "warn" }),
    },
    args: ["."],
  },
  {
    name: "nested config whose directory the parent ignores, named",
    files: {
      ...project,
      "eslint.config.js": `export default [{ ignores: ["src/"] }, { rules: { "no-debugger": 2 } }];`,
      "src/eslint.config.js": config({ "no-debugger": "warn" }),
    },
    args: ["src", "src/c.js"],
  },
  {
    name: "nested configs, files are named",
    files: { ...project, "src/eslint.config.js": config({ "no-debugger": "warn" }) },
    args: ["a.js", "src/c.js"],
  },
  {
    name: "-c",
    files: { ...project, "other.config.js": config({ "no-var": 2 }) },
    args: ["-c", "other.config.js", "."],
  },
  {
    name: "--config in a subdirectory",
    files: {
      ...project,
      "configs/other.config.js": `export default [{ ignores: ["src/"] }, { rules: { "no-var": 2 } }];`,
    },
    args: ["--config", "configs/other.config.js", "."],
  },
  {
    name: "--config=",
    files: { ...project, "other.config.js": config({ "no-var": 2 }) },
    args: ["--config=other.config.js", "a.js"],
  },
  {
    name: "--config overrides nested configs",
    files: {
      ...project,
      "src/eslint.config.js": config({ eqeqeq: "warn" }),
      "other.config.js": config({ "no-var": 2 }),
    },
    args: ["-c", "other.config.js", "."],
  },
  { name: "--config that does not exist", files: project, args: ["-c", "nothing.config.js", "."] },
  { name: "no-config-lookup", files: project, args: ["--no-config-lookup", "."] },
  {
    name: "no-config-lookup with a rule",
    files: project,
    args: ["--no-config-lookup", "--rule", "no-debugger: error", "."],
  },
  {
    name: "a file outside of the base path",
    files: { "p/eslint.config.js": basic, "p/a.js": bad, "q/b.js": bad },
    cwd: "p",
    args: ["-c", "eslint.config.js", "../q/b.js", "a.js"],
  },
  {
    name: "defineConfig, extends, globalIgnores",
    files: {
      ...project,
      "eslint.config.js": `import { defineConfig, globalIgnores } from "eslint/config";\nimport js from "@eslint/js";\nexport default defineConfig([globalIgnores(["src/deep/"]), { files: ["**/*.js"], plugins: { js }, extends: ["js/recommended"], rules: { "no-var": "warn" } }]);`,
    },
    args: ["."],
  },
  {
    name: "js recommended and globals",
    files: {
      "eslint.config.js": `import js from "@eslint/js";\nimport globals from "globals";\nexport default [js.configs.recommended, { languageOptions: { globals: { ...globals.node } } }];`,
      "a.js": "console.log(process.argv, window);\nlet a;\n",
    },
    args: ["."],
  },
  {
    name: "basePath",
    files: {
      ...project,
      "eslint.config.js": `export default [{ basePath: "src", files: ["*.js"], rules: { "no-debugger": 2 } }, { basePath: "src", ignores: ["deep/"] }];`,
    },
    args: ["."],
  },
  {
    name: "a plugin that is not implemented",
    files: {
      "eslint.config.js": `const plugin = { meta: { name: "eslint-plugin-nothing" }, rules: { never: { create() { return {}; } } } };\nexport default [{ plugins: { nothing: plugin }, rules: { "nothing/never": 2, "no-debugger": 2 } }];`,
      "a.js": bad,
    },
    args: ["."],
  },

  // ───────────── flags that configure ─────────────
  {
    name: "--rule",
    files: project,
    args: ["--rule", "no-console: 2", "--rule", "no-debugger: off", "a.js", "src/c.js"],
  },
  {
    name: "--rule with options",
    files: project,
    args: ["--rule", "quotes: [2, double]", "--rule", "semi: [error, never]", "src/e.cjs"],
  },
  {
    name: "--rule as JSON",
    files: project,
    args: ["--rule", '{"quotes": ["error", "double"], "semi": 0}', "src/e.cjs"],
  },
  { name: "--rule several in one", files: project, args: ["--rule", "quotes: [2, double], semi: 0", "src/e.cjs"] },
  { name: "--rule with invalid options", files: project, args: ["--rule", "quotes: [2, nothing]", "a.js"] },
  { name: "--rule with an invalid severity", files: project, args: ["--rule", "quotes: 3", "a.js"] },
  {
    name: "--global",
    files: { "eslint.config.js": config({ "no-undef": 2, "no-global-assign": 2 }), "a.js": "a = b; b = c; c = d;\n" },
    args: ["--global", "a,b:true", "--global", "c:false", "a.js"],
  },
  {
    name: "--parser-options",
    files: { "eslint.config.js": config({ "no-debugger": 2 }), "a.js": "const a = <div/>; debugger;\n" },
    args: ["--parser-options", "ecmaFeatures:{jsx:true}", "a.js"],
  },
  {
    name: "--no-inline-config",
    files: {
      "eslint.config.js": basic,
      "a.js": "/* eslint-disable */\ndebugger;\n/* eslint no-console: 2 */\nconsole.log(1);\n",
    },
    args: ["--no-inline-config", "a.js"],
  },
  {
    name: "unused disable directives by default",
    files: { "eslint.config.js": basic, "a.js": "// eslint-disable-next-line no-debugger\nexport const a = 1;\n" },
    args: ["a.js"],
  },
  {
    name: "--report-unused-disable-directives",
    files: { "eslint.config.js": basic, "a.js": "// eslint-disable-next-line no-debugger\nexport const a = 1;\n" },
    args: ["--report-unused-disable-directives", "a.js"],
  },
  {
    name: "--report-unused-disable-directives-severity off",
    files: { "eslint.config.js": basic, "a.js": "// eslint-disable-next-line no-debugger\nexport const a = 1;\n" },
    args: ["--report-unused-disable-directives-severity", "off", "a.js"],
  },
  {
    name: "--report-unused-disable-directives-severity 2",
    files: { "eslint.config.js": basic, "a.js": "// eslint-disable-next-line no-debugger\nexport const a = 1;\n" },
    args: ["--report-unused-disable-directives-severity=2", "a.js"],
  },
  {
    name: "--report-unused-disable-directives both",
    files: project,
    args: ["--report-unused-disable-directives", "--report-unused-disable-directives-severity", "warn", "a.js"],
  },
  {
    name: "--report-unused-disable-directives-severity invalid",
    files: project,
    args: ["--report-unused-disable-directives-severity", "nothing", "a.js"],
  },
  {
    name: "--report-unused-inline-configs",
    files: { "eslint.config.js": basic, "a.js": "/* eslint no-debugger: error */\nexport const a = 1;\n" },
    args: ["--report-unused-inline-configs", "error", "a.js"],
  },

  // ───────────── output ─────────────
  { name: "stylish with color", files: project, args: ["--color", "."] },
  {
    name: "stylish with color, only warnings",
    files: { "eslint.config.js": basic, "a.js": "let a = 1;\n" },
    args: ["--color", "."],
  },
  { name: "stylish without color", files: project, args: ["--no-color", "."] },
  { name: "stylish FORCE_COLOR", files: project, env: { FORCE_COLOR: "1" }, args: ["a.js"] },
  { name: "stylish nothing to report", files: project, args: ["b.js"] },
  { name: "stylish one problem", files: project, args: ["src/c.js"] },
  {
    name: "stylish wide positions",
    files: { "eslint.config.js": basic, "a.js": "\n".repeat(120) + " ".repeat(130) + "debugger;\ndebugger;\n" },
    args: ["a.js"],
  },
  { name: "stylish syntax error", files: { "eslint.config.js": basic, "a.js": "const = 1;\n" }, args: ["a.js"] },
  {
    name: "stylish not ASCII",
    files: {
      "eslint.config.js": config({ "no-unused-vars": 2, "no-undef": 2 }),
      "a.js": "let é𝒳 = 1;\nlet b = 日本語;\n",
    },
    args: ["--color", "a.js"],
  },
  {
    name: "stylish numbers in the message",
    files: {
      "eslint.config.js": config({ "max-len": [2, 10], "max-lines": [1, 1] }),
      "a.js": "const aaaaaaaaaaaaaaaaaaaaaaaaaaaa = 1;\n\n\nexport { aaaaaaaaaaaaaaaaaaaaaaaaaaaa };\n",
    },
    args: ["--color", "a.js"],
  },
  { name: "-f stylish", files: project, args: ["-f", "stylish", "a.js"] },
  { name: "json", files: project, args: ["-f", "json", "."] },
  { name: "json --format=", files: project, args: ["--format=json", "a.js", "b.js"] },
  { name: "json nothing to lint", files: project, args: ["-f", "json", "--pass-on-no-patterns"] },
  {
    name: "json ignored file",
    files: project,
    args: ["-f", "json", "src/f.ts", "vendor/node_modules/pkg/j.js", "a.js"],
  },
  {
    name: "json syntax error",
    files: { "eslint.config.js": basic, "a.js": "const = 1;\n" },
    args: ["-f", "json", "a.js"],
  },
  {
    name: "json suppressed",
    files: {
      "eslint.config.js": basic,
      "a.js":
        "// eslint-disable-next-line no-debugger -- because\ndebugger;\n/* eslint-disable eqeqeq */\nexport default 1 == 2;\n",
    },
    args: ["-f", "json", "a.js"],
  },
  {
    name: "json suggestions",
    files: { "eslint.config.js": config({ "no-unused-vars": 2, "no-useless-escape": 2 }), "a.js": 'let a = "\\d";\n' },
    args: ["-f", "json", "a.js"],
  },
  {
    name: "json not ASCII",
    files: { "eslint.config.js": basic, "a.js": "export const é = '𝒳\u2028'\nvar b = 1\n" },
    args: ["-f", "json", "a.js"],
  },
  {
    name: "json byte order mark",
    files: { "eslint.config.js": basic, "a.js": "\uFEFFvar b = 1\n" },
    args: ["-f", "json", "a.js"],
  },
  {
    name: "json deprecated rules",
    files: {
      "eslint.config.js": config({ semi: 2, quotes: 1, "no-new-symbol": 2, indent: 0, "no-debugger": 2 }),
      "a.js": bad,
    },
    args: ["-f", "json", "a.js"],
  },
  { name: "json quiet", files: project, args: ["-f", "json", "--quiet", "."] },
  { name: "unknown formatter", files: project, args: ["-f", "nothing", "a.js"] },
  { name: "unix", files: project, args: ["-f", "unix", "."] },
  { name: "output file", files: project, args: ["-o", "out/report.txt", "a.js"], reads: ["out/report.txt"] },
  {
    name: "output file json",
    files: project,
    args: ["-f", "json", "--output-file", "report.json", "."],
    reads: ["report.json"],
  },
  { name: "output file is a directory", files: project, args: ["-o", "src", "a.js"] },
  { name: "output file, nothing to report", files: project, args: ["-o", "report.txt", "b.js"], reads: ["report.txt"] },

  // ───────────── warnings and the exit code ─────────────
  { name: "quiet", files: project, args: ["--quiet", "."] },
  { name: "quiet, only warnings", files: project, args: ["--quiet", "src/d.mjs"] },
  { name: "only warnings", files: project, args: ["src/d.mjs"] },
  { name: "max-warnings 0", files: project, args: ["--max-warnings", "0", "src/d.mjs"] },
  { name: "max-warnings 1", files: project, args: ["--max-warnings", "1", "src/d.mjs"] },
  { name: "max-warnings=0 and errors", files: project, args: ["--max-warnings=0", "a.js"] },
  { name: "max-warnings -1", files: project, args: ["--max-warnings", "-1", "src/d.mjs"] },
  { name: "max-warnings and quiet", files: project, args: ["--max-warnings", "0", "--quiet", "src/d.mjs"] },
  { name: "max-warnings invalid", files: project, args: ["--max-warnings", "many", "src/d.mjs"] },
  { name: "max-warnings counts ignored files", files: project, args: ["--max-warnings", "0", "src/f.ts"] },
  {
    name: "exit-on-fatal-error",
    files: { "eslint.config.js": basic, "a.js": "const = 1;\n" },
    args: ["--exit-on-fatal-error", "a.js"],
  },
  { name: "exit-on-fatal-error without one", files: project, args: ["--exit-on-fatal-error", "a.js"] },
  { name: "unknown flag", files: project, args: ["--nothing", "a.js"] },
  { name: "flag without its value", files: project, args: ["a.js", "--format"] },
  { name: "camel case flag", files: project, args: ["--maxWarnings", "0", "src/d.mjs"] },
  { name: "--no-fix", files: project, args: ["--no-fix", "a.js"] },
  { name: "--cache is accepted", files: project, args: ["--no-cache", "a.js"] },

  // ───────────── stdin ─────────────
  { name: "stdin", files: project, args: ["--stdin"], stdin: bad },
  { name: "stdin json", files: project, args: ["--stdin", "-f", "json"], stdin: bad },
  { name: "stdin filename", files: project, args: ["--stdin", "--stdin-filename", "src/new.js"], stdin: bad },
  {
    name: "stdin filename json",
    files: project,
    args: ["--stdin", "--stdin-filename=src/new.js", "-f", "json"],
    stdin: bad,
  },
  {
    name: "stdin filename without configuration",
    files: project,
    args: ["--stdin", "--stdin-filename", "new.ts"],
    stdin: bad,
  },
  {
    name: "stdin filename ignored",
    files: project,
    args: ["--stdin", "--stdin-filename", "node_modules/new.js"],
    stdin: bad,
  },
  {
    name: "stdin filename ignored, no warning",
    files: project,
    args: ["--stdin", "--stdin-filename", "node_modules/new.js", "--no-warn-ignored"],
    stdin: bad,
  },
  {
    name: "stdin filename with a nested config",
    files: { ...project, "src/eslint.config.js": config({ "no-var": 2 }) },
    args: ["--stdin", "--stdin-filename", "src/new.js"],
    stdin: bad,
  },
  { name: "stdin empty", files: project, args: ["--stdin"], stdin: "" },
  { name: "stdin and fix", files: project, args: ["--stdin", "--fix"], stdin: bad },
  { name: "stdin and fix-dry-run", files: project, args: ["--stdin", "--fix-dry-run", "-f", "json"], stdin: bad },
  { name: "stdin and files", files: project, args: ["--stdin", "b.js"], stdin: bad },

  // ───────────── fixing ─────────────
  { name: "fix", files: project, args: ["--fix", "."] },
  { name: "fix json", files: project, args: ["--fix", "-f", "json", "a.js", "b.js"] },
  { name: "fix-dry-run", files: project, args: ["--fix-dry-run", "."] },
  { name: "fix-dry-run json", files: project, args: ["--fix-dry-run", "-f", "json", "a.js"] },
  { name: "fix and fix-dry-run", files: project, args: ["--fix", "--fix-dry-run", "a.js"] },
  { name: "fix-type without fix", files: project, args: ["--fix-type", "layout", "a.js"] },
  { name: "fix-type layout", files: project, args: ["--fix", "--fix-type", "layout", "a.js"] },
  { name: "fix-type suggestion", files: project, args: ["--fix", "--fix-type", "suggestion", "a.js"] },
  { name: "fix-type two", files: project, args: ["--fix", "--fix-type", "suggestion,layout", "a.js"] },
  {
    name: "fix-type twice",
    files: project,
    args: ["--fix", "--fix-type", "suggestion", "--fix-type", "problem", "a.js"],
  },
  { name: "fix-type invalid", files: project, args: ["--fix", "--fix-type", "nothing", "a.js"] },
  {
    name: "fix-type directive",
    files: { "eslint.config.js": basic, "a.js": "// eslint-disable-next-line no-debugger\nvar a = 1\nexport { a };\n" },
    args: ["--fix", "--fix-type", "directive", "a.js"],
  },
  { name: "fix quiet", files: project, args: ["--fix", "--quiet", "a.js"] },
  {
    name: "fix several passes",
    files: {
      "eslint.config.js": config({
        "no-var": 2,
        "prefer-const": 2,
        semi: 2,
        "no-extra-semi": 2,
        "object-shorthand": 2,
      }),
      "a.js": "var a = 1;;\nvar b = { a: a }\nexport { b }\n",
    },
    args: ["--fix", "-f", "json", "a.js"],
  },
  {
    name: "fix a file with a syntax error",
    files: { "eslint.config.js": basic, "a.js": "var a = 1\nconst = 1;\n" },
    args: ["--fix", "a.js"],
  },
  {
    name: "fix byte order mark",
    files: {
      "eslint.config.js": config({ semi: 2, "unicode-bom": [2, "never"] }),
      "a.js": "\uFEFFexport const a = 1\n",
    },
    args: ["--fix", "-f", "json", "a.js"],
  },
  {
    name: "fix adds a byte order mark",
    files: { "eslint.config.js": config({ semi: 2, "unicode-bom": [2, "always"] }), "a.js": "export const a = 1\n" },
    args: ["--fix", "-f", "json", "a.js"],
  },
  { name: "fix through a link", files: { ...project, "link.js": { link: "a.js" } }, args: ["--fix", "link.js"] },
  {
    name: "fix unused directives",
    files: { "eslint.config.js": basic, "a.js": "// eslint-disable-next-line no-debugger\nexport const a = 1;\n" },
    args: ["--fix", "a.js"],
  },

  // ───────────── rules that need types (set BUN_SEMA_TS_LIB for the harness) ─────────────
  { name: "typed", files: typed, args: ["."] },
  { name: "typed one file", files: typed, args: ["src/a.ts"] },
  { name: "typed from a subdirectory", files: typed, cwd: "src", args: ["."] },
  { name: "typed fix", files: typed, args: ["--fix", "."] },
  { name: "typed fix-dry-run", files: typed, args: ["--fix-dry-run", "."] },
  { name: "typed quiet", files: typed, args: ["--quiet", "."] },
  { name: "typed byte order mark", files: { ...typed, "src/b.ts": "\uFEFF" + typed["src/b.ts"] }, args: ["src/b.ts"] },
  { name: "typed byte order mark fix", files: { ...typed, "src/b.ts": "\uFEFF" + typed["src/b.ts"] }, args: ["--fix", "src/b.ts"] },
  { name: "typed byte order mark fix-dry-run json", files: { ...typed, "src/b.ts": "\uFEFF" + typed["src/b.ts"] }, args: ["--fix-dry-run", "-f", "json", "src/b.ts"] },
  { name: "typed json", files: typed, args: ["-f", "json", "src/b.ts"] },
  { name: "typed crlf fix", files: { ...typed, "src/b.ts": typed["src/b.ts"].replaceAll("\n", "\r\n") }, args: ["--fix", "src/b.ts"] },
  { name: "typed stdin", files: typed, args: ["--stdin", "--stdin-filename", "src/a.ts"], stdin: 'import { later } from "./b";\nlater();\n' },
  { name: "typed declaration file", files: { ...typed, "src/c.d.ts": "declare function f(options?: string | undefined): void;\ntype T = string | string;\n" }, args: ["src/c.d.ts"] },
  { name: "typed syntax error in another file", files: { ...typed, "src/z.ts": "const = 1;\n" }, args: ["src/a.ts", "src/b.ts"] },
  { name: "typed with a type error", files: { ...typed, "src/z.ts": 'export const z: number = "";\n' }, args: ["."] },
  { name: "typed disable comments", files: { ...typed, "src/a.ts": 'import { later } from "./b";\n// eslint-disable-next-line @typescript-eslint/no-floating-promises\nlater();\n// eslint-disable-next-line @typescript-eslint/no-floating-promises\nexport {};\n' }, args: ["."] },
  {
    name: "typed two projects",
    files: {
      "eslint.config.mjs": typed["eslint.config.mjs"],
      "p/tsconfig.json": typed["tsconfig.json"],
      "p/src/a.ts": "export async function f() { return 1; }\nf();\n",
      "q/tsconfig.json": typed["tsconfig.json"],
      "q/src/b.ts": 'const s = "a" as string;\nexport const t = s as string;\n',
    },
    args: ["."],
  },

  // ───────────── bulk suppressions ─────────────
  { name: "suppress-all", files: project, args: ["--suppress-all", "."], reads: ["eslint-suppressions.json"] },
  { name: "suppress-rule", files: project, args: ["--suppress-rule", "no-debugger", "."], reads: ["eslint-suppressions.json"] },
  {
    name: "suppress-rule twice",
    files: project,
    args: ["--suppress-rule", "no-debugger", "--suppress-rule", "semi", "."],
    reads: ["eslint-suppressions.json"],
  },
  {
    name: "suppressions are applied",
    files: { ...project, "eslint-suppressions.json": JSON.stringify({ "a.js": { "no-debugger": { count: 1 }, semi: { count: 1 } }, "src/c.js": { "no-debugger": { count: 1 } } }) },
    args: ["."],
  },
  {
    name: "suppressions json",
    files: { ...project, "eslint-suppressions.json": JSON.stringify({ "a.js": { "no-debugger": { count: 1 } } }) },
    args: ["-f", "json", "--rule", "eqeqeq: off", "--rule", "no-var: off", "a.js"],
  },
  {
    name: "more errors than suppressed",
    files: { "eslint.config.js": basic, "a.js": "debugger;\ndebugger;\n", "eslint-suppressions.json": JSON.stringify({ "a.js": { "no-debugger": { count: 1 } } }) },
    args: ["."],
  },
  {
    name: "fewer errors than suppressed",
    files: { "eslint.config.js": basic, "a.js": "debugger;\n", "eslint-suppressions.json": JSON.stringify({ "a.js": { "no-debugger": { count: 2 } } }) },
    args: ["."],
  },
  {
    name: "fewer errors than suppressed, passed",
    files: { "eslint.config.js": basic, "a.js": "debugger;\n", "eslint-suppressions.json": JSON.stringify({ "a.js": { "no-debugger": { count: 2 } } }) },
    args: ["--pass-on-unpruned-suppressions", "."],
  },
  {
    name: "a suppressed rule that reports nothing",
    files: { "eslint.config.js": basic, "a.js": "debugger;\n", "eslint-suppressions.json": JSON.stringify({ "a.js": { eqeqeq: { count: 2 } } }) },
    args: ["."],
  },
  {
    name: "warnings are not suppressed",
    files: { "eslint.config.js": basic, "a.js": "var a = 1;\nexport { a };\n", "eslint-suppressions.json": JSON.stringify({ "a.js": { "no-var": { count: 1 } } }) },
    args: ["--pass-on-unpruned-suppressions", "."],
  },
  {
    name: "prune-suppressions",
    files: {
      "eslint.config.js": basic,
      "a.js": "debugger;\n",
      "eslint-suppressions.json": JSON.stringify({ "a.js": { "no-debugger": { count: 3 }, eqeqeq: { count: 1 } }, "gone.js": { semi: { count: 1 } }, "eslint.config.js": { semi: { count: 1 } } }),
    },
    args: ["--prune-suppressions", "."],
    reads: ["eslint-suppressions.json"],
  },
  { name: "suppressions-location", files: project, args: ["--suppress-all", "--suppressions-location", "src/s.json", "a.js"], reads: ["src/s.json"] },
  { name: "suppressions-location that does not exist", files: project, args: ["--suppressions-location", "nothing.json", "a.js"] },
  { name: "suppress-all and suppress-rule", files: project, args: ["--suppress-all", "--suppress-rule", "semi", "a.js"] },
  { name: "suppress-all and prune", files: project, args: ["--suppress-all", "--prune-suppressions", "a.js"] },
  { name: "suppress-rule and prune", files: project, args: ["--suppress-rule", "semi", "--prune-suppressions", "a.js"] },
  { name: "suppress-all and stdin", files: project, args: ["--suppress-all", "--stdin"], stdin: bad },
  { name: "suppressions from a subdirectory", files: { ...project, "src/eslint-suppressions.json": JSON.stringify({ "c.js": { "no-debugger": { count: 1 } } }) }, cwd: "src", args: ["c.js"] },
  { name: "suppressions file is invalid", files: { ...project, "eslint-suppressions.json": "{" }, args: ["a.js"] },

  // ───────────── other commands ─────────────
  { name: "print-config and a file", files: project, args: ["--print-config", "a.js", "b.js"] },
  { name: "print-config and stdin", files: project, args: ["--print-config", "a.js", "--stdin"], stdin: "" },
];
