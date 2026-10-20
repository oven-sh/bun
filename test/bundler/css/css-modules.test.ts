import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { itBundled } from "../expectBundled";

// Each run of white space becomes one space, so `.a .b` and `.a.b` stay different.
const oneLine = (text: string) => text.trim().replace(/\s+/g, " ");

// A stylesheet on one line, with the module hash written as `HASH`. `local` is
// a class that the stylesheet scopes.
function scopedOnOneLine(css: string, local: string) {
  const hash = css.match(new RegExp(`\\.${local}_([A-Za-z0-9_-]+)`))?.[1];
  expect(hash, `.${local} should be scoped`).toBeString();
  return oneLine(css.replaceAll(`_${hash}`, "_HASH"));
}

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

  // `:global(...)` and `:local(...)` print as their argument. When the wrapper
  // is the parent of a `&`, or the only argument of a `:is()`, the printer
  // chooses between the selector as written and `:is(selector)`. It chooses by
  // the argument, as for the same selector with no wrapper: `:is()` when the
  // argument has a combinator or starts with a type selector. The expected
  // lines select what the same rule selects with nesting kept.
  for (const backend of ["api", "cli"] as const) {
    itBundled(`css-module/ParentWrittenWithGlobalOrLocal/${backend}`, {
      backend,
      files: {
        "/entry.js": `
          import styles from './styles.module.css';
          console.log(JSON.stringify(styles));
        `,
        "/styles.module.css": `
          :global(.a .b) { .q1& { z-index: 1 } }
          :global(.a .b) { .q2 & { z-index: 2 } }
          :global(.a > .b) { .q3& { z-index: 3 } }
          :global(.a + .b) { .q4 & { z-index: 4 } }
          :global(.a > .b) { :not(.q5&) { z-index: 5 } }
          :global(div) { .q6& { z-index: 6 } }
          :global(div) { .q7 & { z-index: 7 } }
          :global(*) { .q8& { z-index: 8 } }
          :local(.c .d) { .q9& { z-index: 9 } }
          :global(:global(.e .f)) { .q10& { z-index: 10 } }
          :global(:global(span)) { .q11& { z-index: 11 } }
          .p:global(.a .b) { .q12& { z-index: 12 } }
          :global(.a .b) { @media print { .q13& { z-index: 13 } } }
          :global(.g) { .q14& { z-index: 14 } .q15 & { z-index: 15 } }
          .w1:is(:global(.a .b)) { z-index: 16 }
          .w2:is(:global(.a ~ .b)) { z-index: 17 }
          .w3:is(:global(:global(.e .f))) { z-index: 18 }
          .w4:is(:global(.g)) { z-index: 19 }
          .w5:is(:global(input:checked)) { z-index: 20 }
          :is(:global(div)).w6 { z-index: 21 }
          .w7:is(:global(.g), :global(.h)) { z-index: 22 }
        `,
      },
      entryPoints: ["/entry.js"],
      outdir: "/out",
      onAfterBundle(api) {
        expect(scopedOnOneLine(api.readFile("/out/entry.css"), "q1")).toBe(
          oneLine(`
            /* styles.module.css */
            .q1_HASH:is(.a .b) { z-index: 1; }
            .q2_HASH :is(.a .b) { z-index: 2; }
            .q3_HASH:is(.a > .b) { z-index: 3; }
            .q4_HASH :is(.a + .b) { z-index: 4; }
            :not(.q5_HASH:is(.a > .b)) { z-index: 5; }
            .q6_HASH:is(div) { z-index: 6; }
            .q7_HASH :is(div) { z-index: 7; }
            .q8_HASH:is(*) { z-index: 8; }
            .q9_HASH:is(.c_HASH .d_HASH) { z-index: 9; }
            .q10_HASH:is(.e .f) { z-index: 10; }
            .q11_HASH:is(span) { z-index: 11; }
            .q12_HASH:is(.p_HASH.a .b) { z-index: 12; }
            @media print {
              .q13_HASH:is(.a .b) { z-index: 13; }
            }
            .q14_HASH.g { z-index: 14; }
            .q15_HASH .g { z-index: 15; }
            .w1_HASH:is(.a .b) { z-index: 16; }
            .w2_HASH:is(.a ~ .b) { z-index: 17; }
            .w3_HASH:is(.e .f) { z-index: 18; }
            .w4_HASH.g { z-index: 19; }
            .w5_HASH:-webkit-any(input:checked) { z-index: 20; }
            .w5_HASH:-moz-any(input:checked) { z-index: 20; }
            .w5_HASH:is(input:checked) { z-index: 20; }
            :-webkit-any(div).w6_HASH { z-index: 21; }
            :-moz-any(div).w6_HASH { z-index: 21; }
            :is(div).w6_HASH { z-index: 21; }
            .w7_HASH:-webkit-any(.g, .h) { z-index: 22; }
            .w7_HASH:-moz-any(.g, .h) { z-index: 22; }
            .w7_HASH:is(.g, .h) { z-index: 22; }
          `),
        );
      },
    });
  }

  // `:is()` cannot match a pseudo-element. So a parent that has one inside the
  // wrapper still replaces `&` as written. A `:is()` that the stylesheet has
  // around such an argument stays.
  itBundled("css-module/ParentWithPseudoElementInsideGlobal", {
    files: {
      "/entry.js": `
        import styles from './styles.module.css';
        console.log(JSON.stringify(styles));
      `,
      "/styles.module.css": `
        :global(.btn::before) { .d1 & { z-index: 1 } }
        :global(.a::part(x)) { .d2 & { z-index: 2 } }
        :global(::slotted(.a)) { .d3 & { z-index: 3 } }
        :global(button::-moz-focus-inner) { .d4 & { z-index: 4 } }
        :global(.a :global(.btn::before)) { .d5 & { z-index: 5 } }
        .w1:is(:global(.a .btn::before)) { z-index: 6 }
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    onAfterBundle(api) {
      expect(scopedOnOneLine(api.readFile("/out/entry.css"), "d1")).toBe(
        oneLine(`
          /* styles.module.css */
          .d1_HASH .btn:before { z-index: 1; }
          .d2_HASH .a::part(x) { z-index: 2; }
          .d3_HASH ::slotted(.a) { z-index: 3; }
          .d4_HASH button::-moz-focus-inner { z-index: 4; }
          .d5_HASH .a .btn:before { z-index: 5; }
          .w1_HASH:is(.a .btn:before) { z-index: 6; }
        `),
      );
    },
  });

  // The same with nesting kept. `:is()` stays around an argument that has a
  // combinator or starts with a type selector, and goes when it is simple.
  itBundled("css-module/ParentWrittenWithGlobalNestingKept", {
    target: "bun",
    files: {
      "/entry.js": `
        import styles from './styles.module.css';
        console.log(JSON.stringify(styles));
      `,
      "/styles.module.css": `
        :global(.a .b) { .q1& { z-index: 1 } }
        .w1:is(:global(.a .b)) { z-index: 2 }
        .w2:is(:global(input:checked)) { z-index: 3 }
        .w3:is(:global(.g)) { z-index: 4 }
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    onAfterBundle(api) {
      expect(scopedOnOneLine(api.readFile("/out/entry.css"), "q1")).toBe(
        oneLine(`
          /* styles.module.css */
          .a .b {
            .q1_HASH& { z-index: 1; }
          }
          .w1_HASH:is(.a .b) { z-index: 2; }
          .w2_HASH:is(input:checked) { z-index: 3; }
          .w3_HASH.g { z-index: 4; }
        `),
      );
    },
  });

  // `:local(X)` names the same elements as `X`. So where the wrapper is the
  // parent of a `&`, or the only argument of a `:is()`, the two print the same
  // bytes, for each shape of `X`.
  const wrapperShapes = [".a .b", ".a > .b", ".a + .b", ".a ~ .b", "div", "div.a", "*", ".a", ".a.b", ".a:hover"];
  const wrapperContexts = [
    (x: string, n: number) => `${x} { .q${n}& { z-index: ${n} } }`,
    (x: string, n: number) => `${x} { .q${n} & { z-index: ${n} } }`,
    (x: string, n: number) => `${x} { :not(.q${n}&) { z-index: ${n} } }`,
    (x: string, n: number) => `${x} { @media print { .q${n}& { z-index: ${n} } } }`,
    (x: string, n: number) => `.q${n}:is(${x}) { z-index: ${n} }`,
    (x: string, n: number) => `.q${n} :is(${x}) { z-index: ${n} }`,
  ];
  const wrapperCells = (spell: (x: string) => string) =>
    wrapperContexts
      .flatMap((context, c) => wrapperShapes.map((x, s) => context(spell(x), c * wrapperShapes.length + s)))
      .join("\n");
  for (const target of ["browser", "bun"] as const) {
    itBundled(`css-module/LocalWrapperPrintsLikeNoWrapper/${target}`, {
      target,
      files: {
        "/entry.js": `
          import plain from './plain.module.css';
          import wrapped from './wrapped.module.css';
          console.log(JSON.stringify([plain, wrapped]));
        `,
        "/plain.module.css": wrapperCells(x => x),
        "/wrapped.module.css": wrapperCells(x => `:local(${x})`),
      },
      entryPoints: ["/entry.js"],
      outdir: "/out",
      onAfterBundle(api) {
        const [, plain, wrapped] = api.readFile("/out/entry.css").split(/\/\* \w+\.module\.css \*\//);
        expect(scopedOnOneLine(wrapped, "q0").split(" } ")).toEqual(scopedOnOneLine(plain, "q0").split(" } "));
      },
    });
  }
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

// With no link step a parent written with `:global(...)` still gets `:is()`
// when its argument has a combinator.
test("css-module/NoBundleParentWrittenWithGlobal", async () => {
  using dir = tempDir("css-module-no-bundle-global-parent", {
    "styles.module.css": `
      :global(.a .b) { .q& { color: green } }
      .w:is(:global(.a .b)) { color: blue }
      :global(div) { .x& { color: pink } }
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
  expect(scopedOnOneLine(stdout, "q")).toBe(
    oneLine(`
      .q_HASH:is(.a .b) { color: green; }
      .w_HASH:is(.a .b) { color: #00f; }
      .x_HASH:is(div) { color: pink; }
    `),
  );
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
