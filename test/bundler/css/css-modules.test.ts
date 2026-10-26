import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { itBundled, type BundlerTestBundleAPI } from "../expectBundled";

// Each run of white space becomes one space, so `.a .b` and `.a.b` stay different.
const oneLine = (text: string) => text.trim().replace(/\s+/g, " ");

// The stylesheet (on one line) and the JS of a bundle, with the module hash
// written as `HASH`. `local` is a class that the stylesheet scopes.
function readScoped(api: BundlerTestBundleAPI, local: string) {
  const css = api.readFile("/out/entry.css");
  const hash = css.match(new RegExp(`\\.${local}_([A-Za-z0-9_-]+)`))?.[1];
  expect(hash, `.${local} should be scoped`).toBeString();
  const scoped = (text: string) => text.replaceAll(`_${hash}`, "_HASH");
  return { css: oneLine(scoped(css)), js: scoped(api.readFile("/out/entry.js")) };
}

const printsStyles = `
  import styles from './styles.module.css';
  console.log(JSON.stringify(styles));
`;

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

  // A class or id inside `:global(...)` keeps its name in the stylesheet, so
  // the exports object must not have it: the generated name it would get
  // there matches no rule. `:local(...)` inside `:global(...)` is local again.
  for (const backend of ["api", "cli"] as const) {
    itBundled(`css-module/GlobalNamesAreNotExported/${backend}`, {
      backend,
      files: {
        "/entry.js": printsStyles,
        "/styles.module.css": `
          :global(.g) { color: red }
          .local :global(.h) { color: blue }
          :global(.a :local(.b)) { color: green }
          :local(.c) { color: pink }
          #gid { color: black }
          :global(#gid2) { color: white }
          .n:not(:global(.ng)) { color: gray }
        `,
      },
      entryPoints: ["/entry.js"],
      outdir: "/out",
      onAfterBundle(api) {
        const { css, js } = readScoped(api, "local");
        expect(css).toBe(
          oneLine(`
            /* styles.module.css */
            .g { color: red; }
            .local_HASH .h { color: #00f; }
            .a .b_HASH { color: green; }
            .c_HASH { color: pink; }
            #gid_HASH { color: #000; }
            #gid2 { color: #fff; }
            .n_HASH:not(.ng) { color: gray; }
          `),
        );
        expect(js).toEqualIgnoringWhitespace(`
          // styles.module.css
          var styles_module_default = {
            local: "local_HASH",
            b: "b_HASH",
            c: "c_HASH",
            gid: "gid_HASH",
            n: "n_HASH"
          };

          // entry.js
          console.log(JSON.stringify(styles_module_default));
        `);
      },
    });
  }

  // The innermost `:local(...)` or `:global(...)` decides, at any depth.
  itBundled("css-module/LocalAndGlobalNestAtAnyDepth", {
    files: {
      "/entry.js": printsStyles,
      "/styles.module.css": `
        :local(.l1 :global(.g1 :local(.l2 :global(.g2)))) { color: red }
        :global(:is(.c, .d) :local(.e):not(.f)) .after { color: blue }
        :local(:global(.g3) .l3) :global(.g4) .l4 { color: green }
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    onAfterBundle(api) {
      const { css, js } = readScoped(api, "l1");
      expect(css).toBe(
        oneLine(`
          /* styles.module.css */
          .l1_HASH .g1 .l2_HASH .g2 { color: red; }
          :is(.c, .d) .e_HASH:not(.f) .after_HASH { color: #00f; }
          .g3 .l3_HASH .g4 .l4_HASH { color: green; }
        `),
      );
      expect(js).toEqualIgnoringWhitespace(`
        // styles.module.css
        var styles_module_default = {
          l1: "l1_HASH",
          l2: "l2_HASH",
          e: "e_HASH",
          after: "after_HASH",
          l3: "l3_HASH",
          l4: "l4_HASH"
        };

        // entry.js
        console.log(JSON.stringify(styles_module_default));
      `);
    },
  });

  // The scope reaches every selector that can hold a class: the functional
  // pseudo-classes, the pseudo-elements that take a selector, and `@scope`.
  itBundled("css-module/GlobalInEverySelectorContext", {
    files: {
      "/entry.js": printsStyles,
      "/styles.module.css": `
        :global(:is(.a, .b):not(.c):has(.d):nth-child(2 of .e)) .l1 { color: red }
        :global(:host(.f)) .l2 { color: red }
        :global(::slotted(.g)) { color: red }
        :global(video::cue(.h)) { color: red }
        :where(:global(.i), .l3):not(:global(.j)):has(:global(.k) .l4):nth-child(2 of :global(.m) .l5) { color: blue }
        @scope (:global(.s1)) to (:global(.s2) .l6) { .l7 { color: green } }
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    onAfterBundle(api) {
      const { css, js } = readScoped(api, "l1");
      expect(css).toBe(
        oneLine(`
          /* styles.module.css */
          :is(.a, .b):not(.c):has(.d):nth-child(2 of .e) .l1_HASH { color: red; }
          :host(.f) .l2_HASH { color: red; }
          ::slotted(.g) { color: red; }
          video::cue(.h) { color: red; }
          :where(.i, .l3_HASH):not(.j):has(.k .l4_HASH):nth-child(2 of .m .l5_HASH) { color: #00f; }
          @scope (.s1) to (.s2 .l6_HASH) {
            .l7_HASH { color: green; }
          }
        `),
      );
      expect(js).toEqualIgnoringWhitespace(`
        // styles.module.css
        var styles_module_default = {
          l1: "l1_HASH",
          l2: "l2_HASH",
          l3: "l3_HASH",
          l4: "l4_HASH",
          l5: "l5_HASH",
          l6: "l6_HASH",
          l7: "l7_HASH"
        };

        // entry.js
        console.log(JSON.stringify(styles_module_default));
      `);
    },
  });

  // The scope covers only the argument. `:is()` drops an argument that does
  // not parse and keeps parsing, so the local scope must be back for `.y` and
  // `.q`. A name that is also used as a local class is exported once, for
  // the local use.
  itBundled("css-module/GlobalScopeEndsAtTheClosingParen", {
    files: {
      "/entry.js": printsStyles,
      "/styles.module.css": `
        .x:is(:global(.), .y) { color: red }
        .p:is(:global(), .q) { color: blue }
        .g { color: red }
        :global(.g) { color: blue }
        .wrap :global(.g .only) .tail { color: green }
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    onAfterBundle(api) {
      const { css, js } = readScoped(api, "wrap");
      expect(css).toBe(
        oneLine(`
          /* styles.module.css */
          .x_HASH.y_HASH { color: red; }
          .p_HASH.q_HASH { color: #00f; }
          .g_HASH { color: red; }
          .g { color: #00f; }
          .wrap_HASH .g .only .tail_HASH { color: green; }
        `),
      );
      expect(js).toEqualIgnoringWhitespace(`
        // styles.module.css
        var styles_module_default = {
          x: "x_HASH",
          y: "y_HASH",
          p: "p_HASH",
          q: "q_HASH",
          g: "g_HASH",
          wrap: "wrap_HASH",
          tail: "tail_HASH"
        };

        // entry.js
        console.log(JSON.stringify(styles_module_default));
      `);
    },
  });

  // A name that is global in one rule and local in another is exported for
  // the local use, at the place of its first local use.
  itBundled("css-module/NameUsedInGlobalBeforeLocal", {
    files: {
      "/entry.js": printsStyles,
      "/styles.module.css": `
        :global(.b) { color: red }
        .a { color: blue }
        .b { color: green }
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    onAfterBundle(api) {
      const { css, js } = readScoped(api, "a");
      expect(css).toBe(
        oneLine(`
          /* styles.module.css */
          .b { color: red; }
          .a_HASH { color: #00f; }
          .b_HASH { color: green; }
        `),
      );
      expect(js).toEqualIgnoringWhitespace(`
        // styles.module.css
        var styles_module_default = {
          a: "a_HASH",
          b: "b_HASH"
        };

        // entry.js
        console.log(JSON.stringify(styles_module_default));
      `);
    },
  });

  // The invariant behind the tests above: the stylesheet scopes a name exactly
  // when the module exports it. In each shape `l` and `m` must be local and
  // `g` and `h` must be global. Each rule gets its own names.
  const shapes = [
    ".l :global(.g)",
    ":global(.g) .l",
    ":global(.g :local(.l))",
    ":local(.l :global(.g))",
    ":global(.g :local(.l :global(.h)))",
    "#l :global(#g)",
    ".l:not(:global(.g))",
    ":global(:is(.g, .h)) .l",
    ":global(.g:has(.h)) .l",
    ".l:where(:global(.g), .m)",
    "::view-transition-group(*.l)",
    ":global(::view-transition-group(*.g))",
    ":global(.g)::view-transition-old(*.l)",
  ].map((shape, i) => shape.replace(/([.#])([lmgh])\b/g, (_, sigil, name) => sigil + name + i));
  const shapeNames = shapes.flatMap(shape => [...shape.matchAll(/[.#]([lmgh]\d+)/g)].map(m => m[1]));
  const isLocalName = (name: string) => name.startsWith("l") || name.startsWith("m");
  itBundled("css-module/ScopedNamesAreTheExportedNames", {
    files: {
      "/entry.js": printsStyles,
      "/styles.module.css": shapes.map((shape, i) => `${shape} { z-index: ${i} }`).join("\n"),
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    onAfterBundle(api) {
      const { css, js } = readScoped(api, "l0");
      const printed = [...css.replace("/* styles.module.css */", "").matchAll(/[.#]([\w-]+)/g)].map(m => m[1]);
      expect(printed).toEqual(shapeNames.map(name => (isLocalName(name) ? `${name}_HASH` : name)));
      const exported = [...js.matchAll(/^\s*(\w+): "(\w+)",?$/gm)].map(m => [m[1], m[2]]);
      expect(exported).toEqual(shapeNames.filter(isLocalName).map(name => [name, `${name}_HASH`]));
    },
  });

  // Rules nested in a `:global(...)` rule are not inside its parentheses, so
  // their classes are local. `&` inside `:global(...)` is the parent selector:
  // it prints once, under its generated name, as a descendant (`& .x`) or in
  // the same compound (`&.x`).
  itBundled("css-module/GlobalRuleWithNestedRules", {
    files: {
      "/entry.js": printsStyles,
      "/styles.module.css": `
        :global(.a) {
          .b { color: red }
          &:global(.c) .d { color: blue }
        }
        .parent { :global(& .x) { color: red } }
        .p2 { :global(.y &) { color: blue } }
        .p3 { :local(& .z) { color: green } }
        .p4 { :global(&.x) { color: red } }
        .p5 { :global(.y&) { color: blue } }
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    onAfterBundle(api) {
      const { css, js } = readScoped(api, "parent");
      expect(css).toBe(
        oneLine(`
          /* styles.module.css */
          .a .b_HASH { color: red; }
          .a.c .d_HASH { color: #00f; }
          .parent_HASH .x { color: red; }
          .y .p2_HASH { color: #00f; }
          .p3_HASH .z_HASH { color: green; }
          .p4_HASH.x { color: red; }
          .y.p5_HASH { color: #00f; }
        `),
      );
      expect(js).toEqualIgnoringWhitespace(`
        // styles.module.css
        var styles_module_default = {
          b: "b_HASH",
          d: "d_HASH",
          parent: "parent_HASH",
          p2: "p2_HASH",
          p3: "p3_HASH",
          z: "z_HASH",
          p4: "p4_HASH",
          p5: "p5_HASH"
        };

        // entry.js
        console.log(JSON.stringify(styles_module_default));
      `);
    },
  });

  // The argument of `:global(...)` or `:local(...)` prints in place of the
  // wrapper. A `&` that starts the argument starts the printed selector only
  // when the wrapper does. Anywhere else a parent with a combinator needs
  // `:is()`. A type selector after the `&` always moves in front of it.
  itBundled("css-module/AmpersandInsideGlobalUnderAComplexParent", {
    files: {
      "/entry.js": printsStyles,
      "/styles.module.css": `
        .a .b {
          :global(&.x) { color: red }
          .q:global(&.x) { color: orange }
          .q :global(& .x) { color: yellow }
          :global(.y &) { color: green }
          .q:local(&.z) { color: blue }
          :global(:local(&.w)) { color: pink }
          .q :global(&div) { color: purple }
        }
        .p { .q > :global(&div) { color: gray } }
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    onAfterBundle(api) {
      const { css, js } = readScoped(api, "a");
      expect(css).toBe(
        oneLine(`
          /* styles.module.css */
          .a_HASH .b_HASH.x { color: red; }
          .q_HASH:is(.a_HASH .b_HASH).x { color: orange; }
          .q_HASH :is(.a_HASH .b_HASH) .x { color: #ff0; }
          .y :is(.a_HASH .b_HASH) { color: green; }
          .q_HASH:is(.a_HASH .b_HASH).z_HASH { color: #00f; }
          .a_HASH .b_HASH.w_HASH { color: pink; }
          .q_HASH div:is(.a_HASH .b_HASH) { color: purple; }
          .q_HASH > div.p_HASH { color: gray; }
        `),
      );
      expect(js).toEqualIgnoringWhitespace(`
        // styles.module.css
        var styles_module_default = {
          a: "a_HASH",
          b: "b_HASH",
          q: "q_HASH",
          z: "z_HASH",
          w: "w_HASH",
          p: "p_HASH"
        };

        // entry.js
        console.log(JSON.stringify(styles_module_default));
      `);
    },
  });

  itBundled("css-module/OnlyGlobalSelectorsExportsNothing", {
    files: {
      "/entry.js": printsStyles,
      "/styles.module.css": `
        :global(.a) { color: red }
        :global(#b) :global(.c) { color: blue }
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    onAfterBundle(api) {
      expect(oneLine(api.readFile("/out/entry.css"))).toBe(
        oneLine(`
          /* styles.module.css */
          .a { color: red; }
          #b .c { color: #00f; }
        `),
      );
      api.expectFile("/out/entry.js").toEqualIgnoringWhitespace(`
        // styles.module.css
        var styles_module_default = {};

        // entry.js
        console.log(JSON.stringify(styles_module_default));
      `);
    },
  });

  // A name that only exists inside `:global(...)` is not a local name, so
  // `composes` cannot use it and a named import cannot bind it.
  itBundled("css-module/ComposesNameOnlyDefinedAsGlobal", {
    files: {
      "/entry.js": printsStyles,
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

  itBundled("css-module/NamedImportOfGlobalOnlyName", {
    files: {
      "/entry.js": `
        import { g, l } from './styles.module.css';
        console.log(g, l);
      `,
      "/styles.module.css": `
        :global(.g) { color: red }
        .l { color: blue }
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    bundleErrors: {
      "/entry.js": ['No matching export in "styles.module.css" for import "g"'],
    },
  });

  // The printer hashes a view-transition name of a module, and a
  // view-transition class is a local symbol. Both stay as written inside
  // `:global(...)`, and two equal global rules still merge into one.
  itBundled("css-module/ViewTransitionInsideGlobal", {
    files: {
      "/entry.js": printsStyles,
      "/styles.module.css": `
        .card { view-transition-name: hero }
        ::view-transition-group(hero) { color: red }
        :global(::view-transition-group(hero)) { color: red }
        :global(::view-transition-group(hero)) { color: red }
        :global(::view-transition-old(*.slide)) { color: blue }
        :global(:local(::view-transition-new(hero.fade))) { color: green }
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    onAfterBundle(api) {
      const { css, js } = readScoped(api, "card");
      expect(css).toBe(
        oneLine(`
          /* styles.module.css */
          .card_HASH { view-transition-name: hero_HASH; }
          ::view-transition-group(hero_HASH) { color: red; }
          ::view-transition-group(hero) { color: red; }
          ::view-transition-old(*.slide) { color: #00f; }
          ::view-transition-new(hero_HASH.fade_HASH) { color: green; }
        `),
      );
      expect(js).toEqualIgnoringWhitespace(`
        // styles.module.css
        var styles_module_default = {
          card: "card_HASH",
          fade: "fade_HASH"
        };

        // entry.js
        console.log(JSON.stringify(styles_module_default));
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

// With no link step the printer still has to follow the scope that the parser
// gave each name: a `:local(...)` inside `:global(...)` is hashed, the rest of
// the `:global(...)` argument is not.
test("css-module/NoBundleLocalInsideGlobal", async () => {
  using dir = tempDir("css-module-no-bundle-global", {
    "styles.module.css": `
      .card { color: red }
      :global(.a :local(.b)) { color: green }
      :global(::view-transition-group(hero)) { color: blue }
      :global(:local(::view-transition-group(hero.fade))) { color: pink }
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
  const hash = stdout.match(/\.card_([A-Za-z0-9_-]+)\s*\{/)?.[1];
  expect(hash, ".card should be scoped").toBeString();
  expect(oneLine(stdout.replaceAll(`_${hash}`, "_HASH"))).toBe(
    oneLine(`
      .card_HASH { color: red; }
      .a .b_HASH { color: green; }
      ::view-transition-group(hero) { color: #00f; }
      ::view-transition-group(hero_HASH.fade_HASH) { color: pink; }
    `),
  );
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
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
