import { readdirSync } from "node:fs";
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

  // A require()'d CSS file is wrapped in a CommonJS closure whose body is the
  // `module.exports = ...` assignment of its lazy export. That body used to be
  // tree-shaken away, so require() returned `{}` and the class map was lost,
  // and since the wrapper was the only thing in this bundle that needs the
  // runtime, `__commonJS` itself was missing from the output as well.
  itBundled("css-module/RequireCssModule", {
    files: {
      "/entry.js": `
        const styles = require('./styles.module.css');
        const plain = require('./plain.css');
        console.log(JSON.stringify(styles), JSON.stringify(plain));
        export {};
      `,
      "/styles.module.css": `
        .foo { composes: base from './base.module.css'; color: red }
        .bar { composes: foo; color: blue }
      `,
      "/base.module.css": `.base { padding: 0 }`,
      "/plain.css": `.plain { color: green }`,
    },
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toMatchInlineSnapshot(`
        "var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);

        // styles.module.css
        var require_styles_module = __commonJS(function(exports, module) {
          module.exports = {
            foo: "base_1Cz41w foo_-MSaAA",
            bar: "base_1Cz41w foo_-MSaAA bar_-MSaAA"
          };
        });

        // plain.css
        var require_plain = __commonJS(function(exports, module) {
          module.exports = {};
        });

        // entry.js
        var styles = require_styles_module();
        var plain = require_plain();
        console.log(JSON.stringify(styles), JSON.stringify(plain));
        "
      `);
    },
    run: {
      stdout: '{"foo":"base_1Cz41w foo_-MSaAA","bar":"base_1Cz41w foo_-MSaAA bar_-MSaAA"} {}',
    },
  });

  // Without code splitting, import() of a CSS file goes through the same
  // CommonJS wrapper as require().
  itBundled("css-module/DynamicImportCssModuleWithoutSplitting", {
    files: {
      "/entry.js": `
        const { default: styles } = await import('./styles.module.css');
        console.log(JSON.stringify(styles));
      `,
      "/styles.module.css": `.foo { color: red }`,
    },
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toContain("__toESM(require_styles_module()");
    },
    run: {
      stdout: '{"foo":"foo_-MSaAA"}',
    },
  });

  // Only the parts of a CSS file's JS side that actually get printed may pull
  // the runtime into a chunk: a.js needs `__commonJS` for its require(), while
  // b.js, which only reads the class map, must not pick up the helper that
  // a.js made live.
  itBundled("css-module/RequireCssInOneEntryDoesNotAddRuntimeToOthers", {
    files: {
      "/a.js": `
        console.log(JSON.stringify(require('./a.css')));
        export {};
      `,
      "/b.js": `
        import styles from './b.module.css';
        console.log(JSON.stringify(styles));
      `,
      "/a.css": `.a { color: red }`,
      "/b.module.css": `.b { color: blue }`,
    },
    entryPoints: ["/a.js", "/b.js"],
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/a.js").toMatchInlineSnapshot(`
        "var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);

        // a.css
        var require_a = __commonJS(function(exports, module) {
          module.exports = {};
        });

        // a.js
        console.log(JSON.stringify(require_a()));
        "
      `);
      api.expectFile("/out/b.js").toMatchInlineSnapshot(`
        "// b.module.css
        var b_module_default = {
          b: "b_Kd7Gww"
        };

        // b.js
        console.log(JSON.stringify(b_module_default));
        "
      `);
    },
    run: [
      { file: "/out/a.js", stdout: "{}" },
      { file: "/out/b.js", stdout: '{"b":"b_Kd7Gww"}' },
    ],
  });

  // A stylesheet that is itself an entry point only produces a CSS file, so
  // reaching the runtime from it must not count: the runtime has to stay in
  // entry.js, the one chunk that prints the stylesheet's wrapper, instead of
  // being split into a chunk of its own.
  itBundled("css-module/RequireCssThatIsAlsoAnEntryPointWithSplitting", {
    files: {
      "/entry.js": `
        console.log(JSON.stringify(require('./styles.module.css')));
        export {};
      `,
      "/styles.module.css": `.foo { color: red }`,
    },
    entryPoints: ["/entry.js", "/styles.module.css"],
    splitting: true,
    outdir: "/out",
    onAfterBundle(api) {
      expect(readdirSync(api.outdir).sort()).toEqual(["entry.css", "entry.js", "styles.module.css"]);
      api.expectFile("/out/entry.js").toContain("var __commonJS =");
    },
    run: {
      file: "/out/entry.js",
      stdout: '{"foo":"foo_-MSaAA"}',
    },
  });

  itBundled("css-module/RequireCssThatIsAlsoAnEntryPointInCjsFormat", {
    files: {
      "/entry.js": `
        console.log(JSON.stringify(require('./styles.module.css')));
        export {};
      `,
      "/styles.module.css": `.foo { color: red }`,
    },
    entryPoints: ["/entry.js", "/styles.module.css"],
    format: "cjs",
    outdir: "/out",
    run: {
      file: "/out/entry.js",
      stdout: '{"foo":"foo_-MSaAA"}',
    },
  });

  // Wrapping a CSS file must not wrap the files its stylesheet references:
  // the stub evaluates nothing from them. The asset used to come out as an
  // empty `init_img` closure (plus the `__esm` helper) that entry.js then
  // had to call.
  itBundled("css-module/RequireCssDoesNotWrapStylesheetDependencies", {
    files: {
      "/entry.js": `
        import img from './img.png';
        const styles = require('./styles.css');
        console.log(JSON.stringify(styles), typeof img);
      `,
      "/styles.css": `
        @import './base.css';
        .styles { background: url('./img.png') }
      `,
      "/base.css": `.base { color: red }`,
      "/img.png": "not really a png",
    },
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toMatchInlineSnapshot(`
        "var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);

        // styles.css
        var require_styles = __commonJS(function(exports, module) {
          module.exports = {};
        });

        // img.png
        var img_default = "./img-qwe8ze7q.png";

        // entry.js
        var styles = require_styles();
        console.log(JSON.stringify(styles), typeof img_default);
        "
      `);
      api.expectFile("/out/entry.css").toContain(".base {");
    },
    run: {
      stdout: "{} string",
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
