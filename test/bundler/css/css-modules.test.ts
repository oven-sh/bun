import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
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

  // Whether a `composes` declaration counts is decided by the parser: it has to
  // sit directly in a style rule whose selector is a single class. Accepted ones
  // are recorded for the exports object and omitted from the stylesheet; the
  // rest get a warning and are dropped, like esbuild does (they used to fail the
  // whole build at print time). A dropped declaration leaves an empty rule
  // behind, which the minifier removes, so rules holding nothing but a rejected
  // `composes` must not appear in the output.
  const notAllowedNested = '"composes" is not allowed inside nested selectors';
  const notSingleClass = '"composes" only works inside single class selectors';
  const notValidHere = '"composes" is not valid here';
  const entry = /* js */ `
    import styles from "./styles.module.css";
    console.log(styles);
  `;

  itBundled("css-module/ComposesInNestedRuleIsDropped", {
    files: {
      "/entry.js": entry,
      "/styles.module.css": /* css */ `
        .c { color: red }
        .a {
          .z { composes: c; color: blue }
          .y { composes: c }
        }
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    bundleWarnings: { "/styles.module.css": [notAllowedNested, notAllowedNested] },
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toMatchInlineSnapshot(`
        "// styles.module.css
        var styles_module_default = {
          c: "c_-MSaAA",
          a: "a_-MSaAA",
          z: "z_-MSaAA",
          y: "y_-MSaAA"
        };

        // entry.js
        console.log(styles_module_default);
        "
      `);
      api.expectFile("/out/entry.css").toMatchInlineSnapshot(`
        "/* styles.module.css */
        .c_-MSaAA {
          color: red;
        }

        .a_-MSaAA .z_-MSaAA {
          color: #00f;
        }
        "
      `);
    },
  });

  itBundled("css-module/ComposesOnNonSingleClassSelectorIsDropped", {
    files: {
      "/entry.js": entry,
      "/styles.module.css": /* css */ `
        .c { color: red }
        .a .b { composes: c; color: blue }
        .d, .e { composes: c }
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    bundleWarnings: { "/styles.module.css": [notSingleClass, notSingleClass] },
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toMatchInlineSnapshot(`
        "// styles.module.css
        var styles_module_default = {
          c: "c_-MSaAA",
          a: "a_-MSaAA",
          b: "b_-MSaAA",
          d: "d_-MSaAA",
          e: "e_-MSaAA"
        };

        // entry.js
        console.log(styles_module_default);
        "
      `);
      api.expectFile("/out/entry.css").toMatchInlineSnapshot(`
        "/* styles.module.css */
        .c_-MSaAA {
          color: red;
        }

        .a_-MSaAA .b_-MSaAA {
          color: #00f;
        }
        "
      `);
    },
  });

  itBundled("css-module/ComposesInAtRuleNestedInRuleIsDropped", {
    files: {
      "/entry.js": entry,
      "/styles.module.css": /* css */ `
        .c { color: red }
        .a {
          @media (min-width: 1px) { composes: c }
          @media (min-width: 2px) { composes: c; color: blue }
        }
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    bundleWarnings: { "/styles.module.css": [notAllowedNested, notAllowedNested] },
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toMatchInlineSnapshot(`
        "// styles.module.css
        var styles_module_default = {
          c: "c_-MSaAA",
          a: "a_-MSaAA"
        };

        // entry.js
        console.log(styles_module_default);
        "
      `);
      api.expectFile("/out/entry.css").toMatchInlineSnapshot(`
        "/* styles.module.css */
        .c_-MSaAA {
          color: red;
        }

        @media (min-width: 2px) {
          .a_-MSaAA {
            color: #00f;
          }
        }
        "
      `);
    },
  });

  itBundled("css-module/ComposesOutsideStyleRuleIsDropped", {
    files: {
      "/entry.js": entry,
      "/styles.module.css": /* css */ `
        .c { color: red }
        @keyframes fade {
          from { composes: x from "./other.module.css"; opacity: 0 }
          to { opacity: 1 }
        }
        @page { composes: c; margin: 1cm }
        .s { animation: fade 1s }
      `,
      "/other.module.css": /* css */ `.x { color: green }`,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    // Only @page reports its declaration: @keyframes bodies are parsed with a
    // fresh ParserOptions (rules/keyframes.rs), which has nowhere to log to.
    // The keyframe's declaration is still dropped, as the stylesheet shows.
    bundleWarnings: { "/styles.module.css": [notValidHere] },
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toMatchInlineSnapshot(`
        "// styles.module.css
        var styles_module_default = {
          c: "c_-MSaAA",
          s: "s_-MSaAA"
        };

        // entry.js
        console.log(styles_module_default);
        "
      `);
      // other.module.css is not part of the bundle.
      api.expectFile("/out/entry.css").toMatchInlineSnapshot(`
        "/* styles.module.css */
        .c_-MSaAA {
          color: red;
        }

        @keyframes fade_-MSaAA {
          from {
            opacity: 0;
          }

          to {
            opacity: 1;
          }
        }

        @page {
          margin: 1cm;
        }

        .s_-MSaAA {
          animation: 1s fade_-MSaAA;
        }
        "
      `);
    },
  });

  itBundled("css-module/RejectedComposesFromDoesNotImportTheFile", {
    files: {
      "/entry.js": entry,
      "/styles.module.css": /* css */ `
        .c { color: red }
        .a .b { composes: x from "./other.module.css"; color: blue }
        .a .d { composes: y from "./missing.module.css" }
        .ok { composes: c }
      `,
      "/other.module.css": /* css */ `.x { color: green }`,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    bundleWarnings: { "/styles.module.css": [notSingleClass, notSingleClass] },
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toMatchInlineSnapshot(`
        "// styles.module.css
        var styles_module_default = {
          c: "c_-MSaAA",
          a: "a_-MSaAA",
          b: "b_-MSaAA",
          d: "d_-MSaAA",
          ok: "c_-MSaAA ok_-MSaAA"
        };

        // entry.js
        console.log(styles_module_default);
        "
      `);
      // Neither other.module.css nor the unresolvable missing.module.css is
      // part of the bundle.
      api.expectFile("/out/entry.css").toMatchInlineSnapshot(`
        "/* styles.module.css */
        .c_-MSaAA {
          color: red;
        }

        .a_-MSaAA .b_-MSaAA {
          color: #00f;
        }

        .ok_-MSaAA {
        }
        "
      `);
    },
  });

  // The printer used to reject any `composes` printed inside a block, which
  // also covered rules the parser had accepted. The CLI backend makes any
  // warning fail these two tests.
  itBundled("css-module/ComposesInRuleInsideTopLevelAtRule", {
    files: {
      "/entry.js": entry,
      "/styles.module.css": /* css */ `
        .c { color: red }
        @media (min-width: 1px) { .b { composes: c } }
        @supports (display: grid) { @layer x { .d { composes: c; color: blue } } }
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    backend: "cli",
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toMatchInlineSnapshot(`
        "// styles.module.css
        var styles_module_default = {
          c: "c_-MSaAA",
          b: "c_-MSaAA b_-MSaAA",
          d: "c_-MSaAA d_-MSaAA"
        };

        // entry.js
        console.log(styles_module_default);
        "
      `);
      api.expectFile("/out/entry.css").toMatchInlineSnapshot(`
        "/* styles.module.css */
        .c_-MSaAA {
          color: red;
        }

        @media (min-width: 1px) {
          .b_-MSaAA {
          }
        }

        @supports (display: grid) {
          @layer x {
            .d_-MSaAA {
              color: #00f;
            }
          }
        }
        "
      `);
    },
  });

  itBundled("css-module/ComposesInModuleImportedWithConditions", {
    files: {
      "/entry.css": /* css */ `@import "./styles.module.css" layer(base) supports(display: grid) (min-width: 1px);`,
      "/styles.module.css": /* css */ `
        .c { color: red }
        .b { composes: c }
      `,
    },
    entryPoints: ["/entry.css"],
    outdir: "/out",
    backend: "cli",
    onAfterBundle(api) {
      api.expectFile("/out/entry.css").toMatchInlineSnapshot(`
        "/* styles.module.css */
        @media (min-width: 1px) {
          @supports (display: grid) {
            @layer base {
              .c_-MSaAA {
                color: red;
              }

              .b_-MSaAA {
              }
            }
          }
        }

        /* entry.css */

        "
      `);
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
