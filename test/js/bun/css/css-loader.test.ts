import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, normalizeBunSnapshot, tempDir } from "harness";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The default export of a plain .css import is an empty object (esbuild
// parity), and `bun run` and `bun build --target=bun` agree on that shape.
describe.concurrent("css loader default export", () => {
  const entry = `import c from "./s.css";\nprocess.stdout.write(typeof c + " " + JSON.stringify(c));\n`;

  test("bun run", async () => {
    using dir = tempDir("css-loader-run", {
      "s.css": ".c { color: red }",
      "e.ts": entry,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "e.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("object {}");
    expect(exitCode).toBe(0);
  });

  test("bun build --target=bun then run matches bun run", async () => {
    using dir = tempDir("css-loader-build", {
      "s.css": ".c { color: red }",
      "e.ts": entry,
    });
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "e.ts", "--target=bun", "--outdir=out"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [, buildErr, buildCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
    expect(buildErr).toBe("");
    expect(buildCode).toBe(0);

    await using run = Bun.spawn({
      cmd: [bunExe(), "out/e.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("object {}");
    expect(exitCode).toBe(0);
  });

  test("bun run does not parse the file", async () => {
    using dir = tempDir("css-loader-unparsed", {
      "s.css": "..c { composes: nope } ]",
      "e.ts": entry,
    });
    expect(await run(String(dir), "e.ts")).toEqual({ stdout: "object {}", stderr: "", exitCode: 0 });
  });
});

async function run(cwd: string, ...args: string[]) {
  await using proc = Bun.spawn({ cmd: [bunExe(), ...args], env: bunEnv, cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// The default export of a `*.module.css` import is the class-name map
// `Bun.build` emits for that file.
describe.concurrent("css module exports", () => {
  // Imports entry.ts as it is and as `Bun.build` bundles it. One process does
  // both: scoped names hash the path relative to the working directory.
  const parity = `
    import * as runtime from "./entry.ts";
    await Bun.build({ entrypoints: ["./entry.ts"], target: "bun", outdir: "out" });
    const bundled = await import("./out/entry.js");
    process.stdout.write(JSON.stringify({ runtime, bundled }));
  `;

  async function runtimeAndBundled(cwd: string) {
    const { stdout, stderr, exitCode } = await run(cwd, "parity.ts");
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const { runtime, bundled } = JSON.parse(stdout);
    // As strings, so that the order of the keys counts.
    expect(JSON.stringify(runtime)).toBe(JSON.stringify(bundled));
    return runtime;
  }

  test("classes and ids, wherever they appear", async () => {
    using dir = tempDir("css-module-selectors", {
      "parity.ts": parity,
      "entry.ts": `export { default, title, main, spinner } from "./a.module.css";`,
      "a.module.css": `
        .title { color: red }
        #main { color: blue }
        .kebab-case { color: red }
        .default { color: red }
        .\\31 23 { color: red }
        .sm\\:hover { color: red }
        .é { color: red }
        .__proto__ { color: red }
        .a:hover .b::before, .c > .d:not(.e):is(.f, .g) { color: red }
        .nest { &.n1 { color: red } .n2 & { color: red } }
        @media (min-width: 1px) { .m { color: red } }
        @supports (display: grid) { .s { color: red } }
        @layer x { .l { color: red } }
        @container box (min-width: 1px) { .c1 { color: red } }
        @keyframes spin { to { opacity: 1 } }
        .spinner { animation: spin 1s }
        .vt { view-transition-name: hero }
        .dashed { --my-var: 1; color: var(--my-var) }
        .title { margin: 0 }
        div, [data-x] { color: red }
      `,
    });
    const styles = {
      "123": "123_BLNoTg",
      title: "title_BLNoTg",
      main: "main_BLNoTg",
      "kebab-case": "kebab-case_BLNoTg",
      default: "default_BLNoTg",
      "sm:hover": "sm:hover_BLNoTg",
      é: "é_BLNoTg",
      ["__proto__"]: "__proto___BLNoTg",
      a: "a_BLNoTg",
      b: "b_BLNoTg",
      c: "c_BLNoTg",
      d: "d_BLNoTg",
      e: "e_BLNoTg",
      f: "f_BLNoTg",
      g: "g_BLNoTg",
      nest: "nest_BLNoTg",
      n1: "n1_BLNoTg",
      n2: "n2_BLNoTg",
      m: "m_BLNoTg",
      s: "s_BLNoTg",
      l: "l_BLNoTg",
      c1: "c1_BLNoTg",
      spinner: "spinner_BLNoTg",
      vt: "vt_BLNoTg",
      dashed: "dashed_BLNoTg",
    };
    expect(await runtimeAndBundled(String(dir))).toEqual({
      default: styles,
      title: styles.title,
      main: styles.main,
      spinner: styles.spinner,
    });
  });

  test(":local() and :global()", async () => {
    using dir = tempDir("css-module-local-global", {
      "parity.ts": parity,
      "entry.ts": `export { default } from "./a.module.css";`,
      "a.module.css": `
        :global(.g1) .inner { color: green }
        :local(.loc) :global(.g2 .g3) { color: green }
      `,
    });
    expect(await runtimeAndBundled(String(dir))).toMatchObject({
      default: { inner: "inner_BLNoTg", loc: "loc_BLNoTg" },
    });
  });

  test("composes", async () => {
    using dir = tempDir("css-module-composes", {
      "parity.ts": parity,
      "entry.ts": `
        export { default as a } from "./a.module.css";
        export { default as b } from "./sub/b.module.css";
      `,
      "a.module.css": `
        .base { color: red }
        .local { composes: base; padding: 0 }
        .chain { composes: local; margin: 0 }
        .multi { composes: base local; composes: chain; border: 0 }
        .global { composes: g1 g2 from global; outline: 0 }
        .other { composes: btn from "./sub/b.module.css"; top: 0 }
        .bare { composes: deep from "c.module.css"; left: 0 }
        .pkg { composes: p from "pkg/p.module.css"; right: 0 }
        .mixed { composes: base; composes: g1 from global; composes: btn from './sub/b.module.css'; bottom: 0 }
        .self { composes: self }
        .loopA { composes: loopB }
        .loopB { composes: loopA }
        .crossA { composes: crossB from "./sub/b.module.css" }
        .again { composes: base }
        .again { composes: local }
        #both { float: left }
        .both { clear: both }
        .idAndClass { composes: both }
        .external { composes: x from "https://example.com/x.module.css" }
      `,
      "sub/b.module.css": `
        .base { width: 0 }
        .btn { composes: base; composes: deep from "../c.module.css"; height: 0 }
        .crossB { composes: crossA from "../a.module.css" }
      `,
      "c.module.css": `.deep { z-index: 1 }`,
      "node_modules/pkg/package.json": `{ "name": "pkg", "version": "1.0.0" }`,
      "node_modules/pkg/p.module.css": `.p { opacity: 1 }`,
    });
    expect(await runtimeAndBundled(String(dir))).toEqual({
      a: {
        base: "base_BLNoTg",
        local: "base_BLNoTg local_BLNoTg",
        chain: "base_BLNoTg local_BLNoTg chain_BLNoTg",
        multi: "base_BLNoTg local_BLNoTg chain_BLNoTg multi_BLNoTg",
        global: "g1 g2 global_BLNoTg",
        other: "base_BZKj3A deep_j4JN4Q btn_BZKj3A other_BLNoTg",
        bare: "deep_j4JN4Q bare_BLNoTg",
        pkg: "p_RMK_xw pkg_BLNoTg",
        mixed: "base_BLNoTg g1 base_BZKj3A deep_j4JN4Q btn_BZKj3A mixed_BLNoTg",
        self: "self_BLNoTg",
        loopA: "loopB_BLNoTg loopA_BLNoTg",
        loopB: "loopA_BLNoTg loopB_BLNoTg",
        crossA: "crossB_BZKj3A crossA_BLNoTg",
        again: "base_BLNoTg local_BLNoTg again_BLNoTg",
        both: "both_BLNoTg",
        idAndClass: "both_BLNoTg idAndClass_BLNoTg",
        external: "external_BLNoTg",
      },
      b: {
        base: "base_BZKj3A",
        btn: "base_BZKj3A deep_j4JN4Q btn_BZKj3A",
        crossB: "crossA_BLNoTg crossB_BZKj3A",
      },
    });
  });

  test("composes cycle that the exported class is not part of", async () => {
    using dir = tempDir("css-module-composes-cycle", {
      "parity.ts": parity,
      "entry.ts": `
        export { default as one } from "./one.module.css";
        export { default as many } from "./many.module.css";
      `,
      "one.module.css": `
        .r { composes: a }
        .a { composes: b; color: red }
        .b { composes: a; margin: 0 }
      `,
      "many.module.css": `.r { composes: a from "./many-a.module.css" }`,
      "many-a.module.css": `.a { composes: b from "./many-b.module.css"; color: red }`,
      "many-b.module.css": `.b { composes: a from "./many-a.module.css"; margin: 0 }`,
    });
    expect(await runtimeAndBundled(String(dir))).toEqual({
      one: { r: "b_fQusBA a_fQusBA r_fQusBA", a: "b_fQusBA a_fQusBA", b: "a_fQusBA b_fQusBA" },
      many: { r: "b_DHJJbg a_UL9mMQ r_dZlOUg" },
    });
  });

  test("names depend on the path relative to the working directory", async () => {
    using dir = tempDir("css-module-paths", {
      "app/parity.ts": parity,
      "app/entry.ts": `
        export { default as top } from "./x.module.css";
        export { default as nested } from "./deep/er/x.module.css";
        export { default as outside } from "../shared/x.module.css";
        export { default as bom } from "./bom.module.css";
      `,
      "app/x.module.css": `.x { color: red }`,
      "app/deep/er/x.module.css": `.x { composes: x from "../../x.module.css"; margin: 0 }`,
      "shared/x.module.css": `.x { composes: x from "../app/x.module.css"; padding: 0 }`,
      "app/bom.module.css": Buffer.from("﻿.x { color: red }"),
    });
    expect(await runtimeAndBundled(join(String(dir), "app"))).toEqual({
      top: { x: "x_e7Ht-A" },
      nested: { x: "x_e7Ht-A x_AeEIVA" },
      outside: { x: "x_e7Ht-A x_ypjLzg" },
      bom: { x: "x_uzTWCw" },
    });
  });

  test("import, import(), require()", async () => {
    using dir = tempDir("css-module-import-forms", {
      "a.module.css": `
        .title { color: red }
        .btn { composes: title; margin: 0 }
        .kebab-case { color: red }
      `,
      "esm.ts": `
        import styles from "./a.module.css";
        import * as namespace from "./a.module.css";
        import { title, btn } from "./a.module.css";
        const dynamic = await import("./a.module.css");
        const query = await import("./a.module.css?query");
        process.stdout.write(JSON.stringify({ styles, namespace, title, btn, dynamic, query }));
      `,
      "cjs.cjs": `process.stdout.write(JSON.stringify(require("./a.module.css")));`,
    });
    const styles = {
      title: "title_BLNoTg",
      btn: "title_BLNoTg btn_BLNoTg",
      "kebab-case": "kebab-case_BLNoTg",
    };
    const [esm, cjs] = await Promise.all([run(String(dir), "esm.ts"), run(String(dir), "cjs.cjs")]);
    expect({ ...esm, stdout: JSON.parse(esm.stdout) }).toEqual({
      stdout: {
        styles,
        namespace: { default: styles, ...styles },
        title: styles.title,
        btn: styles.btn,
        dynamic: { default: styles, ...styles },
        query: { default: styles, ...styles },
      },
      stderr: "",
      exitCode: 0,
    });
    expect({ ...cjs, stdout: JSON.parse(cjs.stdout) }).toEqual({ stdout: styles, stderr: "", exitCode: 0 });
  });

  test("a module without classes or ids", async () => {
    using dir = tempDir("css-module-empty", {
      "parity.ts": parity,
      "entry.ts": `
        export { default as empty } from "./empty.module.css";
        export { default as noLocals } from "./no-locals.module.css";
      `,
      "empty.module.css": "",
      "no-locals.module.css": `div { color: red } @keyframes k { to { opacity: 1 } }`,
    });
    expect(await runtimeAndBundled(String(dir))).toEqual({ empty: {}, noLocals: {} });
  });

  // What is wrong with the CSS never fails the import: it is skipped, as a
  // browser skips it, and nothing is printed. `Bun.build` goes on rejecting it.
  const skipping = `
    const results = await Promise.all(
      process.argv.slice(2).map(async file => {
        const { logs } = await Bun.build({ entrypoints: ["./" + file], throw: false });
        return [
          file,
          {
            require: require("./" + file),
            import: (await import("./" + file)).default,
            bundler: logs.filter(log => log.level === "error").map(log => log.message),
          },
        ];
      }),
    );
    process.stdout.write(JSON.stringify(Object.fromEntries(results)));
  `;

  async function expectSkipped(
    cwd: string,
    cases: Record<string, { exports: Record<string, string>; bundler: string | string[] }>,
  ) {
    const { stdout, stderr, exitCode } = await run(cwd, "skipping.ts", ...Object.keys(cases));
    expect(stderr).toBe("");
    const results = JSON.parse(stdout);
    for (const [file, { exports, bundler }] of Object.entries(cases)) {
      expect({ file, ...results[file] }).toEqual({
        file,
        import: exports,
        require: exports,
        bundler: expect.arrayContaining([bundler].flat()),
      });
    }
    expect(exitCode).toBe(0);
  }

  test("invalid rules and declarations are skipped", async () => {
    const emptySelector = "Invalid selector. Empty selector is not allowed";
    const notSupported = (name: string) => `Invalid selector. CSS module class: '${name}' is currently not supported.`;
    const cases = {
      "bare-global.module.css": {
        css: `.btn { color: red }\n:global .dark .btn { color: white }`,
        exports: { btn: "btn_2oH-8A" },
        bundler: notSupported("global"),
      },
      "global-block.module.css": {
        css: `:global { .reset { margin: 0 } }\n.card { margin: 0 }`,
        exports: { card: "card_zb_7FQ" },
        bundler: notSupported("global"),
      },
      "bare-local.module.css": {
        css: `:local .panel { color: red }\n.row { color: red }`,
        exports: { row: "row_fzRKIQ" },
        bundler: notSupported("local"),
      },
      "global-keyframes.module.css": {
        css: `@keyframes :global(spin) { to { opacity: 1 } }\n.spinner { animation: spin 1s }`,
        exports: { spinner: "spinner_dPaeTg" },
        bundler: "Unexpected token: :",
      },
      "line-comments.module.css": {
        css: `.head {\n  // first\n  color: red; // second\n}\n.foot { color: red }`,
        exports: { head: "head_AaIjDQ", foot: "foot_AaIjDQ" },
        bundler: "Unexpected token: ;",
      },
      // Up to the next "{", everything is the selector of the next rule.
      "line-comment-before-a-rule.module.css": {
        css: `.one { color: red }\n// comment\n.two { color: red }\n.three { color: red }`,
        exports: { one: "one_2CjRWA", three: "three_2CjRWA" },
        bundler: emptySelector,
      },
      "sass-variable.module.css": {
        css: `$gap: 4px;\n.first { margin: $gap }\n.second { margin: $gap }`,
        exports: { second: "second_0tV0hA" },
        bundler: emptySelector,
      },
      "stray-semicolon.module.css": {
        css: `.one { color: red };\n.two { color: red }\n.three { color: red }`,
        exports: { one: "one_avrLAQ", three: "three_avrLAQ" },
        bundler: emptySelector,
      },
      "stray-brace.module.css": {
        css: `.one { color: red } }\n.two { color: red }\n.three { color: red }`,
        exports: { one: "one_bxI1dg", three: "three_bxI1dg" },
        bundler: emptySelector,
      },
      "less.module.css": {
        css: `.rounded() { border-radius: 2px }\n.box { .rounded(); color: red }`,
        exports: { box: "box_OTTf4Q" },
        bundler: "Invalid selector. Expected identifier after '.' in class selector, found: rounded(",
      },
      "star-hack.module.css": {
        css: `.clearfix { *zoom: 1; color: red }\n.next { color: red }`,
        exports: { clearfix: "clearfix_lvEdxw", next: "next_lvEdxw" },
        bundler: "Unexpected token: ;",
      },
      "late-import.module.css": {
        css: `.one { color: red }\n@import "./plain.css";\n.two { color: red }`,
        exports: { one: "one_r-liRw", two: "two_r-liRw" },
        bundler: "@import rules must come before any other rules except @charset and @layer",
      },
      "declaration-after-composes.module.css": {
        css: `.base { color: red }\n.a { composes: base; *zoom: 1 }\n.b { *zoom: 1; composes: base }`,
        exports: { base: "base_dl5igQ", a: "base_dl5igQ a_dl5igQ", b: "base_dl5igQ b_dl5igQ" },
        bundler: "Unexpected end of input",
      },
      // The names a selector had before it went wrong are kept.
      "deep-combinator.module.css": {
        css: `.outer >>> .inner { color: red }\n.next { color: red }`,
        exports: { outer: "outer_AQnDcA", next: "next_AQnDcA" },
        bundler: "Invalid selector. Found a dangling combinator with no selector",
      },
      "unescaped.module.css": {
        css: `.w-1/2 { width: 50% }\n.1col { width: 100% }\n.ok { width: 1px }`,
        exports: { "w-1": "w-1_-1Df1Q", ok: "ok_-1Df1Q" },
        bundler: "Unexpected token: /",
      },
      "not-css.module.css": { css: `{"a": 1}`, exports: {}, bundler: emptySelector },
    };
    using dir = tempDir("css-module-skipped", {
      ...Object.fromEntries(Object.entries(cases).map(([file, { css }]) => [file, css])),
      "plain.css": `.x { color: red }`,
      "skipping.ts": skipping,
    });
    await expectSkipped(String(dir), cases);
  });

  test("a composes that cannot be followed is left out", async () => {
    const neverAppears = (name: string, file: string) =>
      `The name "${name}" never appears in "${file}" as a CSS modules locally scoped class name. Note that "composes" only works with single class selectors.`;
    const notCSS = (file: string) =>
      `Cannot use the "composes" property with the "${file}" file (it is not a CSS file)`;
    const invalidSelector = "Invalid selector. Expected identifier after '.' in class selector, found: .";
    const cases = {
      "syntax.module.css": {
        css: `.a { color: red }\n..b { }\n`,
        exports: { a: "a_bksvvA" },
        bundler: invalidSelector,
      },
      "composes-syntax.module.css": {
        css: `.a { composes: a from "./syntax.module.css" }`,
        exports: { a: "a_bksvvA a_M__03g" },
        bundler: invalidSelector,
      },
      "missing-local.module.css": {
        css: `.a { composes: nope }`,
        exports: { a: "a_axKivQ" },
        bundler: neverAppears("nope", "missing-local.module.css"),
      },
      "missing-imported.module.css": {
        css: `.a { composes: nope from "./ok.module.css" }`,
        exports: { a: "a_lV3ovQ" },
        bundler: neverAppears("nope", "ok.module.css"),
      },
      "not-a-module.module.css": {
        css: `.a { composes: x from "./plain.css" }`,
        exports: { a: "a_XQAOgQ" },
        bundler: neverAppears("x", "plain.css"),
      },
      "missing-in-composed.module.css": {
        css: `.a { composes: a from "./missing-local.module.css" }`,
        exports: { a: "a_axKivQ a_22pesA" },
        bundler: neverAppears("nope", "missing-local.module.css"),
      },
      "missing-file.module.css": {
        css: `.a { composes: x from "./nofile.module.css" }`,
        exports: { a: "a_fujFUQ" },
        bundler: `Could not resolve: "./nofile.module.css"`,
      },
      "missing-package.module.css": {
        css: `.a { composes: x from "nopkg/x.module.css" }`,
        exports: { a: "a_wsh19Q" },
        bundler: `Could not resolve: "nopkg/x.module.css". Maybe you need to "bun install"?`,
      },
      "alias.module.css": {
        css: `.a { composes: x from "@/styles/x.module.css"; composes: y from "~pkg/y.module.css" }`,
        exports: { a: "a_hM-9SA" },
        bundler: [
          `Could not resolve: "@/styles/x.module.css". Maybe you need to "bun install"?`,
          `Could not resolve: "~pkg/y.module.css". Maybe you need to "bun install"?`,
        ],
      },
      "not-css.module.css": {
        css: `.a { composes: x from "./script.js"; composes: y from "./sheet.scss" }`,
        exports: { a: "a_56-NkA" },
        bundler: [notCSS("script.js"), notCSS("sheet.scss")],
      },
      "id-only.module.css": {
        css: `#x { color: red }\n.a { composes: x }`,
        exports: { x: "x_0YzEFA", a: "a_0YzEFA" },
        bundler: `The composes property cannot be used with "x", because it is not a single class name.`,
      },
      "two.module.css": {
        css: `.a { composes: n1 n2 }`,
        exports: { a: "a_yCs-Eg" },
        bundler: [neverAppears("n1", "two.module.css"), neverAppears("n2", "two.module.css")],
      },
      "function.module.css": {
        css: `.a { composes: global(x) }`,
        exports: { a: "a_3mn57Q" },
        bundler: "Invalid declaration",
      },
      "the-rest.module.css": {
        css: `
          .base { color: red }
          .a {
            composes: base nope;
            composes: x from "./nofile.module.css";
            composes: g from global;
            composes: title nope from "./ok.module.css";
          }
        `,
        exports: { base: "base_-Ns4ug", a: "base_-Ns4ug g title_eAaSLw a_-Ns4ug" },
        bundler: `Could not resolve: "./nofile.module.css"`,
      },
    };
    using dir = tempDir("css-module-composes-skipped", {
      ...Object.fromEntries(Object.entries(cases).map(([file, { css }]) => [file, css])),
      "ok.module.css": `.title { color: red }`,
      "plain.css": `.x { color: red }`,
      "script.js": `export {};`,
      "sheet.scss": `.y { color: red }`,
      "skipping.ts": skipping,
    });
    await expectSkipped(String(dir), cases);
  });

  test("a file that was deleted after it was resolved", async () => {
    using dir = tempDir("css-module-deleted", {
      "a.module.css": `.a { color: red }`,
      "b.module.css": `.b { composes: c from "./c.module.css" }`,
      "c.module.css": `.c { color: red }`,
      "e.ts": `
        import { unlinkSync } from "node:fs";
        await import("./a.module.css");
        await import("./b.module.css");
        unlinkSync("a.module.css");
        unlinkSync("c.module.css");
        for (const file of ["a", "b"]) {
          try {
            console.log(JSON.stringify((await import("./" + file + ".module.css?again")).default));
          } catch (e) {
            console.log(e.name + ": " + e.message);
          }
        }
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), "e.ts");
    expect({ stdout: normalizeBunSnapshot(stdout, dir), stderr, exitCode }).toEqual({
      stdout: `BuildMessage: ENOENT reading "<dir>/a.module.css"\n{"b":"b_Kd7Gww"}`,
      stderr: "",
      exitCode: 0,
    });
  });

  test("an invalid module as the entry point, a preload or a static import", async () => {
    using dir = tempDir("css-module-invalid-entry", {
      "a.module.css": `.a { color: red }\n..b { }\n`,
      "e.ts": `import styles from "./a.module.css";\nconsole.log(JSON.stringify(styles));`,
    });
    expect(
      await Promise.all([
        run(String(dir), "./a.module.css"),
        run(String(dir), "--preload", "./a.module.css", "e.ts"),
        run(String(dir), "e.ts"),
      ]),
    ).toEqual([
      { stdout: "", stderr: "", exitCode: 0 },
      { stdout: `{"a":"a_BLNoTg"}\n`, stderr: "", exitCode: 0 },
      { stdout: `{"a":"a_BLNoTg"}\n`, stderr: "", exitCode: 0 },
    ]);
  });

  test("a specifier that is not UTF-8 and does not resolve", async () => {
    const invalid = (before: string, after: string) =>
      Buffer.concat([Buffer.from(before), Buffer.from([0xff]), Buffer.from(after)]);
    using dir = tempDir("css-module-invalid-utf8", {
      "a.module.css": invalid(`.a { composes: b from "./b`, `.module.css" }`),
      "import.css": invalid(`@import "./b`, `.css";`),
      "url.css": invalid(`.a { background: url("./b`, `.png") }`),
      "e.ts": `import styles from "./a.module.css";\nconsole.log(JSON.stringify(styles));`,
    });
    const [runtime, ...bundler] = await Promise.all([
      run(String(dir), "e.ts"),
      run(String(dir), "build", "e.ts", "--outdir=out"),
      run(String(dir), "build", "import.css", "--outdir=out"),
      run(String(dir), "build", "url.css", "--outdir=out"),
    ]);
    expect(runtime).toEqual({ stdout: `{"a":"a_BLNoTg"}\n`, stderr: "", exitCode: 0 });
    expect(bundler.map(({ stderr, exitCode }) => [stderr.match(/^error: .*$/m)?.[0], exitCode])).toEqual([
      [`error: Could not resolve: "./b\uFFFD.module.css"`, 1],
      [`error: Could not resolve: "./b\uFFFD.css"`, 1],
      [`error: Could not resolve: "./b\uFFFD.png"`, 1],
    ]);
  });

  test("composes from an absolute path about as long as a path buffer", async () => {
    using dir = tempDir("css-module-long-composes", {
      "e.ts": `import styles from "./a.module.css";\nconsole.log(JSON.stringify(styles));`,
    });
    // Its parent directory exists, so the resolver goes on to try the name with each extension.
    const root = String(dir).replaceAll("\\", "/") + "/";
    const limit = isWindows ? 32767 * 3 + 1 : isLinux ? 4096 : 1024;
    const names: string[] = [];
    let css = "";
    for (let length = limit - 16; length <= limit + 4; length++) {
      names.push(`c${names.length}`);
      css += `.${names.at(-1)} { composes: x from "${root}${Buffer.alloc(length - root.length, "c")}" }\n`;
    }
    writeFileSync(join(String(dir), "a.module.css"), css);

    const [runtime, bundler] = await Promise.all([
      run(String(dir), "e.ts"),
      run(String(dir), "build", "e.ts", "--outdir=out"),
    ]);
    expect({ ...runtime, stdout: JSON.parse(runtime.stdout) }).toEqual({
      stdout: Object.fromEntries(names.map(name => [name, `${name}_BLNoTg`])),
      stderr: "",
      exitCode: 0,
    });
    expect(bundler.stderr.match(/^error: Could not resolve: /gm)).toHaveLength(names.length);
    expect(bundler.exitCode).toBe(1);
  });

  test("a plugin's path that is longer than a path buffer", async () => {
    using dir = tempDir("css-module-long-path", {
      "e.ts": `
        const repeat = text => Buffer.alloc(100_000 * text.length, text).toString();
        const paths = {
          "long:name": "/" + repeat("a") + "/x.module.css",
          "long:directories": repeat("/a") + "/x.module.css",
          "long:parents": repeat("/..") + "/x.module.css",
          "long:relative": repeat("a/") + "x.module.css",
        };
        Bun.plugin({
          name: "long paths",
          setup(build) {
            build.onResolve({ filter: /^long:/ }, ({ path }) => ({ path: paths[path] }));
            build.onLoad({ filter: /x\\.module\\.css$/ }, () => ({
              contents: ".a { color: red } .b { composes: a }",
              loader: "css",
            }));
          },
        });
        for (const specifier in paths) console.log(specifier, JSON.stringify((await import(specifier)).default));
      `,
    });
    expect(await run(String(dir), "e.ts")).toEqual({
      stdout: [
        `long:name {"a":"a_jsfsgw","b":"a_jsfsgw b_jsfsgw"}`,
        `long:directories {"a":"a_eK6HIw","b":"a_eK6HIw b_eK6HIw"}`,
        `long:parents {"a":"a_3vXDBw","b":"a_3vXDBw b_3vXDBw"}`,
        `long:relative {"a":"a_v5UDKQ","b":"a_v5UDKQ b_v5UDKQ"}`,
        "",
      ].join("\n"),
      stderr: "",
      exitCode: 0,
    });
  });

  test("what the resolver logs while it follows composes is not printed", async () => {
    using dir = tempDir("css-module-resolver-log", {
      "a.module.css": `.a { composes: b from "cut-short/b.module.css" }`,
      "node_modules/cut-short/package.json": `{ "name": "cut-short",`,
      "node_modules/cut-short/b.module.css": `.b { color: red }`,
      "e.ts": `import styles from "./a.module.css";\nconsole.log(JSON.stringify(styles));`,
    });
    expect(await run(String(dir), "e.ts")).toEqual({
      stdout: `{"a":"b_ua79Dw a_BLNoTg"}\n`,
      stderr: "",
      exitCode: 0,
    });
  });

  test("nested rules, required with little stack left", async () => {
    using dir = tempDir("css-module-little-stack", {
      "a.module.css": Buffer.alloc(150 * 3, ".a{").toString() + Buffer.alloc(150, "}").toString(),
      // On the main thread, JavaScript runs out of stack long before native code does.
      "e.cjs": `new Worker(require.resolve("./worker.cjs"));`,
      "worker.cjs": `
        let styles;
        let frames = 0;
        let next = 128;
        // Overflows the stack, then tries from ever higher frames on the way back up.
        (function dive() {
          try {
            dive();
          } catch {}
          if (styles || ++frames < next) return;
          next *= 2;
          try {
            // A require() that overflows can leave an empty module in require.cache: a new specifier each time.
            styles = require("./a.module.css?" + frames);
          } catch (e) {
            if (!(e instanceof RangeError)) throw e;
          }
        })();
        console.log(JSON.stringify(styles ?? require("./a.module.css")));
      `,
    });
    expect(await run(String(dir), "e.cjs")).toEqual({ stdout: `{"a":"a_BLNoTg"}\n`, stderr: "", exitCode: 0 });
  });

  test("what the bundler only warns about does not throw", async () => {
    using dir = tempDir("css-module-warnings", {
      "parity.ts": parity,
      "entry.ts": `export { default } from "./a.module.css";`,
      "a.module.css": `.a { colr: red; color: notacolor } .b { composes: a }`,
    });
    expect(await runtimeAndBundled(String(dir))).toEqual({ default: { a: "a_BLNoTg", b: "a_BLNoTg b_BLNoTg" } });
  });

  test("bun test --isolate", async () => {
    const file = `
      import { expect, test } from "bun:test";
      import styles from "./a.module.css";
      test("styles", () => {
        expect(styles).toEqual({ title: "title_BLNoTg" });
      });
    `;
    using dir = tempDir("css-module-isolate", {
      "a.module.css": `.title { color: red }`,
      "one.test.ts": file,
      "two.test.ts": file,
    });
    const { stderr, exitCode } = await run(String(dir), "test", "--isolate");
    expect(stderr).toContain(" 2 pass\n 0 fail\n");
    expect(exitCode).toBe(0);
  });

  // Each file is seen half written before it is seen complete. Each text is longer than the one it replaces:
  // writeFileSync() writes, then cuts off what is left of the old text, and kqueue does not report the cut.
  const rewrites = {
    "the module": [
      ["a.module.css", `.c { color: red; background: blue; margin: 0 } .`, `{"c":"c_BLNoTg"}`],
      [
        "a.module.css",
        `.c { color: red; background: blue; margin: 0 } .z { color: red }`,
        `{"c":"c_BLNoTg","z":"z_BLNoTg"}`,
      ],
    ],
    "a file it composes from": [
      ["b.module.css", `.w { color: red; background: blue; margin: 0 } .`, `{"a":"a_BLNoTg"}`],
      ["b.module.css", `.w { color: red; background: blue; margin: 0 } .x { color: red }`, `{"a":"x_Kd7Gww a_BLNoTg"}`],
    ],
  };
  const reloadTimeout = 30_000;
  test.each([
    ["--hot", "the module"],
    ["--hot", "a file it composes from"],
    ["--watch", "the module"],
    ["--watch", "a file it composes from"],
  ] as const)(
    "%s reloads when %s changes",
    async (flag, which) => {
      using dir = tempDir("css-module-reload", {
        "a.module.css": `.a { composes: x from "./b.module.css" }`,
        "b.module.css": `.x { composes: y } .y { color: red }`,
        "e.ts": `
          // Until the other end of stdin is closed: a test that times out never gets to kill this process.
          globalThis.keepAlive ??= Bun.stdin.text().then(() => process.exit());
          const { default: styles } = await import("./a.module.css");
          console.log(JSON.stringify(styles));
        `,
      });
      // Not in the directory that is watched: every line written to it would be an event.
      using traceDir = tempDir("css-module-reload-trace", {});
      const trace = join(String(traceDir), "events.jsonl");
      await using proc = Bun.spawn({
        cmd: [bunExe(), flag, "e.ts"],
        env: { ...bunEnv, BUN_WATCHER_TRACE: trace },
        cwd: String(dir),
        stdin: "pipe",
        stdout: "pipe",
        stderr: "inherit",
      });
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      let output = "";
      let waitingFor = "";

      // The runner's timeout does not say what was seen. This one, a little earlier, does.
      const stuck = Promise.withResolvers<never>();
      const watchdog = setTimeout(() => {
        stuck.reject(
          new Error(
            `${flag} did not print ${waitingFor}\n` +
              `stdout: ${JSON.stringify(output)}\n` +
              `watcher events: ${existsSync(trace) ? readFileSync(trace, "utf8") : "none"}`,
          ),
        );
      }, reloadTimeout - 5_000);
      using _ = { [Symbol.dispose]: () => clearTimeout(watchdog) };

      // One write can cause several reloads: what is printed before the line does not matter.
      async function line(expected: string, after: string) {
        waitingFor = `${expected} after ${after}`;
        while (!output.split("\n").slice(0, -1).includes(expected)) {
          const { value, done } = await Promise.race([reader.read(), stuck.promise]);
          if (done) break;
          output += decoder.decode(value, { stream: true });
        }
        expect(output.split("\n")).toContain(expected);
      }

      await line(`{"a":"y_Kd7Gww x_Kd7Gww a_BLNoTg"}`, "it was started");
      for (const [file, contents, expected] of rewrites[which]) {
        writeFileSync(join(String(dir), file), contents);
        await line(expected, `${file} became ${JSON.stringify(contents)}`);
      }
    },
    reloadTimeout,
  );
});

// Not concurrent with the tests above: nearly all of its time is spent parsing.
test("css module: a composes chain too deep for the stack is an error", async () => {
  using dir = tempDir("css-module-deep", {
    // A worker's stack is smaller than the main thread's, so less has to be parsed.
    "e.ts": `new Worker(new URL("./worker.ts", import.meta.url).href);`,
    // How deep is too deep depends on the platform and the build, so the chain
    // doubles until it is. It is in a file of its own so that it is followed
    // once, not once per class.
    "worker.ts": `
      const steps = [];
      for (let depth = 1000; depth < 400_000 && typeof steps.at(-1)?.[1] !== "string"; depth *= 2) {
        const rules = [];
        for (let i = 0; i < depth; i++) rules.push(".c" + i + "{composes:c" + (i + 1) + "}");
        rules.push(".c" + depth + "{}");
        await Bun.write("chain-" + depth + ".module.css", rules.join("\\n"));
        await Bun.write("a-" + depth + ".module.css", '.a { composes: c0 from "./chain-' + depth + '.module.css" }');
        try {
          const { a } = await import("./a-" + depth + ".module.css");
          steps.push([depth, a.split(" ").length]);
        } catch (e) {
          steps.push([depth, e.name + ": " + e.message]);
        }
      }
      process.stdout.write(JSON.stringify(steps));
    `,
  });
  const { stdout, stderr, exitCode } = await run(String(dir), "e.ts");
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const steps: [depth: number, names: number | string][] = JSON.parse(stdout);
  expect(steps.length).toBeGreaterThan(1);
  expect(steps).toEqual([
    // `.a`, and `.c0` to `.c<depth>`.
    ...steps.slice(0, -1).map(([depth]) => [depth, depth + 2]),
    [steps.at(-1)![0], "RangeError: Maximum call stack size exceeded."],
  ]);
});
