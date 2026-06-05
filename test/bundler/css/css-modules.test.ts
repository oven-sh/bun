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
