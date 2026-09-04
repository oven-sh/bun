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
