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

  // An `animation` or `animation-name` value with no typed form (it holds a
  // `var()`, an `env()`, a `linear()`, or an `auto` before the name) is kept
  // as raw tokens. Each keyframes name in it must get the hash of the
  // `@keyframes` rule, and every other token must print as written.
  // Rows are [declarations as written, declarations as printed]. `#` stands
  // for the hash of the module.
  const rawTokenAnimations: [written: string, printed: string][] = [
    // The typed form, for comparison.
    ["animation: 1s reveal", "animation: 1s reveal_#"],

    // var(), env(), linear(), and an `auto` before the name.
    ["animation: reveal var(--d) linear both", "animation: reveal_# var(--d) linear both"],
    ["animation: var(--d) reveal", "animation: var(--d) reveal_#"],
    ["animation: env(--x) reveal", "animation: env(--x) reveal_#"],
    ["animation: 1s linear(0, 0.5 50%, 1) reveal", "animation: 1s linear(0, .5 50%, 1) reveal_#"],
    ["animation: auto linear both reveal", "animation: auto linear both reveal_#"],
    ["animation: 1s reveal, var(--other)", "animation: 1s reveal_#, var(--other)"],
    ["animation: 1s reveal, auto linear both reveal", "animation: 1s reveal_#, auto linear both reveal_#"],
    ["animation: reveal var(--d) !important", "animation: reveal_# var(--d) !important"],
    ["-webkit-animation: reveal var(--d)", "-webkit-animation: reveal_# var(--d)"],
    // From `src/style.module.css` of react-day-picker 9.14.0.
    [
      "animation: rdp-slide_in_left var(--rdp-animation_duration) var(--rdp-animation_timing) forwards",
      "animation: rdp-slide_in_left_# var(--rdp-animation_duration) var(--rdp-animation_timing) forwards",
    ],

    // A quoted name prints as a hashed ident.
    ['animation: "reveal" var(--d)', "animation: reveal_# var(--d)"],
    ['animation: var(--d) "reveal"', "animation: var(--d) reveal_#"],
    // With no space beside it, the ident would join the next token, so the
    // quoted name stays as written.
    ['animation: "reveal"var(--d)', 'animation: "reveal"var(--d)'],
    ['animation: 1s"reveal" var(--d)', 'animation: 1s"reveal" var(--d)'],

    // A dashed name. After the name, a dashed ident is a timeline.
    ["animation: --reveal var(--d)", "animation: --reveal_# var(--d)"],
    ["animation: reveal var(--d) --timeline", "animation: reveal_# var(--d) --timeline"],

    // The `animation-name` longhand. There, only `none` is a keyword.
    ["animation-name: reveal, var(--x)", "animation-name: reveal_#, var(--x)"],
    ['animation-name: var(--x), "reveal"', "animation-name: var(--x), reveal_#"],
    ["animation-name: --reveal, var(--x)", "animation-name: --reveal_#, var(--x)"],
    ["animation-name: linear, none, var(--x)", "animation-name: linear_#, none, var(--x)"],
    ["-webkit-animation-name: var(--x), reveal", "-webkit-animation-name: var(--x), reveal_#"],
    // A name in the fallback of a `var()` is not in these tokens.
    ["animation-name: var(--n, reveal)", "animation-name: var(--n, reveal)"],

    // The order of the declarations in a block stays as written.
    ["animation: 1s reveal; animation: reveal var(--d)", "animation: 1s reveal_#; animation: reveal_# var(--d)"],

    // Keywords of the other sub-properties are not names, in any case.
    [
      "animation: var(--d) LINEAR Ease-In Infinite Alternate BOTH Paused AUTO reveal",
      "animation: var(--d) LINEAR Ease-In Infinite Alternate BOTH Paused AUTO reveal_#",
    ],
    ["animation: none var(--d)", "animation: none var(--d)"],
    ["animation: var(--whole)", "animation: var(--whole)"],
    // A typed value takes the second `linear` as the name. Here the `var()`
    // can hold a comma or an easing, so a keyword is never taken as a name.
    ["animation: 1s linear linear", "animation: 1s linear linear_#"],
    ["animation: linear var(--d) linear", "animation: linear var(--d) linear"],

    // CSS-wide keywords (and `default`) are not names.
    ["animation: inherit", "animation: inherit"],
    ["animation: initial", "animation: initial"],
    ["animation: unset", "animation: unset"],
    ["animation: revert", "animation: revert"],
    ["animation: revert-layer", "animation: revert-layer"],
    ["animation: default var(--d)", "animation: default var(--d)"],
    ["animation-name: initial", "animation-name: initial"],

    // The arguments of a function are not in a name position.
    ["animation: reveal 1s scroll(root block)", "animation: reveal_# 1s scroll(root block)"],
    ["animation: var(--d) steps(4, jump-none) reveal", "animation: var(--d) steps(4, jump-none) reveal_#"],
    // A bare block is not valid in `animation`. An ident in it is tagged like
    // the others.
    ["animation: [reveal] var(--d)", "animation: [reveal_#] var(--d)"],
  ];

  /** The declarations of each `.r<index>` rule of `css`, keyed by the row as written. */
  function printedRows(css: string, rows: [written: string, printed: string][]) {
    const printed: Record<string, string> = {};
    // Adjacent rules with equal declarations are merged into one selector list.
    for (const [, selectors, body] of css.matchAll(/^(\.r\d[^{]*) \{\n([^}]*);\n\}/gm)) {
      for (const [, index] of selectors.matchAll(/\.r(\d+)/g)) {
        printed[rows[+index][0]] = body.trim().replaceAll(/;\n\s*/g, "; ");
      }
    }
    return printed;
  }

  itBundled("css-module/AnimationNameScopedInRawTokens", {
    files: {
      "/entry.js": `
        import styles from './styles.module.css';
        console.log(styles);
      `,
      "/styles.module.css":
        rawTokenAnimations.map(([written], index) => `.r${index} { ${written} }`).join("\n") +
        "\n@keyframes reveal { to { opacity: 1 } }",
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    onAfterBundle(api) {
      const css = api.readFile("/out/entry.css");
      const hash = css.match(/@keyframes reveal_([A-Za-z0-9_-]+) \{/)?.[1];
      expect(hash, "@keyframes reveal should be scoped").toBeDefined();

      expect(printedRows(css, rawTokenAnimations)).toEqual(
        Object.fromEntries(rawTokenAnimations.map(([written, printed]) => [written, printed.replaceAll("#", hash!)])),
      );
    },
  });

  // The same tokens under `--minify-whitespace`.
  itBundled("css-module/AnimationNameScopedInRawTokensMinified", {
    files: {
      "/entry.js": `
        import styles from './styles.module.css';
        console.log(styles);
      `,
      "/styles.module.css": `
        .a { animation: 1s reveal var(--d) }
        .b { animation: infinite "reveal" var(--d) }
        .c { animation: --reveal var(--d) }
        @keyframes reveal { to { opacity: 1 } }
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    minifyWhitespace: true,
    onAfterBundle(api) {
      const css = api.readFile("/out/entry.css");
      const hash = css.match(/@keyframes reveal_([A-Za-z0-9_-]+)\{/)?.[1];
      expect(hash, "@keyframes reveal should be scoped").toBeDefined();

      expect(css.trim()).toBe(
        [
          `.a_${hash}{animation:1s reveal_${hash} var(--d)}`,
          `.b_${hash}{animation:infinite reveal_${hash} var(--d)}`,
          `.c_${hash}{animation:--reveal_${hash} var(--d)}`,
          `@keyframes reveal_${hash}{to{opacity:1}}`,
        ].join(""),
      );
    },
  });

  // Every kind of block that holds declarations scopes the name. The minify
  // pass does not visit `@page`, `style()` and keyframe blocks.
  itBundled("css-module/AnimationNameScopedInRawTokensInEveryBlock", {
    files: {
      "/entry.js": `
        import styles from './styles.module.css';
        console.log(styles);
      `,
      "/styles.module.css": `
        .card { & .inner { animation: reveal var(--d) } }
        @media (min-width: 1px) { .a { animation: reveal var(--d) } }
        @supports (display: grid) { .b { animation: reveal var(--d) } }
        @layer base { .c { animation: reveal var(--d) } }
        @container (min-width: 1px) { .d { animation: reveal var(--d) } }
        @scope (.e) { .f { animation: reveal var(--d) } }
        @starting-style { .g { animation: reveal var(--d) } }
        @page { animation: reveal var(--d) }
        @container style(animation: reveal var(--d)) { .h { color: red } }
        @keyframes reveal { to { opacity: 1 } }
        @keyframes other { to { animation: reveal var(--d) } }
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    onAfterBundle(api) {
      const css = api.readFile("/out/entry.css");
      const hash = css.match(/@keyframes reveal_([A-Za-z0-9_-]+) \{/)?.[1];
      expect(hash, "@keyframes reveal should be scoped").toBeDefined();

      const names = [...css.matchAll(/animation: (\S+) var\(--d\)/g)].map(([, name]) => name);
      expect(names).toEqual(Array.from({ length: 10 }, () => `reveal_${hash}`));
    },
  });

  // A file that is not a CSS module has no names to scope. Its raw tokens,
  // the quotes of a name included, print as written.
  const plainAnimations = [
    "animation: reveal var(--d) linear both",
    'animation: "reveal" var(--d)',
    "animation: --reveal var(--d)",
    "animation: auto linear both reveal",
    'animation-name: "reveal", var(--x)',
    "animation: inherit",
  ];
  itBundled("css/AnimationRawTokensAsWritten", {
    files: {
      "/entry.js": `import './styles.css';`,
      "/styles.css":
        plainAnimations.map((written, index) => `.r${index} { ${written} }`).join("\n") +
        "\n@keyframes reveal { to { opacity: 1 } }",
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    onAfterBundle(api) {
      const css = api.readFile("/out/entry.css");
      expect(css).toContain("@keyframes reveal {");

      const rows = plainAnimations.map((written): [string, string] => [written, written]);
      expect(printedRows(css, rows)).toEqual(Object.fromEntries(rows));
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

  // A `view-transition-*` value the grammar rejects stays untouched, so a
  // future keyword or a var() reference is not hashed as if it were a name.
  // (`animation` and `animation-name` do hash the names in such a value, see
  // `css-module/AnimationNameScopedInRawTokens`.)
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

// `bun build --no-bundle` parses a module file through the transpiler, not
// the bundler. A keyframes name in raw tokens is scoped there too.
test("css-module/NoBundleAnimationNameScopedInRawTokens", async () => {
  using dir = tempDir("css-module-no-bundle-animation", {
    "styles.module.css": `
      .card { animation: reveal var(--d); animation-name: var(--x), reveal }
      @keyframes reveal { to { opacity: 1 } }
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
  const hash = stdout.match(/@keyframes reveal_([A-Za-z0-9_-]+) \{/)?.[1];
  expect(hash, "@keyframes reveal should be scoped").toBeDefined();
  expect(stdout).toEqualIgnoringWhitespace(`
    .card_${hash} {
      animation: reveal_${hash} var(--d);
      animation-name: var(--x), reveal_${hash};
    }

    @keyframes reveal_${hash} {
      to {
        opacity: 1;
      }
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
