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

/**
 * Runs `bun build <entry> --outdir out` on the given files (plus an `entry.js`
 * that imports `styles.module.css` and logs its exports). On success, returns
 * the emitted stylesheet and, for a JS entry, the exports object it logs.
 */
async function buildCssModule(files: Record<string, string>, entry = "entry.js") {
  using dir = tempDir("css-module-composes", {
    "entry.js": `import styles from "./styles.module.css";\nconsole.log(JSON.stringify(styles));`,
    ...files,
  });
  const run = async (args: string[]) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  };

  const { stderr, exitCode } = await run(["build", entry, "--outdir", "out"]);
  if (exitCode !== 0) return { stderr, exitCode, css: undefined, exports: undefined };
  const css = await Bun.file(join(String(dir), "out", "entry.css")).text();
  const exports = entry.endsWith(".js") ? JSON.parse((await run([join("out", "entry.js")])).stdout) : undefined;
  return { stderr, exitCode, css, exports };
}

// The parser decides whether a `composes` declaration counts (it has to sit
// directly in a style rule whose selector is a single class) and records the
// accepted ones for the bundler; the printer omits the property from the
// stylesheet. Rejected declarations are reported as warnings and dropped, like
// esbuild does; they must not fail the build.
describe.concurrent("css-module composes placement", () => {
  test("inside a nested style rule it is rejected with a warning", async () => {
    const { stderr, exitCode, exports, css } = await buildCssModule({
      "styles.module.css": `
        .c { color: red }
        .a { .z { composes: c; color: blue } }
      `,
    });
    expect({ exitCode, stderr }).toEqual({
      exitCode: 0,
      stderr: expect.stringContaining('"composes" is not allowed inside nested selectors'),
    });
    expect(exports).toEqual({ c: "c_-MSaAA", a: "a_-MSaAA", z: "z_-MSaAA" });
    expect(css).toMatchInlineSnapshot(`
      "/* styles.module.css */
      .c_-MSaAA {
        color: red;
      }

      .a_-MSaAA .z_-MSaAA {
        color: #00f;
      }
      "
    `);
  });

  test("on a selector that is not a single class it is rejected with a warning", async () => {
    const { stderr, exitCode, exports, css } = await buildCssModule({
      "styles.module.css": `
        .c { color: red }
        .a .b { composes: c; color: blue }
      `,
    });
    expect({ exitCode, stderr }).toEqual({
      exitCode: 0,
      stderr: expect.stringContaining('"composes" only works inside single class selectors'),
    });
    expect(exports).toEqual({ c: "c_-MSaAA", a: "a_-MSaAA", b: "b_-MSaAA" });
    expect(css).toMatchInlineSnapshot(`
      "/* styles.module.css */
      .c_-MSaAA {
        color: red;
      }

      .a_-MSaAA .b_-MSaAA {
        color: #00f;
      }
      "
    `);
  });

  test("directly inside an at-rule nested in a style rule it is rejected with a warning", async () => {
    const { stderr, exitCode, exports, css } = await buildCssModule({
      "styles.module.css": `
        .c { color: red }
        .a { @media (min-width: 1px) { composes: c; color: blue } }
      `,
    });
    expect({ exitCode, stderr }).toEqual({
      exitCode: 0,
      stderr: expect.stringContaining('"composes" is not allowed inside nested selectors'),
    });
    expect(exports).toEqual({ c: "c_-MSaAA", a: "a_-MSaAA" });
    expect(css).toMatchInlineSnapshot(`
      "/* styles.module.css */
      .c_-MSaAA {
        color: red;
      }

      @media (min-width: 1px) {
        .a_-MSaAA {
          color: #00f;
        }
      }
      "
    `);
  });

  test("in a style rule inside a top-level at-rule it is accepted", async () => {
    const { stderr, exitCode, exports, css } = await buildCssModule({
      "styles.module.css": `
        .c { color: red }
        @media (min-width: 1px) { .b { composes: c } }
        @supports (display: grid) { @layer x { .d { composes: c; color: blue } } }
      `,
    });
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
    expect(exports).toEqual({ c: "c_-MSaAA", b: "c_-MSaAA b_-MSaAA", d: "c_-MSaAA d_-MSaAA" });
    expect(css).toMatchInlineSnapshot(`
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
  });

  test("a module pulled in by a conditional @import still prints", async () => {
    const { stderr, exitCode, css } = await buildCssModule(
      {
        "entry.css": `@import "./styles.module.css" layer(base) supports(display: grid) (min-width: 1px);`,
        "styles.module.css": `
          .c { color: red }
          .b { composes: c }
        `,
      },
      "entry.css",
    );
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
    expect(css).toMatchInlineSnapshot(`
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
  });

  test("a rejected declaration does not pull in the file it composes from", async () => {
    const { stderr, exitCode, exports, css } = await buildCssModule({
      "styles.module.css": `
        .c { color: red }
        .a .b { composes: x from "./other.module.css"; color: blue }
        .a .d { composes: y from "./missing.module.css" }
        .ok { composes: c }
      `,
      "other.module.css": `.x { color: green }`,
    });
    expect({ exitCode, stderr }).toEqual({
      exitCode: 0,
      stderr: expect.stringContaining('"composes" only works inside single class selectors'),
    });
    expect(exports).toEqual({ c: "c_-MSaAA", a: "a_-MSaAA", b: "b_-MSaAA", d: "d_-MSaAA", ok: "c_-MSaAA ok_-MSaAA" });
    // Neither other.module.css nor the unresolvable missing.module.css is part
    // of the bundle.
    expect(css).toMatchInlineSnapshot(`
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
  });
});
