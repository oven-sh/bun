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

  // Classes and ids inside `:global(...)` are printed as written, so they must
  // not show up in the exports object either (the hashed name they would be
  // exported under matches nothing in the stylesheet).
  itBundled("css-module/GlobalPseudoFunctionNamesAreNotExported", {
    files: {
      "/entry.js": `
        import styles from './styles.module.css';
        console.log(JSON.stringify(styles));
      `,
      "/styles.module.css": `
        :global(.g) { color: red }
        .local :global(.h) { color: blue }
        :global(#gid) { color: green }
        .scoped { color: pink }
        #sid { color: black }
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toMatchInlineSnapshot(`
        "// styles.module.css
        var styles_module_default = {
          local: "local_-MSaAA",
          scoped: "scoped_-MSaAA",
          sid: "sid_-MSaAA"
        };

        // entry.js
        console.log(JSON.stringify(styles_module_default));
        "
      `);
      api.expectFile("/out/entry.css").toMatchInlineSnapshot(`
        "/* styles.module.css */
        .g {
          color: red;
        }

        .local_-MSaAA .h {
          color: #00f;
        }

        #gid {
          color: green;
        }

        .scoped_-MSaAA {
          color: pink;
        }

        #sid_-MSaAA {
          color: #000;
        }
        "
      `);
    },
  });

  // `:local(...)` nested inside `:global(...)` makes its argument local again
  // (esbuild does the same), and the scope switch ends at the closing paren.
  itBundled("css-module/LocalPseudoFunctionInsideGlobal", {
    files: {
      "/entry.js": `
        import styles from './styles.module.css';
        console.log(JSON.stringify(styles));
      `,
      "/styles.module.css": `
        :global(.a :local(.b)) { color: red }
        :global(:is(.c, .d) :local(.e):not(.f)) .after { color: blue }
        .before:not(:global(.n)) { color: green }
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toMatchInlineSnapshot(`
        "// styles.module.css
        var styles_module_default = {
          b: "b_-MSaAA",
          e: "e_-MSaAA",
          after: "after_-MSaAA",
          before: "before_-MSaAA"
        };

        // entry.js
        console.log(JSON.stringify(styles_module_default));
        "
      `);
      api.expectFile("/out/entry.css").toMatchInlineSnapshot(`
        "/* styles.module.css */
        .a .b_-MSaAA {
          color: red;
        }

        :is(.c, .d) .e_-MSaAA:not(.f) .after_-MSaAA {
          color: #00f;
        }

        .before_-MSaAA:not(.n) {
          color: green;
        }
        "
      `);
    },
  });

  // `:is()` drops an invalid selector and keeps parsing the rest of its list
  // with the same selector parser, so a `:global(...)` whose argument fails to
  // parse must still hand the enclosing (local) scope back.
  itBundled("css-module/GlobalScopeRestoredAfterInvalidArgument", {
    files: {
      "/entry.js": `
        import styles from './styles.module.css';
        console.log(JSON.stringify(styles));
      `,
      "/styles.module.css": `
        .x:is(:global(.), .y) { color: red }
        .p:is(:global(), .q) { color: blue }
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toMatchInlineSnapshot(`
        "// styles.module.css
        var styles_module_default = {
          x: "x_-MSaAA",
          y: "y_-MSaAA",
          p: "p_-MSaAA",
          q: "q_-MSaAA"
        };

        // entry.js
        console.log(JSON.stringify(styles_module_default));
        "
      `);
      api.expectFile("/out/entry.css").toMatchInlineSnapshot(`
        "/* styles.module.css */
        .x_-MSaAA.y_-MSaAA {
          color: red;
        }

        .p_-MSaAA.q_-MSaAA {
          color: #00f;
        }
        "
      `);
    },
  });

  // The same name used both as a local class and inside `:global(...)` is
  // exported once, for the local use; the global use still prints as written.
  itBundled("css-module/GlobalAndLocalUseOfSameName", {
    files: {
      "/entry.js": `
        import styles from './styles.module.css';
        console.log(JSON.stringify(styles));
      `,
      "/styles.module.css": `
        .g { color: red }
        :global(.g) { color: blue }
        .wrap :global(.g) { color: green }
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toMatchInlineSnapshot(`
        "// styles.module.css
        var styles_module_default = {
          g: "g_-MSaAA",
          wrap: "wrap_-MSaAA"
        };

        // entry.js
        console.log(JSON.stringify(styles_module_default));
        "
      `);
      api.expectFile("/out/entry.css").toMatchInlineSnapshot(`
        "/* styles.module.css */
        .g_-MSaAA {
          color: red;
        }

        .g {
          color: #00f;
        }

        .wrap_-MSaAA .g {
          color: green;
        }
        "
      `);
    },
  });

  // Rules nested inside a `:global(...)` rule are not inside the parens, so
  // their own classes are still local.
  itBundled("css-module/GlobalPseudoFunctionDoesNotLeakIntoNestedRules", {
    files: {
      "/entry.js": `
        import styles from './styles.module.css';
        console.log(JSON.stringify(styles));
      `,
      "/styles.module.css": `
        :global(.a) {
          .b { color: red }
          &:global(.c) .d { color: blue }
        }
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toMatchInlineSnapshot(`
        "// styles.module.css
        var styles_module_default = {
          b: "b_-MSaAA",
          d: "d_-MSaAA"
        };

        // entry.js
        console.log(JSON.stringify(styles_module_default));
        "
      `);
      api.expectFile("/out/entry.css").toMatchInlineSnapshot(`
        "/* styles.module.css */
        .a .b_-MSaAA {
          color: red;
        }

        .a.c .d_-MSaAA {
          color: #00f;
        }
        "
      `);
    },
  });

  itBundled("css-module/OnlyGlobalSelectorsExportsNothing", {
    files: {
      "/entry.js": `
        import styles from './styles.module.css';
        console.log(JSON.stringify(styles));
      `,
      "/styles.module.css": `
        :global(.a) { color: red }
        :global(#b) :global(.c) { color: blue }
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toMatchInlineSnapshot(`
        "// styles.module.css
        var styles_module_default = {};

        // entry.js
        console.log(JSON.stringify(styles_module_default));
        "
      `);
      api.expectFile("/out/entry.css").toMatchInlineSnapshot(`
        "/* styles.module.css */
        .a {
          color: red;
        }

        #b .c {
          color: #00f;
        }
        "
      `);
    },
  });

  // A name that only ever appears inside `:global(...)` is not a local, so it
  // cannot be composed (previously this composed a hashed name that no rule
  // in the output used).
  itBundled("css-module/ComposesNameOnlyDefinedAsGlobal", {
    files: {
      "/entry.js": `
        import styles from './styles.module.css';
        console.log(JSON.stringify(styles));
      `,
      "/styles.module.css": `
        .a { composes: g; color: red }
        :global(.g) { color: blue }
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    bundleErrors: {
      "/styles.module.css": [
        'The name "g" never appears in "styles.module.css" as a CSS modules locally scoped class name.',
      ],
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
