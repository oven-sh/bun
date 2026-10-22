import type { BuildOutput } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { itBundled, type BundlerTestBundleAPI } from "../expectBundled";

// Tests ported from:
// https://github.com/evanw/esbuild/blob/main/internal/bundler_tests/bundler_css_test.go

// For debug, all files are written to $TEMP/bun-bundle-tests/css

describe("bundler", () => {
  itBundled("css/CSSEntryPoint", {
    files: {
      "/entry.css": /* css */ `
          body {
            background: white;
            color: black }
        `,
    },
    outfile: "/out.js",
    onAfterBundle(api) {
      api.expectFile("/out.js").toEqualIgnoringWhitespace(`
  /* entry.css */
  body {
          color: #000;
          background: #fff;
  }`);
    },
  });

  itBundled("css/CSSEntryPointEmpty", {
    files: {
      "/entry.css": /* css */ `\n`,
    },
    outfile: "/out.js",
    onAfterBundle(api) {
      api.expectFile("/out.js").toEqualIgnoringWhitespace(`
  /* entry.css */`);
    },
  });

  itBundled("css/CSSNesting", {
    target: "bun",
    files: {
      "/entry.css": /* css */ `
  body {
  	h1 {
  		color: white;
  	}
  }`,
    },
    outfile: "/out.js",
    onAfterBundle(api) {
      api.expectFile("/out.js").toEqualIgnoringWhitespace(`
  /* entry.css */
  body {
  	&h1 {
  		color: #fff;
  	}
  }
  `);
    },
  });

  itBundled("css/CSSAtImportMissing", {
    files: {
      "/entry.css": `@import "./missing.css";`,
    },
    bundleErrors: {
      "/entry.css": ['Could not resolve: "./missing.css"'],
    },
  });

  itBundled("css/CSSAtImportSimple", {
    // GENERATED
    files: {
      "/entry.css": /* css */ `
          @import "./internal.css";
        `,
      "/internal.css": /* css */ `
          .before { color: red }
        `,
    },
    outfile: "/out.css",
    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(`
  /* internal.css */
  .before {
    color: red;
  }
  /* entry.css */
  `);
    },
  });

  itBundled("css/CSSAtImportDiamond", {
    // GENERATED
    files: {
      "/a.css": /* css */ `
          @import "./b.css";
          @import "./c.css";
          .last { color: red }
        `,
      "/b.css": /* css */ `
          @import "./d.css";
          .first { color: red }
        `,
      "/c.css": /* css */ `
          @import "./d.css";
          .third { color: red }
        `,
      "/d.css": /* css */ `
          .second { color: red }
        `,
    },
    outfile: "/out.css",
    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(`
  /* b.css */
  .first {
    color: red;
  }
  /* d.css */
  .second {
    color: red;
  }
  /* c.css */
  .third {
    color: red;
  }
  /* a.css */
  .last {
    color: red;
  }
  `);
    },
  });

  itBundled("css/CSSAtImportCycle", {
    files: {
      "/a.css": /* css */ `
          @import "./a.css";
          .hehe { color: red }
        `,
    },
    outfile: "/out.css",
    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(`
  /* a.css */
  .hehe {
    color: red;
  }
  `);
    },
  });

  // An unknown at-rule statement is not a valid rule, so an "@import" after it
  // is still a valid import. The bundler inlines the file (or hoists an
  // external import), so the output must not hold the "@import" rule again.
  // esbuild and lightningcss do not inline this import: they keep the rule.
  const importAfterUnknownAtRule: Record<string, { files: Record<string, string>; out: string }> = {
    Simple: {
      files: {
        "/entry.css": /* css */ `
          @tailwind base;
          @import "./local.css";
          .k { color: red }
        `,
        "/local.css": `.l { color: blue }`,
      },
      out: `.l{color:#00f}@tailwind base;.k{color:red}`,
    },
    BetweenImports: {
      files: {
        "/entry.css": /* css */ `
          @import "./other.css";
          @unknown foo;
          @import "./local.css";
          .k { color: red }
        `,
        "/local.css": `.l { color: blue }`,
        "/other.css": `.m { color: green }`,
      },
      out: `.m{color:green}.l{color:#00f}@unknown foo;.k{color:red}`,
    },
    // In the next two cases the "@layer" statement prints after the inlined
    // file. esbuild prints a "@layer" statement that precedes an "@import" first.
    LayerThenUnknown: {
      files: {
        "/entry.css": /* css */ `
          @layer a, b;
          @unknown x;
          @import "./local.css";
          .k { color: red }
        `,
        "/local.css": `.l { color: blue }`,
      },
      out: `.l{color:#00f}@layer a,b;@unknown x;.k{color:red}`,
    },
    UnknownThenLayer: {
      files: {
        "/entry.css": /* css */ `
          @unknown x;
          @layer a, b;
          @import "./local.css";
          .k { color: red }
        `,
        "/local.css": `.l { color: blue }`,
      },
      out: `.l{color:#00f}@unknown x;@layer a,b;.k{color:red}`,
    },
    // A url() in the prelude of an unknown at-rule has an import record of its own.
    UnknownWithURL: {
      files: {
        "/entry.css": /* css */ `
          @foo url(https://example.com/a.png);
          @import "./local.css";
          @bar url(https://example.com/a.png);
          @import "./other.css";
          .k { color: red }
        `,
        "/local.css": `.l { color: blue }`,
        "/other.css": `.m { color: green }`,
      },
      out: `.l{color:#00f}.m{color:green}@foo url(https://example.com/a.png);@bar url(https://example.com/a.png);.k{color:red}`,
    },
    Conditional: {
      files: {
        "/entry.css": /* css */ `
          @tailwind base;
          @import "./local.css" layer(foo) screen;
          .k { color: red }
        `,
        "/local.css": `.l { color: blue }`,
      },
      out: `@media screen{@layer foo{.l{color:#00f}}}@tailwind base;.k{color:red}`,
    },
    External: {
      files: {
        "/entry.css": /* css */ `
          @tailwind base;
          @import "https://example.com/x.css";
          .k { color: red }
        `,
      },
      out: `@import "https://example.com/x.css";@tailwind base;.k{color:red}`,
    },
    // Create React App documents "@import-normalize;" as the first line of a stylesheet.
    ExternalThenLocal: {
      files: {
        "/entry.css": /* css */ `
          @import-normalize;
          @import url("https://example.com/fonts.css");
          @import "./local.css";
          .k { color: red }
        `,
        "/local.css": `.l { color: blue }`,
      },
      out: `@import "https://example.com/fonts.css";.l{color:#00f}@import-normalize;.k{color:red}`,
    },
    // The importer is wrapped in the conditions of its own import. The wrapper must not hold an "@import".
    ImporterWithConditions: {
      files: {
        "/entry.css": /* css */ `
          @import "./mid.css" layer(foo) screen;
        `,
        "/mid.css": /* css */ `
          @plugin "x";
          @import "./local.css";
          .m { color: green }
        `,
        "/local.css": `.l { color: blue }`,
      },
      out: `@media screen{@layer foo{.l{color:#00f}}}@media screen{@layer foo{@plugin "x";.m{color:green}}}`,
    },
    // Both copies of mid.css come from one shared stylesheet.
    ImporterImportedTwice: {
      files: {
        "/entry.css": /* css */ `
          @import "./mid.css" layer(one);
          @import "./mid.css" layer(two);
        `,
        "/mid.css": /* css */ `
          @plugin "x";
          @import "./local.css";
          .m { color: green }
        `,
        "/local.css": `.l { color: blue }`,
      },
      out: `@layer one{.l{color:#00f}}@layer one{@plugin "x";.m{color:green}}@layer two{.l{color:#00f}}@layer two{@plugin "x";.m{color:green}}`,
    },
    Cycle: {
      files: {
        "/entry.css": /* css */ `
          @tailwind base;
          @import "./entry.css";
          .k { color: red }
        `,
      },
      out: `@tailwind base;.k{color:red}`,
    },
    Diamond: {
      files: {
        "/entry.css": /* css */ `
          @tailwind base;
          @import "./b.css";
          @import "./c.css";
          .last { color: red }
        `,
        "/b.css": /* css */ `
          @plugin "x";
          @import "./d.css";
          .first { color: red }
        `,
        "/c.css": /* css */ `
          @import "./d.css";
          .third { color: red }
        `,
        "/d.css": `.second { color: red }`,
      },
      out: `@plugin "x";.first{color:red}.second{color:red}.third{color:red}@tailwind base;.last{color:red}`,
    },
  };

  // The CSS parser rejects an "@import" that comes after a style rule.
  async function expectToBundleAgain(file: string, allowWarnings = true) {
    const again = await Bun.build({ entrypoints: [file], throw: false });
    const logs = again.logs.filter(log => !allowWarnings || log.level === "error");
    expect(logs.map(log => log.message)).toEqual([]);
    expect(again.success).toBe(true);
  }

  for (const [name, { files, out }] of Object.entries(importAfterUnknownAtRule)) {
    itBundled(`css/CSSAtImportAfterUnknownAtRule${name}`, {
      files,
      outfile: "/out.css",
      minifyWhitespace: true,
      async onAfterBundle(api) {
        api.expectFile("/out.css").toBe(out + "\n");
        await expectToBundleAgain(api.outfile);
      },
    });
  }

  itBundled("css/CSSAtImportAfterUnknownAtRuleCLI", {
    files: importAfterUnknownAtRule.Simple.files,
    outfile: "/out.css",
    backend: "cli",
    async onAfterBundle(api) {
      api.expectFile("/out.css").toBe(`/* local.css */
.l {
  color: #00f;
}

/* entry.css */
@tailwind base;

.k {
  color: red;
}
`);
      await expectToBundleAgain(api.outfile);
    },
  });

  itBundled("css/CSSAtImportAfterUnknownAtRuleFromJS", {
    files: {
      "/entry.js": /* js */ `import "./entry.css";`,
      ...importAfterUnknownAtRule.Simple.files,
    },
    outdir: "/out",
    minifyWhitespace: true,
    onAfterBundle(api) {
      api.expectFile("/out/entry.css").toBe(importAfterUnknownAtRule.Simple.out + "\n");
    },
  });

  itBundled("css/CSSAtImportAfterUnknownAtRuleFromHTML", {
    files: {
      "/index.html": /* html */ `
        <!doctype html>
        <html>
          <head>
            <link rel="stylesheet" href="./entry.css" />
          </head>
          <body></body>
        </html>
      `,
      ...importAfterUnknownAtRule.Simple.files,
    },
    entryPoints: ["/index.html"],
    outdir: "/out",
    minifyWhitespace: true,
    onAfterBundle(api) {
      const chunks = readdirSync(api.outdir).filter(name => name.endsWith(".css"));
      expect(chunks).toHaveLength(1);
      api.expectFile("/out/" + chunks[0]).toBe(importAfterUnknownAtRule.Simple.out + "\n");
    },
  });

  // A CSS module holds "@import" records and "composes" records in one list.
  // "@value" is an unknown at-rule here.
  const importInCSSModule = {
    files: {
      "/m.module.css": /* css */ `
        @value primary: red;
        @import "./shared.css";
        .box { composes: other from "./o.module.css"; color: blue }
      `,
      "/o.module.css": /* css */ `
        @value gap: 4px;
        @import "./deep.css";
        .other { background: green }
      `,
      "/shared.css": `.shared { color: red }`,
      "/deep.css": `.deep { color: red }`,
    },
    o: `/* deep.css */
.deep {
  color: red;
}

/* o.module.css */
@value gap: 4px;

.other_WK10Lw {
  background: green;
}
`,
    m: `/* m.module.css */
@value primary: red;

.box_5WBUVQ {
  color: #00f;
}
`,
    shared: `/* shared.css */
.shared {
  color: red;
}
`,
  };

  itBundled("css/CSSAtImportAfterUnknownAtRuleInCSSModule", {
    files: {
      "/entry.js": /* js */ `
        import styles from "./m.module.css";
        console.log(styles.box);
      `,
      ...importInCSSModule.files,
    },
    outdir: "/out",
    onAfterBundle(api) {
      const { shared, o, m } = importInCSSModule;
      api.expectFile("/out/entry.css").toBe([shared, o, m].join("\n"));
    },
  });

  // Two CSS chunks print the same two stylesheets.
  itBundled("css/CSSAtImportAfterUnknownAtRuleInCSSModuleSplitting", {
    files: {
      "/a.js": /* js */ `
        import styles from "./m.module.css";
        console.log(styles.box);
        import("./lazy.js");
      `,
      "/b.js": /* js */ `
        import styles from "./o.module.css";
        console.log(styles.other);
      `,
      "/lazy.js": /* js */ `
        import styles from "./m.module.css";
        console.log(styles.box);
      `,
      ...importInCSSModule.files,
    },
    entryPoints: ["/a.js", "/b.js"],
    outdir: "/out",
    splitting: true,
    onAfterBundle(api) {
      const { shared, o, m } = importInCSSModule;
      api.expectFile("/out/a.css").toBe([shared, o, m].join("\n"));
      api.expectFile("/out/b.css").toBe(o);
    },
  });

  // An "@import" of a file that is not a stylesheet is not inlined and not
  // printed. esbuild fails this build: `Cannot import "notes.txt" into a CSS file`.
  for (const [name, before] of [
    ["", ""],
    ["AfterUnknownAtRule", "@tailwind base;"],
  ]) {
    itBundled(`css/CSSAtImportOfTextFile${name}`, {
      files: {
        "/entry.css": `${before}\n@import "./notes.txt";\n.k { color: red }`,
        "/notes.txt": `notes`,
      },
      outfile: "/out.css",
      minifyWhitespace: true,
      onAfterBundle(api) {
        api.expectFile("/out.css").toBe(`${before}.k{color:red}\n`);
      },
    });
  }

  // The last "@import" of b.css sets its place, also when b.css imports a file that is not a stylesheet.
  itBundled("css/CSSAtImportOrderAfterImportOfTextFile", {
    files: {
      "/entry.css": /* css */ `
        @import "./b.css";
        @import "./x.css";
        @import "./b.css";
        .e { color: red }
      `,
      "/b.css": /* css */ `
        @import "./notes.txt";
        .b { color: red }
      `,
      "/x.css": `.x { color: red }`,
      "/notes.txt": `notes`,
    },
    outfile: "/out.css",
    minifyWhitespace: true,
    onAfterBundle(api) {
      api.expectFile("/out.css").toBe(".x{color:red}.b{color:red}.e{color:red}\n");
    },
  });

  // Without bundling nothing inlines the file, so the "@import" rule stays.
  test("css @import after an unknown at-rule prints with --no-bundle", async () => {
    using dir = tempDir("css-import-after-unknown-no-bundle", {
      "entry.css": `@tailwind base;\n@import "./local.css";\n.k { color: red }\n`,
      "local.css": `.l { color: blue }\n`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--no-bundle", "--minify", "entry.css"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({
      stdout,
      log: stderr.split("\n").filter(line => /^(warn|error):/.test(line)),
      exitCode,
    }).toEqual({
      stdout: `@tailwind base;@import "./local.css";.k{color:red}`,
      log: ["warn: invalid @ rule encountered: '@tailwind'"],
      exitCode: 0,
    });
  });

  // CSS takes "@namespace" only between the "@import" rules and the first
  // other rule of a style sheet. The parser rejects a rule after that place
  // and warns about a rule in a block, so these cases bundle their output
  // again and expect no log.
  const svg = "http://www.w3.org/2000/svg";
  const xhtml = "http://www.w3.org/1999/xhtml";
  const xlink = "http://www.w3.org/1999/xlink";
  const icons = `@namespace svg url(${svg});\nsvg|a { color: red }`;
  const fontFace = `@font-face { font-family: f; src: url(data:font/woff2;base64,AA==) }`;
  async function expectStylesheet(api: BundlerTestBundleAPI, file: string, css: string) {
    api.expectFile(file).toBe(css);
    await expectToBundleAgain(api.join(file), false);
  }
  const warningsOf = (build: BuildOutput) =>
    build.logs.map(({ level, message, position }) => ({
      level,
      message,
      file: position && basename(position.file),
      line: position?.line,
      column: position?.column,
    }));
  const noWarnings = {
    onAfterApiBundle(build: BuildOutput) {
      expect(warningsOf(build)).toEqual([]);
    },
  };
  const noEffect = (file: string, line: number, column: number, reason: string, url: string) => ({
    level: "warn",
    message: `${reason} in the same output file, so this rule ("${url}") has no effect there`,
    file,
    line,
    column,
  });

  // The chunk prints one entry with the rules after its external "@import" rules.
  const hoisted: Record<string, { files: Record<string, string>; css: string }> = {
    OfImportingFile: {
      files: {
        "/entry.css": `@import "./a.css";\n${icons}`,
        "/a.css": `.a { color: blue }`,
      },
      css: `@namespace svg "${svg}";.a{color:#00f}svg|a{color:red}`,
    },
    // The conditions of an import are a block around the rules of its file.
    OfConditionalImport: {
      files: {
        "/entry.css": `@import "./icons.css" screen;\n.e { color: green }`,
        "/icons.css": icons,
      },
      css: `@namespace svg "${svg}";@media screen{svg|a{color:red}}.e{color:green}`,
    },
    OfConditionalImports: {
      files: {
        "/entry.css": `
          @import "./icons.css" screen;
          @import "./icons.css" layer(x);
          @import "./icons.css" supports(display: grid);
          @import "./only.css" layer(y);
          @import "./only.css" print;
          .e { color: green }`,
        "/icons.css": icons,
        "/only.css": `@namespace svg url(${svg});`,
      },
      css: `@namespace svg "${svg}";@media screen{svg|a{color:red}}@layer x{svg|a{color:red}}@supports (display:grid){svg|a{color:red}}@layer y;.e{color:green}`,
    },
    AfterConditionalImport: {
      files: {
        "/entry.css": `@import "./layers.css" screen;\n@import "./icons.css";`,
        "/layers.css": `@layer a;`,
        "/icons.css": icons,
      },
      css: `@namespace svg "${svg}";@media screen{@layer a;}svg|a{color:red}`,
    },
    // An import with no rule prints "@layer foo;", and a condition around that is a block.
    AfterImportOfNoRulesInLayerAndMedia: {
      files: {
        "/entry.css": `@import "./empty.css" layer(foo) screen;\n@import "./icons.css";\n.e { color: green }`,
        "/empty.css": ``,
        "/icons.css": icons,
      },
      css: `@namespace svg "${svg}";@media screen{@layer foo;}svg|a{color:red}.e{color:green}`,
    },
    AfterImportOfNoRulesInLayerAndSupports: {
      files: {
        "/entry.css": `@import "./empty.css" layer(foo) supports(display: grid);\n@import "./icons.css";\n.e { color: green }`,
        "/empty.css": ``,
        "/icons.css": icons,
      },
      css: `@namespace svg "${svg}";@supports (display:grid){@layer foo;}svg|a{color:red}.e{color:green}`,
    },
    AfterImportOfNoRulesInLayerInMedia: {
      files: {
        "/entry.css": `@import "./mid.css" screen;\n@import "./icons.css";\n.e { color: green }`,
        "/mid.css": `@import "./empty.css" layer(b);`,
        "/empty.css": ``,
        "/icons.css": icons,
      },
      css: `@namespace svg "${svg}";@media screen{@layer b;}svg|a{color:red}.e{color:green}`,
    },
    // A "@layer" statement after an "@import" rule ends the prologue.
    AfterImportOfNoRulesInLayerAfterExternalImport: {
      files: {
        "/entry.css": `@import "https://example.com/e.css";\n@import "./empty.css" layer(foo);\n@import "./icons.css";`,
        "/empty.css": ``,
        "/icons.css": icons,
      },
      css: `@import "https://example.com/e.css";@namespace svg "${svg}";@layer foo;svg|a{color:red}`,
    },
    AfterExternalImport: {
      files: {
        "/entry.css": `@import "./a.css";\n${icons}`,
        "/a.css": `@import "https://example.com/e.css";\n@layer x;`,
      },
      css: `@import "https://example.com/e.css";@namespace svg "${svg}";@layer x;svg|a{color:red}`,
    },
    AfterExternalImports: {
      files: {
        "/entry.css": `@import "https://example.com/a.css";\n@import "./x.css";\n@import "https://example.com/b.css" screen;\n${icons}`,
        "/x.css": `@import "https://example.com/c.css";\n.x { color: green }`,
      },
      css: `@import "https://example.com/a.css";@import "https://example.com/c.css";@import "https://example.com/b.css" screen;@namespace svg "${svg}";.x{color:green}svg|a{color:red}`,
    },
    // An earlier copy of an import leaves a "@layer" statement in the chunk.
    WithLayerOfEarlierImport: {
      files: {
        "/entry.css": `
          @import "./icons.css" layer(x);
          @import "./b.css" layer(y);
          @import "./icons.css" layer(x);
          .e { color: green }`,
        "/icons.css": icons,
        "/b.css": `@namespace xl url(${xlink});\n[xl|href] { color: blue }`,
      },
      css: `@namespace xl "${xlink}";@namespace svg "${svg}";@layer x;@layer y{[xl|href]{color:#00f}}@layer x{svg|a{color:red}}.e{color:green}`,
    },
    AfterLayersOfEarlierImportInMedia: {
      files: {
        "/entry.css": `@import "./base.css" screen;\n@import "./icons.css";\n@import "./base.css" screen;`,
        "/base.css": `@layer base { .a { color: blue } }`,
        "/icons.css": icons,
      },
      css: `@namespace svg "${svg}";@media screen{@layer base;}svg|a{color:red}@media screen{@layer base{.a{color:#00f}}}`,
    },
    AfterLayersOfEarlierImportInLayer: {
      files: {
        "/entry.css": `@import "./base.css" layer(outer);\n@import "./icons.css";\n@import "./base.css" layer(outer);`,
        "/base.css": `@layer base { .a { color: blue } }`,
        "/icons.css": icons,
      },
      css: `@namespace svg "${svg}";@layer outer{@layer base;}svg|a{color:red}@layer outer{@layer base{.a{color:#00f}}}`,
    },
    AfterLayersOfEarlierImportAfterExternalImport: {
      files: {
        "/entry.css": `@import "https://example.com/e.css";\n@import "./base.css";\n@import "./icons.css";\n@import "./base.css";`,
        "/base.css": `@layer base { .a { color: blue } }`,
        "/icons.css": icons,
      },
      css: `@import "https://example.com/e.css";@namespace svg "${svg}";@layer base;svg|a{color:red}@layer base{.a{color:#00f}}`,
    },
    // With a minify flag, "@media all" prints only its rules. The rule after it ends the prologue.
    AfterLayerStatementInMediaAllAndRule: {
      files: {
        "/entry.css": `@import "./layers.css";\n@import "./icons.css";`,
        "/layers.css": `@media all { @layer x; }\n.a { color: blue }`,
        "/icons.css": icons,
      },
      css: `@namespace svg "${svg}";@layer x;.a{color:#00f}svg|a{color:red}`,
    },
    SamePrefixAndURL: {
      files: {
        "/entry.css": `@import "./a.css";\n@import "./b.css";\n@namespace svg url(${svg});\nsvg|c { color: red }`,
        "/a.css": `@namespace svg url(${svg});\n@namespace s "${svg}";\nsvg|a { color: red }\ns|a { color: blue }`,
        "/b.css": `@namespace svg "${svg}";\nsvg|b { color: red }`,
      },
      css: `@namespace svg "${svg}";@namespace s "${svg}";svg|a{color:red}s|a{color:#00f}svg|b{color:red}svg|c{color:red}`,
    },
    // The chunk has the default namespace that each file with selectors declares.
    DefaultOfEachFile: {
      files: {
        "/entry.css": `@import "./fonts.css";\n@import "./a.css";\n@import "./b.css";`,
        "/fonts.css": fontFace,
        "/a.css": `@namespace url(${xhtml});\na { color: blue }`,
        "/b.css": `@namespace "${xhtml}";\n@namespace svg url(${svg});\nb { color: red }\nsvg|b { color: green }`,
      },
      css: `@namespace svg "${svg}";@namespace "${xhtml}";@font-face{font-family:f;src:url(data:font/woff2;base64,AA==)}a{color:#00f}b{color:red}svg|b{color:green}`,
    },
    // The last default namespace of a file is the one in force.
    LastDefaultOfFile: {
      files: {
        "/entry.css": `@import "./fonts.css";\n@import "./a.css";`,
        "/fonts.css": fontFace,
        "/a.css": `@namespace url(urn:x);\n@namespace url(urn:y);\na { color: blue }`,
      },
      css: `@namespace "urn:y";@font-face{font-family:f;src:url(data:font/woff2;base64,AA==)}a{color:#00f}`,
    },
    // A "@font-face" rule in a block has no selector.
    DefaultOfEachFileWithSelectors: {
      files: {
        "/entry.css": `@import "./fonts.css";\n@import "./a.css";`,
        "/fonts.css": `@supports (font-variation-settings: normal) { ${fontFace} }`,
        "/a.css": `@namespace url(${xhtml});\na { color: blue }`,
      },
      css: `@namespace "${xhtml}";@supports (font-variation-settings: normal){@font-face{font-family:f;src:url(data:font/woff2;base64,AA==)}}a{color:#00f}`,
    },
    // It comes before the default namespace of a file without selectors, also when that one is in a valid place.
    DefaultOfEachFileWithSelectorsOverValidRule: {
      files: {
        "/entry.css": `@import "./declarations.css";\n@import "./fonts.css";\n@import "./a.css";`,
        "/declarations.css": `@namespace url(urn:other);`,
        "/fonts.css": fontFace,
        "/a.css": `@namespace url(${xhtml});\na { color: blue }`,
      },
      css: `@namespace "${xhtml}";@font-face{font-family:f;src:url(data:font/woff2;base64,AA==)}a{color:#00f}`,
    },
    // No file with selectors declares a default namespace, so the one in a valid place stays in force.
    DefaultOfDeclarationsFile: {
      files: {
        "/entry.css": `@import "./prefixes.css";\n@import "./default.css";\n@import "./body.css";\n@import "./late.css";`,
        "/prefixes.css": `@namespace svg url(${svg});`,
        "/default.css": `@namespace url(${xhtml});`,
        "/body.css": `p { color: red }\nsvg|svg { color: blue }`,
        "/late.css": `@namespace xl url(${xlink});\n[xl|href] { color: green }`,
      },
      css: `@namespace svg "${svg}";@namespace xl "${xlink}";@namespace "${xhtml}";p{color:red}svg|svg{color:#00f}[xl|href]{color:green}`,
    },
    // This is the scope of the chunk, not of CSS: with the two sheets, a browser drops the rule of use.css.
    PrefixOfAnotherFile: {
      files: {
        "/entry.css": `@import "./use.css";\n@import "./icons.css";`,
        "/use.css": `svg|b { color: blue }`,
        "/icons.css": icons,
      },
      css: `@namespace svg "${svg}";svg|b{color:#00f}svg|a{color:red}`,
    },
  };
  for (const [name, { files, css }] of Object.entries(hoisted)) {
    itBundled(`css/CSSAtNamespace${name}`, {
      files,
      outfile: "/out.css",
      minifyWhitespace: true,
      ...noWarnings,
      async onAfterBundle(api) {
        await expectStylesheet(api, "/out.css", css + "\n");
      },
    });
  }

  itBundled("css/CSSAtNamespaceOfImportingFileNotMinified", {
    files: hoisted.OfImportingFile.files,
    outfile: "/out.css",
    ...noWarnings,
    async onAfterBundle(api) {
      await expectStylesheet(
        api,
        "/out.css",
        `@namespace svg "${svg}";\n\n/* a.css */\n.a {\n  color: #00f;\n}\n\n/* entry.css */\nsvg|a {\n  color: red;\n}\n`,
      );
    },
  });

  itBundled("css/CSSAtNamespaceOfSecondFileOfJSEntry", {
    files: {
      "/entry.js": `import "./base.css";\nimport "./icons.css";`,
      "/base.css": `.base { color: blue }`,
      "/icons.css": `${icons}\n[svg|href] { color: green }`,
    },
    outdir: "/out",
    minifyWhitespace: true,
    ...noWarnings,
    async onAfterBundle(api) {
      await expectStylesheet(
        api,
        "/out/entry.css",
        `@namespace svg "${svg}";.base{color:#00f}svg|a{color:red}[svg|href]{color:green}\n`,
      );
    },
  });

  // Without a minify flag, "@media all" prints as a block.
  itBundled("css/CSSAtNamespaceOfMediaAllImport", {
    files: {
      "/entry.css": `@import "./icons.css" all;\n.e { color: green }`,
      "/icons.css": icons,
    },
    outfile: "/out.css",
    ...noWarnings,
    async onAfterBundle(api) {
      await expectStylesheet(
        api,
        "/out.css",
        `@namespace svg "${svg}";\n\n/* icons.css */\n@media all {\n  svg|a {\n    color: red;\n  }\n}\n\n/* entry.css */\n.e {\n  color: green;\n}\n`,
      );
    },
  });

  // The parser warns about an at-rule that it does not know. One without a
  // block does not end the prologue, and one with a block ends it.
  itBundled("css/CSSAtNamespaceAfterUnknownAtRule", {
    files: {
      "/entry.css": `
        @import "./a.css";
        @unknown a;
        @namespace svg url(${svg});
        @unknown b;
        svg|a { color: red }`,
      "/a.css": `.a { color: blue }`,
    },
    outfile: "/out.css",
    minifyWhitespace: true,
    async onAfterBundle(api) {
      api.expectFile("/out.css").toBe(`@namespace svg "${svg}";.a{color:#00f}@unknown a;@unknown b;svg|a{color:red}\n`);
      await expectToBundleAgain(api.outfile);
    },
  });

  itBundled("css/CSSAtNamespaceAfterUnknownAtRuleWithBlock", {
    files: {
      "/entry.css": `@import "./unknown.css";\n@import "./reset.css";`,
      "/unknown.css": `@unknown x { a: b }`,
      "/reset.css": `@namespace url(${xhtml});\n${icons}\na { color: blue }`,
    },
    outfile: "/out.css",
    minifyWhitespace: true,
    onAfterApiBundle(build) {
      expect(warningsOf(build).map(({ message }) => message)).toEqual([`invalid @ rule encountered: '@unknown'`]);
    },
    async onAfterBundle(api) {
      api
        .expectFile("/out.css")
        .toBe(`@namespace svg "${svg}";@namespace "${xhtml}";@unknown x{a: b}svg|a{color:red}a{color:#00f}\n`);
      await expectToBundleAgain(api.outfile);
    },
  });

  // The parser decides what a valid place is. Browsers skip a rule that they
  // do not take, so for them the rule of reset.css is in a valid place here.
  itBundled("css/CSSAtNamespaceDefaultAfterMozDocument", {
    files: {
      "/entry.css": `@import "./moz.css";\n@import "./reset.css";`,
      "/moz.css": `@-moz-document url-prefix() { a { color: red } }`,
      "/reset.css": `@namespace url(${xhtml});\na { color: blue }`,
    },
    outfile: "/out.css",
    minifyWhitespace: true,
    onAfterApiBundle(build) {
      expect(warningsOf(build)).toEqual([
        noEffect("reset.css", 1, 1, `"moz.css" declares no default "@namespace"`, xhtml),
      ]);
    },
    async onAfterBundle(api) {
      await expectStylesheet(api, "/out.css", `@-moz-document url-prefix(){a{color:red}}a{color:#00f}\n`);
    },
  });

  // A chunk is one style sheet: it has one rule for a prefix, and a prefix
  // means that namespace in each file of the chunk. The first rule in the
  // chunk stays, and the build warns about the other.
  const prefixOfTwoURLs = {
    "/entry.css": `@import "./x.css";\n@import "./a.css";\n@import "./b.css";\n@import "./c.css";`,
    "/x.css": `.x { color: green }`,
    "/a.css": `@namespace p url(urn:a);\np|a { color: red }`,
    // The last rule of a file for a prefix is the one in force.
    "/b.css": `@namespace p url(urn:unused);\n  @namespace p url(urn:b);\n@namespace q url(urn:q);\np|b, q|b { color: blue }`,
    "/c.css": `p|c { color: green }`,
  };
  const prefixOfTwoURLsReason = `"a.css" declares the "@namespace" prefix "p" as "urn:a"`;
  itBundled("css/CSSAtNamespacePrefixOfTwoURLs", {
    files: prefixOfTwoURLs,
    outfile: "/out.css",
    minifyWhitespace: true,
    onAfterApiBundle(build) {
      expect(warningsOf(build)).toEqual([noEffect("b.css", 2, 3, prefixOfTwoURLsReason, "urn:b")]);
    },
    async onAfterBundle(api) {
      await expectStylesheet(
        api,
        "/out.css",
        `@namespace p "urn:a";@namespace q "urn:q";.x{color:green}p|a{color:red}p|b,q|b{color:#00f}p|c{color:green}\n`,
      );
    },
  });

  itBundled("css/CSSAtNamespacePrefixOfTwoURLsCLI", {
    files: prefixOfTwoURLs,
    outfile: "/out.css",
    bundleWarnings: {
      "/b.css": [`${prefixOfTwoURLsReason} in the same output file, so this rule ("urn:b") has no effect there`],
    },
  });

  // A rule in a valid place stays in force: browsers use the last one for a prefix.
  itBundled("css/CSSAtNamespacePrefixOfTwoURLsInValidPlace", {
    files: {
      "/entry.css": `@import "./declarations.css";\n@import "./body.css";\n@import "./late.css";`,
      "/declarations.css": `@namespace p url(urn:a);`,
      "/body.css": `@namespace p url(urn:b);\np|a { color: red }`,
      "/late.css": `@namespace q url(urn:q);\n@namespace p url(urn:c);\nq|b { color: blue }`,
    },
    outfile: "/out.css",
    minifyWhitespace: true,
    onAfterApiBundle(build) {
      const reason = `"body.css" declares the "@namespace" prefix "p" as "urn:b"`;
      expect(warningsOf(build)).toEqual([
        noEffect("declarations.css", 1, 1, reason, "urn:a"),
        noEffect("late.css", 2, 1, reason, "urn:c"),
      ]);
    },
    async onAfterBundle(api) {
      await expectStylesheet(
        api,
        "/out.css",
        `@namespace p "urn:b";@namespace q "urn:q";p|a{color:red}q|b{color:#00f}\n`,
      );
    },
  });

  itBundled("css/CSSAtNamespaceTwoPrefixesOfTwoURLs", {
    files: {
      "/entry.css": `@import "./q.css";\n@import "./a.css";\n@import "./b.css";\n@import "./c.css";`,
      "/q.css": `@namespace q url(urn:q);\nq|x { color: green }`,
      "/a.css": `@namespace p url(urn:a);\np|a { color: red }`,
      "/b.css": `@namespace p url(urn:b);\np|b { color: blue }`,
      "/c.css": `@namespace p url(urn:a);\n@namespace q url(urn:c);\np|c { color: lime }`,
    },
    outfile: "/out.css",
    minifyWhitespace: true,
    onAfterApiBundle(build) {
      expect(warningsOf(build)).toEqual([
        noEffect("b.css", 1, 1, prefixOfTwoURLsReason, "urn:b"),
        noEffect("c.css", 2, 1, `"q.css" declares the "@namespace" prefix "q" as "urn:q"`, "urn:c"),
      ]);
    },
    async onAfterBundle(api) {
      await expectStylesheet(
        api,
        "/out.css",
        `@namespace q "urn:q";@namespace p "urn:a";q|x{color:green}p|a{color:red}p|b{color:#00f}p|c{color:#0f0}\n`,
      );
    },
  });

  // The rule of b.css has an effect in two.css. The warning is about one.css.
  itBundled("css/CSSAtNamespaceSplitting", {
    files: {
      "/one.js": `import "./a.css";\nimport "./b.css";`,
      "/two.js": `import "./b.css";`,
      "/a.css": `@namespace p url(urn:a);\np|a { color: red }`,
      "/b.css": `@namespace p url(urn:b);\np|b { color: blue }`,
    },
    entryPoints: ["/one.js", "/two.js"],
    outdir: "/out",
    splitting: true,
    minifyWhitespace: true,
    onAfterApiBundle(build) {
      expect(warningsOf(build)).toEqual([noEffect("b.css", 1, 1, prefixOfTwoURLsReason, "urn:b")]);
    },
    async onAfterBundle(api) {
      await expectStylesheet(api, "/out/one.css", `@namespace p "urn:a";p|a{color:red}p|b{color:#00f}\n`);
      await expectStylesheet(api, "/out/two.css", `@namespace p "urn:b";p|b{color:#00f}\n`);
    },
  });

  // The build warns once for a rule and a reason, and once more for another reason.
  itBundled("css/CSSAtNamespaceOneWarningForEachReason", {
    files: {
      "/one.js": `import "./a.css";\nimport "./b.css";`,
      "/two.js": `import "./a.css";\nimport "./b.css";\nimport "./x.css";`,
      "/three.js": `import "./c.css";\nimport "./b.css";`,
      "/a.css": `@namespace p url(urn:a);\np|a { color: red }`,
      "/b.css": `@namespace p url(urn:b);\np|b { color: blue }`,
      "/c.css": `@namespace p url(urn:c);\np|c { color: green }`,
      "/x.css": `.x { color: green }`,
    },
    entryPoints: ["/one.js", "/two.js", "/three.js"],
    outdir: "/out",
    splitting: true,
    minifyWhitespace: true,
    onAfterApiBundle(build) {
      expect(warningsOf(build)).toEqual([
        noEffect("b.css", 1, 1, prefixOfTwoURLsReason, "urn:b"),
        noEffect("b.css", 1, 1, `"c.css" declares the "@namespace" prefix "p" as "urn:c"`, "urn:b"),
      ]);
    },
    async onAfterBundle(api) {
      await expectStylesheet(api, "/out/one.css", `@namespace p "urn:a";p|a{color:red}p|b{color:#00f}\n`);
      await expectStylesheet(
        api,
        "/out/two.css",
        `@namespace p "urn:a";p|a{color:red}p|b{color:#00f}.x{color:green}\n`,
      );
      await expectStylesheet(api, "/out/three.css", `@namespace p "urn:c";p|c{color:green}p|b{color:#00f}\n`);
    },
  });

  itBundled("css/CSSAtNamespaceOneWarningForEachFile", {
    files: {
      "/entry.css": `@import "./x.css";\n@import "./a.css";\n@import "./b.css";\n@import "./c.css";`,
      "/x.css": `.x { color: green }`,
      "/a.css": `@namespace p url(urn:a);\np|a { color: red }`,
      "/b.css": `@namespace p url(urn:b);\np|b { color: blue }`,
      "/c.css": `@namespace p url(urn:b);\np|c { color: blue }`,
    },
    outfile: "/out.css",
    minifyWhitespace: true,
    onAfterApiBundle(build) {
      expect(warningsOf(build)).toEqual([
        noEffect("b.css", 1, 1, prefixOfTwoURLsReason, "urn:b"),
        noEffect("c.css", 1, 1, prefixOfTwoURLsReason, "urn:b"),
      ]);
    },
  });

  // A default namespace that another file with selectors does not have cannot
  // govern only its own file. The chunk does not print it.
  itBundled("css/CSSAtNamespaceDefaultOfImportingFile", {
    files: {
      "/entry.css": `@import "./a.css";\n@namespace url(${xhtml});\na { color: red }`,
      "/a.css": `a { color: blue }`,
    },
    outfile: "/out.css",
    onAfterApiBundle(build) {
      expect(warningsOf(build)).toEqual([
        noEffect("entry.css", 2, 1, `"a.css" declares no default "@namespace"`, xhtml),
      ]);
    },
    async onAfterBundle(api) {
      await expectStylesheet(
        api,
        "/out.css",
        `/* a.css */\na {\n  color: #00f;\n}\n\n/* entry.css */\na {\n  color: red;\n}\n`,
      );
    },
  });

  itBundled("css/CSSAtNamespaceDefaultOfThreeFiles", {
    files: {
      "/entry.css": `@import "./fonts.css";\n@import "./a.css";\n@import "./b.css";\n@import "./c.css";`,
      "/fonts.css": fontFace,
      "/a.css": `@namespace url(urn:a);\na { color: red }`,
      "/b.css": `@namespace url(urn:b);\nb { color: blue }`,
      "/c.css": `@namespace url(urn:c);\nc { color: green }`,
    },
    outfile: "/out.css",
    minifyWhitespace: true,
    onAfterApiBundle(build) {
      const a = `"a.css" declares the default "@namespace" as "urn:a"`;
      expect(warningsOf(build)).toEqual([
        noEffect("a.css", 1, 1, `"b.css" declares the default "@namespace" as "urn:b"`, "urn:a"),
        noEffect("b.css", 1, 1, a, "urn:b"),
        noEffect("c.css", 1, 1, a, "urn:c"),
      ]);
    },
    async onAfterBundle(api) {
      await expectStylesheet(
        api,
        "/out.css",
        `@font-face{font-family:f;src:url(data:font/woff2;base64,AA==)}a{color:red}b{color:#00f}c{color:green}\n`,
      );
    },
  });

  // A rule in a block holds selectors when a rule in it does.
  const printedFontFace = `@font-face{font-family:f;src:url(data:font/woff2;base64,AA==)}`;
  for (const [name, rule, printed, hasSelectors] of [
    ["Media", `@media screen { a { color: red } }`, `@media screen{a{color:red}}`, true],
    ["Layer", `@layer x { a { color: red } }`, `@layer x{a{color:red}}`, true],
    ["Scope", `@scope (.s) { ${fontFace} }`, `@scope(.s){${printedFontFace}}`, true],
    ["MediaOfFontFace", `@media screen { ${fontFace} }`, `@media screen{${printedFontFace}}`, false],
    ["LayerOfFontFace", `@layer x { ${fontFace} }`, `@layer x{${printedFontFace}}`, false],
    ["ScopeOfFontFace", `@scope { ${fontFace} }`, `@scope{${printedFontFace}}`, false],
  ] as const) {
    itBundled(`css/CSSAtNamespaceDefaultAfter${name}`, {
      files: {
        "/entry.css": `@import "./x.css";\n@import "./reset.css";`,
        "/x.css": rule,
        "/reset.css": `@namespace url(${xhtml});\nb { color: blue }`,
      },
      outfile: "/out.css",
      minifyWhitespace: true,
      onAfterApiBundle(build) {
        const reason = `"x.css" declares no default "@namespace"`;
        expect(warningsOf(build)).toEqual(hasSelectors ? [noEffect("reset.css", 1, 1, reason, xhtml)] : []);
      },
      async onAfterBundle(api) {
        const namespace = hasSelectors ? "" : `@namespace "${xhtml}";`;
        await expectStylesheet(api, "/out.css", `${namespace}${printed}b{color:#00f}\n`);
      },
    });
  }

  // The default namespace in a valid place stays in force, as browsers use it now.
  itBundled("css/CSSAtNamespaceDefaultOfLaterFile", {
    files: {
      "/entry.css": `@import "./reset.css";\n@import "./b.css";`,
      "/reset.css": `@namespace url(${xhtml});\n* { margin: 0 }`,
      "/b.css": `@namespace url(${svg});\n@namespace svg url(${svg});\nb { color: red }`,
    },
    outfile: "/out.css",
    minifyWhitespace: true,
    onAfterApiBundle(build) {
      expect(warningsOf(build)).toEqual([
        noEffect("b.css", 1, 1, `"reset.css" declares the default "@namespace" as "${xhtml}"`, svg),
      ]);
    },
    async onAfterBundle(api) {
      await expectStylesheet(
        api,
        "/out.css",
        `@namespace svg "${svg}";@namespace "${xhtml}";*{margin:0}b{color:red}\n`,
      );
    },
  });

  // A default namespace in a file without selectors has no effect to keep.
  itBundled("css/CSSAtNamespaceDefaultOfFileWithoutSelectors", {
    files: {
      "/entry.css": `@import "./a.css";\n@import "./fonts.css";`,
      "/a.css": `.a { color: red }`,
      "/fonts.css": `@namespace url(${xhtml});\n${fontFace}`,
    },
    outfile: "/out.css",
    ...noWarnings,
    async onAfterBundle(api) {
      await expectStylesheet(
        api,
        "/out.css",
        `/* a.css */\n.a {\n  color: red;\n}\n\n/* fonts.css */\n@font-face {\n  font-family: f;\n  src: url("data:font/woff2;base64,AA==");\n}\n\n/* entry.css */\n\n`,
      );
    },
  });

  // A chunk with each "@namespace" rule in a valid place keeps its bytes, and
  // the build has no warning.
  const inPlace: Record<string, { files: Record<string, string>; css: string }> = {
    SingleFile: {
      files: { "/entry.css": `@namespace url(${xhtml});\n${icons}` },
      css: `@namespace "${xhtml}";@namespace svg "${svg}";svg|a{color:red}`,
    },
    FirstFile: {
      files: {
        "/entry.css": `@import "./icons.css";\n.e { color: green }`,
        "/icons.css": icons,
      },
      css: `@namespace svg "${svg}";svg|a{color:red}.e{color:green}`,
    },
    // The default namespace of the first file also governs the second.
    FirstFileDefault: {
      files: {
        "/entry.css": `@import "./reset.css";\n.icon { color: red }`,
        "/reset.css": `@namespace url(${xhtml});\na { color: blue }`,
      },
      css: `@namespace "${xhtml}";a{color:#00f}.icon{color:red}`,
    },
    DeclarationsFiles: {
      files: {
        "/entry.css": `@import "./prefixes.css";\n@import "./default.css";\n@import "./body.css";`,
        "/prefixes.css": `@namespace svg url(${svg});`,
        "/default.css": `@namespace url(${xhtml});`,
        "/body.css": `p { color: red }\nsvg|svg { color: blue }`,
      },
      css: `@namespace svg "${svg}";@namespace "${xhtml}";p{color:red}svg|svg{color:#00f}`,
    },
    // Browsers use the last rule for the prefix.
    TwoRulesOfPrefix: {
      files: {
        "/entry.css": `@import "./declarations.css";\n@import "./body.css";`,
        "/declarations.css": `@namespace p url(urn:a);`,
        "/body.css": `@namespace p url(urn:b);\np|a { color: red }`,
      },
      css: `@namespace p "urn:a";@namespace p "urn:b";p|a{color:red}`,
    },
    AfterExternalImport: {
      files: {
        "/entry.css": `@import "./icons.css";\n.e { color: green }`,
        "/icons.css": `@import "https://example.com/e.css";\n${icons}`,
      },
      css: `@import "https://example.com/e.css";@namespace svg "${svg}";svg|a{color:red}.e{color:green}`,
    },
    AfterLayerStatements: {
      files: {
        "/entry.css": `@import "./layers.css";\n@import "./icons.css";`,
        "/layers.css": `@layer base, theme;`,
        "/icons.css": `@layer theme;\n@namespace svg url(${svg});\n@layer theme { svg|a { color: red } }`,
      },
      css: `@layer base,theme;@layer theme;@namespace svg "${svg}";@layer theme{svg|a{color:red}}`,
    },
    // An earlier copy of an import prints only the names of its layers.
    AfterLayersOfEarlierImport: {
      files: {
        "/entry.css": `@import "./base.css";\n@import "./icons.css";\n@import "./base.css";`,
        "/base.css": `@layer base { .a { color: blue } }`,
        "/icons.css": icons,
      },
      css: `@layer base;@namespace svg "${svg}";svg|a{color:red}@layer base{.a{color:#00f}}`,
    },
    // The conditions of an import are no block when its file prints no rule.
    AfterConditionalImportOfNoRules: {
      files: {
        "/entry.css": `@import "./fonts.css" screen;\n@import "./reset.css";\n.icon { color: red }`,
        "/fonts.css": `@import "https://example.com/fonts.css";`,
        "/reset.css": `@namespace url(${xhtml});\na { color: blue }`,
      },
      css: `@import "https://example.com/fonts.css" screen;@namespace "${xhtml}";a{color:#00f}.icon{color:red}`,
    },
    AfterLayerOfEarlierImport: {
      files: {
        "/entry.css": `@import "./tokens.css" layer(base);\n@import "./reset.css";\n@import "./components.css";`,
        "/tokens.css": `:root { --c: red }`,
        "/reset.css": `@namespace url(${xhtml});\na { color: blue }`,
        "/components.css": `@import "./tokens.css" layer(base);\n.btn { color: var(--c) }`,
      },
      css: `@layer base;@namespace "${xhtml}";a{color:#00f}@layer base{:root{--c:red}}.btn{color:var(--c)}`,
    },
    AfterLayerOfImportOfNoRules: {
      files: {
        "/entry.css": `@import "./empty.css" layer(foo);\n@import "./icons.css";\n.e { color: green }`,
        "/empty.css": ``,
        "/icons.css": icons,
      },
      css: `@layer foo;@namespace svg "${svg}";svg|a{color:red}.e{color:green}`,
    },
    // With a minify flag, "@media all" prints no block around its rules.
    OfMediaAllImport: {
      files: {
        "/entry.css": `@import "./reset.css" all;\n.icon { color: red }`,
        "/reset.css": `@namespace url(${xhtml});\na { color: blue }`,
      },
      css: `@namespace "${xhtml}";a{color:#00f}.icon{color:red}`,
    },
    AfterLayerStatementInMediaAll: {
      files: {
        "/entry.css": `@import "./layers.css";\n@import "./icons.css";`,
        "/layers.css": `@media all { @layer x; }`,
        "/icons.css": icons,
      },
      css: `@layer x;@namespace svg "${svg}";svg|a{color:red}`,
    },
    OfMediaAllImportOfMediaAllImport: {
      files: {
        "/entry.css": `@import "./mid.css" all;\n.icon { color: red }`,
        "/mid.css": `@import "./reset.css" all;`,
        "/reset.css": `@namespace url(${xhtml});\na { color: blue }`,
      },
      css: `@namespace "${xhtml}";a{color:#00f}.icon{color:red}`,
    },
    AfterLayerStatementInMediaAllInMediaAll: {
      files: {
        "/entry.css": `@import "./layers.css";\n@import "./icons.css";`,
        "/layers.css": `@media all { @media all { @layer x; } }`,
        "/icons.css": icons,
      },
      css: `@layer x;@namespace svg "${svg}";svg|a{color:red}`,
    },
    AfterLayersOfEarlierImportInMediaAll: {
      files: {
        "/entry.css": `@import "./base.css" all;\n@import "./icons.css";\n@import "./base.css" all;`,
        "/base.css": `@layer base { .a { color: blue } }`,
        "/icons.css": icons,
      },
      css: `@layer base;@namespace svg "${svg}";svg|a{color:red}@layer base{.a{color:#00f}}`,
    },
  };
  for (const [name, { files, css }] of Object.entries(inPlace)) {
    itBundled(`css/CSSAtNamespaceInPlace${name}`, {
      files,
      outfile: "/out.css",
      minifyWhitespace: true,
      ...noWarnings,
      async onAfterBundle(api) {
        await expectStylesheet(api, "/out.css", css + "\n");
      },
    });
  }

  itBundled("css/CSSAtNamespaceInPlaceOfMediaAllImportMinifySyntax", {
    files: inPlace.OfMediaAllImport.files,
    outfile: "/out.css",
    minifySyntax: true,
    ...noWarnings,
    async onAfterBundle(api) {
      await expectStylesheet(
        api,
        "/out.css",
        `/* reset.css */\n@namespace "${xhtml}";a{color:#00f}\n/* entry.css */\n.icon{color:red}\n`,
      );
    },
  });

  // "minifySyntax" alone minifies the files of a chunk and no other entry, so
  // the "@layer" name of the earlier copy stays in a "@media all" block.
  itBundled("css/CSSAtNamespaceAfterLayersOfEarlierImportInMediaAllMinifySyntax", {
    files: inPlace.AfterLayersOfEarlierImportInMediaAll.files,
    outfile: "/out.css",
    minifySyntax: true,
    ...noWarnings,
    async onAfterBundle(api) {
      await expectStylesheet(
        api,
        "/out.css",
        `@namespace svg "${svg}";\n@media all {\n  @layer base;\n}\n\n/* icons.css */\nsvg|a{color:red}\n/* base.css */\n@layer base{.a{color:#00f}}\n/* entry.css */\n`,
      );
    },
  });

  // Without a minify flag, the "@media all" rule of the file prints as a block.
  itBundled("css/CSSAtNamespaceAfterLayerStatementInMediaAllNotMinified", {
    files: inPlace.AfterLayerStatementInMediaAll.files,
    outfile: "/out.css",
    ...noWarnings,
    async onAfterBundle(api) {
      await expectStylesheet(
        api,
        "/out.css",
        `@namespace svg "${svg}";\n\n/* layers.css */\n@media all {\n  @layer x;\n}\n\n/* icons.css */\nsvg|a {\n  color: red;\n}\n\n/* entry.css */\n\n`,
      );
    },
  });

  // The parser skips an at-rule statement that it does not know. A style rule
  // with only such a statement prints only the statement.
  for (const [name, rule, printed, atRule] of [
    ["UnknownAtRule", `@tailwind base;`, `@tailwind base;`, `@tailwind`],
    ["StyleRuleOfUnknownAtRule", `.btn { @apply px-4; }`, `@apply px-4;`, `@apply`],
  ] as const) {
    itBundled(`css/CSSAtNamespaceInPlaceAfter${name}`, {
      files: {
        "/entry.css": `@import "./a.css";\n@import "./icons.css";`,
        "/a.css": rule,
        "/icons.css": icons,
      },
      outfile: "/out.css",
      minifyWhitespace: true,
      onAfterApiBundle(build) {
        expect(warningsOf(build).map(({ message }) => message)).toEqual([`invalid @ rule encountered: '${atRule}'`]);
      },
      async onAfterBundle(api) {
        api.expectFile("/out.css").toBe(`${printed}@namespace svg "${svg}";svg|a{color:red}\n`);
        await expectToBundleAgain(api.outfile);
      },
    });
  }

  itBundled("css/CSSAtNamespaceInPlaceDeclarationsFilesNotMinified", {
    files: inPlace.DeclarationsFiles.files,
    outfile: "/out.css",
    ...noWarnings,
    async onAfterBundle(api) {
      await expectStylesheet(
        api,
        "/out.css",
        `/* prefixes.css */\n@namespace svg "${svg}";\n\n/* default.css */\n@namespace "${xhtml}";\n\n/* body.css */\np {\n  color: red;\n}\n\nsvg|svg {\n  color: #00f;\n}\n\n/* entry.css */\n\n`,
      );
    },
  });

  itBundled("css/CSSUrlImport", {
    files: {
      "/a.css": /* css */ `
          .hello {
            background-image: url(./hi.svg)
          }
        `,
      "/hi.svg": /* svg */ `
  <svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
    <circle cx="50" cy="50" r="40" fill="blue" />
  </svg>
        `,
    },
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/a.css").toEqualIgnoringWhitespace(`
  /* a.css */
  .hello {
    background-image: url("data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KICA8Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI0MCIgZmlsbD0iYmx1ZSIgLz4KPC9zdmc+");
  }
  `);
    },
  });

  // TODO: re-enable these tests when we do minify local css identifiers
  // itBundled("css/TestImportLocalCSSFromJSMinifyIdentifiersAvoidGlobalNames", {
  //   files: {
  //     "/entry.js": /* js */ `
  //       import "./global.css";
  //       import "./local.module.css";
  //     `,
  //     "/global.css": /* css */ `
  //     :is(.a, .b, .c, .d, .e, .f, .g, .h, .i, .j, .k, .l, .m, .n, .o, .p, .q, .r, .s, .t, .u, .v, .w, .x, .y, .z),
  //     :is(.A, .B, .C, .D, .E, .F, .G, .H, .I, .J, .K, .L, .M, .N, .O, .P, .Q, .R, .S, .T, .U, .V, .W, .X, .Y, .Z),
  //     ._ { color: red }
  //   `,
  //     "/local.module.css": /* css */ `
  //     .rename-this { color: blue }
  //   `,
  //   },
  //   entryPoints: ["/entry.js"],
  //   outdir: "/out",
  //   minifyIdentifiers: true,
  // });

  // // See: https://github.com/evanw/esbuild/issues/3295
  // itBundled("css/ImportLocalCSSFromJSMinifyIdentifiersMultipleEntryPoints", {
  //   files: {
  //     "/a.js": /* js */ `
  //       import { foo, bar } from "./a.module.css";
  //       console.log(foo, bar);
  //     `,
  //     "/a.module.css": /* css */ `
  //       .foo { color: #001; }
  //       .bar { color: #002; }
  //     `,
  //     "/b.js": /* js */ `
  //       import { foo, bar } from "./b.module.css";
  //       console.log(foo, bar);
  //     `,
  //     "/b.module.css": /* css */ `
  //       .foo { color: #003; }
  //       .bar { color: #004; }
  //     `,
  //   },
  //   entryPoints: ["/a.js", "/b.js"],
  //   outdir: "/out",
  //   minifyIdentifiers: true,
  // });

  // TODO: some classes are commented out bc we don't support :global or :local yet
  itBundled("css/ImportCSSFromJSComposes", {
    files: {
      "/entry.js": /* js */ `
          import styles from "./styles.module.css"
          console.log(styles)
        `,
      "/global.css": /* css */ `
          .GLOBAL1 {
            color: black;
          }
        `,
      "/styles.module.css": /* css */ `
          @import "global.css";
          /* .local0 {
            composes: local1;
            :global {
              composes: GLOBAL1 GLOBAL2;
            }
          } */
          .local0 {
            composes: GLOBAL2 GLOBAL3 from global;
            composes: local1 local2;
            background: green;
          }
          /* .local0 :global {
            composes: GLOBAL4;
          } */
          .local3 {
            border: 1px solid black;
            composes: local4;
          }
          .local4 {
            opacity: 0.5;
          }
          .local1 {
            color: red;
            composes: local3;
          }
          .fromOtherFile {
            composes: local0 from "other1.module.css";
            composes: local0 from "other2.module.css";
          }
        `,
      "/other1.module.css": /* css */ `
          .local0 {
            composes: base1 base2 from "base.module.css";
            color: blue;
          }
        `,
      "/other2.module.css": /* css */ `
          .local0 {
            composes: base1 base3 from "base.module.css";
            background: purple;
          }
        `,
      "/base.module.css": /* css */ `
          .base1 {
            cursor: pointer;
          }
          .base2 {
            display: inline;
          }
          .base3 {
            float: left;
          }
        `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    bundleErrors: {
      "/styles.module.css": [
        'The name "local2" never appears in "styles.module.css" as a CSS modules locally scoped class name. Note that "composes" only works with single class selectors.',
      ],
    },
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toMatchInlineSnapshot(`
          "// styles.module.css
          var styles_module_default = {
            local0: "GLOBAL2 GLOBAL3 local4_-MSaAA local3_-MSaAA local1_-MSaAA local0_-MSaAA",
            local3: "local4_-MSaAA local3_-MSaAA",
            local4: "local4_-MSaAA",
            local1: "local4_-MSaAA local3_-MSaAA local1_-MSaAA",
            fromOtherFile: "base1_1Cz41w base2_1Cz41w local0_qwJuwA base3_1Cz41w local0_AgBO5Q fromOtherFile_-MSaAA"
          };

          // entry.js
          console.log(styles_module_default);
          "
        `);
      api.expectFile("/out/entry.css").toMatchInlineSnapshot(`
          "/* global.css */
          .GLOBAL1 {
            color: #000;
          }

          /* other1.module.css */
          .local0_qwJuwA {
            color: #00f;
          }

          /* base.module.css */
          .base1_1Cz41w {
            cursor: pointer;
          }

          .base2_1Cz41w {
            display: inline;
          }

          .base3_1Cz41w {
            float: left;
          }

          /* other2.module.css */
          .local0_AgBO5Q {
            background: purple;
          }

          /* styles.module.css */
          .local0_-MSaAA {
            background: green;
          }

          .local3_-MSaAA {
            border: 1px solid #000;
          }

          .local4_-MSaAA {
            opacity: .5;
          }

          .local1_-MSaAA {
            color: red;
          }

          .fromOtherFile_-MSaAA {
          }
          "
        `);
    },
  });

  itBundled("css/ImportCSSFromJSComposesFromMissingImport", {
    files: {
      "/entry.js": `
          import styles from "./styles.module.css"
          console.log(styles)
        `,
      "/styles.module.css": `
          .foo {
            composes: x from "file.module.css";
            composes: y from "file.module.css";
            composes: z from "file.module.css";
            composes: x from "file.css";
          }
        `,
      "/file.module.css": `
          .x {
            color: red;
          }
          :global(.y) {
            color: blue;
          }
        `,
      "/file.css": `
          .x {
            color: red;
          }
        `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    bundleErrors: {
      "/styles.module.css": [
        // TODO: renable when we support :local and :global
        // 'Cannot use global name "y" with "composes"',
        // 'Cannot use global name "x" with "composes"',
      ],
      "/file.module.css": ['The name "z" never appears in "file.module.css"'],
      "/file.css": ['The name "x" never appears in "file.css"'],
    },
    bundleWarnings: {
      "/styles.module.css": [
        // TODO: renable when we support :local and :global
        // 'The global name "y" is defined in file.module.css. Use the ":local" selector to change "y" into a local name.',
        // 'The global name "x" is defined in file.css. Use the "local-css" loader for "file.css" to enable local names.',
      ],
    },
  });

  itBundled("css/ImportCSSFromJSComposesFromNotCSS", {
    files: {
      "/entry.js": `
          import styles from "./styles.module.css"
          console.log(styles)
        `,
      "/styles.module.css": `
          .foo {
            composes: bar from "file.txt";
          }
        `,
      "/file.txt": `
          .bar {
            color: red;
          }
        `,
    },
    loader: {
      ".txt": "text",
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    bundleErrors: {
      "/styles.module.css": ['Cannot use the "composes" property with the "file.txt" file (it is not a CSS file)'],
    },
  });

  itBundled("css/ImportCSSFromJSComposesCircular", {
    files: {
      "/entry.js": `
        import styles from "./styles.module.css"
        console.log(styles)
      `,
      "/styles.module.css": `
        .foo {
          composes: bar;
        }
        .bar {
          composes: foo;
        }
        .baz {
          composes: baz;
        }
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",

    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toMatchInlineSnapshot(`
        "// styles.module.css
        var styles_module_default = {
          foo: "bar_-MSaAA foo_-MSaAA",
          bar: "foo_-MSaAA bar_-MSaAA",
          baz: "baz_-MSaAA"
        };

        // entry.js
        console.log(styles_module_default);
        "
      `);
      api.expectFile("/out/entry.css").toMatchInlineSnapshot(`
        "/* styles.module.css */
        .foo_-MSaAA {
        }

        .bar_-MSaAA {
        }

        .baz_-MSaAA {
        }
        "
      `);
    },
  });

  itBundled("css/ImportCSSFromJSComposesFromCircular", {
    files: {
      "/entry.js": `
        import styles from "./styles.module.css"
        console.log(styles)
      `,
      "/styles.module.css": `
        .foo {
          composes: bar from "other.module.css";
        }
        .bar {
          composes: bar from "styles.module.css";
        }
      `,
      "/other.module.css": `
        .bar {
          composes: foo from "styles.module.css";
        }
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",

    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toMatchInlineSnapshot(`
        "// styles.module.css
        var styles_module_default = {
          foo: "bar_NlEjJA foo_-MSaAA",
          bar: "bar_-MSaAA"
        };

        // entry.js
        console.log(styles_module_default);
        "
      `);
      api.expectFile("/out/entry.css").toMatchInlineSnapshot(`
        "/* other.module.css */
        .bar_NlEjJA {
        }

        /* styles.module.css */
        .foo_-MSaAA {
        }

        .bar_-MSaAA {
        }
        "
      `);
    },
  });

  // Define all the invalid cases
  type InvalidComposesTest = { name: string; cssContent: string; expectedError?: string; expectedWarning?: string };
  const invalidComposesTests: InvalidComposesTest[] = [
    {
      name: "IDSelector",
      cssContent: `
        /* Invalid: ID selector */
        .withId {
          composes: #invalid;
          color: red;
        }
      `,
      expectedError: "Invalid declaration",
    },
    {
      name: "ElementSelector",
      cssContent: `
        /* Invalid: Element selector */
        .withElement {
          composes: div;
          color: blue;
        }
      `,
      expectedError:
        'The name "div" never appears in "styles.module.css" as a CSS modules locally scoped class name. Note that "composes" only works with single class selectors.',
    },
    {
      name: "CompoundSelector",
      cssContent: `
        /* Invalid: Compound selector */
        .withCompound {
          composes: .valid.invalid;
          color: green;
        }
      `,
      expectedError: "Invalid declaration",
    },
    {
      name: "ComplexSelector",
      cssContent: `
        /* Invalid: Complex selector */
        .withComplex {
          composes: .parent > .child;
          color: purple;
        }
      `,
      expectedError: "Invalid declaration",
    },
    {
      name: "PseudoClass",
      cssContent: `
        /* Invalid: Pseudo-class */
        .withPseudo {
          composes: .valid:hover;
          color: orange;
        }
      `,
      expectedError: "Invalid declaration",
    },
    {
      name: "AttributeSelector",
      cssContent: `
        /* Invalid: Attribute selector */
        .withAttribute {
          composes: [disabled];
          color: yellow;
        }
      `,
      expectedError: "Invalid declaration",
    },
    {
      name: "ImportedNonClass",
      cssContent: `
        /* Invalid: Imported non-class */
        .withImportedNonClass {
          composes: element from "other.module.css";
          color: magenta;
        }
      `,
      expectedError:
        'The name "element" never appears in "other.module.css" as a CSS modules locally scoped class name. Note that "composes" only works with single class selectors.',
    },
  ];

  // Create a separate test for each invalid case
  for (const testCase of invalidComposesTests) {
    itBundled(`css/ImportCSSFromJSComposes${testCase.name}`, {
      files: {
        "/entry.js": /* js */ `
          import styles from "./styles.module.css"
          console.log(styles)
        `,
        "/styles.module.css": /* css */ testCase.cssContent,
        "/other.module.css": /* css */ `
          /* Non-class selectors in another file */
          div {
            color: brown;
          }
          
          #id {
            color: teal;
          }
          
          .valid {
            color: pink;
          }
          
          element {
            color: gray;
          }
        `,
      },
      entryPoints: ["/entry.js"],
      outdir: "/out",
      bundleErrors: testCase.expectedError
        ? testCase.name === "ImportedNonClass"
          ? { "/other.module.css": [testCase.expectedError] }
          : { "/styles.module.css": [testCase.expectedError] }
        : undefined,
      bundleWarnings: testCase.expectedWarning ? { "/styles.module.css": [testCase.expectedWarning] } : undefined,
      onAfterBundle(api) {
        // Check that the output files were generated correctly
        api.expectFile("/out/entry.js").toMatchSnapshot();
        api.expectFile("/out/entry.css").toMatchSnapshot();
      },
    });
  }

  itBundled("css/ComposesWithSharedPropertiesError", {
    files: {
      "/entry.js": `
      import styles from "./styles.module.css"
      console.log(styles)
    `,
      "/styles.module.css": `
      .button {
        color: blue;
        composes: otherButton from "./other.module.css";
      }
    `,
      "/other.module.css": `
      .otherButton {
        color: red;
        font-size: 16px;
      }
    `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    bundleWarnings: true,
    onAfterBundle(api) {
      // Check that the output files were generated correctly
      api.expectFile("/out/entry.js").toMatchSnapshot();
      api.expectFile("/out/entry.css").toMatchSnapshot();
    },
  });

  itBundled("css/ComposesSameFile", {
    files: {
      "/entry.js": `
      import styles from "./styles.module.css"
      console.log(styles)
    `,
      "/styles.module.css": `
      .button {
        color: blue;
        composes: otherButton from "./styles.module.css";
      }

      .otherButton {
        color: red;
        font-size: 16px;
      }
    `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    bundleWarnings: true,
    onAfterBundle(api) {
      // Check that the output files were generated correctly
      api.expectFile("/out/entry.js").toMatchInlineSnapshot(`
        "// styles.module.css
        var styles_module_default = {
          button: "otherButton_-MSaAA button_-MSaAA",
          otherButton: "otherButton_-MSaAA"
        };

        // entry.js
        console.log(styles_module_default);
        "
      `);
      api.expectFile("/out/entry.css").toMatchInlineSnapshot(`
        "/* styles.module.css */
        .button_-MSaAA {
          color: #00f;
        }

        .otherButton_-MSaAA {
          color: red;
          font-size: 16px;
        }
        "
      `);
    },
  });

  itBundled("css/ComposesSameFileSameClass", {
    files: {
      "/entry.js": `
      import styles from "./styles.module.css"
      console.log(styles)
    `,
      "/styles.module.css": `
      .button {
        color: blue;
        composes: button from "./styles.module.css";
      }
    `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    bundleWarnings: true,
    onAfterBundle(api) {
      // Check that the output files were generated correctly
      api.expectFile("/out/entry.js").toMatchInlineSnapshot(`
        "// styles.module.css
        var styles_module_default = {
          button: "button_-MSaAA"
        };

        // entry.js
        console.log(styles_module_default);
        "
      `);
      api.expectFile("/out/entry.css").toMatchInlineSnapshot(`
        "/* styles.module.css */
        .button_-MSaAA {
          color: #00f;
        }
        "
      `);
    },
  });
});

describe("esbuild-bundler", () => {
  itBundled("css/CSSEntryPoint", {
    // GENERATED
    files: {
      "/entry.css": /* css */ `
        body {
          background: white;
          color: black }
      `,
    },
  });
  itBundled("css/CSSAtImportMissing", {
    files: {
      "/entry.css": `@import "./missing.css";`,
    },
    bundleErrors: {
      "/entry.css": ['Could not resolve: "./missing.css"'],
    },
  });
  itBundled("css/CSSAtImportExternal", {
    external: ["./external1.css", "./external2.css", "./external3.css", "./external4.css", "./external5.css"],
    // GENERATED
    files: {
      "/entry.css": /* css */ `
        @import "./internal.css";
        @import "./external1.css";
        @import "./external2.css";
        @import "./charset1.css";
        @import "./charset2.css";
        @import "./external5.css" screen;
      `,
      "/internal.css": /* css */ `
        @import "./external5.css" print;
        .before { color: red }
      `,
      "/charset1.css": /* css */ `
        @charset "UTF-8";
        @import "./external3.css";
        @import "./external4.css";
        @import "./external5.css";
        @import "https://www.example.com/style1.css";
        @import "https://www.example.com/style2.css";
        @import "https://www.example.com/style3.css" print;
        .middle { color: green }
      `,
      "/charset2.css": /* css */ `
        @charset "UTF-8";
        @import "./external3.css";
        @import "./external5.css" screen;
        @import "https://www.example.com/style1.css";
        @import "https://www.example.com/style3.css";
        .after { color: blue }
      `,
    },
    outfile: "/out/out.css",
    onAfterBundle(api) {
      api.expectFile("/out/out.css").toEqualIgnoringWhitespace(/* css */ `@import "./external1.css";
@import "./external2.css";
@import "./external4.css";
@import "./external5.css";
@import "https://www.example.com/style2.css";
@import "./external3.css";
@import "https://www.example.com/style1.css";
@import "https://www.example.com/style3.css";
@import "./external5.css" screen;

/* internal.css */
.before {
          color: red;
        }

/* charset1.css */
.middle {
          color: green;
        }

/* charset2.css */
.after {
  color: #00f;
}

/* entry.css */`);
    },
  });
  itBundled("css/CSSAtImport", {
    // GENERATED
    files: {
      "/entry.css": /* css */ `
        @import "./a.css";
        @import "./b.css";
        .entry { color: red }
      `,
      "/a.css": /* css */ `
        @import "./shared.css";
        .a { color: green }
      `,
      "/b.css": /* css */ `
        @import "./shared.css";
        .b { color: blue }
      `,
      "/shared.css": `.shared { color: black }`,
    },
  });
  itBundled("css/CSSFromJSMissingImport", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import {missing} from "./a.css"
        console.log(missing)
      `,
      "/a.css": `.a { color: red }`,
    },
    bundleErrors: {
      "/entry.js": ['No matching export in "a.css" for import "missing"'],
    },
  });
  itBundled("css/CSSFromJSMissingStarImport", {
    outdir: "/out",
    files: {
      "/entry.js": /* js */ `
        import * as ns from "./a.css"
        console.log(ns.missing)
      `,
      "/a.css": `.a { color: red }`,
    },
    bundleWarnings: {
      "/entry.js": ['Import "missing" will always be undefined because there is no matching export in "a.css"'],
    },
    onAfterBundle(api) {
      api.expectFile("/out/entry.css").toEqualIgnoringWhitespace(/* css */ `/* a.css */
        .a{
          color: red;
        }`);
    },
  });
  itBundled("css/ImportCSSFromJS", {
    outdir: "/out",
    files: {
      "/entry.js": /* js */ `
        import "./a.js"
        import "./b.js"
      `,
      "/a.js": /* js */ `
        import "./a.css";
        console.log('a')
      `,
      "/a.css": `.a { color: red }`,
      "/b.js": /* js */ `
        import "./b.css";
        console.log('b')
      `,
      "/b.css": `.b { color: blue }`,
    },
  });
  // itBundled("css/ImportCSSFromJSWriteToStdout", {
  //   files: {
  //     "/entry.js": `import "./entry.css"`,
  //     "/entry.css": `.entry { color: red }`,
  //   },
  //   bundleErrors: {
  //     "/entry.js": ['Cannot import "entry.css" into a JavaScript file without an output path configured'],
  //   },
  // });
  itBundled("css/ImportJSFromCSS", {
    outdir: "/out",
    files: {
      "/entry.ts": `export default 123`,
      "/entry.css": `@import "./entry.ts";`,
    },
    entryPoints: ["/entry.css"],
    bundleErrors: {
      "/entry.css": ['Cannot import a ".ts" file into a CSS file'],
    },
  });
  itBundled("css/ImportJSONFromCSS", {
    // GENERATED
    files: {
      "/entry.json": `{}`,
      "/entry.css": `@import "./entry.json";`,
    },
    entryPoints: ["/entry.css"],
    bundleErrors: {
      "/entry.css": ['Cannot import a ".json" file into a CSS file'],
    },
  });
  itBundled("css/MissingImportURLInCSS", {
    // GENERATED
    files: {
      "/src/entry.css": /* css */ `
        a { background: url(./one.png); }
        b { background: url("./two.png"); }
      `,
    },
    bundleErrors: {
      "/src/entry.css": ['Could not resolve: "./one.png"', 'Could not resolve: "./two.png"'],
    },
  });

  // Skipping for now
  itBundled("css/ExternalImportURLInCSS", {
    files: {
      "/src/entry.css": /* css */ `
        div:after {
          content: 'If this is recognized, the path should become "../src/external.png"';
          background: url(./external.png);
        }

        /* These URLs should be external automatically */
        a { background: url(http://example.com/images/image.png) }
        b { background: url(https://example.com/images/image.png) }
        c { background: url(//example.com/images/image.png) }
        d { background: url(data:image/png;base64,iVBORw0KGgo=) }
        path { fill: url(#filter) }
      `,
    },
    external: ["./src/external.png"],
  });

  itBundled("css/InvalidImportURLInCSS", {
    // GENERATED
    files: {
      "/entry.css": /* css */ `
        a {
          background: url(./js.js);
          background: url("./jsx.jsx");
          background: url(./ts.ts);
          background: url('./tsx.tsx');
          background: url(./json.json);
          background: url(./css.css);
        }
      `,
      "/js.js": `export default 123`,
      "/jsx.jsx": `export default 123`,
      "/ts.ts": `export default 123`,
      "/tsx.tsx": `export default 123`,
      "/json.json": `{ "test": true }`,
      "/css.css": `a { color: red }`,
    },
    bundleErrors: {
      "/entry.css": [
        'Cannot import a ".jsx" file into a CSS file',
        'Cannot import a ".jsx" file into a CSS file',
        'Cannot import a ".ts" file into a CSS file',
        'Cannot import a ".tsx" file into a CSS file',
        'Cannot import a ".json" file into a CSS file',
      ],
    },
    /* TODO FIX expectedScanLog: `entry.css: ERROR: Cannot use "js.js" as a URL
  NOTE: You can't use a "url()" token to reference the file "js.js" because it was loaded with the "js" loader, which doesn't provide a URL to embed in the resulting CSS.
  entry.css: ERROR: Cannot use "jsx.jsx" as a URL
  NOTE: You can't use a "url()" token to reference the file "jsx.jsx" because it was loaded with the "jsx" loader, which doesn't provide a URL to embed in the resulting CSS.
  entry.css: ERROR: Cannot use "ts.ts" as a URL
  NOTE: You can't use a "url()" token to reference the file "ts.ts" because it was loaded with the "ts" loader, which doesn't provide a URL to embed in the resulting CSS.
  entry.css: ERROR: Cannot use "tsx.tsx" as a URL
  NOTE: You can't use a "url()" token to reference the file "tsx.tsx" because it was loaded with the "tsx" loader, which doesn't provide a URL to embed in the resulting CSS.
  entry.css: ERROR: Cannot use "json.json" as a URL
  NOTE: You can't use a "url()" token to reference the file "json.json" because it was loaded with the "json" loader, which doesn't provide a URL to embed in the resulting CSS.
  entry.css: ERROR: Cannot use "css.css" as a URL
  NOTE: You can't use a "url()" token to reference a CSS file, and "css.css" is a CSS file (it was loaded with the "css" loader).
  `, */
  });
  itBundled("css/TextImportURLInCSSText", {
    outfile: "/out.css",
    files: {
      "/entry.css": /* css */ `
        a {
          background: url(./example.txt);
        }
      `,
      "/example.txt": `This is some text.`,
    },
    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(/* css */ `
/* entry.css */
a {
  background: url("data:text/plain;base64,VGhpcyBpcyBzb21lIHRleHQu");
}
`);
    },
  });
  itBundled("css/Png", {
    outfile: "/out.css",
    // GENERATED
    files: {
      "/entry.css": /* css */ `
        a {
          background: url(./example.png);
        }
      `,
      "/example.png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    },
    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(/* css */ `
/* entry.css */
a {
  background: url("data:image/png;base64,iVBORw0KGgo=");
}
`);
    },
  });

  // We don't support dataurl rn
  //   itBundled("css/DataURLImportURLInCSS", {
  //     outfile: "/out.css",
  //     // GENERATED
  //     files: {
  //       "/entry.css": /* css */ `
  //         a {
  //           background: url(./example.png);
  //         }
  //       `,
  //       "/example.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  //     },
  //     loader: {
  //       ".png": "dataurl",
  //     },
  //     onAfterBundle(api) {
  //       api.expectFile("/out.css").toEqualIgnoringWhitespace(/* css */ `
  // /* entry.css */
  // a {
  //   background: url("data:image/png;base64,iVBORw0KGgo=");
  // }
  // `);
  //     },
  //   });

  // We don't support binary loader rn
  //   itBundled("css/BinaryImportURLInCSS", {

  //     // GENERATED
  //     files: {
  //       "/entry.css": /* css */ `
  //         a {
  //           background: url(./example.png);
  //         }
  //       `,
  //       "/example.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  //     },
  //     onAfterBundle(api) {
  //       api.expectFile("/out.css").toEqualIgnoringWhitespace(/* css */ `
  // /* entry.css */
  // a {
  //   background: url("data:image/png;base64,iVBORw0KGgo=");
  // }
  // `);
  //     },
  //   });

  // We don't support base64 loader rn
  // itBundled("css/Base64ImportURLInCSS", {

  //   // GENERATED
  //   files: {
  //     "/entry.css": /* css */ `
  //       a {
  //         background: url(./example.png);
  //       }
  //     `,
  //     "/example.png": `\x89\x50\x4E\x47\x0D\x0A\x1A\x0A`,
  //   },
  // });

  itBundled("css/FileImportURLInCSS", {
    files: {
      "/entry.css": /* css */ `
        @import "./one.css";
        @import "./two.css";
      `,
      "/one.css": `a { background: url(./example.data) }`,
      "/two.css": `b { background: url(./example.data) }`,
      "/example.data": new Array(128 * 1024 + 1).fill("Z".charCodeAt(0)).join(""),
    },
    loader: {
      ".data": "file",
    },
    outdir: "/out",
    async onAfterBundle(api) {
      api.expectFile("/out/example-ra0pdz4b.data").toEqual(new Array(128 * 1024 + 1).fill("Z".charCodeAt(0)).join(""));

      api.expectFile("/out/entry.css").toEqualIgnoringWhitespace(/* css */ `
/* one.css */
a {
  background: url("./example-ra0pdz4b.data");
}

/* two.css */
b {
  background: url("./example-ra0pdz4b.data");
}

/* entry.css */
`);
    },
  });

  // A url()'s `?query` / `#fragment` suffix must survive path rewriting so that
  // SVG fragment references like `url(sprites.svg#icon)` keep addressing the
  // element inside the asset. esbuild also preserves these.
  itBundled("css/URLQueryFragmentPreservedFileLoader", {
    files: {
      "/entry.css": /* css */ `
        .a { mask: url(./sprites.svg#icon) }
        .b { clip-path: url("./sprites.svg?v=3#c") }
        .c { background: url(./sprites.svg) }
        .d { --bg: url("./sprites.svg#custom") }
      `,
      "/sprites.svg": Buffer.alloc(128 * 1024 + 1, "Z").toString(),
    },
    loader: {
      ".svg": "file",
    },
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.css").toEqualIgnoringWhitespace(/* css */ `
/* entry.css */
.a {
  mask: url("./sprites-mrrzcz3w.svg#icon");
}
.b {
  clip-path: url("./sprites-mrrzcz3w.svg?v=3#c");
}
.c {
  background: url("./sprites-mrrzcz3w.svg");
}
.d {
  --bg: url("./sprites-mrrzcz3w.svg#custom");
}
`);
    },
  });
  itBundled("css/URLQueryFragmentPreservedDataURL", {
    files: {
      "/entry.css": /* css */ `
        .a { mask: url(./small.svg#m1) }
        .b { background: url("./small.svg?v=2") }
        .c { mask: url(./small.svg?v=2#m1) }
        .d { background: url(./small.svg) }
      `,
      "/small.svg": `<svg xmlns="http://www.w3.org/2000/svg"><mask id="m1"/></svg>`,
    },
    outdir: "/out",
    onAfterBundle(api) {
      // A `?query` appended to a base64 data: URL lands in the body and fails
      // decoding, so only the `#fragment` is kept on the inline path.
      api.expectFile("/out/entry.css").toEqualIgnoringWhitespace(/* css */ `
/* entry.css */
.a {
  mask: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxtYXNrIGlkPSJtMSIvPjwvc3ZnPg==#m1");
}
.b {
  background: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxtYXNrIGlkPSJtMSIvPjwvc3ZnPg==");
}
.c {
  mask: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxtYXNrIGlkPSJtMSIvPjwvc3ZnPg==#m1");
}
.d {
  background: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxtYXNrIGlkPSJtMSIvPjwvc3ZnPg==");
}
`);
    },
  });
  itBundled("css/URLQueryFragmentPreservedMinified", {
    files: {
      "/entry.css": /* css */ `
        .a { mask: url(./sprites.svg#icon) }
      `,
      "/sprites.svg": Buffer.alloc(128 * 1024 + 1, "Z").toString(),
    },
    loader: {
      ".svg": "file",
    },
    minifyWhitespace: true,
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.css").toEqualIgnoringWhitespace(/* css */ `.a{mask:url(./sprites-mrrzcz3w.svg#icon)}`);
    },
  });

  itBundled("css/IgnoreURLsInAtRulePrelude", {
    // GENERATED
    files: {
      "/entry.css": /* css */ `
        /* This should not generate a path resolution error */
        @supports (background: url(ignored.png)) {
          a { color: red }
        }
      `,
    },
  });

  itBundled("css/URLInEnvFallbackOfAtImportMediaQuery", {
    files: {
      "/entry.css": /* css */ `
        @import "./b.css" (min-width: env(foo, url(sub/g.css)));
        .c0 { color: blue }
      `,
      "/b.css": `.b1 { color: green }`,
      "/sub/g.css": `.c0 { color: red }`,
    },
    backend: "cli",
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.css").toBe(`/* b.css */
@media (min-width: env(foo, url(sub/g.css))) {
  .b1 {
    color: green;
  }
}

/* entry.css */
.c0 {
  color: #00f;
}
`);
    },
  });

  itBundled("css/PackageURLsInCSS", {
    files: {
      "/entry.css": /* css */ `
        @import "./test.css";

        a { background: url(a/1.png); }
        b { background: url(b/2.png); }
        c { background: url(c/3.png); }
      `,
      "/test.css": `.css { color: red }`,
      "/a/1.png": `a-1`,
      "/node_modules/b/2.png": `b-2-node_modules`,
      "/c/3.png": `c-3`,
      "/node_modules/c/3.png": `c-3-node_modules`,
    },
    outfile: "/out.css",
    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(/* css */ `
/* test.css */
.css {
  color: red;
}

/* entry.css */
a {
  background: url("data:image/png;base64,YS0x");
}
b {
  background: url("data:image/png;base64,Yi0yLW5vZGVfbW9kdWxlcw==");
}
c {
  background: url("data:image/png;base64,Yy0z");
}
`);
    },
  });

  itBundled("css/CSSAtImportExtensionOrderCollision", {
    files: {
      // This should avoid picking ".js" because it's explicitly configured as non-CSS
      "/entry.css": `@import "./test";`,
      "/test.js": `console.log('js')`,
      "/test.css": `.css { color: red }`,
    },
    outfile: "/out.css",
    // extensionOrder: [".js", ".css"],
    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(/* css */ `
/* test.css */
.css {
  color: red;
}

/* entry.css */
`);
    },
  });

  /* We don't support `extensionOrder`/`--resolve-extensions` rn
  itBundled("css/CSSAtImportExtensionOrderCollisionUnsupported", {

    // GENERATED
    files: {
      "/entry.css": `@import "./test";`,
      "/test.js": `console.log('js')`,
      "/test.sass": `// some code`,
    },
    outfile: "/out.css",
    extensionOrder: [".js", ".sass"],
    bundleErrors: {
      "/entry.css": ['ERROR: No loader is configured for ".sass" files: test.sass'],
    },
  });
  */

  // itBundled("css/CSSAtImportConditionsNoBundle", {
  //   files: {
  //     "/entry.css": `@import "./print.css" print;`,
  //   },
  // });

  itBundled("css/CSSAtImportConditionsBundleExternal", {
    files: {
      "/entry.css": /* css */ `@import "https://example.com/print.css" print;`,
    },
    outfile: "/out.css",
    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(/* css */ `
@import "https://example.com/print.css" print;

/* entry.css */
`);
    },
  });

  itBundled("css/CSSAtImportConditionsBundleExternalConditionWithURL", {
    files: {
      "/entry.css": /* css */ `@import "https://example.com/foo.css" supports(background: url("foo.png"));`,
    },
  });

  itBundled("css/CSSAtImportConditionsBundleLOL", {
    outfile: "/out.css",
    files: {
      "/entry.css": /* css */ `
@import url(http://example.com/foo.css);
@import url(http://example.com/foo.css) layer;
@import url(http://example.com/foo.css) layer(layer-name);
@import url(http://example.com/foo.css) layer(layer-name) supports(display: flex);
@import url(http://example.com/foo.css) layer(layer-name) supports(display: flex) (min-width: 768px) and
  (max-width: 1024px);
@import url(http://example.com/foo.css) layer(layer-name) (min-width: 768px) and (max-width: 1024px);
@import url(http://example.com/foo.css) supports(display: flex);
@import url(http://example.com/foo.css) supports(display: flex) (min-width: 768px) and (max-width: 1024px);
@import url(http://example.com/foo.css) (min-width: 768px) and (max-width: 1024px);

@import url(./foo.css);
@import url(./foo.css) layer;
@import url(./foo.css) layer(layer-name);
@import url(./foo.css) layer(layer-name) supports(display: flex);
@import url(./foo.css) layer(layer-name) supports(display: flex) (min-width: 768px) and (max-width: 1024px);
@import url(./foo.css) layer(layer-name) (min-width: 768px) and (max-width: 1024px);
@import url(./foo.css) supports(display: flex);
@import url(./foo.css) supports(display: flex) (min-width: 768px) and (max-width: 1024px);
@import url(./foo.css) (min-width: 768px) and (max-width: 1024px);

@import url(./empty-1.css) layer(empty-1);
@import url(./empty-2.css) supports(empty: 2);
@import url(./empty-3.css) (empty: 3);

@import "./nested-layer.css" layer(outer);
@import "./nested-layer.css" supports(outer: true);
@import "./nested-layer.css" (outer: true);
@import "./nested-supports.css" layer(outer);
@import "./nested-supports.css" supports(outer: true);
@import "./nested-supports.css" (outer: true);
@import "./nested-media.css" layer(outer);
@import "./nested-media.css" supports(outer: true);
@import "./nested-media.css" (outer: true);
			`,

      "/foo.css": /* css */ `body { color: red }`,

      "/empty-1.css": ``,
      "/empty-2.css": ``,
      "/empty-3.css": ``,

      "/nested-layer.css": /* css */ `@import "./foo.css" layer(inner);`,
      "/nested-supports.css": /* css */ `@import "./foo.css" supports(inner: true);`,
      "/nested-media.css": /* css */ `@import "./foo.css" (inner: true);`,
    },
    onAfterBundle(api) {
      // api.expectFile("/out.css").toMatchSnapshot();
      api.expectFile("/out.css").toEqualIgnoringWhitespace(/* css */ `@import "http://example.com/foo.css";
        @import "http://example.com/foo.css" layer;
        @import "http://example.com/foo.css" layer(layer-name);
        @import "http://example.com/foo.css" layer(layer-name) supports(display: flex);
        @import "http://example.com/foo.css" layer(layer-name) (min-width: 768px) and (max-width: 1024px);
        @import "http://example.com/foo.css" supports(display: flex);
        @import "http://example.com/foo.css" (min-width: 768px) and (max-width: 1024px);

        /* foo.css */
        body {
          color: red;
        }

        /* foo.css */
        @layer {
          body {
            color: red;
          }
        }

        /* foo.css */
        @layer layer-name {
          body {
            color: red;
          }
        }

        /* foo.css */
        @supports (display: flex) {
          @layer layer-name {
            body {
              color: red;
            }
          }
        }

        /* foo.css */
        @media (min-width: 768px) and (max-width: 1024px) {
          @layer layer-name {
            body {
          color: red;
            }
          }
        }

        /* foo.css */
        @supports (display: flex) {
          body {
            color: red;
          }
        }

        /* foo.css */
        @media (min-width: 768px) and (max-width: 1024px) {
          body {
            color: red;
          }
        }

        /* empty-1.css */
        @layer empty-1;

        /* empty-2.css */

        /* empty-3.css */

        /* foo.css */
        @layer outer {
          @layer inner {
            body {
              color: red;
            }
          }
        }

        /* nested-layer.css */
        @layer outer;

        /* foo.css */
        @supports (outer: true) {
          @layer inner {
            body {
              color: red;
            }
          }
        }

        /* nested-layer.css */

        /* foo.css */
        @media (outer: true) {
          @layer inner {
            body {
              color: red;
            }
          }
        }

        /* nested-layer.css */

        /* foo.css */
        @layer outer {
          @supports (inner: true) {
            body {
              color: red;
            }
          }
        }

        /* nested-supports.css */
        @layer outer;

        /* foo.css */
        @supports (outer: true) {
          @supports (inner: true) {
            body {
              color: red;
            }
          }
        }

        /* nested-supports.css */

        /* foo.css */
        @media (outer: true) {
          @supports (inner: true) {
            body {
              color: red;
            }
          }
        }

        /* nested-supports.css */

        /* foo.css */
        @layer outer {
          @media (inner: true) {
            body {
              color: red;
            }
          }
        }

        /* nested-media.css */
        @layer outer;

        /* foo.css */
        @supports (outer: true) {
          @media (inner: true) {
            body {
              color: red;
            }
          }
        }

        /* nested-media.css */

        /* foo.css */
        @media (outer: true) {
          @media (inner: true) {
            body {
              color: red;
            }
          }
        }

        /* nested-media.css */

        /* entry.css */
      `);
    },
  });

  // This tests that bun correctly clones the import records for all import
  // condition tokens. If they aren't cloned correctly, then something will
  // likely crash with an out-of-bounds error.
  itBundled("css/CSSAtImportConditionsWithImportRecordsBundle", {
    files: {
      "/entry.css": /* css */ `
        @import url(./foo.css) supports(background: url(./a.png));
        @import url(./foo.css) supports(background: url(./b.png)) list-of-media-queries;
        @import url(./foo.css) layer(layer-name) supports(background: url(./a.png));
        @import url(./foo.css) layer(layer-name) supports(background: url(./b.png)) list-of-media-queries;
      `,
      "/foo.css": /* css */ `body { color: red }`,
      "/a.png": `A`,
      "/b.png": `B`,
    },
    outfile: "/out.css",
    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(/* css */ `
/* foo.css */
@supports (background: url(./a.png)) {
  body {
    color: red;
  }
}

/* foo.css */
@media list-of-media-queries {
  @supports (background: url(./b.png)) {
    body {
      color: red;
    }
  }
}

/* foo.css */
@supports (background: url(./a.png)) {
  @layer layer-name {
    body {
      color: red;
    }
  }
}

/* foo.css */
@media list-of-media-queries {
  @supports (background: url(./b.png)) {
    @layer layer-name {
      body {
        color: red;
      }
    }
  }
}

/* entry.css */
`);
    },
  });

  const files = [
    "/001/default/style.css",
    "/001/relative-url/style.css",
    "/at-charset/001/style.css",
    "/at-keyframes/001/style.css",
    "/at-layer/001/style.css",
    "/at-layer/002/style.css",
    "/at-layer/003/style.css",
    "/at-layer/004/style.css",
    "/at-layer/005/style.css",
    "/at-layer/006/style.css",
    "/at-layer/007/style.css",
    "/at-layer/008/style.css",
    "/at-media/001/default/style.css",
    "/at-media/002/style.css",
    "/at-media/003/style.css",
    "/at-media/004/style.css",
    "/at-media/005/style.css",
    "/at-media/006/style.css",
    "/at-media/007/style.css",
    "/at-media/008/style.css",
    "/at-supports/001/style.css",
    "/at-supports/002/style.css",
    "/at-supports/003/style.css",
    "/at-supports/004/style.css",
    "/at-supports/005/style.css",
    "/cycles/001/style.css",
    "/cycles/002/style.css",
    "/cycles/003/style.css",
    "/cycles/004/style.css",
    "/cycles/005/style.css",
    "/cycles/006/style.css",
    "/cycles/007/style.css",
    "/cycles/008/style.css",
    "/data-urls/002/style.css",
    "/data-urls/003/style.css",
    "/duplicates/001/style.css",
    "/duplicates/002/style.css",
    "/empty/001/style.css",
    "/relative-paths/001/style.css",
    "/relative-paths/002/style.css",
    "/subresource/001/style.css",
    "/subresource/002/style.css",
    "/subresource/004/style.css",
    "/subresource/005/style.css",
    "/subresource/007/style.css",
    "/url-format/001/default/style.css",
    "/url-format/001/relative-url/style.css",
    "/url-format/002/default/style.css",
    "/url-format/002/relative-url/style.css",
    "/url-format/003/default/style.css",
    "/url-format/003/relative-url/style.css",
    "/url-fragments/001/style.css",
    "/url-fragments/002/style.css",
  ];

  // From: https://github.com/romainmenke/css-import-tests. These test cases just
  // serve to document any changes in bun's behavior. Any changes in behavior
  // should be tested to ensure they don't cause any regressions. The easiest way
  // to test the changes is to bundle https://github.com/evanw/css-import-tests
  // and visually inspect a browser's rendering of the resulting CSS file.
  itBundled("css/CSSAtImportConditionsFromExternalRepo", {
    files: {
      "/001/default/a.css": `.box { background-color: green; }`,
      "/001/default/style.css": `@import url("a.css");`,

      "/001/relative-url/a.css": `.box { background-color: green; }`,
      "/001/relative-url/style.css": `@import url("./a.css");`,

      "/at-charset/001/a.css": `@charset "utf-8"; .box { background-color: red; }`,
      "/at-charset/001/b.css": `@charset "utf-8"; .box { background-color: green; }`,
      "/at-charset/001/style.css": `@charset "utf-8"; @import url("a.css"); @import url("b.css");`,

      "/at-keyframes/001/a.css": `
        .box { animation: BOX; animation-duration: 0s; animation-fill-mode: both; }
        @keyframes BOX { 0%, 100% { background-color: green; } }
      `,
      "/at-keyframes/001/b.css": `
        .box { animation: BOX; animation-duration: 0s; animation-fill-mode: both; }
        @keyframes BOX { 0%, 100% { background-color: red; } }
      `,
      "/at-keyframes/001/style.css": `@import url("a.css") screen; @import url("b.css") print;`,

      "/at-layer/001/a.css": `.box { background-color: red; }`,
      "/at-layer/001/b.css": `.box { background-color: green; }`,
      "/at-layer/001/style.css": `
        @import url("a.css") layer(a);
        @import url("b.css") layer(b);
        @import url("a.css") layer(a);
      `,

      "/at-layer/002/a.css": `.box { background-color: green; }`,
      "/at-layer/002/b.css": `.box { background-color: red; }`,
      "/at-layer/002/style.css": `
        @import url("a.css") layer(a) print;
        @import url("b.css") layer(b);
        @import url("a.css") layer(a);
      `,

      "/at-layer/003/a.css": `@layer a { .box { background-color: red; } }`,
      "/at-layer/003/b.css": `@layer b { .box { background-color: green; } }`,
      "/at-layer/003/style.css": `@import url("a.css"); @import url("b.css"); @import url("a.css");`,

      "/at-layer/004/a.css": `@layer { .box { background-color: green; } }`,
      "/at-layer/004/b.css": `@layer { .box { background-color: red; } }`,
      "/at-layer/004/style.css": `@import url("a.css"); @import url("b.css"); @import url("a.css");`,

      "/at-layer/005/a.css": `@import url("b.css") layer(b) (width: 1px);`,
      "/at-layer/005/b.css": `.box { background-color: red; }`,
      "/at-layer/005/style.css": `
        @import url("a.css") layer(a) (min-width: 1px);
        @layer a.c { .box { background-color: red; } }
        @layer a.b { .box { background-color: green; } }
      `,

      "/at-layer/006/a.css": `@import url("b.css") layer(b) (min-width: 1px);`,
      "/at-layer/006/b.css": `.box { background-color: red; }`,
      "/at-layer/006/style.css": `
        @import url("a.css") layer(a) (min-width: 1px);
        @layer a.c { .box { background-color: green; } }
        @layer a.b { .box { background-color: red; } }
      `,

      "/at-layer/007/style.css": `
        @layer foo {}
        @layer bar {}
        @layer bar { .box { background-color: green; } }
        @layer foo { .box { background-color: red; } }
      `,

      "/at-layer/008/a.css": `@import "b.css" layer; .box { background-color: green; }`,
      "/at-layer/008/b.css": `.box { background-color: red; }`,
      "/at-layer/008/style.css": `@import url("a.css") layer;`,

      "/at-media/001/default/a.css": `.box { background-color: green; }`,
      "/at-media/001/default/style.css": `@import url("a.css") screen;`,

      "/at-media/002/a.css": `.box { background-color: green; }`,
      "/at-media/002/b.css": `.box { background-color: red; }`,
      "/at-media/002/style.css": `@import url("a.css") screen; @import url("b.css") print;`,

      "/at-media/003/a.css": `@import url("b.css") (min-width: 1px);`,
      "/at-media/003/b.css": `.box { background-color: green; }`,
      "/at-media/003/style.css": `@import url("a.css") screen;`,

      "/at-media/004/a.css": `@import url("b.css") print;`,
      "/at-media/004/b.css": `.box { background-color: red; }`,
      "/at-media/004/c.css": `.box { background-color: green; }`,
      "/at-media/004/style.css": `@import url("c.css"); @import url("a.css") print;`,

      "/at-media/005/a.css": `@import url("b.css") (max-width: 1px);`,
      "/at-media/005/b.css": `.box { background-color: red; }`,
      "/at-media/005/c.css": `.box { background-color: green; }`,
      "/at-media/005/style.css": `@import url("c.css"); @import url("a.css") (max-width: 1px);`,

      "/at-media/006/a.css": `@import url("b.css") (min-width: 1px);`,
      "/at-media/006/b.css": `.box { background-color: green; }`,
      "/at-media/006/style.css": `@import url("a.css") (min-height: 1px);`,

      "/at-media/007/a.css": `@import url("b.css") screen;`,
      "/at-media/007/b.css": `.box { background-color: green; }`,
      "/at-media/007/style.css": `@import url("a.css") all;`,

      "/at-media/008/a.css": `@import url("green.css") layer(alpha) print;`,
      "/at-media/008/b.css": `@import url("red.css") layer(beta) print;`,
      "/at-media/008/green.css": `.box { background-color: green; }`,
      "/at-media/008/red.css": `.box { background-color: red; }`,
      "/at-media/008/style.css": `
        @import url("a.css") layer(alpha) all;
        @import url("b.css") layer(beta) all;
        @layer beta { .box { background-color: green; } }
        @layer alpha { .box { background-color: red; } }
      `,

      "/at-supports/001/a.css": `.box { background-color: green; }`,
      "/at-supports/001/style.css": `@import url("a.css") supports(display: block);`,

      "/at-supports/002/a.css": `@import url("b.css") supports(width: 10px);`,
      "/at-supports/002/b.css": `.box { background-color: green; }`,
      "/at-supports/002/style.css": `@import url("a.css") supports(display: block);`,

      "/at-supports/003/a.css": `@import url("b.css") supports(width: 10px);`,
      "/at-supports/003/b.css": `.box { background-color: green; }`,
      "/at-supports/003/style.css": `@import url("a.css") supports((display: block) or (display: inline));`,

      "/at-supports/004/a.css": `@import url("b.css") layer(b) supports(width: 10px);`,
      "/at-supports/004/b.css": `.box { background-color: green; }`,
      "/at-supports/004/style.css": `@import url("a.css") layer(a) supports(display: block);`,

      "/at-supports/005/a.css": `@import url("green.css") layer(alpha) supports(foo: bar);`,
      "/at-supports/005/b.css": `@import url("red.css") layer(beta) supports(foo: bar);`,
      "/at-supports/005/green.css": `.box { background-color: green; }`,
      "/at-supports/005/red.css": `.box { background-color: red; }`,
      "/at-supports/005/style.css": `
        @import url("a.css") layer(alpha) supports(display: block);
        @import url("b.css") layer(beta) supports(display: block);
        @layer beta { .box { background-color: green; } }
        @layer alpha { .box { background-color: red; } }
      `,

      "/cycles/001/style.css": `@import url("style.css"); .box { background-color: green; }`,

      "/cycles/002/a.css": `@import url("red.css"); @import url("b.css");`,
      "/cycles/002/b.css": `@import url("green.css"); @import url("a.css");`,
      "/cycles/002/green.css": `.box { background-color: green; }`,
      "/cycles/002/red.css": `.box { background-color: red; }`,
      "/cycles/002/style.css": `@import url("a.css");`,

      "/cycles/003/a.css": `@import url("b.css"); .box { background-color: green; }`,
      "/cycles/003/b.css": `@import url("a.css"); .box { background-color: red; }`,
      "/cycles/003/style.css": `@import url("a.css");`,

      "/cycles/004/a.css": `@import url("b.css"); .box { background-color: red; }`,
      "/cycles/004/b.css": `@import url("a.css"); .box { background-color: green; }`,
      "/cycles/004/style.css": `@import url("a.css"); @import url("b.css");`,

      "/cycles/005/a.css": `@import url("b.css"); .box { background-color: green; }`,
      "/cycles/005/b.css": `@import url("a.css"); .box { background-color: red; }`,
      "/cycles/005/style.css": `@import url("a.css"); @import url("b.css"); @import url("a.css");`,

      "/cycles/006/a.css": `@import url("red.css"); @import url("b.css");`,
      "/cycles/006/b.css": `@import url("green.css"); @import url("a.css");`,
      "/cycles/006/c.css": `@import url("a.css");`,
      "/cycles/006/green.css": `.box { background-color: green; }`,
      "/cycles/006/red.css": `.box { background-color: red; }`,
      "/cycles/006/style.css": `@import url("b.css"); @import url("c.css");`,

      "/cycles/007/a.css": `@import url("red.css"); @import url("b.css") screen;`,
      "/cycles/007/b.css": `@import url("green.css"); @import url("a.css") all;`,
      "/cycles/007/c.css": `@import url("a.css") not print;`,
      "/cycles/007/green.css": `.box { background-color: green; }`,
      "/cycles/007/red.css": `.box { background-color: red; }`,
      "/cycles/007/style.css": `@import url("b.css"); @import url("c.css");`,

      "/cycles/008/a.css": `@import url("red.css") layer; @import url("b.css");`,
      "/cycles/008/b.css": `@import url("green.css") layer; @import url("a.css");`,
      "/cycles/008/c.css": `@import url("a.css") layer;`,
      "/cycles/008/green.css": `.box { background-color: green; }`,
      "/cycles/008/red.css": `.box { background-color: red; }`,
      "/cycles/008/style.css": `@import url("b.css"); @import url("c.css");`,

      "/data-urls/002/style.css": `@import url('data:text/css;plain,.box%20%7B%0A%09background-color%3A%20green%3B%0A%7D%0A');`,

      "/data-urls/003/style.css": `@import url('data:text/css,.box%20%7B%0A%09background-color%3A%20green%3B%0A%7D%0A');`,

      "/duplicates/001/a.css": `.box { background-color: green; }`,
      "/duplicates/001/b.css": `.box { background-color: red; }`,
      "/duplicates/001/style.css": `@import url("a.css"); @import url("b.css"); @import url("a.css");`,

      "/duplicates/002/a.css": `.box { background-color: green; }`,
      "/duplicates/002/b.css": `.box { background-color: red; }`,
      "/duplicates/002/style.css": `@import url("a.css"); @import url("b.css"); @import url("a.css"); @import url("b.css"); @import url("a.css");`,

      "/empty/001/empty.css": ``,
      "/empty/001/style.css": `@import url("./empty.css"); .box { background-color: green; }`,

      "/relative-paths/001/a/a.css": `@import url("../b/b.css")`,
      "/relative-paths/001/b/b.css": `.box { background-color: green; }`,
      "/relative-paths/001/style.css": `@import url("./a/a.css");`,

      "/relative-paths/002/a/a.css": `@import url("./../b/b.css")`,
      "/relative-paths/002/b/b.css": `.box { background-color: green; }`,
      "/relative-paths/002/style.css": `@import url("./a/a.css");`,

      "/subresource/001/something/images/green.png": `...`,
      "/subresource/001/something/styles/green.css": `.box { background-image: url("../images/green.png"); }`,
      "/subresource/001/style.css": `@import url("./something/styles/green.css");`,

      "/subresource/002/green.png": `...`,
      "/subresource/002/style.css": `@import url("./styles/green.css");`,
      "/subresource/002/styles/green.css": `.box { background-image: url("../green.png"); }`,

      "/subresource/004/style.css": `@import url("./styles/green.css");`,
      "/subresource/004/styles/green.css": `.box { background-image: url("green.png"); }`,
      "/subresource/004/styles/green.png": `...`,

      "/subresource/005/style.css": `@import url("./styles/green.css");`,
      "/subresource/005/styles/green.css": `.box { background-image: url("./green.png"); }`,
      "/subresource/005/styles/green.png": `...`,

      "/subresource/007/green.png": `...`,
      "/subresource/007/style.css": `.box { background-image: url("./green.png"); }`,

      "/url-format/001/default/a.css": `.box { background-color: green; }`,
      "/url-format/001/default/style.css": `@import url(a.css);`,

      "/url-format/001/relative-url/a.css": `.box { background-color: green; }`,
      "/url-format/001/relative-url/style.css": `@import url(./a.css);`,

      "/url-format/002/default/a.css": `.box { background-color: green; }`,
      "/url-format/002/default/style.css": `@import "a.css";`,

      "/url-format/002/relative-url/a.css": `.box { background-color: green; }`,
      "/url-format/002/relative-url/style.css": `@import "./a.css";`,

      "/url-format/003/default/a.css": `.box { background-color: green; }`,
      "/url-format/003/default/style.css": `@import url("a.css"`,

      "/url-format/003/relative-url/a.css": `.box { background-color: green; }`,
      "/url-format/003/relative-url/style.css": `@import url("./a.css"`,

      "/url-fragments/001/a.css": `.box { background-color: green; }`,
      "/url-fragments/001/style.css": `@import url("./a.css#foo");`,

      "/url-fragments/002/a.css": `.box { background-color: green; }`,
      "/url-fragments/002/b.css": `.box { background-color: red; }`,
      "/url-fragments/002/style.css": `@import url("./a.css#1"); @import url("./b.css#2"); @import url("./a.css#3");`,
    },
    entryPoints: files,
    outputPaths: files,
    outdir: "/out",
    onAfterBundle(api) {
      for (const file of files) {
        console.log("Checking snapshot:", file);
        api.expectFile(join(file)).toMatchSnapshot(file);
      }
    },
  });

  itBundled("css/CSSAtImportConditionsAtLayerBundle", {
    files: {
      "/case1.css": /* css */ `
        @import url(case1-foo.css) layer(first.one);
        @import url(case1-foo.css) layer(last.one);
        @import url(case1-foo.css) layer(first.one);
      `,
      "/case1-foo.css": `body { color: red }`,

      "/case2.css": /* css */ `
        @import url(case2-foo.css);
        @import url(case2-bar.css);
        @import url(case2-foo.css);
      `,
      "/case2-foo.css": `@layer first.one { body { color: red } }`,
      "/case2-bar.css": `@layer last.one { body { color: green } }`,

      "/case3.css": /* css */ `
        @import url(case3-foo.css);
        @import url(case3-bar.css);
        @import url(case3-foo.css);
      `,
      "/case3-foo.css": `@layer { body { color: red } }`,
      "/case3-bar.css": `@layer only.one { body { color: green } }`,

      "/case4.css": /* css */ `
        @import url(case4-foo.css) layer(first);
        @import url(case4-foo.css) layer(last);
        @import url(case4-foo.css) layer(first);
      `,
      "/case4-foo.css": `@layer one { @layer two, three.four; body { color: red } }`,

      "/case5.css": /* css */ `
        @import url(case5-foo.css) layer;
        @import url(case5-foo.css) layer(middle);
        @import url(case5-foo.css) layer;
      `,
      "/case5-foo.css": `@layer one { @layer two, three.four; body { color: red } }`,

      // Note: There was a bug that only showed up in this case. We need at least this many cases.
      "/case6.css": /* css */ `
        @import url(case6-foo.css) layer(first);
        @import url(case6-foo.css) layer(last);
        @import url(case6-foo.css) layer(first);
      `,
      "/case6-foo.css": `@layer { @layer two, three.four; body { color: red } }`,
    },
    entryPoints: ["/case1.css", "/case2.css", "/case3.css", "/case4.css", "/case5.css", "/case6.css"],
    outdir: "/out",
    onAfterBundle(api) {
      const snapshotFiles = ["case1.css", "case2.css", "case3.css", "case4.css", "case5.css", "case6.css"];
      for (const file of snapshotFiles) {
        console.log("Checking snapshot:", file);
        api.expectFile(join("/out", file)).toMatchSnapshot(file);
      }
    },
  });

  itBundled("css/CSSAtImportConditionsAtLayerBundleAlternatingLayerInFile", {
    files: {
      "/a.css": `@layer first { body { color: red } }`,
      "/b.css": `@layer last { body { color: green } }`,

      "/case1.css": /* css */ `
        @import url(a.css);
        @import url(a.css);
      `,

      "/case2.css": /* css */ `
        @import url(a.css);
        @import url(b.css);
        @import url(a.css);
      `,

      "/case3.css": /* css */ `
        @import url(a.css);
        @import url(b.css);
        @import url(a.css);
        @import url(b.css);
      `,

      "/case4.css": /* css */ `
        @import url(a.css);
        @import url(b.css);
        @import url(a.css);
        @import url(b.css);
        @import url(a.css);
      `,

      "/case5.css": /* css */ `
        @import url(a.css);
        @import url(b.css);
        @import url(a.css);
        @import url(b.css);
        @import url(a.css);
        @import url(b.css);
      `,

      "/case6.css": /* css */ `
        @import url(a.css);
        @import url(b.css);
        @import url(a.css);
        @import url(b.css);
        @import url(a.css);
        @import url(b.css);
        @import url(a.css);
      `,
    },
    entryPoints: ["/case1.css", "/case2.css", "/case3.css", "/case4.css", "/case5.css", "/case6.css"],
    outdir: "/out",
    onAfterBundle(api) {
      const snapshotFiles = ["case1.css", "case2.css", "case3.css", "case4.css", "case5.css", "case6.css"];
      for (const file of snapshotFiles) {
        console.log("Checking snapshot:", file);
        api.expectFile(join("/out", file)).toMatchSnapshot(file);
      }
    },
  });

  itBundled("css/CSSAtImportConditionsChainExternal", {
    files: {
      "/entry.css": /* css */ `
        @import "a.css" layer(a) not print;
      `,
      "/a.css": /* css */ `
        @import "http://example.com/external1.css";
        @import "b.css" layer(b) not tv;
        @import "http://example.com/external2.css" layer(a2);
      `,
      "/b.css": /* css */ `
        @import "http://example.com/external3.css";
        @import "http://example.com/external4.css" layer(b2);
      `,
    },
    outfile: "/out.css",
  });

  // This test mainly just makes sure that this scenario doesn't crash
  itBundled("css/CSSAndJavaScriptCodeSplittingESBuildIssue1064", {
    files: {
      "/a.js": /* js */ `
        import shared from './shared.js'
        console.log(shared() + 1)
      `,
      "/b.js": /* js */ `
        import shared from './shared.js'
        console.log(shared() + 2)
      `,
      "/c.css": /* css */ `
        @import "./shared.css";
        body { color: red }
      `,
      "/d.css": /* css */ `
        @import "./shared.css";
        body { color: blue }
      `,
      "/shared.js": `export default function() { return 3 }`,
      "/shared.css": `body { background: black }`,
    },
    entryPoints: ["/a.js", "/b.js", "/c.css", "/d.css"],
    format: "esm",
    splitting: true,
    onAfterBundle(api) {
      const files = ["/a.js", "/b.js", "/c.css", "/d.css"];
      for (const file of files) {
        api.expectFile(file).toMatchSnapshot(file);
      }
    },
  });

  itBundled("css/CSSExternalQueryAndHashNoMatchESBuildIssue1822", {
    files: {
      "/entry.css": /* css */ `
        a { background: url(foo/bar.png?baz) }
        b { background: url(foo/bar.png#baz) }
      `,
    },
    outfile: "/out.css",
    bundleErrors: {
      "/entry.css": [
        `Could not resolve: "foo/bar.png?baz". Maybe you need to "bun install"?`,
        `Could not resolve: "foo/bar.png#baz". Maybe you need to "bun install"?`,
      ],
    },
  });
  itBundled("css/CSSNestingOldBrowser", {
    // GENERATED
    files: {
      "/nested-@layer.css": `a { @layer base { color: red; } }`,
      "/nested-@media.css": `a { @media screen { color: red; } }`,
      "/nested-ampersand-twice.css": `a { &, & { color: red; } }`,
      "/nested-ampersand-first.css": `a { &, b { color: red; } }`,
      "/nested-attribute.css": `a { [href] { color: red; } }`,
      "/nested-colon.css": `a { :hover { color: red; } }`,
      "/nested-dot.css": `a { .cls { color: red; } }`,
      "/nested-greaterthan.css": `a { > b { color: red; } }`,
      "/nested-hash.css": `a { #id { color: red; } }`,
      "/nested-plus.css": `a { + b { color: red; } }`,
      "/nested-tilde.css": `a { ~ b { color: red; } }`,
      "/toplevel-ampersand-twice.css": `&, & { color: red; }`,
      "/toplevel-ampersand-first.css": `&, a { color: red; }`,
      "/toplevel-ampersand-second.css": `a, & { color: red; }`,
      "/toplevel-attribute.css": `[href] { color: red; }`,
      "/toplevel-colon.css": `:hover { color: red; }`,
      "/toplevel-dot.css": `.cls { color: red; }`,
      "/toplevel-greaterthan.css": `> b { color: red; }`,
      "/toplevel-hash.css": `#id { color: red; }`,
      "/toplevel-plus.css": `+ b { color: red; }`,
      "/toplevel-tilde.css": `~ b { color: red; }`,
    },
    entryPoints: [
      "/nested-@layer.css",
      "/nested-@media.css",
      "/nested-ampersand-twice.css",
      "/nested-ampersand-first.css",
      "/nested-attribute.css",
      "/nested-colon.css",
      "/nested-dot.css",
      "/nested-greaterthan.css",
      "/nested-hash.css",
      "/nested-plus.css",
      "/nested-tilde.css",
      "/toplevel-ampersand-twice.css",
      "/toplevel-ampersand-first.css",
      "/toplevel-ampersand-second.css",
      "/toplevel-attribute.css",
      "/toplevel-colon.css",
      "/toplevel-dot.css",
      "/toplevel-greaterthan.css",
      "/toplevel-hash.css",
      "/toplevel-plus.css",
      "/toplevel-tilde.css",
    ],
    unsupportedCSSFeatures: ["Nesting"],
    /* TODO FIX expectedScanLog: `nested-@layer.css: WARNING: CSS nesting syntax is not supported in the configured target environment (chrome10)
  nested-@media.css: WARNING: CSS nesting syntax is not supported in the configured target environment (chrome10)
  nested-ampersand-first.css: WARNING: CSS nesting syntax is not supported in the configured target environment (chrome10)
  nested-ampersand-twice.css: WARNING: CSS nesting syntax is not supported in the configured target environment (chrome10)
  nested-attribute.css: WARNING: CSS nesting syntax is not supported in the configured target environment (chrome10)
  nested-colon.css: WARNING: CSS nesting syntax is not supported in the configured target environment (chrome10)
  nested-dot.css: WARNING: CSS nesting syntax is not supported in the configured target environment (chrome10)
  nested-greaterthan.css: WARNING: CSS nesting syntax is not supported in the configured target environment (chrome10)
  nested-hash.css: WARNING: CSS nesting syntax is not supported in the configured target environment (chrome10)
  nested-plus.css: WARNING: CSS nesting syntax is not supported in the configured target environment (chrome10)
  nested-tilde.css: WARNING: CSS nesting syntax is not supported in the configured target environment (chrome10)
  toplevel-ampersand-first.css: WARNING: CSS nesting syntax is not supported in the configured target environment (chrome10)
  toplevel-ampersand-second.css: WARNING: CSS nesting syntax is not supported in the configured target environment (chrome10)
  toplevel-ampersand-twice.css: WARNING: CSS nesting syntax is not supported in the configured target environment (chrome10)
  toplevel-ampersand-twice.css: WARNING: CSS nesting syntax is not supported in the configured target environment (chrome10)
  toplevel-greaterthan.css: WARNING: CSS nesting syntax is not supported in the configured target environment (chrome10)
  toplevel-plus.css: WARNING: CSS nesting syntax is not supported in the configured target environment (chrome10)
  toplevel-tilde.css: WARNING: CSS nesting syntax is not supported in the configured target environment (chrome10)
  `, */
  });
  itBundled("css/MetafileCSSBundleTwoToOne", {
    files: {
      "/foo/entry.js": /* js */ `
        import '../common.css'
        console.log('foo')
      `,
      "/bar/entry.js": /* js */ `
        import '../common.css'
        console.log('bar')
      `,
      "/common.css": `body { color: red }`,
    },
    metafile: true,
    entryPoints: ["/foo/entry.js", "/bar/entry.js"],
    entryNaming: "[ext]/[hash]",
    outdir: "/",
  });
  itBundled("css/DeduplicateRules", {
    // GENERATED
    files: {
      "/yes0.css": `a { color: red; color: green; color: red }`,
      "/yes1.css": `a { color: red } a { color: green } a { color: red }`,
      "/yes2.css": `@media screen { a { color: red } } @media screen { a { color: red } }`,
      "/no0.css": `@media screen { a { color: red } } @media screen { & a { color: red } }`,
      "/no1.css": `@media screen { a { color: red } } @media screen { a[x] { color: red } }`,
      "/no2.css": `@media screen { a { color: red } } @media screen { a.x { color: red } }`,
      "/no3.css": `@media screen { a { color: red } } @media screen { a#x { color: red } }`,
      "/no4.css": `@media screen { a { color: red } } @media screen { a:x { color: red } }`,
      "/no5.css": `@media screen { a:x { color: red } } @media screen { a:x(y) { color: red } }`,
      "/no6.css": `@media screen { a b { color: red } } @media screen { a + b { color: red } }`,
      "/across-files.css": `@import 'across-files-0.css'; @import 'across-files-1.css'; @import 'across-files-2.css';`,
      "/across-files-0.css": `a { color: red; color: red }`,
      "/across-files-1.css": `a { color: green }`,
      "/across-files-2.css": `a { color: red }`,
      "/across-files-url.css": `@import 'across-files-url-0.css'; @import 'across-files-url-1.css'; @import 'across-files-url-2.css';`,
      "/across-files-url-0.css": `@import 'http://example.com/some.css'; @font-face { src: url(http://example.com/some.font); }`,
      "/across-files-url-1.css": `@font-face { src: url(http://example.com/some.other.font); }`,
      "/across-files-url-2.css": `@font-face { src: url(http://example.com/some.font); }`,
    },
    entryPoints: [
      "/yes0.css",
      "/yes1.css",
      "/yes2.css",
      "/no0.css",
      "/no1.css",
      "/no2.css",
      "/no3.css",
      "/no4.css",
      "/no5.css",
      "/no6.css",
      "/across-files.css",
      "/across-files-url.css",
    ],
  });
});
