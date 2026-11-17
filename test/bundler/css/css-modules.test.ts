import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync } from "node:fs";
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

  // The class-name object is in a chunk that both entry points import. #18435 printed a copy into
  // each entry point, and said that the object should get a chunk of its own.
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
      const [barEntry, chunk, fooEntry] = readdirSync(api.outdir)
        .filter(file => file.endsWith(".js"))
        .sort();
      expect([barEntry, chunk, fooEntry]).toEqual([
        "bar-entry.js",
        expect.stringMatching(/^foo-entry-[a-z0-9]{8}\.js$/),
        "foo-entry.js",
      ]);
      api.expectFile("/out/" + chunk).toMatchInlineSnapshot(`
        "// common.module.css
        var common_module_default = {
          baz: "baz_I7o34g"
        };

        export { common_module_default };
        "
      `);
      expect(api.readFile("/out/foo-entry.js").replace(chunk, "chunk.js")).toMatchInlineSnapshot(`
        "import {
          common_module_default
        } from "./chunk.js";

        // foo-entry.js
        console.log(common_module_default);
        "
      `);
      expect(api.readFile("/out/bar-entry.js").replace(chunk, "chunk.js")).toMatchInlineSnapshot(`
        "import {
          common_module_default
        } from "./chunk.js";

        // bar-entry.js
        console.log(common_module_default);
        "
      `);
    },
    run: [
      { file: "/out/foo-entry.js", stdout: '{\n  baz: "baz_I7o34g",\n}' },
      { file: "/out/bar-entry.js", stdout: '{\n  baz: "baz_I7o34g",\n}' },
    ],
  });

  // JavaScript that reads the value of a stylesheet gets the class names, in every output format.
  // The value is in a module of its own, so one stylesheet has one object and one `require()` result.
  const stylesheets = {
    "/x.module.css": `.foo { color: red }`,
    "/plain.css": `.plain { color: green }`,
    "/kebab.module.css": `.foo-bar { color: red } .baz { color: blue }`,
    "/glob/a.module.css": `.a { color: red }`,
    "/glob/b.module.css": `.b { color: blue }`,
  };
  const valueShapes: Record<
    string,
    { files: Record<string, string>; entryPoints?: string[]; run: Record<string, string>; skipModes?: string[] }
  > = {
    // Only the namespace object needs a runtime helper here.
    NamespaceImport: {
      files: {
        "/entry.js": `
          import * as styles from "./x.module.css";
          import * as plain from "./plain.css";
          console.log(JSON.stringify([styles, plain]));
        `,
      },
      run: { "entry.js": '[{"default":{"foo":"foo_e7Ht-A"},"foo":"foo_e7Ht-A"},{"default":{}}]' },
    },
    // An entry point that only has a default import prints the object that another entry point names.
    NamespaceImportNextToDefaultImport: {
      files: {
        "/a.js": `import * as styles from "./x.module.css"; console.log("a", JSON.stringify(styles));`,
        "/b.js": `import styles from "./x.module.css"; console.log("b", JSON.stringify(styles));`,
      },
      entryPoints: ["/a.js", "/b.js"],
      run: {
        "a.js": 'a {"default":{"foo":"foo_e7Ht-A"},"foo":"foo_e7Ht-A"}',
        "b.js": 'b {"foo":"foo_e7Ht-A"}',
      },
    },
    // A file with a run-time `export *` keeps the exports object of what it imports.
    DefaultImportNextToRuntimeExportStar: {
      files: {
        "/a.js": `
          import styles from "./x.module.css";
          export * from "./commonjs.cjs";
          console.log("a", JSON.stringify(styles));
        `,
        "/b.js": `import styles from "./x.module.css"; console.log("b", JSON.stringify(styles));`,
        "/commonjs.cjs": `module.exports = { value: 1 };`,
      },
      entryPoints: ["/a.js", "/b.js"],
      run: { "a.js": 'a {"foo":"foo_e7Ht-A"}', "b.js": 'b {"foo":"foo_e7Ht-A"}' },
    },
    ExportStar: {
      files: {
        "/a.js": `import * as styles from "./x.module.css"; console.log("a", Object.keys(styles).join());`,
        "/b.js": `export * from "./x.module.css"; console.log("b");`,
      },
      entryPoints: ["/a.js", "/b.js"],
      run: { "a.js": "a default,foo", "b.js": "b" },
    },
    Require: {
      files: {
        "/entry.js": `
          const styles = require("./x.module.css");
          const plain = require("./plain.css");
          console.log(JSON.stringify([styles, plain]));
          export {};
        `,
      },
      run: { "entry.js": '[{"foo":"foo_e7Ht-A"},{}]' },
    },
    RequireNextToDefaultImport: {
      files: {
        "/a.js": `console.log("a", JSON.stringify(require("./x.module.css"))); export {};`,
        "/b.js": `import styles from "./x.module.css"; console.log("b", JSON.stringify(styles));`,
      },
      entryPoints: ["/a.js", "/b.js"],
      run: { "a.js": 'a {"foo":"foo_e7Ht-A"}', "b.js": 'b {"foo":"foo_e7Ht-A"}' },
    },
    RequireAndDefaultImportAreOneObject: {
      files: {
        "/entry.js": `
          import styles from "./x.module.css";
          console.log(styles === require("./x.module.css"), JSON.stringify(styles));
        `,
      },
      run: { "entry.js": 'true {"foo":"foo_e7Ht-A"}' },
    },
    // The wrapper of a require()d file covers the stylesheet that the file imports.
    RequireOfFileThatImportsStylesheet: {
      files: {
        "/a.js": `console.log("a", JSON.stringify(require("./component.js").styles)); export {};`,
        "/b.js": `import styles from "./x.module.css"; console.log("b", JSON.stringify(styles));`,
        "/component.js": `import styles from "./x.module.css"; export { styles };`,
      },
      entryPoints: ["/a.js", "/b.js"],
      run: { "a.js": 'a {"foo":"foo_e7Ht-A"}', "b.js": 'b {"foo":"foo_e7Ht-A"}' },
    },
    RequireOfStylesheetThatComposes: {
      files: {
        "/entry.js": `
          import base from "./base.module.css";
          console.log(JSON.stringify([require("./button.module.css"), base]));
        `,
        "/button.module.css": `.button { composes: base from "./base.module.css"; color: red }`,
        "/base.module.css": `.base { padding: 0 }`,
      },
      run: { "entry.js": '[{"button":"base_1Cz41w button_6E65eQ"},{"base":"base_1Cz41w"}]' },
    },
    DynamicImport: {
      files: {
        "/entry.js": `
          import("./x.module.css").then(styles =>
            console.log(JSON.stringify(styles.default), Object.keys(styles).sort().join()),
          );
        `,
      },
      run: { "entry.js": '{"foo":"foo_e7Ht-A"} default,foo' },
    },
    StylesheetEntryPointNextToDefaultImport: {
      files: {
        "/entry.js": `import styles from "./x.module.css"; console.log(JSON.stringify(styles));`,
      },
      entryPoints: ["/entry.js", "/x.module.css"],
      run: { "entry.js": '{"foo":"foo_e7Ht-A"}' },
    },
    // One require() or import() of a stylesheet left every default import of it with no class names.
    DefaultImportNextToRequireInAnotherFile: {
      files: {
        "/entry.js": `import "./modern.js"; import "./legacy.cjs";`,
        "/modern.js": `import styles from "./x.module.css"; console.log("modern", styles.foo);`,
        "/legacy.cjs": `console.log("legacy", require("./x.module.css").foo);`,
      },
      run: { "entry.js": "modern foo_e7Ht-A\nlegacy foo_e7Ht-A" },
    },
    DefaultImportNextToDynamicImportInAnotherFile: {
      files: {
        "/entry.js": `import "./modern.js"; import "./lazy.js";`,
        "/modern.js": `import styles from "./x.module.css"; console.log("modern", styles.foo);`,
        "/lazy.js": `import("./x.module.css").then(styles => console.log("lazy", styles.default.foo));`,
      },
      run: { "entry.js": "modern foo_e7Ht-A\nlazy foo_e7Ht-A" },
    },
    // A require() whose value nothing reads still prints a wrapper, which needs the runtime.
    RequireWithNoValueReadInCommonJS: {
      files: {
        "/entry.js": `require("./plain.css"); require("./x.module.css"); console.log("ran");`,
      },
      run: { "entry.js": "ran" },
      // An iife does not run a CommonJS entry point, with or without a stylesheet.
      skipModes: ["iife"],
    },
    // A CommonJS file whose exports are lifted has no wrapper of its own.
    RequireWithNoValueReadInCommonJSDependency: {
      files: {
        "/entry.js": `import { value } from "./dependency.js"; console.log("ran", value);`,
        "/dependency.js": `require("./plain.css"); exports.value = 1;`,
      },
      run: { "entry.js": "ran 1" },
    },
    RequireWithNoValueReadInModule: {
      files: {
        "/entry.js": `
          import { value } from "./value.js";
          require("./plain.css");
          require("./x.module.css");
          console.log("ran", value);
        `,
        "/value.js": `export const value = 1;`,
      },
      run: { "entry.js": "ran 1" },
    },
    // A name that is not an identifier is a key of the object. The namespace of an ES module does not
    // have it yet, as for such a key of a JSON file.
    ClassNameThatIsNotAnIdentifier: {
      files: {
        "/entry.js": `
          import styles from "./kebab.module.css";
          import * as namespace from "./kebab.module.css";
          const required = require("./kebab.module.css");
          import("./kebab.module.css").then(lazy =>
            console.log(JSON.stringify([styles, namespace.default, required, lazy.default])),
          );
        `,
      },
      run: {
        "entry.js": "[" + Array(4).fill('{"foo-bar":"foo-bar_Fe8ZQg","baz":"baz_Fe8ZQg"}').join() + "]",
      },
    },
    // import.meta.glob() makes an import() for each file, or a namespace import with \`eager\`.
    LazyGlob: {
      files: {
        "/entry.js": `
          const modules = import.meta.glob("./glob/*.module.css");
          const paths = Object.keys(modules).sort();
          Promise.all(paths.map(path => modules[path]())).then(loaded =>
            console.log(JSON.stringify(loaded.map((styles, i) => [paths[i], styles.default, Object.keys(styles).sort()]))),
          );
        `,
      },
      run: {
        "entry.js":
          '[["./glob/a.module.css",{"a":"a_KE7_UA"},["a","default"]],["./glob/b.module.css",{"b":"b_okzPrQ"},["b","default"]]]',
      },
    },
    LazyGlobOfDefaultExport: {
      files: {
        "/entry.js": `
          const modules = import.meta.glob("./glob/*.module.css", { import: "default" });
          const paths = Object.keys(modules).sort();
          Promise.all(paths.map(path => modules[path]())).then(loaded =>
            console.log(JSON.stringify(loaded.map((styles, i) => [paths[i], styles]))),
          );
        `,
      },
      run: { "entry.js": '[["./glob/a.module.css",{"a":"a_KE7_UA"}],["./glob/b.module.css",{"b":"b_okzPrQ"}]]' },
    },
    EagerGlob: {
      files: {
        "/entry.js": `
          const modules = import.meta.glob("./glob/*.module.css", { eager: true });
          const paths = Object.keys(modules).sort();
          console.log(JSON.stringify(paths.map(path => [path, modules[path].default, Object.keys(modules[path]).sort()])));
        `,
      },
      run: {
        "entry.js":
          '[["./glob/a.module.css",{"a":"a_KE7_UA"},["a","default"]],["./glob/b.module.css",{"b":"b_okzPrQ"},["b","default"]]]',
      },
    },
    // The class names run where the first import of the stylesheet is, also when that import reads no
    // value. m.js reads them before b.js has run its own import of the stylesheet.
    BareImportAheadOfValueImportInACycle: {
      files: {
        "/entry.js": `
          import "./x.module.css";
          import { value } from "./b.js";
          console.log(JSON.stringify(value));
        `,
        "/b.js": `
          import { early } from "./m.js";
          import styles from "./x.module.css";
          export function getStyles() { return styles; }
          export const value = [early, styles.foo];
        `,
        "/m.js": `
          import { getStyles } from "./b.js";
          export const early = typeof getStyles();
        `,
      },
      run: { "entry.js": '["object","foo_e7Ht-A"]' },
    },
  };
  const valueModes = {
    esm: {},
    cjs: { format: "cjs" },
    iife: { format: "iife" },
    minify: { minifyIdentifiers: true, minifySyntax: true, minifyWhitespace: true },
    bun: { target: "bun" },
    cli: { backend: "cli" },
  } as const;
  for (const [shape, { files, entryPoints = ["/entry.js"], run, skipModes = [] }] of Object.entries(valueShapes)) {
    for (const [mode, options] of Object.entries(valueModes)) {
      if (skipModes.includes(mode)) continue;
      itBundled(`css-module/${shape}/${mode}`, {
        files: { ...stylesheets, ...files },
        entryPoints,
        outdir: "/out",
        ...options,
        run: Object.entries(run).map(([file, stdout]) => ({ file: "/out/" + file, stdout })),
      });
    }
  }

  itBundled("css-module/NamespaceImportInExecutable", {
    files: {
      ...stylesheets,
      "/entry.js": `import * as styles from "./x.module.css"; console.log(JSON.stringify(styles));`,
    },
    entryPoints: ["/entry.js"],
    compile: true,
    backend: "cli",
    run: { stdout: '{"default":{"foo":"foo_e7Ht-A"},"foo":"foo_e7Ht-A"}' },
  });

  // The wrapper of a require()d stylesheet holds the class names. The files that the stylesheet
  // names with @import, url() and composes are not JavaScript imports of the wrapper: they get none.
  itBundled("css-module/RequireWrapsOnlyTheStylesheet", {
    files: {
      "/entry.js": `
        import image from "./image.png";
        import base from "./base.module.css";
        const styles = require("./styles.module.css");
        console.log(JSON.stringify(styles), JSON.stringify(base), typeof image);
      `,
      "/styles.module.css": `
        @import "./reset.css";
        .card { composes: base from "./base.module.css"; background: url("./image.png") }
      `,
      "/base.module.css": `.base { padding: 0 }`,
      "/reset.css": `body { margin: 0 }`,
      "/image.png": "not a real png",
    },
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toMatchInlineSnapshot(`
        "var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);

        // styles.module.css
        var require_styles_module = __commonJS(function(exports, module) {
          module.exports = {
            card: "base_1Cz41w card_-MSaAA"
          };
        });

        // image.png
        var image_default = "./image-mphfvab5.png";

        // base.module.css
        var base_module_default = {
          base: "base_1Cz41w"
        };

        // entry.js
        var styles = require_styles_module();
        console.log(JSON.stringify(styles), JSON.stringify(base_module_default), typeof image_default);
        "
      `);
    },
    run: { stdout: '{"card":"base_1Cz41w card_-MSaAA"} {"base":"base_1Cz41w"} string' },
  });

  // An entry point that reads no value of a stylesheet gets no runtime helper from an entry point that does.
  itBundled("css-module/RequireInOneEntryPointAddsNothingToAnother", {
    files: {
      "/a.js": `console.log(JSON.stringify(require("./a.css"))); export {};`,
      "/b.js": `
        import "./a.css";
        import styles from "./b.module.css";
        console.log(JSON.stringify(styles));
      `,
      "/a.css": `.a { color: red }`,
      "/b.module.css": `.b { color: blue }`,
    },
    entryPoints: ["/a.js", "/b.js"],
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/a.js").toMatchInlineSnapshot(`
        "var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);

        // a.css
        var require_a = __commonJS(function(exports, module) {
          module.exports = {};
        });

        // a.js
        console.log(JSON.stringify(require_a()));
        "
      `);
      api.expectFile("/out/b.js").toMatchInlineSnapshot(`
        "// b.module.css
        var b_module_default = {
          b: "b_Kd7Gww"
        };

        // b.js
        console.log(JSON.stringify(b_module_default));
        "
      `);
    },
    run: [
      { file: "/out/a.js", stdout: "{}" },
      { file: "/out/b.js", stdout: '{"b":"b_Kd7Gww"}' },
    ],
  });

  // The class names print where the first import of the stylesheet is, also when that import is a bare one.
  itBundled("css-module/BareImportPlacesTheClassNames", {
    files: {
      "/entry.js": `
        import "./x.module.css";
        import { a } from "./a.js";
        import { b } from "./b.js";
        console.log(a, b);
      `,
      "/a.js": `export const a = "a";`,
      "/b.js": `import styles from "./x.module.css"; export const b = styles.foo;`,
      "/x.module.css": `.foo { color: red }`,
    },
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toMatchInlineSnapshot(`
        "// x.module.css
        var x_module_default = {
          foo: "foo_e7Ht-A"
        };

        // a.js
        var a = "a";

        // b.js
        var b = x_module_default.foo;

        // entry.js
        console.log(a, b);
        "
      `);
    },
    run: { stdout: "a foo_e7Ht-A" },
  });

  // A file that is wrapped (here: loaded by require() or by an import() that is not split) can have a bare
  // import of a stylesheet. The stylesheet has no JavaScript, so it gets no wrapper and no call.
  const wrappedFiles = {
    "/page.js": `import "./page.css"; export const page = 1; console.log("page");`,
    "/page.css": `@import "./reset.css"; .page { color: red; background: url("./image.png") }`,
    "/reset.css": `body { margin: 0 }`,
    "/image.png": "not a real png",
  };
  itBundled("css-module/BareImportInFileLoadedByRequire", {
    files: {
      ...wrappedFiles,
      "/entry.js": `console.log(JSON.stringify(require("./page.js"))); export {};`,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    onAfterBundle(api) {
      const js = api.readFile("/out/entry.js");
      expect(js.slice(js.indexOf("// page.js"))).toMatchInlineSnapshot(`
        "// page.js
        var exports_page = {};
        __export(exports_page, {
          page: () => page
        });
        var page = 1;
        var init_page = __esm(() => {
          console.log("page");
        });

        // entry.js
        console.log(JSON.stringify((init_page(), __toCommonJS(exports_page))));
        "
      `);
      expect(api.readFile("/out/entry.css")).toContain("margin: 0");
    },
    run: { stdout: 'page\n{"page":1}' },
  });
  itBundled("css-module/BareImportInFileLoadedByUnsplitImport", {
    files: {
      ...wrappedFiles,
      "/entry.js": `import("./page.js").then(page => console.log(JSON.stringify(page)));`,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    onAfterBundle(api) {
      const js = api.readFile("/out/entry.js");
      expect(js.slice(js.indexOf("// page.js"))).toMatchInlineSnapshot(`
        "// page.js
        var exports_page = {};
        __export(exports_page, {
          page: () => page
        });
        var page = 1;
        var init_page = __esm(() => {
          console.log("page");
        });

        // entry.js
        Promise.resolve().then(() => (init_page(), exports_page)).then((page) => console.log(JSON.stringify(page)));
        "
      `);
    },
    run: { stdout: 'page\n{"page":1}' },
  });
  // A require() of a stylesheet has a value, also when nothing reads it: the wrapper holds an empty object.
  itBundled("css-module/RequireWithNoValueReadHasAnEmptyWrapper", {
    files: {
      ...wrappedFiles,
      "/entry.js": `import legacy from "./legacy.cjs"; console.log(JSON.stringify(legacy));`,
      "/legacy.cjs": `require("./page.css"); module.exports = { legacy: 1 };`,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    onAfterBundle(api) {
      const js = api.readFile("/out/entry.js");
      expect(js.slice(js.indexOf("// page.css"))).toMatchInlineSnapshot(`
        "// page.css
        var require_page = __commonJS(function(exports, module) {
          module.exports = {};
        });

        // legacy.cjs
        var require_legacy = __commonJS(function(exports, module) {
          require_page();
          module.exports = { legacy: 1 };
        });

        // entry.js
        var import_legacy = __toESM(require_legacy());
        console.log(JSON.stringify(import_legacy.default));
        "
      `);
    },
    run: { stdout: '{"legacy":1}' },
  });
  // Two entry points load the wrapped file, so it is in a chunk of its own.
  itBundled("css-module/BareImportInFileLoadedByRequireWithSplitting", {
    files: {
      ...wrappedFiles,
      "/a.js": `console.log("a", JSON.stringify(require("./page.js"))); export {};`,
      "/b.js": `console.log("b", JSON.stringify(require("./page.js"))); export {};`,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: 'page\na {"page":1}' },
      { file: "/out/b.js", stdout: 'page\nb {"page":1}' },
    ],
  });

  // The minifier picks short names by how often each character is in the files of a chunk. The text of the
  // stylesheet counts for the module that holds its class names, so the names are the ones that a build
  // picked before that module had a row of its own.
  itBundled("css-module/MinifiedNamesCountTheTextOfTheStylesheet", {
    files: {
      "/entry.js": `
        import styles from "./x.module.css";
        export function read(value) { return styles[value]; }
      `,
      "/x.module.css": `/* ${Buffer.alloc(4096, "q").toString()} */ .foo { color: red }`,
    },
    outdir: "/out",
    minifyIdentifiers: true,
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toMatchInlineSnapshot(`
        "// x.module.css
        var q = {
          foo: "foo_e7Ht-A"
        };

        // entry.js
        function f(o) {
          return q[o];
        }
        export {
          f as read
        };
        "
      `);
    },
  });

  // The module that holds the class names is not a source file: the source map of a JS chunk has no entry for it.
  for (const [name, sourceMap] of Object.entries({
    External: "external",
    Linked: "linked",
    Inline: "inline",
  } as const)) {
    itBundled(`css-module/SourceMapHasNoStylesheet${name}`, {
      files: {
        "/entry.js": `
          import * as styles from "./x.module.css";
          console.log(JSON.stringify(styles), JSON.stringify(require("./y.module.css")));
        `,
        "/x.module.css": `.foo { color: red }`,
        "/y.module.css": `.bar { color: blue }`,
      },
      outdir: "/out",
      sourceMap,
      onAfterBundle(api) {
        const js = api.readFile("/out/entry.js");
        const map = JSON.parse(
          sourceMap === "inline"
            ? Buffer.from(js.slice(js.lastIndexOf("base64,") + "base64,".length), "base64").toString()
            : api.readFile("/out/entry.js.map"),
        );
        expect({ sources: map.sources, sourcesContent: map.sourcesContent?.length }).toEqual({
          sources: ["../entry.js"],
          sourcesContent: 1,
        });
      },
      run: { stdout: '{"default":{"foo":"foo_e7Ht-A"},"foo":"foo_e7Ht-A"} {"bar":"bar_zA6N2g"}' },
    });
  }
  // The chunk that two entry points share holds only class names: its source map has no source.
  itBundled("css-module/SourceMapOfSharedClassNames", {
    files: {
      "/a.js": `import styles from "./x.module.css"; console.log("a", styles.foo);`,
      "/b.js": `import styles from "./x.module.css"; console.log("b", styles.foo);`,
      "/x.module.css": `.foo { color: red }`,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    outdir: "/out",
    sourceMap: "external",
    onAfterBundle(api) {
      const maps = readdirSync(api.outdir)
        .filter(file => file.endsWith(".js.map"))
        .sort()
        .map(file => JSON.parse(api.readFile("/out/" + file)).sources);
      expect(maps).toEqual([[], ["../a.js"], ["../b.js"]]);
    },
    run: [
      { file: "/out/a.js", stdout: "a foo_e7Ht-A" },
      { file: "/out/b.js", stdout: "b foo_e7Ht-A" },
    ],
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
          spin: "spin_${hash}",
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

  // `.r` is outside the `.a`/`.b` composes cycle but leads into it, which must not overflow the stack.
  itBundled("css-module/ComposesCycleWithoutTheExportedClass", {
    files: {
      "/entry.js": `
        import styles from './styles.module.css';
        console.log(styles);
      `,
      "/styles.module.css": `
        .r { composes: a }
        .a { composes: b; color: red }
        .b { composes: a; margin: 0 }
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toMatchInlineSnapshot(`
        "// styles.module.css
        var styles_module_default = {
          r: "b_-MSaAA a_-MSaAA r_-MSaAA",
          a: "b_-MSaAA a_-MSaAA",
          b: "a_-MSaAA b_-MSaAA"
        };

        // entry.js
        console.log(styles_module_default);
        "
      `);
    },
  });

  itBundled("css-module/ComposesCycleAcrossFilesWithoutTheExportedClass", {
    files: {
      "/entry.js": `
        import styles from './styles.module.css';
        console.log(styles);
      `,
      "/styles.module.css": `.r { composes: a from "./a.module.css" }`,
      "/a.module.css": `.a { composes: b from "./b.module.css"; color: red }`,
      "/b.module.css": `.b { composes: a from "./a.module.css"; margin: 0 }`,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toMatchInlineSnapshot(`
        "// styles.module.css
        var styles_module_default = {
          r: "b_Kd7Gww a_BLNoTg r_-MSaAA"
        };

        // entry.js
        console.log(styles_module_default);
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

describe("bare :global", () => {
  itBundled("css-module/BareGlobalPseudoClassIsAnError", {
    files: {
      "/index.module.css": /* css */ `
      :global.foo {
        color: red;
      }
      `,
    },
    outdir: "/out",
    entryPoints: ["/index.module.css"],
    bundleErrors: {
      "/index.module.css": ["CSS module class: 'global' is currently not supported."],
    },
  });

  // react-datepicker ships such a file.
  itBundled("css-module/BareGlobalPseudoClassInPlainCss", {
    files: {
      "/index.css": /* css */ `
      :global .react-datepicker__x::before {
        color: red;
      }
      .z {
        color: blue;
      }
      `,
    },
    outdir: "/out",
    entryPoints: ["/index.css"],
    onAfterBundle(api) {
      api.expectFile("/out/index.css").toEqualIgnoringWhitespace(`
      /* index.css */
      :global .react-datepicker__x:before {
        color: red;
      }
      .z {
        color: #00f;
      }
      `);
    },
  });
});

describe("css modules", () => {
  /**
   * Bundles the first of `files` through a JS import. `css` is the stylesheet on one line, without
   * comments and with every `_<hash>` written `_H`. `styles` is the default export of the file.
   */
  async function bundle(files: Record<string, string>) {
    using dir = tempDir("css-modules", {
      ...files,
      "entry.js": `export { default } from "./${Object.keys(files)[0]}";`,
    });
    const out = join(String(dir), "out");
    const result = await Bun.build({ entrypoints: [join(String(dir), "entry.js")], outdir: out, throw: false });
    const logs = result.logs.map(log => Bun.stripANSI(log.message));
    if (!result.success) return { logs };
    const unhash = (text: string) => text.replace(/_[\w-]{6}(?![\w-])/g, "_H");
    const css = await Bun.file(join(out, "entry.css")).text();
    const { default: styles } = await import(join(out, "entry.js"));
    return {
      logs,
      css: unhash(css.replace(/\/\*.*?\*\//g, ""))
        .replace(/\s+/g, " ")
        .trim(),
      styles: JSON.parse(unhash(JSON.stringify(styles))) as Record<string, string>,
    };
  }

  const keyframes = "@keyframes spin { to { opacity: 0 } }";
  const keyframesOut = "@keyframes spin_H { to { opacity: 0; } }";

  test.concurrent.each([
    {
      name: "a @counter-style name stays global, as the list-style that names it does",
      css: `@counter-style thumbs { system: cyclic; symbols: "x" } .a { list-style: thumbs }`,
      out: `@counter-style thumbs { system: cyclic; symbols: "x"; } .a_H { list-style: thumbs; }`,
      styles: { a: "a_H" },
    },
    {
      name: "a @keyframes name is exported",
      css: `${keyframes} .a { animation: spin 1s }`,
      out: `${keyframesOut} .a_H { animation: 1s spin_H; }`,
      styles: { spin: "spin_H", a: "a_H" },
    },
    {
      name: "a class named like an earlier @keyframes can still be composed",
      css: `${keyframes} .spin { animation: spin 1s } .b { composes: spin; color: red }`,
      out: `${keyframesOut} .spin_H { animation: 1s spin_H; } .b_H { color: red; }`,
      styles: { spin: "spin_H", b: "spin_H b_H" },
    },
    {
      name: "animation after a nested rule names the hashed @keyframes",
      css: `${keyframes} .a { &.b { color: red } animation: spin 1s }`,
      out: `${keyframesOut} .a_H.b_H { color: red; } .a_H { animation: 1s spin_H; }`,
      styles: { spin: "spin_H", a: "a_H", b: "b_H" },
    },
    {
      name: "animation with var() names the hashed @keyframes",
      css: `${keyframes}
        .a { animation: spin var(--d) linear }
        .b { animation-name: var(--x), spin }
        .c { animation: var(--d) ease-in-out infinite alternate both paused spin }
        .d { animation: inherit }`,
      out: `${keyframesOut} .a_H { animation: spin_H var(--d) linear; } .b_H { animation-name: var(--x), spin_H; } .c_H { animation: var(--d) ease-in-out infinite alternate both paused spin_H; } .d_H { animation: inherit; }`,
      styles: { spin: "spin_H", a: "a_H", b: "b_H", c: "c_H", d: "d_H" },
    },
    {
      name: "names inside :global() are not exported",
      css: `.root :global(.ant-btn) { color: red } :global(#app) .x { color: blue }`,
      out: `.root_H .ant-btn { color: red; } #app .x_H { color: #00f; }`,
      styles: { root: "root_H", x: "x_H" },
    },
    {
      name: ":global() ends at its closing parenthesis",
      css: `:global(.g) .a { color: red } .g { color: blue }`,
      out: `.g .a_H { color: red; } .g_H { color: #00f; }`,
      styles: { a: "a_H", g: "g_H" },
    },
    {
      name: "a bare :global inside :host() ends at its closing parenthesis",
      css: `:host(:global .dark) .title { color: red }`,
      out: `:host(.dark) .title_H { color: red; }`,
      styles: { title: "title_H" },
    },
    {
      name: "the at-rules of Tailwind and Mantine stay in their class, so every exported class has a rule",
      css: `.wrapper { @apply flex; & cite { @apply text-base; } } .hidden { @mixin larger-than $x { display: none } }`,
      out: `.wrapper_H { @apply flex; } .wrapper_H cite { @apply text-base; } .hidden_H { @mixin larger-than $x { display: none } }`,
      styles: { wrapper: "wrapper_H", hidden: "hidden_H" },
      logs: ["@apply", "@apply", "@mixin"].map(name => `invalid @ rule encountered: '${name}'`),
    },
    {
      name: ":local() inside :global()",
      css: `:global(.g :local(.l)) .m { color: red }`,
      out: `.g .l_H .m_H { color: red; }`,
      styles: { l: "l_H", m: "m_H" },
    },
    {
      name: "a bare :global or :local holds up to the next one or the comma",
      css: `.c1 :local .c2 :global .c3 .c4 :local .c5, .c3 { color: red } :global .g > .h { color: blue }`,
      out: `.c1_H .c2_H .c3 .c4 .c5_H, .c3_H { color: red; } .g > .h { color: #00f; }`,
      styles: { c1: "c1_H", c2: "c2_H", c5: "c5_H", c3: "c3_H" },
    },
    {
      name: "a bare :global ends with the selector list that holds it, and with the prelude",
      css: `.a:not(:global .g) .b { color: red } :global .g { .n { color: blue } }`,
      out: `.a_H:not(.g) .b_H { color: red; } .g .n_H { color: #00f; }`,
      styles: { a: "a_H", b: "b_H", n: "n_H" },
    },
    {
      name: "view transition names and classes inside :global()",
      css: `:global(::view-transition-old(root)) { opacity: 0 }
        :global(::view-transition-group(*.card)) { top: 0 }
        ::view-transition-new(hero) { opacity: 1 }`,
      out: `::view-transition-old(root) { opacity: 0; } ::view-transition-group(*.card) { top: 0; } ::view-transition-new(hero_H) { opacity: 1; }`,
      styles: {},
    },
    {
      name: "a container name is global in the declaration and in the query",
      css: `.box { container: page / inline-size } @container page (width > 1px) { .x { color: red } }`,
      out: `.box_H { container: page / inline-size; } @container page (width > 1px) { .x_H { color: red; } }`,
      styles: { box: "box_H", x: "x_H" },
    },
    {
      name: "a repeated rule is printed once",
      css: `.a { color: red } .b { margin: 0 } .a { color: red }`,
      out: `.b_H { margin: 0; } .a_H { color: red; }`,
      styles: { a: "a_H", b: "b_H" },
    },
  ])("$name", async ({ css, out, styles, logs = [] }) => {
    expect(await bundle({ "styles.module.css": css })).toEqual({ logs, css: out, styles });
  });

  const nested = '"composes" is not allowed inside nested selectors';
  const notSingleClass = '"composes" only works inside single class selectors';

  test.concurrent.each([
    {
      name: "after a nested rule",
      css: `.c { color: red } .a { &:hover { color: green } composes: c; color: blue }`,
      styles: { c: "c_H", a: "c_H a_H" },
      logs: [],
    },
    {
      name: "in a nested rule, then in the rule that holds it",
      css: `.c { color: red } .a { .z { composes: c; color: blue } composes: c }`,
      styles: { c: "c_H", a: "c_H a_H", z: "z_H" },
      logs: [nested],
    },
    {
      name: "in a rule inside @media and @layer",
      css: `.c { color: red } @media print { @layer x { .b { composes: c; color: blue } } }`,
      styles: { c: "c_H", b: "c_H b_H" },
      logs: [],
    },
    {
      name: "in @media inside a rule",
      css: `.c { color: red } .a { @media print { composes: c; color: blue } }`,
      styles: { c: "c_H", a: "a_H" },
      logs: [nested],
    },
    {
      name: "under a selector that is not one class",
      css: `.c { color: red } .a .b { composes: c; color: blue }`,
      styles: { c: "c_H", a: "a_H", b: "b_H" },
      logs: [notSingleClass],
    },
    {
      name: "refused, from a file that does not exist",
      css: `.a .b { composes: x from "./missing.module.css"; color: blue }`,
      styles: { a: "a_H", b: "b_H" },
      logs: [notSingleClass],
    },
  ])("composes $name", async ({ css, styles, logs }) => {
    const result = await bundle({ "styles.module.css": css });
    expect({ styles: result.styles, logs: result.logs }).toEqual({ styles, logs });
    expect(result.css).toContain("color: #00f;");
    expect(result.css).not.toContain("composes");
  });

  test.concurrent("composes in a module imported with layer()", async () => {
    expect(
      await bundle({
        "wrap.css": `@import "./styles.module.css" layer(base);`,
        "styles.module.css": `.c { color: red } .b { composes: c; color: blue }`,
      }),
    ).toEqual({ logs: [], css: `@layer base { .c_H { color: red; } .b_H { color: #00f; } }`, styles: {} });
  });

  test.concurrent("composes of a name that only :global() holds is an error", async () => {
    expect(await bundle({ "styles.module.css": `:global(.g) { color: red } .a { composes: g }` })).toEqual({
      logs: [expect.stringContaining('The name "g" never appears in')],
    });
  });

  test.concurrent("the composes conflict check sees the custom properties of every rule of a class", async () => {
    const { logs } = await bundle({
      "styles.module.css": `.button { --x: 2; composes: other from "./other.module.css" } .button { --y: 3 }`,
      "other.module.css": `.other { --x: 1; --y: 1 }`,
    });
    expect(logs.toSorted()).toEqual([
      expect.stringContaining("The value of --x in the class button is undefined."),
      expect.stringContaining("The value of --y in the class button is undefined."),
    ]);
  });

  test.concurrent("composes in a plain stylesheet is an unknown property, not an import", async () => {
    expect(
      await bundle({
        "plain.css": `.k { composes: g from "./g.css" } .j { composes: m from "./missing.css" } .i { composes: 12px }`,
        "g.css": `.g { color: green }`,
      }),
    ).toEqual({
      logs: [],
      css: `.k { composes: g from "./g.css"; } .j { composes: m from "./missing.css"; } .i { composes: 12px; }`,
      styles: {},
    });
  });

  test.concurrent("composes conflicts name the unprefixed property and come in a fixed order", async () => {
    const { logs } = await bundle({
      "styles.module.css": `.a { composes: b from "./other.module.css"; view-transition-group: x; -webkit-transform: none; margin-top: var(--m); background-color: red }`,
      "other.module.css": `.b { margin-top: 0; view-transition-group: y; background-color: blue; transform: none }`,
    });
    expect(logs).toEqual(
      ["background-color", "margin-top", "transform", "view-transition-group"].map(
        name => `The value of ${name} in the class a is undefined.`,
      ),
    );
  });

  test.concurrent.each([
    ["12px", "Invalid declaration"],
    ["a, b", "Unexpected token: ,"],
  ])("composes: %s in a module is an error, not an unparsed value", async (value, error) => {
    expect(await bundle({ "styles.module.css": `.a { top: 0 } .b { top: 1px } .c { composes: ${value} }` })).toEqual({
      logs: [error],
    });
  });
});

describe("bare :global and :local: what stays an error", () => {
  describe.each([
    ["NoSpaceBefore", ".a:global .b", "CSS module class: 'global' is currently not supported."],
    ["NoSpaceAfterLocal", ":local.a", "CSS module class: 'local' is currently not supported."],
    ["NothingAfter", ".a :global ", "Found a dangling combinator with no selector"],
    ["FunctionAfterPart", ".a::part(x):global(.g)", "Token is not allowed in this state"],
  ])("%s", (name, selector, error) => {
    itBundled(`css-module/BareGlobal${name}IsAnError`, {
      files: {
        "/index.module.css": `${selector}{ color: red; }`,
      },
      outdir: "/out",
      entryPoints: ["/index.module.css"],
      bundleErrors: {
        "/index.module.css": [error],
      },
    });
  });
});
