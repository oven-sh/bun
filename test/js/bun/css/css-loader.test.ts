import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { writeFileSync } from "node:fs";
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

  test("import() and require() throw what the bundler logs", async () => {
    const neverAppears = (name: string, file: string) =>
      `The name "${name}" never appears in "${file}" as a CSS modules locally scoped class name. Note that "composes" only works with single class selectors.`;
    const invalidSelector = {
      name: "BuildMessage",
      message: "Invalid selector. Expected identifier after '.' in class selector, found: .",
      at: "syntax.module.css:2:2",
    };
    const cases = {
      "syntax.module.css": { css: `.a { color: red }\n..b { }\n`, error: invalidSelector },
      "composes-syntax.module.css": { css: `.a { composes: a from "./syntax.module.css" }`, error: invalidSelector },
      "missing-local.module.css": {
        css: `.a { composes: nope }`,
        error: {
          name: "BuildMessage",
          message: neverAppears("nope", "missing-local.module.css"),
          at: "missing-local.module.css:1:15",
        },
      },
      "missing-imported.module.css": {
        css: `.a { composes: nope from "./ok.module.css" }`,
        error: {
          name: "BuildMessage",
          message: neverAppears("nope", "ok.module.css"),
          at: "missing-imported.module.css:1:15",
        },
      },
      "not-a-module.module.css": {
        css: `.a { composes: x from "./plain.css" }`,
        error: { name: "BuildMessage", message: neverAppears("x", "plain.css"), at: "not-a-module.module.css:1:15" },
      },
      "missing-in-composed.module.css": {
        css: `.a { composes: a from "./missing-local.module.css" }`,
        error: {
          name: "BuildMessage",
          message: neverAppears("nope", "missing-local.module.css"),
          at: "missing-local.module.css:1:15",
        },
      },
      "missing-file.module.css": {
        css: `.a { composes: x from "./nofile.module.css" }`,
        error: {
          name: "ResolveMessage",
          message: `Could not resolve: "./nofile.module.css"`,
          at: "missing-file.module.css:1:22",
        },
      },
      "missing-package.module.css": {
        css: `.a { composes: x from "nopkg/x.module.css" }`,
        error: {
          name: "ResolveMessage",
          message: `Could not resolve: "nopkg/x.module.css". Maybe you need to "bun install"?`,
          at: "missing-package.module.css:1:22",
        },
      },
      "not-css.module.css": {
        css: `.a { composes: x from "./script.js" }`,
        error: {
          name: "BuildMessage",
          message: `Cannot use the "composes" property with the "script.js" file (it is not a CSS file)`,
          at: "not-css.module.css:1:15",
        },
      },
      "id-only.module.css": {
        css: `#x { color: red }\n.a { composes: x }`,
        error: {
          name: "BuildMessage",
          message: `The composes property cannot be used with "x", because it is not a single class name.`,
          at: "id-only.module.css:2:15",
        },
      },
      "two.module.css": {
        css: `.a { composes: n1 n2 }`,
        error: [
          { name: "BuildMessage", message: neverAppears("n1", "two.module.css"), at: "two.module.css:1:15" },
          { name: "BuildMessage", message: neverAppears("n2", "two.module.css"), at: "two.module.css:1:15" },
        ],
      },
    };
    using dir = tempDir("css-module-errors", {
      ...Object.fromEntries(Object.entries(cases).map(([file, { css }]) => [file, css])),
      "ok.module.css": `.title { color: red }`,
      "plain.css": `.x { color: red }`,
      "script.js": `export {};`,
      "errors.ts": `
        import { basename } from "node:path";
        const show = e =>
          e.errors?.map(show) ?? {
            name: e.name,
            message: e.message,
            at: basename(e.position.file) + ":" + e.position.line + ":" + e.position.column,
          };
        const results = {};
        for (const file of process.argv.slice(2)) {
          const result = (results[file] = {});
          try {
            result.import = await import("./" + file);
          } catch (e) {
            result.import = show(e);
          }
          try {
            result.require = require("./" + file);
          } catch (e) {
            result.require = show(e);
          }
          const { logs } = await Bun.build({ entrypoints: ["./" + file], throw: false });
          result.bundler = logs.map(log => log.message);
        }
        process.stdout.write(JSON.stringify(results));
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), "errors.ts", ...Object.keys(cases));
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const results = JSON.parse(stdout);
    for (const [file, { error }] of Object.entries(cases)) {
      expect({ file, ...results[file] }).toEqual({
        file,
        import: error,
        require: error,
        bundler: expect.arrayContaining([error].flat().map(({ message }) => message)),
      });
    }
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
            await import("./" + file + ".module.css?again");
          } catch (e) {
            console.log(e.name + ": " + e.message);
          }
        }
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), "e.ts");
    expect({ stdout: normalizeBunSnapshot(stdout, dir), stderr, exitCode }).toEqual({
      stdout: `BuildMessage: ENOENT reading "<dir>/a.module.css"\nBuildMessage: ENOENT reading "<dir>/c.module.css"`,
      stderr: "",
      exitCode: 0,
    });
  });

  test("an uncaught error shows the line of the CSS file", async () => {
    using dir = tempDir("css-module-uncaught", {
      "a.module.css": `.a { color: red }\n..b { }\n`,
      "e.ts": `import "./a.module.css";`,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), "e.ts");
    expect(normalizeBunSnapshot(stderr, dir)).toMatchInlineSnapshot(`
      "2 | ..b { }
           ^
      error: Invalid selector. Expected identifier after '.' in class selector, found: .
          at <dir>/a.module.css:2:2

      Bun v<bun-version>"
    `);
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
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

  test.each(["--hot", "--watch"])("%s reloads when the module or a file it composes from changes", async flag => {
    using dir = tempDir("css-module-reload", {
      "a.module.css": `.a { composes: x from "./b.module.css" }`,
      "b.module.css": `.x { composes: y } .y { color: red }`,
      "e.ts": `
        import styles from "./a.module.css";
        console.log(JSON.stringify(styles));
        globalThis.keepAlive ??= setInterval(() => {}, 1 << 30);
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), flag, "e.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "inherit",
    });
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let output = "";
    async function nextLine() {
      while (!output.includes("\n")) {
        const { value, done } = await reader.read();
        if (done) throw new Error(`stdout closed after ${JSON.stringify(output)}`);
        output += decoder.decode(value, { stream: true });
      }
      const line = output.slice(0, output.indexOf("\n"));
      output = output.slice(line.length + 1);
      return line;
    }

    expect(await nextLine()).toBe(`{"a":"y_Kd7Gww x_Kd7Gww a_BLNoTg"}`);
    writeFileSync(join(String(dir), "b.module.css"), `.x { color: red }`);
    expect(await nextLine()).toBe(`{"a":"x_Kd7Gww a_BLNoTg"}`);
    writeFileSync(join(String(dir), "a.module.css"), `.a { color: red } .z { color: red }`);
    expect(await nextLine()).toBe(`{"a":"a_BLNoTg","z":"z_BLNoTg"}`);
  });
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
    [steps.at(-1)![0], `BuildMessage: Maximum "composes" depth exceeded`],
  ]);
});
