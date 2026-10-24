import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
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
          spin: "spin_${hash}",
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

  // A keyframes name is renamed in the CSS, so JS needs the new name for
  // `style.animationName` and `event.animationName`. esbuild, Lightning CSS
  // and postcss-modules export it too.
  itBundled("css-module/KeyframesNamesExported", {
    files: {
      "/entry.js": `
        import styles from './styles.module.css';
        console.log(styles);
      `,
      "/styles.module.css": `
        @keyframes spin { to { rotate: 1turn } }
        @-webkit-keyframes spin { to { rotate: 1turn } }
        @keyframes fade-in { from { opacity: 0 } }
        @keyframes "quoted name" { to { opacity: 1 } }
        @media (min-width: 1px) {
          @keyframes in-media { to { opacity: 0 } }
        }
        .box { animation: spin 1s linear infinite }
        .two { animation: fade-in 1s, "quoted name" 2s }
        .ref { animation-name: elsewhere, in-media; -webkit-animation-name: spin }
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toMatchInlineSnapshot(`
        "// styles.module.css
        var styles_module_default = {
          spin: "spin_-MSaAA",
          "fade-in": "fade-in_-MSaAA",
          "quoted name": "quoted name_-MSaAA",
          "in-media": "in-media_-MSaAA",
          box: "box_-MSaAA",
          two: "two_-MSaAA",
          ref: "ref_-MSaAA",
          elsewhere: "elsewhere_-MSaAA"
        };

        // entry.js
        console.log(styles_module_default);
        "
      `);
      api.expectFile("/out/entry.css").toMatchInlineSnapshot(`
        "/* styles.module.css */
        @keyframes spin_-MSaAA {
          to {
            rotate: 1turn;
          }
        }

        @-webkit-keyframes spin_-MSaAA {
          to {
            rotate: 1turn;
          }
        }

        @keyframes fade-in_-MSaAA {
          from {
            opacity: 0;
          }
        }

        @keyframes quoted\\ name_-MSaAA {
          to {
            opacity: 1;
          }
        }

        @media (min-width: 1px) {
          @keyframes in-media_-MSaAA {
            to {
              opacity: 0;
            }
          }
        }

        .box_-MSaAA {
          animation: 1s linear infinite spin_-MSaAA;
        }

        .two_-MSaAA {
          animation: 1s fade-in_-MSaAA, 2s quoted\\ name_-MSaAA;
        }

        .ref_-MSaAA {
          animation-name: elsewhere_-MSaAA, in-media_-MSaAA;
          -webkit-animation-name: spin_-MSaAA;
        }
        "
      `);
    },
  });

  // A class or an id with the name of a keyframes rule shares its key, in
  // both orders. `@keyframes pulse` makes the entry before `.pulse` does, and
  // the class has to take it over, or `composes: pulse` is an error.
  itBundled("css-module/KeyframesNameSharedWithClassAndId", {
    files: {
      "/entry.js": `
        import styles from './styles.module.css';
        console.log(styles);
      `,
      "/styles.module.css": `
        @keyframes pulse { 50% { opacity: 0.5 } }
        .pulse { animation: pulse 1s }
        #blink { animation-name: blink }
        @keyframes blink { to { opacity: 0 } }
        @keyframes wave { to { opacity: 0 } }
        .loader { composes: pulse; color: red }
        #wave { color: blue }
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toMatchInlineSnapshot(`
        "// styles.module.css
        var styles_module_default = {
          pulse: "pulse_-MSaAA",
          blink: "blink_-MSaAA",
          wave: "wave_-MSaAA",
          loader: "pulse_-MSaAA loader_-MSaAA"
        };

        // entry.js
        console.log(styles_module_default);
        "
      `);
      api.expectFile("/out/entry.css").toMatchInlineSnapshot(`
        "/* styles.module.css */
        @keyframes pulse_-MSaAA {
          50% {
            opacity: .5;
          }
        }

        .pulse_-MSaAA {
          animation: 1s pulse_-MSaAA;
        }

        #blink_-MSaAA {
          animation-name: blink_-MSaAA;
        }

        @keyframes blink_-MSaAA {
          to {
            opacity: 0;
          }
        }

        @keyframes wave_-MSaAA {
          to {
            opacity: 0;
          }
        }

        .loader_-MSaAA {
          color: red;
        }

        #wave_-MSaAA {
          color: #00f;
        }
        "
      `);
    },
  });

  for (const backend of ["cli", "api"] as const) {
    for (const format of ["esm", "cjs"] as const) {
      itBundled(`css-module/KeyframesNameNamedImport/${backend}/${format}`, {
        files: {
          "/entry.js": `
            import styles, { spin } from './styles.module.css';
            import * as ns from './other.module.css';
            console.log(JSON.stringify([spin, styles.spin, styles["fade-in"], ns.only, ns.default]));
          `,
          "/styles.module.css": `
            @keyframes spin { to { rotate: 1turn } }
            @keyframes fade-in { from { opacity: 0 } }
          `,
          "/other.module.css": `@keyframes only { to { opacity: 0 } }`,
        },
        entryPoints: ["/entry.js"],
        outdir: "/out",
        backend,
        format,
        run: { stdout: '["spin_-MSaAA","spin_-MSaAA","fade-in_-MSaAA","only_NlEjJA",{"only":"only_NlEjJA"}]' },
      });
    }
  }

  // A name is final when its declaration list or its rule is. Each rule
  // below holds the name in another kind of list. `:global()` makes a
  // selector global, not the names in the declarations of the rule.
  itBundled("css-module/KeyframesNamesInEveryDeclarationList", {
    files: {
      "/entry.js": `
        import styles from './styles.module.css';
        console.log(styles);
      `,
      "/styles.module.css": `
        .rule { animation: in-rule 1s !important; animation-name: ease }
        .parent {
          .child { animation-name: in-nested-rule }
          @media (min-width: 1px) { animation-name: in-nested-media }
          animation: 1s ease ease;
        }
        @keyframes outer {
          from { animation-name: in-keyframe }
        }
        @page { animation-name: in-page; @top-left { animation-name: in-page-margin } }
        @container style(animation-name: in-style-query) { .queried { color: red } }
        .prefixed { -webkit-animation: in-prefixed 1s; -moz-animation-name: in-prefixed-name }
        :global(div) { animation-name: in-global-rule }
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toMatchInlineSnapshot(`
        "// styles.module.css
        var styles_module_default = {
          rule: "rule_-MSaAA",
          ease: "ease_-MSaAA",
          "in-rule": "in-rule_-MSaAA",
          parent: "parent_-MSaAA",
          child: "child_-MSaAA",
          "in-nested-rule": "in-nested-rule_-MSaAA",
          "in-nested-media": "in-nested-media_-MSaAA",
          "in-keyframe": "in-keyframe_-MSaAA",
          outer: "outer_-MSaAA",
          "in-page-margin": "in-page-margin_-MSaAA",
          "in-page": "in-page_-MSaAA",
          queried: "queried_-MSaAA",
          "in-style-query": "in-style-query_-MSaAA",
          prefixed: "prefixed_-MSaAA",
          "in-prefixed": "in-prefixed_-MSaAA",
          "in-prefixed-name": "in-prefixed-name_-MSaAA",
          "in-global-rule": "in-global-rule_-MSaAA"
        };

        // entry.js
        console.log(styles_module_default);
        "
      `);
      api.expectFile("/out/entry.css").toMatchInlineSnapshot(`
        "/* styles.module.css */
        .rule_-MSaAA {
          animation-name: ease_-MSaAA;
          animation: 1s in-rule_-MSaAA !important;
        }

        .parent_-MSaAA {
          animation: 1s ease ease_-MSaAA;
        }

        .parent_-MSaAA .child_-MSaAA {
          animation-name: in-nested-rule_-MSaAA;
        }

        @media (min-width: 1px) {
          .parent_-MSaAA {
            animation-name: in-nested-media_-MSaAA;
          }
        }

        @keyframes outer_-MSaAA {
          from {
            animation-name: in-keyframe_-MSaAA;
          }
        }

        @page {
          animation-name: in-page_-MSaAA;

          @top-left {
            animation-name: in-page-margin_-MSaAA;
          }
        }

        @container style(animation-name: in-style-query_-MSaAA) {
          .queried_-MSaAA {
            color: red;
          }
        }

        .prefixed_-MSaAA {
          -webkit-animation: 1s in-prefixed_-MSaAA;
          -moz-animation-name: in-prefixed-name_-MSaAA;
        }

        div {
          animation-name: in-global-rule_-MSaAA;
        }
        "
      `);
    },
  });

  // A `style()` query holds a declaration too. The hook for it runs when the
  // `@container` rule is accepted.
  itBundled("css-module/KeyframesNamesInStyleQueries", {
    files: {
      "/entry.js": `
        import styles from './styles.module.css';
        console.log(styles);
      `,
      "/styles.module.css": `
        @container style(animation-name: q1) and (not style(animation: q2 1s)) { .a { color: red } }
        @container (min-width: 1px) and style((animation-name: q3) or (animation-name: q4)) { .b { color: red } }
        @container not style(not (animation-name: q5)) { .c { color: red } }
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toMatchInlineSnapshot(`
        "// styles.module.css
        var styles_module_default = {
          a: "a_-MSaAA",
          q1: "q1_-MSaAA",
          q2: "q2_-MSaAA",
          b: "b_-MSaAA",
          q3: "q3_-MSaAA",
          q4: "q4_-MSaAA",
          c: "c_-MSaAA",
          q5: "q5_-MSaAA"
        };

        // entry.js
        console.log(styles_module_default);
        "
      `);
      api.expectFile("/out/entry.css").toMatchInlineSnapshot(`
        "/* styles.module.css */
        @container style(animation-name: q1_-MSaAA) and (not style(animation: 1s q2_-MSaAA)) {
          .a_-MSaAA {
            color: red;
          }
        }

        @container (width >= 1px) and style((animation-name: q3_-MSaAA) or (animation-name: q4_-MSaAA)) {
          .b_-MSaAA {
            color: red;
          }
        }

        @container not style(not (animation-name: q5_-MSaAA)) {
          .c_-MSaAA {
            color: red;
          }
        }
        "
      `);
    },
  });

  // Two rules merge when their declarations are equal. A quoted name and the
  // same name as an ident were not equal before they became symbols, so they
  // still do not merge. The rule with two selectors is split, which clones it.
  itBundled("css-module/KeyframesNamesEqualLikePlainNames", {
    files: {
      "/entry.js": `
        import styles from './styles.module.css';
        console.log(styles);
      `,
      "/styles.module.css": `
        .m1 { animation-name: same }
        .m2 { animation-name: same }
        .m3 { animation-name: "same" }
        .m4 { animation: same 1s }
        .m5 { animation: "same" 1s }
        .s1, .s2:focus-visible { animation: split 1s; animation-name: split2 }
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toMatchInlineSnapshot(`
        "// styles.module.css
        var styles_module_default = {
          m1: "m1_-MSaAA",
          same: "same_-MSaAA",
          m2: "m2_-MSaAA",
          m3: "m3_-MSaAA",
          m4: "m4_-MSaAA",
          m5: "m5_-MSaAA",
          s1: "s1_-MSaAA",
          s2: "s2_-MSaAA",
          split: "split_-MSaAA",
          split2: "split2_-MSaAA"
        };

        // entry.js
        console.log(styles_module_default);
        "
      `);
      api.expectFile("/out/entry.css").toMatchInlineSnapshot(`
        "/* styles.module.css */
        .m1_-MSaAA, .m2_-MSaAA {
          animation-name: same_-MSaAA;
        }

        .m3_-MSaAA {
          animation-name: same_-MSaAA;
        }

        .m4_-MSaAA {
          animation: 1s same_-MSaAA;
        }

        .m5_-MSaAA {
          animation: 1s same_-MSaAA;
        }

        .s1_-MSaAA {
          animation: 1s split_-MSaAA;
          animation-name: split2_-MSaAA;
        }

        .s2_-MSaAA:focus-visible {
          animation: 1s split_-MSaAA;
          animation-name: split2_-MSaAA;
        }
        "
      `);
    },
  });

  // A name gets a key when the parser accepts it as a local name. These are
  // not accepted: a quoted CSS-wide keyword or "none", a value kept as raw
  // tokens, a declaration of a dropped keyframe, and `animation-name:hover {}`,
  // which is a nested rule.
  itBundled("css-module/KeyframesNamesNotLocalNotExported", {
    files: {
      "/entry.js": `
        import styles from './styles.module.css';
        console.log(styles);
      `,
      "/styles.module.css": `
        @keyframes "none" { to { opacity: 1 } }
        @keyframes "inherit" { to { opacity: 1 } }
        .quoted { animation-name: "none", "inherit" }
        .none { animation: none 1s; animation-name: none }
        .raw { animation: fade var(--duration) linear; animation-name: var(--name) }
        .nested { animation-name:hover { color: red } }
        @keyframes kept {
          from { animation-name: dropped; color: red !importantx }
          to { opacity: 1 }
        }
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toMatchInlineSnapshot(`
        "// styles.module.css
        var styles_module_default = {
          quoted: "quoted_-MSaAA",
          none: "none_-MSaAA",
          raw: "raw_-MSaAA",
          nested: "nested_-MSaAA",
          kept: "kept_-MSaAA"
        };

        // entry.js
        console.log(styles_module_default);
        "
      `);
      api.expectFile("/out/entry.css").toMatchInlineSnapshot(`
        "/* styles.module.css */
        @keyframes "none" {
          to {
            opacity: 1;
          }
        }

        @keyframes "inherit" {
          to {
            opacity: 1;
          }
        }

        .quoted_-MSaAA {
          animation-name: "none", "inherit";
        }

        .none_-MSaAA {
          animation: 1s;
          animation-name: none;
        }

        .raw_-MSaAA {
          animation: fade var(--duration) linear;
          animation-name: var(--name);
        }

        .nested_-MSaAA animation-name:hover {
          color: red;
        }

        @keyframes kept_-MSaAA {
          to {
            opacity: 1;
          }
        }
        "
      `);
    },
  });

  // The key is the name as written, without CSS escapes. The value is the
  // name the browser reports, so it has no escapes either.
  itBundled("css-module/KeyframesNameEdgeKeys", {
    files: {
      "/entry.js": `
        import styles from './styles.module.css';
        console.log(JSON.stringify(Object.entries(styles)));
      `,
      "/styles.module.css": `
        @keyframes __proto__ { to { opacity: 0 } }
        @keyframes a\\.b { to { opacity: 0 } }
        @keyframes \\- { to { opacity: 0 } }
        @keyframes é { to { opacity: 0 } }
        .x { animation-name: __proto__, a\\.b, \\-, é }
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    run: {
      stdout: JSON.stringify([
        ["__proto__", "__proto___-MSaAA"],
        ["a.b", "a.b_-MSaAA"],
        ["-", "-_-MSaAA"],
        ["é", "é_-MSaAA"],
        ["x", "x_-MSaAA"],
      ]),
    },
    onAfterBundle(api) {
      api.expectFile("/out/entry.css").toMatchInlineSnapshot(`
        "/* styles.module.css */
        @keyframes __proto___-MSaAA {
          to {
            opacity: 0;
          }
        }

        @keyframes a\\.b_-MSaAA {
          to {
            opacity: 0;
          }
        }

        @keyframes -_-MSaAA {
          to {
            opacity: 0;
          }
        }

        @keyframes é_-MSaAA {
          to {
            opacity: 0;
          }
        }

        .x_-MSaAA {
          animation-name: __proto___-MSaAA, a\\.b_-MSaAA, -_-MSaAA, é_-MSaAA;
        }
        "
      `);
    },
  });

  // A keyframes name is not a class, so `composes` cannot take it.
  itBundled("css-module/ComposesKeyframesNameIsAnError", {
    files: {
      "/entry.js": `
        import styles from './styles.module.css';
        console.log(styles);
      `,
      "/styles.module.css": `
        @keyframes spin { to { rotate: 1turn } }
        .a { composes: spin; color: red }
        .b { composes: fade from "./other.module.css"; color: blue }
      `,
      "/other.module.css": `.c { animation-name: fade }`,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    bundleErrors: {
      "/styles.module.css": [
        'The composes property cannot be used with "spin", because it is not a single class name.',
      ],
      "/other.module.css": ['The composes property cannot be used with "fade", because it is not a single class name.'],
    },
  });
});

// `bun build --no-bundle` prints a module file with no link step. Local
// symbols have no final name there, so the printer hashes the original name.
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

// With no link step the printer names the symbols of keyframes names itself.
// Those names have to be the names that the linker gives in a bundle.
test("css-module/NoBundleKeyframesNamesMatchBundle", async () => {
  using dir = tempDir("css-module-no-bundle-names", {
    "styles.module.css": `
      .card { animation: spin 1s, "fade in" 2s }
      #hero { animation-name: elsewhere }
      @keyframes spin { to { rotate: 1turn } }
      @keyframes "fade in" { to { opacity: 0 } }
    `,
  });
  const build = async (...args: string[]) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", ...args, "styles.module.css"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  };

  const noBundle = await build("--no-bundle");
  expect(noBundle.stdout).toMatchInlineSnapshot(`
    ".card_-MSaAA {
      animation: 1s spin_-MSaAA, 2s fade\\ in_-MSaAA;
    }

    #hero_-MSaAA {
      animation-name: elsewhere_-MSaAA;
    }

    @keyframes spin_-MSaAA {
      to {
        rotate: 1turn;
      }
    }

    @keyframes fade\\ in_-MSaAA {
      to {
        opacity: 0;
      }
    }
    "
  `);
  expect({ stderr: noBundle.stderr, exitCode: noBundle.exitCode }).toEqual({ stderr: "", exitCode: 0 });

  const bundle = await build("--outdir", "out");
  expect({ stderr: bundle.stderr, exitCode: bundle.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const bundled = await Bun.file(join(String(dir), "out", "styles.module.css")).text();
  expect(bundled).toBe("/* styles.module.css */\n" + noBundle.stdout);
});

// The note of the `composes` error points at the name. A name with an escape
// is a copy, not a part of the source text, so its note points at the end of
// the declaration list.
test("css-module/ComposesKeyframesNameNotePointsAtTheName", async () => {
  using dir = tempDir("css-module-composes-note", {
    "styles.module.css": [
      "  @keyframes spin { to { rotate: 1turn } }",
      ".ref {",
      "  color: red;",
      "  animation-name: fade;",
      "}",
      "  @container style(animation-name: queried) { .q { color: red } }",
      ".esc { animation-name: sl\\69 de }",
      ".a { composes: spin }",
      ".b { composes: fade }",
      ".c { composes: queried }",
      ".d { composes: slide }",
    ].join("\n"),
  });
  const result = await Bun.build({ entrypoints: [join(String(dir), "styles.module.css")], throw: false });

  const error = (name: string) =>
    `The composes property cannot be used with "${name}", because it is not a single class name.`;
  const note = (name: string) => `The definition of "${name}" is here.`;
  expect(
    result.logs.map(log => ({
      message: log.message,
      notes: (log as BuildMessage & { notes: BuildMessage[] }).notes.map(({ message, position }) => ({
        message,
        // `column` is 1-based.
        at: position!.lineText.slice(position!.column - 1),
      })),
    })),
  ).toEqual([
    { message: error("spin"), notes: [{ message: note("spin"), at: "spin { to { rotate: 1turn } }" }] },
    { message: error("fade"), notes: [{ message: note("fade"), at: "fade;" }] },
    { message: error("queried"), notes: [{ message: note("queried"), at: "queried) { .q { color: red } }" }] },
    { message: error("slide"), notes: [{ message: note("slide"), at: "}" }] },
  ]);
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
