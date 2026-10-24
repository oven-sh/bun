import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { join, relative } from "node:path";
import { itBundled } from "../expectBundled";

describe("css", () => {
  itBundled("css-module/GlobalPseudoFunction", {
    files: {
      "index.module.css": /* css */ `
      :global(.foo) {
        color: red;
      }
      `,
    },
    outdir: "/out",
    entryPoints: ["/index.module.css"],
    onAfterBundle(api) {
      api.expectFile("/out/index.module.css").toEqualIgnoringWhitespace(`
      /* index.module.css */
      .foo {
        color: red;
      }
      `);
    },
  });

  itBundled("css-module/BundleTwoFilesWithoutCodeSplitting", {
    files: {
      "/foo-entry.js": `
        import styles from './common.module.css'
        console.log(styles)
      `,
      "/bar-entry.js": `
        import styles from './common.module.css'
        console.log(styles)
      `,
      "/common.module.css": `.baz { color: red }`,
    },
    entryPoints: ["/foo-entry.js", "/bar-entry.js"],
    outdir: "/out",

    onAfterBundle(api) {
      api.expectFile("/out/foo-entry.js").toMatchInlineSnapshot(`
        "// common.module.css
        var common_module_default = {
          baz: "baz_I7o34g"
        };

        // foo-entry.js
        console.log(common_module_default);
        "
      `);
      api.expectFile("/out/bar-entry.js").toMatchInlineSnapshot(`
        "// common.module.css
        var common_module_default = {
          baz: "baz_I7o34g"
        };

        // bar-entry.js
        console.log(common_module_default);
        "
      `);
    },
  });

  itBundled("css-module/BundleTwoFilesWithCodeSplitting", {
    files: {
      "/foo-entry.js": `
        import styles from './common.module.css'
        console.log(styles)
      `,
      "/bar-entry.js": `
        import styles from './common.module.css'
        console.log(styles)
      `,
      "/common.module.css": `.baz { color: red }`,
    },
    entryPoints: ["/foo-entry.js", "/bar-entry.js"],
    splitting: true,
    outdir: "/out",

    onAfterBundle(api) {
      api.expectFile("/out/foo-entry.js").toMatchInlineSnapshot(`
        "// common.module.css
        var common_module_default = {
          baz: "baz_I7o34g"
        };

        // foo-entry.js
        console.log(common_module_default);
        "
      `);
      api.expectFile("/out/bar-entry.js").toMatchInlineSnapshot(`
        "// common.module.css
        var common_module_default = {
          baz: "baz_I7o34g"
        };

        // bar-entry.js
        console.log(common_module_default);
        "
      `);
    },
  });

  // https://github.com/oven-sh/bun/issues/18921
  // The `animation` shorthand and `animation-name` longhand must scope their
  // referenced `@keyframes` name to the SAME hashed name the keyframes rule
  // receives, otherwise the animation is broken.
  itBundled("css-module/AnimationNameScopedToKeyframes", {
    files: {
      "/entry.js": `
        import styles from './styles.module.css';
        console.log(styles.playAnim, styles.spin);
      `,
      "/styles.module.css": `
        .playAnim { animation: anim forwards ease-out 0.25s; }
        .spin { animation-name: rotate; }
        .quoted { animation-name: "anim"; }
        @keyframes anim { from { opacity: 0 } to { opacity: 1 } }
        @keyframes rotate { to { transform: rotate(360deg) } }
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    onAfterBundle(api) {
      const css = api.readFile("/out/entry.css");

      // Each @keyframes name is scoped (e.g. `anim_<hash>`), not left bare.
      const animKeyframes = css.match(/@keyframes\s+(anim_[A-Za-z0-9_-]+)\s*\{/);
      const rotateKeyframes = css.match(/@keyframes\s+(rotate_[A-Za-z0-9_-]+)\s*\{/);
      expect(animKeyframes, "@keyframes anim should be scoped").not.toBeNull();
      expect(rotateKeyframes, "@keyframes rotate should be scoped").not.toBeNull();

      // The `animation` shorthand references the SAME scoped keyframes name.
      const animShorthand = css.match(/animation:\s*([^;]+);/);
      expect(animShorthand, "animation shorthand should be present").not.toBeNull();
      expect(animShorthand![1]).toContain(animKeyframes![1]);

      // The `animation-name` longhand references the SAME scoped keyframes name.
      expect(css).toContain(`animation-name: ${rotateKeyframes![1]}`);

      // The quoted-string form scopes to the same hash as the ident form.
      expect(css).toContain(`animation-name: ${animKeyframes![1]}`);

      // The bare (unscoped) names must not survive as animation references.
      expect(css).not.toMatch(/animation:[^;]*\banim\b/);
      expect(css).not.toMatch(/animation-name:\s*rotate\b/);
    },
  });

  // The parser dedupes repeated class/id names through a borrowed lookup
  // (`add_symbol_for_name`); many references to the same names must all map
  // to a single hashed symbol each.
  itBundled("css-module/RepeatedClassAndIdReferences", {
    files: {
      "/entry.js": `
        import styles from './styles.module.css';
        console.log(JSON.stringify(styles));
      `,
      "/styles.module.css":
        Array.from({ length: 64 }, (_, i) => `.btn { z-index: ${i} }`).join("\n") +
        "\n#hero { color: red }\n" +
        Array.from({ length: 32 }, () => `#hero .btn { color: blue }`).join("\n"),
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    onAfterBundle(api) {
      const js = api.readFile("/out/entry.js");
      const css = api.readFile("/out/entry.css");

      const btn = js.match(/btn:\s*"(btn_[A-Za-z0-9_-]+)"/);
      const hero = js.match(/hero:\s*"(hero_[A-Za-z0-9_-]+)"/);
      expect(btn).not.toBeNull();
      expect(hero).not.toBeNull();

      // Every `.btn` / `#hero` occurrence shares the same hashed name.
      const btnHashes = new Set([...css.matchAll(/\.btn_[A-Za-z0-9_-]+/g)].map(m => m[0]));
      const heroHashes = new Set([...css.matchAll(/#hero_[A-Za-z0-9_-]+/g)].map(m => m[0]));
      expect([...btnHashes]).toEqual([`.${btn![1]}`]);
      expect([...heroHashes]).toEqual([`#${hero![1]}`]);
      expect(css).not.toMatch(/\.btn\b[^_]/);
      expect(css).not.toMatch(/#hero\b[^_]/);
    },
  });

  // The name inside `::view-transition-group(name)` (and `-old`, `-new`,
  // `-image-pair`) is a custom ident. It must get the same module hash as the
  // `view-transition-name` / `view-transition-class` / `view-transition-group`
  // declarations, otherwise the selectors never match the elements.
  itBundled("css-module/ViewTransitionNamesScoped", {
    files: {
      "/entry.js": `
        import styles from './styles.module.css';
        console.log(styles.card);
      `,
      "/styles.module.css": `
        .card {
          view-transition-name: hero;
          view-transition-class: slide;
          view-transition-group: hero;
        }
        .page {
          view-transition-name: none;
          view-transition-class: none;
          view-transition-group: nearest;
        }
        ::view-transition-group(hero) { animation-duration: 1s }
        ::view-transition-image-pair(hero) { isolation: auto }
        ::view-transition-old(.slide) { opacity: 0 }
        ::view-transition-new(.slide) { opacity: 1 }
        ::view-transition-group(*) { animation-timing-function: linear }
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    onAfterBundle(api) {
      const css = api.readFile("/out/entry.css");
      const card = css.match(/\.card_([A-Za-z0-9_-]+)\s*\{/);
      expect(card, ".card should be scoped").not.toBeNull();
      const hash = card![1];

      expect(css).toEqualIgnoringWhitespace(`
        /* styles.module.css */
        .card_${hash} {
          view-transition-name: hero_${hash};
          view-transition-class: slide_${hash};
          view-transition-group: hero_${hash};
        }

        .page_${hash} {
          view-transition-name: none;
          view-transition-class: none;
          view-transition-group: nearest;
        }

        ::view-transition-group(hero_${hash}) {
          animation-duration: 1s;
        }

        ::view-transition-image-pair(hero_${hash}) {
          isolation: auto;
        }

        ::view-transition-old(.slide_${hash}) {
          opacity: 0;
        }

        ::view-transition-new(.slide_${hash}) {
          opacity: 1;
        }

        ::view-transition-group(*) {
          animation-timing-function: linear;
        }
      `);
    },
  });

  // A class used only inside a `::view-transition-*(.class)` selector is
  // hashed in the CSS, so it must also be in the exports object. Otherwise
  // JS cannot set `view-transition-class` to the hashed name.
  // https://github.com/oven-sh/bun/issues/42726
  itBundled("css-module/ViewTransitionClassExported", {
    files: {
      "/entry.js": `
        import styles from './styles.module.css';
        console.log(styles);
      `,
      "/styles.module.css": `
        ::view-transition-group(.overlay) { z-index: 100 }
        ::view-transition-image-pair(.pair) { isolation: auto }
        ::view-transition-old(.slide-out) { opacity: 0 }
        ::view-transition-new(.slide-in) { opacity: 1 }
        ::view-transition-group(hero) { animation-duration: 1s }
        .plain { color: red }
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    onAfterBundle(api) {
      const css = api.readFile("/out/entry.css");
      const plain = css.match(/\.plain_([A-Za-z0-9_-]+)\s*\{/);
      expect(plain, ".plain should be scoped").not.toBeNull();
      const hash = plain![1];

      expect(css).toEqualIgnoringWhitespace(`
        /* styles.module.css */
        ::view-transition-group(.overlay_${hash}) {
          z-index: 100;
        }

        ::view-transition-image-pair(.pair_${hash}) {
          isolation: auto;
        }

        ::view-transition-old(.slide-out_${hash}) {
          opacity: 0;
        }

        ::view-transition-new(.slide-in_${hash}) {
          opacity: 1;
        }

        ::view-transition-group(hero_${hash}) {
          animation-duration: 1s;
        }

        .plain_${hash} {
          color: red;
        }
      `);

      const js = api.readFile("/out/entry.js");
      expect(js).toEqualIgnoringWhitespace(`
        // styles.module.css
        var styles_module_default = {
          overlay: "overlay_${hash}",
          pair: "pair_${hash}",
          "slide-out": "slide-out_${hash}",
          "slide-in": "slide-in_${hash}",
          plain: "plain_${hash}"
        };

        // entry.js
        console.log(styles_module_default);
      `);
    },
  });

  // css-view-transitions-2 lets the argument combine a name (or `*`) with
  // classes, and chain classes. Every class is hashed and exported, the same
  // as the single `.class` form. The name is hashed like `view-transition-name`.
  itBundled("css-module/ViewTransitionNameAndClassesExported", {
    files: {
      "/entry.js": `
        import styles from './styles.module.css';
        console.log(styles);
      `,
      "/styles.module.css": `
        ::view-transition-group(hero.big) { top: 0 }
        ::view-transition-old(*.fade) { opacity: 0 }
        ::view-transition-new(.a.b) { opacity: 1 }
        ::view-transition-image-pair(photo.wide.tall) { isolation: auto }
        ::view-transition-group-children(hero.big.slow) { overflow: clip }
        .card { view-transition-name: hero; view-transition-class: big fade }
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    onAfterBundle(api) {
      const css = api.readFile("/out/entry.css");
      const card = css.match(/\.card_([A-Za-z0-9_-]+)\s*\{/);
      expect(card, ".card should be scoped").not.toBeNull();
      const hash = card![1];

      expect(css).toEqualIgnoringWhitespace(`
        /* styles.module.css */
        ::view-transition-group(hero_${hash}.big_${hash}) {
          top: 0;
        }

        ::view-transition-old(*.fade_${hash}) {
          opacity: 0;
        }

        ::view-transition-new(.a_${hash}.b_${hash}) {
          opacity: 1;
        }

        ::view-transition-image-pair(photo_${hash}.wide_${hash}.tall_${hash}) {
          isolation: auto;
        }

        ::view-transition-group-children(hero_${hash}.big_${hash}.slow_${hash}) {
          overflow: clip;
        }

        .card_${hash} {
          view-transition-name: hero_${hash};
          view-transition-class: big_${hash} fade_${hash};
        }
      `);

      const js = api.readFile("/out/entry.js");
      expect(js).toEqualIgnoringWhitespace(`
        // styles.module.css
        var styles_module_default = {
          big: "big_${hash}",
          fade: "fade_${hash}",
          a: "a_${hash}",
          b: "b_${hash}",
          wide: "wide_${hash}",
          tall: "tall_${hash}",
          slow: "slow_${hash}",
          card: "card_${hash}"
        };

        // entry.js
        console.log(styles_module_default);
      `);
    },
  });

  // `::view-transition-group-children()` (css-view-transitions-2) takes the
  // same argument as `::view-transition-group()`. The name and the class get
  // the module hash, the class is exported, and there is no warning.
  // https://github.com/oven-sh/bun/issues/42777
  itBundled("css-module/ViewTransitionGroupChildrenScoped", {
    files: {
      "/entry.js": `
        import styles from './styles.module.css';
        console.log(styles);
      `,
      "/styles.module.css": `
        .card {
          view-transition-name: hero;
          view-transition-class: big;
          view-transition-group: contain;
        }
        ::view-transition-group(hero) { animation-duration: 1s }
        ::view-transition-group-children(hero) { overflow: clip }
        ::view-transition-group-children(.big) { overflow: clip }
        ::view-transition-group-children(*):only-child { overflow: visible }
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    onAfterBundle(api) {
      const css = api.readFile("/out/entry.css");
      const card = css.match(/\.card_([A-Za-z0-9_-]+)\s*\{/);
      expect(card, ".card should be scoped").not.toBeNull();
      const hash = card![1];

      expect(css).toEqualIgnoringWhitespace(`
        /* styles.module.css */
        .card_${hash} {
          view-transition-name: hero_${hash};
          view-transition-class: big_${hash};
          view-transition-group: contain;
        }

        ::view-transition-group(hero_${hash}) {
          animation-duration: 1s;
        }

        ::view-transition-group-children(hero_${hash}) {
          overflow: clip;
        }

        ::view-transition-group-children(.big_${hash}) {
          overflow: clip;
        }

        ::view-transition-group-children(*):only-child {
          overflow: visible;
        }
      `);

      const js = api.readFile("/out/entry.js");
      expect(js).toEqualIgnoringWhitespace(`
        // styles.module.css
        var styles_module_default = {
          card: "card_${hash}",
          big: "big_${hash}"
        };

        // entry.js
        console.log(styles_module_default);
      `);
    },
  });

  // A module file in a nested directory: the `view-transition-class`
  // declaration, the `::view-transition-*(.class)` selector and the exported
  // value must all carry the same hash.
  itBundled("css-module/ViewTransitionClassNestedDirectory", {
    files: {
      "/entry.js": `
        import styles from './src/deep/styles.module.css';
        console.log(styles);
      `,
      "/src/deep/styles.module.css": `
        .card {
          view-transition-class: slide;
          animation-name: spin;
        }
        @keyframes spin { to { opacity: 0 } }
        ::view-transition-old(.slide) { opacity: 0 }
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    onAfterBundle(api) {
      const css = api.readFile("/out/entry.css");
      const card = css.match(/\.card_([A-Za-z0-9_-]+)\s*\{/);
      expect(card, ".card should be scoped").not.toBeNull();
      const hash = card![1];

      expect(css).toEqualIgnoringWhitespace(`
        /* src/deep/styles.module.css */
        .card_${hash} {
          view-transition-class: slide_${hash};
          animation-name: spin_${hash};
        }

        @keyframes spin_${hash} {
          to {
            opacity: 0;
          }
        }

        ::view-transition-old(.slide_${hash}) {
          opacity: 0;
        }
      `);

      const js = api.readFile("/out/entry.js");
      expect(js).toEqualIgnoringWhitespace(`
        // src/deep/styles.module.css
        var styles_module_default = {
          card: "card_${hash}",
          slide: "slide_${hash}"
        };

        // entry.js
        console.log(styles_module_default);
      `);
    },
  });

  // Values the grammar rejects stay untouched, so a future keyword or a
  // var() reference is not hashed as if it were a name.
  itBundled("css-module/ViewTransitionUnparsedValuesNotScoped", {
    files: {
      "/entry.js": `
        import styles from './styles.module.css';
        console.log(styles.card);
      `,
      "/styles.module.css": `
        .card {
          view-transition-name: var(--name);
          view-transition-class: slide none;
          view-transition-group: 1px;
        }
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    onAfterBundle(api) {
      const css = api.readFile("/out/entry.css");
      expect(css).toContain("view-transition-name: var(--name);");
      expect(css).toContain("view-transition-class: slide none;");
      expect(css).toContain("view-transition-group: 1px;");
    },
  });

  itBundled("css-module/ExportsMapMultipleClassesAndComposes", {
    files: {
      "/entry.js": `
        import styles from './styles.module.css';
        console.log(styles.alpha, styles.betaGamma);
      `,
      "/styles.module.css": `
        .alpha { color: red; }
        .betaGamma { composes: alpha; color: blue; }
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    onAfterBundle(api) {
      const js = api.readFile("/out/entry.js");

      const alpha = js.match(/alpha:\s*"(alpha_[A-Za-z0-9_-]+)"/);
      expect(alpha).not.toBeNull();
      // `composes: alpha` => betaGamma's export contains both hashed names.
      const beta = js.match(/betaGamma:\s*"([^"]+)"/);
      expect(beta).not.toBeNull();
      expect(beta![1]).toContain("betaGamma_");
      expect(beta![1]).toContain(alpha![1]);

      // Printed CSS must use the same hashed names as the exports map.
      const css = api.readFile("/out/entry.css");
      expect(css).toContain(`.${alpha![1]}`);
      const betaOwn = beta![1].split(" ").find(name => name.startsWith("betaGamma_"))!;
      expect(css).toContain(`.${betaOwn}`);
    },
  });
});

// `bun build --no-bundle` prints a module file with no link step. Class
// symbols have no final name there, so the printer hashes the original name
// like it does for keyframes.
test("css-module/NoBundleHashesClassSymbols", async () => {
  using dir = tempDir("css-module-no-bundle", {
    "styles.module.css": `
      .card { view-transition-class: slide; animation-name: spin }
      @keyframes spin { to { opacity: 0 } }
      ::view-transition-old(.slide) { opacity: 0 }
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--no-bundle", "styles.module.css"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const card = stdout.match(/\.card_([A-Za-z0-9_-]+)\s*\{/);
  expect(card, ".card should be scoped").not.toBeNull();
  const hash = card![1];
  expect(stdout).toEqualIgnoringWhitespace(`
    .card_${hash} {
      view-transition-class: slide_${hash};
      animation-name: spin_${hash};
    }

    @keyframes spin_${hash} {
      to {
        opacity: 0;
      }
    }

    ::view-transition-old(.slide_${hash}) {
      opacity: 0;
    }
  `);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

// The hash comes from the path relative to the project root, as in a bundled
// build, so two module files with the same basename get different names.
test("css-module/NoBundleHashesByRelativePath", async () => {
  using dir = tempDir("css-module-no-bundle-nested", {
    "a/styles.module.css": `.card { color: red }`,
    "b/styles.module.css": `.card { color: blue }`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--no-bundle", "a/styles.module.css", "b/styles.module.css", "--outdir", "out"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  const a = await Bun.file(`${dir}/out/a/styles.module.css`).text();
  const b = await Bun.file(`${dir}/out/b/styles.module.css`).text();
  const hashA = a.match(/\.card_([A-Za-z0-9_-]+)\s*\{/)?.[1];
  const hashB = b.match(/\.card_([A-Za-z0-9_-]+)\s*\{/)?.[1];
  expect(hashA).toBeDefined();
  expect(hashB).toBeDefined();
  expect(hashA).not.toBe(hashB);
});

test("a resolve error in CSS covers the whole url() and composes path", async () => {
  using dir = tempDir("css-resolve-error-range", {
    "a.module.css": [
      "@font-face { src: url('/fonts/missing.woff2') format('woff2'); }",
      '.a { background: url("./missing.png"); }',
      ".b { composes: x from   './missing.css'; }",
    ].join("\n"),
  });
  const result = await Bun.build({ entrypoints: [join(String(dir), "a.module.css")], throw: false });

  // `column` is 1-based.
  const ranges = result.logs.map(({ position }) =>
    position!.lineText.slice(position!.column - 1, position!.column - 1 + position!.length),
  );
  expect(ranges).toEqual([`url('/fonts/missing.woff2')`, `url("./missing.png")`, `'./missing.css'`]);
});

// A warning of the CSS parser says where it is, as an error of the same sheet
// does: the file, the 1-based line, the column and the text of the line.
describe.concurrent("css parser warning positions", () => {
  // The `.notes` getter is not declared in bun-types yet.
  type Log = BuildMessage & { notes?: BuildMessage[] };

  function positionIn(dir: string, log: Log) {
    const { file, namespace, line, column, lineText } = log.position!;
    return { file: relative(dir, file), namespace, line, column, lineText };
  }

  async function buildLogs(name: string, sheet: string) {
    using dir = tempDir("css-warning-position", { [name]: sheet });
    const result = await Bun.build({ entrypoints: [join(String(dir), name)], throw: false });
    return (result.logs as Log[]).map(log => ({
      level: log.level,
      message: log.message,
      ...positionIn(String(dir), log),
      notes: (log.notes ?? []).map(note => ({ message: note.message, ...positionIn(String(dir), note) })),
    }));
  }

  const unknownAtRule = (name: string, line: number, lineText = "@unknown-rule x;", column = 14) => ({
    level: "warn",
    message: "invalid @ rule encountered: '@unknown-rule'",
    file: name,
    namespace: "file",
    line,
    column,
    lineText,
    notes: [],
  });

  test("each kind of warning, and the note, in a CSS module", async () => {
    const sheet = [
      /*  1 */ "@unknownrule foo;",
      /*  2 */ ".base { color: red; }",
      /*  3 */ ".outer {",
      /*  4 */ "  .inner {",
      /*  5 */ "    composes: base;",
      /*  6 */ "  }",
      /*  7 */ "}",
      /*  8 */ ".a .b {",
      /*  9 */ "  color: blue;",
      /* 10 */ "  composes: base;",
      /* 11 */ "}",
      /* 12 */ ".c::custom-thing { color: green; }",
      /* 13 */ ".d:_internal { color: green; }",
      /* 14 */ ".e::custom-fn(x) { color: green; }",
      /* 15 */ ".f:custom-fn(x) { color: green; }",
      /* 16 */ ".p { @nest .q & { color: red } }",
      /* 17 */ "@other bar;",
    ];
    const warning = (message: string, line: number, column: number, notes: object[] = []) => ({
      level: "warn",
      message,
      file: "styles.module.css",
      namespace: "file",
      line,
      column,
      lineText: sheet[line - 1],
      notes,
    });
    const unsupported = (name: string) => `Invalid selector. Unsupported pseudo-class or pseudo-element '${name}'`;

    const logs = await buildLogs("styles.module.css", sheet.join("\n"));
    // The misplaced `composes` declarations also make printing the sheet fail.
    expect(logs.filter(log => log.level !== "error")).toEqual([
      warning("invalid @ rule encountered: '@unknownrule'", 1, 13),
      warning('"composes" is not allowed inside nested selectors', 5, 14),
      warning('"composes" only works inside single class selectors', 10, 12, [
        {
          message: "The parent selector is not a single class selector because of the syntax here:",
          file: "styles.module.css",
          namespace: "file",
          line: 8,
          column: 1,
          lineText: sheet[7],
        },
      ]),
      warning(unsupported("custom-thing"), 12, 4),
      warning(unsupported("_internal"), 13, 4),
      warning(unsupported("custom-fn"), 14, 15),
      warning(unsupported("custom-fn"), 15, 14),
      warning("The @nest rule is deprecated, use standard CSS nesting instead", 16, 11),
      warning("invalid @ rule encountered: '@other'", 17, 7),
    ]);
  });

  test.each([
    ["in a nested rule", [".outer {", "  .inner {", "    composes: base;", "  }", "}"], 3, 14],
    ["two levels deep", [".a {", "  .b {", "    .c {", "      composes: base;", "    }", "  }", "}"], 4, 16],
    ["in a nested @media", [".outer {", "  @media (min-width: 1px) {", "    composes: base;", "  }", "}"], 3, 14],
  ])('the warning for a "composes" %s is on the declaration', async (_, rules, line, column) => {
    const logs = await buildLogs("styles.module.css", [...rules, ".base { color: red; }"].join("\n"));
    expect(logs.filter(log => log.level !== "error")).toEqual([
      {
        level: "warn",
        message: '"composes" is not allowed inside nested selectors',
        file: "styles.module.css",
        namespace: "file",
        line,
        column,
        lineText: rules[line - 1],
        notes: [],
      },
    ]);
  });

  test("a sheet that is not a CSS module", async () => {
    const rules = ".a { color: red }\n.b { color: blue }\n";
    expect(await buildLogs("styles.css", rules + "@unknown-rule x;\n")).toEqual([unknownAtRule("styles.css", 3)]);
  });

  test.each([
    ["on the first line", "@unknown-rule x;\n.a { color: red }\n", 1, "@unknown-rule x;"],
    ["after a CRLF line break", ".a { color: red }\r\n@unknown-rule x;\r\n", 2, "@unknown-rule x;"],
    ["after a lone CR line break", ".a { color: red }\r@unknown-rule x;\r", 2, "@unknown-rule x;"],
    ["on a last line with no line break", ".a { color: red }\n@unknown-rule x;", 2, "@unknown-rule x;"],
  ])("a warning %s", async (_, sheet, line, lineText) => {
    expect(await buildLogs("styles.css", sheet)).toEqual([unknownAtRule("styles.css", line, lineText)]);
  });

  test("a warning at the end of the sheet", async () => {
    const sheet = ".a { color: red }\n@unknown-rule";
    using dir = tempDir("css-warning-position", { "styles.css": sheet });
    const { logs } = await Bun.build({ entrypoints: [join(String(dir), "styles.css")], throw: false });
    // The logger has no column after the last character of a source: it reports that character.
    expect(logs.map(({ position }) => position)).toEqual([
      expect.objectContaining({ line: 2, column: 13, offset: sheet.length, lineText: "@unknown-rule" }),
    ]);
  });

  // The logger cuts a long line around the position, or keeps it whole for a position in its last
  // 80 bytes, and indents the caret by the whole column. Such a warning has its place and no line
  // text. The first warning of each sheet is on a cut line and the second on a whole one.
  test("warnings on a long line have their place and no line text", async () => {
    const rules = Buffer.alloc(130, ".a{color:red}").toString();
    const logs = await buildLogs("styles.css", rules + "@unknown-rule x;" + rules + "@unknown-rule x;\n");
    expect(logs).toEqual([unknownAtRule("styles.css", 1, "", 144), unknownAtRule("styles.css", 1, "", 290)]);
  });

  test("bun build prints the place and no code frame for warnings on a long line", async () => {
    const rules = Buffer.alloc(130, ".a{color:red}").toString();
    using dir = tempDir("css-warning-long-line", {
      "styles.css": rules + "@unknown-rule x;" + rules + "@unknown-rule x;\n",
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "./styles.css"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect({ stderr: normalizeBunSnapshot(stderr, String(dir)), exitCode }).toEqual({
      stderr: [
        "warn: invalid @ rule encountered: '@unknown-rule'",
        "   at <dir>/styles.css:1:144",
        "",
        "warn: invalid @ rule encountered: '@unknown-rule'",
        "   at <dir>/styles.css:1:290",
      ].join("\n"),
      exitCode: 0,
    });
  });

  test("a warning has the file and the namespace that an error of the same sheet has", async () => {
    const logs = await buildLogs("styles.css", "@unknown-rule x;\n.a { color: red }\n}\n");
    expect(logs.map(({ level, file, namespace, line }) => ({ level, file, namespace, line }))).toEqual([
      { level: "warn", file: "styles.css", namespace: "file", line: 1 },
      { level: "error", file: "styles.css", namespace: "file", line: 4 },
    ]);
  });

  test("a sheet that a plugin loads in another namespace, and an in-memory sheet", async () => {
    const sheet = ".a { color: red }\n@unknown-rule x;\n";
    using dir = tempDir("css-warning-namespace", { "entry.ts": `import "virtual:sheet.css";` });

    const plugin = await Bun.build({
      entrypoints: [join(String(dir), "entry.ts")],
      throw: false,
      plugins: [
        {
          name: "virtual",
          setup(builder) {
            builder.onResolve({ filter: /^virtual:/ }, args => ({
              path: args.path.slice("virtual:".length),
              namespace: "virtual",
            }));
            builder.onLoad({ filter: /.*/, namespace: "virtual" }, () => ({ contents: sheet, loader: "css" }));
          },
        },
      ],
    });
    expect(plugin.logs.map(log => ({ level: log.level, message: log.message, ...log.position }))).toEqual([
      {
        level: "warn",
        message: "invalid @ rule encountered: '@unknown-rule'",
        file: "sheet.css",
        namespace: "virtual",
        line: 2,
        column: 14,
        length: 0,
        offset: sheet.indexOf(" x;"),
        lineText: "@unknown-rule x;",
      },
    ]);

    // The same in-memory path, once with a warning and once with an error.
    const inMemory = (contents: string) =>
      Bun.build({ entrypoints: ["/memory/sheet.css"], files: { "/memory/sheet.css": contents }, throw: false });
    const [warned, failed] = await Promise.all([inMemory(sheet), inMemory(".a { color: red }\n}\n")]);
    const place = ({ level, position }: BuildMessage) => ({
      level,
      file: position!.file,
      namespace: position!.namespace,
      line: position!.line,
    });
    const error = place(failed.logs[0] as BuildMessage);
    expect([place(warned.logs[0] as BuildMessage), error]).toEqual([
      { level: "warn", file: error.file, namespace: "file", line: 2 },
      { level: "error", file: expect.stringContaining("sheet.css"), namespace: "file", line: 3 },
    ]);
  });

  test("a sheet in a data: URL has the URL as its file", async () => {
    const url = "data:text/css,.a{color:red}%0A@unknown-rule%20x;";
    using dir = tempDir("css-warning-data-url", { "styles.css": `@import "${url}";\n` });
    const { logs } = await Bun.build({ entrypoints: [join(String(dir), "styles.css")], throw: false });
    expect(logs.map(log => ({ level: log.level, ...log.position }))).toEqual([
      {
        level: "warn",
        file: url,
        namespace: "dataurl",
        line: 2,
        column: 14,
        length: 0,
        offset: ".a{color:red}\n@unknown-rule".length,
        lineText: "@unknown-rule x;",
      },
    ]);
  });

  test.each([
    ["bun build", "styles.css", []],
    ["bun build", "styles.module.css", []],
    ["bun build --no-bundle", "styles.css", ["--no-bundle"]],
    ["bun build --no-bundle", "styles.module.css", ["--no-bundle"]],
  ])("%s of %s prints the line and the place of a warning", async (_, name, flags) => {
    using dir = tempDir("css-warning-position-cli", {
      [name]: ".a { color: red }\n.b { color: blue }\n@unknown-rule x;\n",
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", ...flags, "./" + name],
      env: bunEnv,
      cwd: String(dir),
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(normalizeBunSnapshot(stderr, String(dir))).toBe(
      [
        "3 | @unknown-rule x;",
        "                 ^",
        "warn: invalid @ rule encountered: '@unknown-rule'",
        `   at <dir>/${name}:3:14`,
      ].join("\n"),
    );
    expect(exitCode).toBe(0);
  });
});
