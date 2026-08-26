import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { basename, join } from "node:path";
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

  // Composing a class from another file that declares one of the composing
  // class's properties is reported at the two declarations of that property
  // (like esbuild), whichever rule of either class declares it.
  describe("composes conflict locations", () => {
    function where(position: BuildMessage["position"]) {
      const { file, line, column, length, lineText } = position!;
      return { file: basename(file), line, column, length, lineText };
    }

    async function composesConflicts(styles: string[], other: string[]) {
      using dir = tempDir("css-modules-composes-conflict", {
        "entry.js": `import styles from "./styles.module.css"; console.log(styles);`,
        "styles.module.css": styles.join("\n"),
        "other.module.css": other.join("\n"),
      });
      const build = await Bun.build({ entrypoints: [join(String(dir), "entry.js")], throw: false });
      return build.logs.map(log => {
        const [firstDefinition] = (log as BuildMessage & { notes: BuildMessage[] }).notes;
        return {
          message: log.message,
          at: where(log.position),
          note: firstDefinition.message,
          noteAt: where(firstDefinition.position),
        };
      });
    }

    test.concurrent("custom property declared by a later rule of the composing class", async () => {
      expect(
        await composesConflicts(
          [`.button { composes: other from "./other.module.css" }`, `.button { --x: 3 }`],
          [`.other { --x: 1 }`],
        ),
      ).toEqual([
        {
          message: "The value of --x in the class button is undefined.",
          at: { file: "styles.module.css", line: 2, column: 11, length: 3, lineText: ".button { --x: 3 }" },
          note: "The first definition of --x is here:",
          noteAt: { file: "other.module.css", line: 1, column: 10, length: 3, lineText: ".other { --x: 1 }" },
        },
      ]);
    });

    test.concurrent("known property declared by a later rule of the composing class", async () => {
      expect(
        await composesConflicts(
          [`.button { composes: other from "./other.module.css" }`, `.button { color: red }`],
          [`.other { color: blue }`],
        ),
      ).toEqual([
        {
          message: "The value of color in the class button is undefined.",
          at: { file: "styles.module.css", line: 2, column: 11, length: 5, lineText: ".button { color: red }" },
          note: "The first definition of color is here:",
          noteAt: { file: "other.module.css", line: 1, column: 10, length: 5, lineText: ".other { color: blue }" },
        },
      ]);
    });

    test.concurrent("!important declarations", async () => {
      expect(
        await composesConflicts(
          [`.button { composes: other from "./other.module.css" }`, `.button { color: red !important }`],
          [`.other { color: blue !important }`],
        ),
      ).toEqual([
        {
          message: "The value of color in the class button is undefined.",
          at: {
            file: "styles.module.css",
            line: 2,
            column: 11,
            length: 5,
            lineText: ".button { color: red !important }",
          },
          note: "The first definition of color is here:",
          noteAt: {
            file: "other.module.css",
            line: 1,
            column: 10,
            length: 5,
            lineText: ".other { color: blue !important }",
          },
        },
      ]);
    });

    test.concurrent("the declaration's own line inside a multi-line rule", async () => {
      expect(
        await composesConflicts(
          [`.button {`, `  composes: other from "./other.module.css";`, `  margin: 0;`, `  --x: 3;`, `}`],
          [`.other {`, `  color: red;`, `  --x: 1;`, `}`],
        ),
      ).toEqual([
        {
          message: "The value of --x in the class button is undefined.",
          at: { file: "styles.module.css", line: 4, column: 3, length: 3, lineText: "  --x: 3;" },
          note: "The first definition of --x is here:",
          noteAt: { file: "other.module.css", line: 3, column: 3, length: 3, lineText: "  --x: 1;" },
        },
      ]);
    });

    test.concurrent("the note points at the rule of the composed class that declares the property", async () => {
      expect(
        await composesConflicts(
          [`.button { --x: 3; composes: other from "./other.module.css" }`],
          [`.other { color: red }`, `.other { --x: 1 }`],
        ),
      ).toEqual([
        {
          message: "The value of --x in the class button is undefined.",
          at: {
            file: "styles.module.css",
            line: 1,
            column: 11,
            length: 3,
            lineText: `.button { --x: 3; composes: other from "./other.module.css" }`,
          },
          note: "The first definition of --x is here:",
          noteAt: { file: "other.module.css", line: 2, column: 10, length: 3, lineText: ".other { --x: 1 }" },
        },
      ]);
    });

    test.concurrent("each conflicting property is reported at its own declaration", async () => {
      expect(
        await composesConflicts(
          [`.button { composes: other from "./other.module.css" }`, `.button { --x: 3 }`, `.button { color: red }`],
          [`.other { --x: 1; color: blue }`],
        ),
      ).toEqual([
        {
          message: "The value of --x in the class button is undefined.",
          at: { file: "styles.module.css", line: 2, column: 11, length: 3, lineText: ".button { --x: 3 }" },
          note: "The first definition of --x is here:",
          noteAt: {
            file: "other.module.css",
            line: 1,
            column: 10,
            length: 3,
            lineText: ".other { --x: 1; color: blue }",
          },
        },
        {
          message: "The value of color in the class button is undefined.",
          at: { file: "styles.module.css", line: 3, column: 11, length: 5, lineText: ".button { color: red }" },
          note: "The first definition of color is here:",
          noteAt: {
            file: "other.module.css",
            line: 1,
            column: 18,
            length: 5,
            lineText: ".other { --x: 1; color: blue }",
          },
        },
      ]);
    });

    test.concurrent("classes without a shared property", async () => {
      expect(
        await composesConflicts(
          [`.button { composes: other from "./other.module.css" }`, `.button { --x: 3 }`],
          [`.other { --y: 1 }`, `.other { color: red }`],
        ),
      ).toEqual([]);
    });
  });
});
