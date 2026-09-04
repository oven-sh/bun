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
