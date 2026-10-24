import { fileURLToPath, Loader } from "bun";
import { describe, expect } from "bun:test";
import fs, { readdirSync } from "node:fs";
import { join } from "path";
import { BundlerTestInput, itBundled } from "./expectBundled";

describe("bundler", async () => {
  for (let target of ["bun", "node"] as const) {
    describe(`${target} loader`, async () => {
      itBundled("bun/loader-yaml-file", {
        target,
        files: {
          "/entry.ts": /* js */ `
        import hello from './hello.notyaml' with {type: "yaml"};
        console.write(JSON.stringify(hello));
      `,
          "/hello.notyaml": `hello: world`,
        },
        run: { stdout: '{"hello":"world"}' },
      });
      itBundled("bun/loader-text-file", {
        target,
        outfile: "",
        outdir: "/out",

        files: {
          "/entry.ts": /* js */ `
        import hello from './hello.foo' with {type: "text"};
        console.log(hello);
      `,
          "/hello.foo": "Hello, world!",
        },
        run: { stdout: "Hello, world!" },
      });
      itBundled("bun/loader-json-file", {
        target,
        files: {
          "/entry.ts": /* js */ `
        import hello from './hello.notjson' with {type: "json"};
        console.write(JSON.stringify(hello));
      `,
          "/hello.notjson": JSON.stringify({ hello: "world" }),
        },
        run: { stdout: '{"hello":"world"}' },
      });
      itBundled("bun/loader-toml-file", {
        target,
        files: {
          "/entry.ts": /* js */ `
        import hello from './hello.nottoml' with {type: "toml"};
        console.write(JSON.stringify(hello));
      `,
          "/hello.nottoml": `hello = "world"`,
        },
        run: { stdout: '{"hello":"world"}' },
      });
      // The Temporal reference is a real unbound symbol: a user binding named
      // Temporal in the same bundle gets renamed instead of capturing the
      // `Temporal.*.from` calls the TOML module compiles to.
      itBundled("bun/loader-toml-datetime-shadowed-temporal-global", {
        target,
        files: {
          "/entry.ts": /* js */ `
        import cfg from './config.toml';
        var Temporal = "shadowed";
        console.write(Temporal + " " + cfg.ld.toString());
      `,
          "/config.toml": `ld = 1979-05-27`,
        },
        run: { stdout: "shadowed 1979-05-27" },
      });
      // The realistic collision: another module in the chunk imports a
      // Temporal polyfill binding. The import gets renamed and the TOML
      // module's calls still resolve to the native global.
      itBundled("bun/loader-toml-datetime-imported-temporal-binding", {
        target,
        files: {
          "/entry.ts": /* js */ `
        import { Temporal } from './polyfill.js';
        import cfg from './config.toml';
        console.write(Temporal.tag + " " + (cfg.ld instanceof globalThis.Temporal.PlainDate) + " " + cfg.ld.toString());
      `,
          "/polyfill.js": `export const Temporal = { tag: "polyfill" };`,
          "/config.toml": `ld = 1979-05-27`,
        },
        run: { stdout: "polyfill true 1979-05-27" },
      });
      itBundled("bun/loader-toml-datetime-no-bundle", {
        target,
        bundling: false,
        entryPoints: ["/config.toml"],
        files: {
          "/config.toml": `d = 1979-05-27\n[t]\nat = 1979-05-27T00:32:00-07:00`,
        },
        run: true,
        onAfterBundle(api) {
          const code = api.readFile("/out.js");
          expect(code).toContain('Temporal.PlainDate.from("1979-05-27")');
          expect(code).toContain('Temporal.Instant.from("1979-05-27T00:32:00-07:00")');
        },
      });
      // TOML date/time values bundle as Temporal construction calls; the
      // bundled module yields the same values Bun.TOML.parse returns.
      itBundled("bun/loader-toml-datetime", {
        target,
        files: {
          "/entry.ts": /* js */ `
        import cfg, { lt } from './config.toml';
        console.write(JSON.stringify([
          cfg.odt instanceof Temporal.Instant, cfg.odt.toString(),
          cfg.ldt instanceof Temporal.PlainDateTime, cfg.ldt.toString(),
          cfg.ld instanceof Temporal.PlainDate, cfg.ld.toString(),
          lt instanceof Temporal.PlainTime, lt.toString(),
          cfg.tbl.arr[0].toString(),
        ]));
      `,
          "/config.toml": `odt = 1979-05-27T00:32:00-07:00\nldt = 1979-05-27 07:32\nld = 1979-05-27\nlt = 07:32:00.500\n[tbl]\narr = [ 07:32:00 ]`,
        },
        run: {
          stdout:
            '[true,"1979-05-27T07:32:00Z",true,"1979-05-27T07:32:00",true,"1979-05-27",true,"07:32:00.5","07:32:00"]',
        },
      });
      itBundled("bun/loader-text-file", {
        target,
        files: {
          "/entry.ts": /* js */ `
        import hello from './hello.json' with {type: "text"};
        console.write(hello);
      `,
          "/hello.json": JSON.stringify({ hello: "world" }),
        },
        run: { stdout: '{"hello":"world"}' },
      });
      itBundled("bun/loader-xml-file", {
        target,
        files: {
          "/entry.ts": /* js */ `
        import doc from './hello.notxml' with {type: "xml"};
        import byExtension, { greeting } from './hello.xml';
        console.write(JSON.stringify([doc, byExtension, greeting]));
      `,
          "/hello.notxml": `<hello to="world">hi <b>there</b></hello>`,
          "/hello.xml": `<?xml version="1.0"?><!DOCTYPE greeting [<!ENTITY w "world">]><greeting __proto__="1"><to>&w;</to><to>you</to></greeting>`,
        },
        run: {
          stdout:
            '[{"hello":{"@to":"world","#text":"hi ","b":"there"}},{"greeting":{"@__proto__":"1","to":["world","you"]}},{"@__proto__":"1","to":["world","you"]}]',
        },
      });
    });
  }

  itBundled("bun/loader-text-file", {
    target: "bun",
    outfile: "",
    outdir: "/out",

    files: {
      "/entry.ts": /* js */ `
    import first from './1.boo' with {type: "text"};
    import second from './2.boo' with {type: "text"};
    console.write(first + second);
  `,
      "/1.boo": "'`Hello, \nworld!`",
      "/2.boo": "`${Hello}\n, world!`'",
    },
    run: {
      stdout: "'`Hello, \nworld!``${Hello}\n, world!`'",
    },
  });

  itBundled("bun/loader-json-proto-key-is-own-property", {
    target: "bun",
    files: {
      "/entry.ts": /* js */ `
    import data from './data.json';
    const out = [
      Object.getPrototypeOf(data) === Object.prototype,
      Object.hasOwn(data, "__proto__"),
      data.x,
      JSON.stringify(data),
    ];
    console.write(JSON.stringify(out));
  `,
      "/data.json": `{"__proto__": {"x": 1}, "a": 2}`,
    },
    run: { stdout: '[true,true,null,"{\\"__proto__\\":{\\"x\\":1},\\"a\\":2}"]' },
  });

  itBundled("bun/loader-toml-proto-key-is-own-property", {
    target: "bun",
    files: {
      "/entry.ts": /* js */ `
    import data from './data.toml';
    const out = [
      Object.getPrototypeOf(data) === Object.prototype,
      Object.hasOwn(data, "__proto__"),
      data.x,
      JSON.stringify(data),
    ];
    console.write(JSON.stringify(out));
  `,
      "/data.toml": `a = 2\n[__proto__]\nx = 1\n`,
    },
    run: { stdout: '[true,true,null,"{\\"a\\":2,\\"__proto__\\":{\\"x\\":1}}"]' },
  });

  itBundled("bun/loader-yaml-proto-key-is-own-property", {
    target: "bun",
    files: {
      "/entry.ts": /* js */ `
    import data from './data.yaml';
    const out = [
      Object.getPrototypeOf(data) === Object.prototype,
      Object.hasOwn(data, "__proto__"),
      data.x,
      JSON.stringify(data),
    ];
    console.write(JSON.stringify(out));
  `,
      "/data.yaml": `__proto__:\n  x: 1\na: 2\n`,
    },
    run: { stdout: '[true,true,null,"{\\"__proto__\\":{\\"x\\":1},\\"a\\":2}"]' },
  });

  itBundled("bun/loader-jsonc-proto-key-is-own-property", {
    target: "bun",
    files: {
      "/entry.ts": /* js */ `
    import data from './data.jsonc';
    const out = [
      Object.getPrototypeOf(data) === Object.prototype,
      Object.hasOwn(data, "__proto__"),
      data.x,
      JSON.stringify(data),
    ];
    console.write(JSON.stringify(out));
  `,
      "/data.jsonc": `// jsonc\n{"__proto__": {"x": 1}, "a": 2,}`,
    },
    run: { stdout: '[true,true,null,"{\\"__proto__\\":{\\"x\\":1},\\"a\\":2}"]' },
  });

  itBundled("bun/loader-json5-proto-key-is-own-property", {
    target: "bun",
    files: {
      "/entry.ts": /* js */ `
    import data from './data.json5';
    const out = [
      Object.getPrototypeOf(data) === Object.prototype,
      Object.hasOwn(data, "__proto__"),
      data.x,
      JSON.stringify(data),
    ];
    console.write(JSON.stringify(out));
  `,
      "/data.json5": `{__proto__: {x: 1}, a: 2}`,
    },
    run: { stdout: '[true,true,null,"{\\"__proto__\\":{\\"x\\":1},\\"a\\":2}"]' },
  });

  itBundled("bun/loader-json-nested-proto-key-is-own-property", {
    target: "bun",
    files: {
      "/entry.ts": /* js */ `
    import data from './data.json';
    const nested = data.nested;
    const out = [
      Object.getPrototypeOf(nested) === Object.prototype,
      Object.hasOwn(nested, "__proto__"),
      nested.x,
      JSON.stringify(data),
    ];
    console.write(JSON.stringify(out));
  `,
      "/data.json": `{"nested": {"__proto__": {"x": 1}, "a": 2}}`,
    },
    run: { stdout: '[true,true,null,"{\\"nested\\":{\\"__proto__\\":{\\"x\\":1},\\"a\\":2}}"]' },
  });

  itBundled("bun/loader-toml-inline-table-proto-key-is-own-property", {
    target: "bun",
    files: {
      "/entry.ts": /* js */ `
    import data from './data.toml';
    const out = [
      Object.getPrototypeOf(data) === Object.prototype,
      Object.hasOwn(data, "__proto__"),
      data.x,
      JSON.stringify(data),
    ];
    console.write(JSON.stringify(out));
  `,
      "/data.toml": `a = 2\n"__proto__" = { x = 1 }\n`,
    },
    run: { stdout: '[true,true,null,"{\\"a\\":2,\\"__proto__\\":{\\"x\\":1}}"]' },
  });

  itBundled("bun/loader-yaml-flow-proto-key-is-own-property", {
    target: "bun",
    files: {
      "/entry.ts": /* js */ `
    import data from './data.yaml';
    const out = [
      Object.getPrototypeOf(data) === Object.prototype,
      Object.hasOwn(data, "__proto__"),
      data.x,
      JSON.stringify(data),
    ];
    console.write(JSON.stringify(out));
  `,
      "/data.yaml": `{__proto__: {x: 1}, a: 2}\n`,
    },
    run: { stdout: '[true,true,null,"{\\"__proto__\\":{\\"x\\":1},\\"a\\":2}"]' },
  });

  itBundled("bun/loader-yaml-boolean-keys-minify-syntax", {
    target: "bun",
    minifySyntax: true,
    files: {
      "/entry.ts": /* js */ `
    import data from './data.yaml';
    console.write(JSON.stringify(data));
  `,
      "/data.yaml": `true: t\nfalse: f\nok: 1\n`,
    },
    run: { stdout: `{"true":"t","false":"f","ok":1}` },
  });
  itBundled("bun/loader-yaml-non-string-keys-no-bundle", {
    target: "bun",
    bundling: false,
    entryPoints: ["/data.yaml"],
    files: {
      "/data.yaml": `true: t\n~: tilde\n1: one\n1.5: f\n-1: neg\n.inf: i\n.nan: n\n[a, b]: seq\n{x: 1}: map\nok: 1\n`,
    },
    runtimeFiles: {
      "/test.js": /* js */ `
    import data, * as ns from './out.js';
    console.write(JSON.stringify(data) + " " + JSON.stringify(Object.keys(ns)));
  `,
    },
    run: {
      file: "/test.js",
      stdout: `{"1":"one","true":"t","null":"tilde","1.5":"f","-1":"neg","Infinity":"i","NaN":"n","a,b":"seq","[object Object]":"map","ok":1} ["default","ok"]`,
    },
  });

  itBundled("bun/loader-xml-proto-key-is-own-property", {
    target: "bun",
    files: {
      "/entry.ts": /* js */ `
    import data from './data.xml';
    const out = [
      Object.getPrototypeOf(data.r) === Object.prototype,
      Object.hasOwn(data.r, "__proto__"),
      data.r.x,
      JSON.stringify(data),
    ];
    console.write(JSON.stringify(out));
  `,
      "/data.xml": `<r><__proto__><x>1</x></__proto__><a>2</a></r>`,
    },
    run: { stdout: '[true,true,null,"{\\"r\\":{\\"__proto__\\":{\\"x\\":\\"1\\"},\\"a\\":\\"2\\"}}"]' },
  });

  itBundled("bun/loader-xml-entry-point", {
    target: "bun",
    outfile: "",
    outdir: "/out",
    files: {
      "/feed.xml": `<?xml version="1.0"?><feed><entry id="1">one</entry><entry id="2">two</entry></feed>`,
    },
    entryPoints: ["/feed.xml"],
    entryNaming: "[dir]/[name]-[hash].[ext]",
    onAfterBundle(api) {
      const jsFile = readdirSync(api.outdir).find(x => x.endsWith(".js"))!;
      const module = require(join(api.outdir, jsFile));
      expect(module.default).toStrictEqual({
        feed: {
          entry: [
            { "@id": "1", "#text": "one" },
            { "@id": "2", "#text": "two" },
          ],
        },
      });
    },
  });

  itBundled("bun/loader-xml-syntax-error", {
    target: "bun",
    files: {
      "/entry.ts": /* js */ `
    import data from './bad.xml';
    console.log(data);
  `,
      "/bad.xml": `<config>\n  <port>8080</bad>\n</config>`,
    },
    bundleErrors: {
      "/bad.xml": ["Expected closing tag </port> but found </bad>"],
    },
  });

  // The CSS-modules lazy export builds its object through `E::Object::put`.
  itBundled("bun/loader-css-module-proto-class-is-own-property", {
    target: "bun",
    outdir: "/out",
    files: {
      "/entry.ts": /* js */ `
    import styles from './styles.module.css';
    const out = [
      Object.getPrototypeOf(styles) === Object.prototype,
      Object.hasOwn(styles, "__proto__"),
      typeof styles.a === "string",
    ];
    console.write(JSON.stringify(out));
  `,
      "/styles.module.css": `.__proto__ { color: red; }\n.a { color: blue; }\n`,
    },
    run: { stdout: "[true,true,true]" },
  });

  itBundled("bun/wasm-is-copied-to-outdir", {
    target: "bun",
    outdir: "/out",

    files: {
      "/entry.ts": /* js */ `
    import wasm from './add.wasm';
    import { join } from 'path';
    const { instance } = await WebAssembly.instantiate(await Bun.file(join(import.meta.dir, wasm)).arrayBuffer());
    console.log(instance.exports.add(1, 2));
  `,
      "/add.wasm": fs.readFileSync(join(import.meta.dir, "fixtures", "add.wasm")),
    },
    run: {
      stdout: "3",
    },
  });

  // (a Windows checkout may have given the fixture CRLF line endings; the harness compares LF-normalized output)
  const moon = (
    await Bun.file(
      fileURLToPath(import.meta.resolve("../js/bun/util/text-loader-fixture-text-file.backslashes.txt")),
    ).text()
  ).replaceAll("\r\n", "\n");

  // https://github.com/oven-sh/bun/issues/3449
  itBundled("bun/loader-text-file-#3449", {
    target: "bun",
    outfile: "",
    outdir: "/out",

    files: {
      "/entry.ts": /* js */ `
    import first from './1.boo' with {type: "text"};
    console.write(first);
  `,
      "/1.boo": moon,
    },
    run: {
      stdout: moon,
    },
  });

  const loaders: Loader[] = ["wasm", "json", "file" /* "napi" */, "text"];
  const exts = ["wasm", "json", "lmao" /*  ".node" */, "txt"];
  for (let i = 0; i < loaders.length; i++) {
    const loader = loaders[i];
    const ext = exts[i];
    itBundled(`bun/loader-copy-file-entry-point-with-onLoad-${loader}`, {
      target: "bun",
      outdir: "/out",
      files: {
        [`/entry.${ext}`]: /* js */ `{ "hello": "friends" }`,
      },
      entryNaming: "[dir]/[name]-[hash].[ext]",
      plugins(builder) {
        builder.onLoad({ filter: new RegExp(`.${loader}$`) }, async ({ path }) => {
          const result = await Bun.file(path).text();
          return { contents: result, loader };
        });
      },
      onAfterBundle(api) {
        const jsFile = readdirSync(api.outdir).find(x => x.endsWith(".js"))!;
        const module = require(join(api.outdir, jsFile));

        if (loader === "json") {
          expect(module.default).toStrictEqual({ hello: "friends" });
        } else if (loader === "text") {
          expect(module.default).toStrictEqual('{ "hello": "friends" }');
        } else {
          api.assertFileExists(join("out", module.default));
        }
      },
    });
  }

  for (let i = 0; i < loaders.length; i++) {
    const loader = loaders[i];
    const ext = exts[i];
    itBundled(`bun/loader-copy-file-entry-point-${loader}`, {
      target: "bun",
      outfile: "",
      outdir: "/out",
      files: {
        [`/entry.${ext}`]: /* js */ `{ "hello": "friends" }`,
      },
      entryNaming: "[dir]/[name]-[hash].[ext]",
      onAfterBundle(api) {
        const jsFile = readdirSync(api.outdir).find(x => x.endsWith(".js"))!;
        const module = require(join(api.outdir, jsFile));

        if (loader === "json") {
          expect(module.default).toStrictEqual({ hello: "friends" });
        } else if (loader === "text") {
          expect(module.default).toStrictEqual('{ "hello": "friends" }');
        } else {
          api.assertFileExists(join("out", module.default));
        }
      },
    });
  }

  // `import addon from "./addon.node"` prints as `__require("./addon-[hash].node")`
  // in ESM output, so the chunk has to define the runtime helper.
  itBundled("bun/loader-napi-esm-runtime-require", {
    target: "bun",
    format: "esm",
    outdir: "/out",
    files: {
      "/entry.ts": /* js */ `
        import addon from "./addon.node";
        export default addon;
      `,
      "/addon.node": "not a real addon",
    },
    onAfterBundle(api) {
      const js = api.readFile("/out/entry.js");
      expect(js).toContain("var __require = import.meta.require;");
      expect(js).toMatch(/__require\("\.\/addon-[a-z0-9]+\.node"\)/);
    },
  });

  itBundled("loader/AssetEntryPointInlinedByStylesheet", {
    backend: "cli",
    outdir: "/out",
    entryPoints: ["/logo.png", "/style.css"],
    outputPaths: ["/out/logo.js", "/out/style.css"],
    files: {
      "/logo.png": "png bytes",
      "/style.css": `body { background: url("./logo.png"); }`,
    },
    onAfterBundle(api) {
      const png = readdirSync(api.outdir).find(x => x.endsWith(".png"))!;
      expect(api.readFile(join("/out", png))).toBe("png bytes");
      expect(api.readFile("/out/logo.js")).toContain(`"./${png}"`);
      expect(api.readFile("/out/style.css")).toContain(`url("data:image/png;base64,`);
    },
  });

  describe("handles empty files", () => {
    for (const target of ["bun", "node", "browser"] as const) {
      itBundled(`${target}/loader-empty-text-file`, {
        target: target,
        files: {
          "/entry.ts": /* js */ `
          import empty from './empty.txt' with {type: "text"};
          console.write(JSON.stringify(empty));
        `,
          "/empty.txt": "",
        },
        run: { stdout: '""' },
      });

      itBundled(`${target}/loader-empty-file-loader`, {
        target: target,
        outdir: "/out",
        files: {
          "/entry.ts": /* js */ `
          import empty from './empty.txt' with {type: "file"};
          export default empty;
        `,
          "/empty.txt": "",
        },
        onAfterBundle(api) {
          const jsFile = readdirSync(api.outdir).find(x => x.endsWith(".js"))!;
          const module = require(join(api.outdir, jsFile));
          api.assertFileExists(join("out", module.default));
        },
      });
    }
  });

  // The default export of a data file is its parsed value, whatever else in
  // the bundle loads the file. The value here has the two keys that CommonJS
  // interop reads off `module.exports`: `__esModule` and `default`.
  describe("data file default export", () => {
    const whole = '{"__esModule":true,"default":5,"x":1}';
    const dataFiles = {
      json: `{ "__esModule": true, "default": 5, "x": 1 }`,
      jsonc: `// comment\n{ "__esModule": true, "default": 5, "x": 1, }`,
      json5: `{ __esModule: true, default: 5, x: 1 }`,
      toml: `__esModule = true\ndefault = 5\nx = 1\n`,
      yaml: `__esModule: true\ndefault: 5\nx: 1\n`,
    };
    // What makes the linker give the data file its CommonJS form. `loads` are
    // the other ways the entry reads the value: each is the same object.
    const shapes = {
      "require": { loads: ["require(DATA)"] },
      "import": { loads: ["(await import(DATA)).default"] },
      "split-import": { loads: ["(await import(DATA)).default", "require(DATA)"], splitting: true },
      "cjs-entry": { loads: [], dataIsEntry: true, format: "cjs" },
      "iife-entry": { loads: [], dataIsEntry: true, format: "iife" },
    } as const;
    type Ext = keyof typeof dataFiles;
    type Shape = keyof typeof shapes;

    function fixture(ext: Ext, shape: Shape): BundlerTestInput {
      const { loads, dataIsEntry, ...options } = { dataIsEntry: false, ...shapes[shape] };
      // Every ES view of `default`, read directly and through a re-exporting file.
      const views = ["named", "ns.default", "reexported", "renamed", "star.default", ...loads];
      const multipleOutputs = dataIsEntry || "splitting" in options;
      return {
        files: {
          "/entry.js": /* js */ `
            import json, { default as named } from "./data.${ext}";
            import * as ns from "./data.${ext}";
            import reexported, { renamed, star } from "./reexport.js";
            (async () => {
              const views = [${views.join(", ").replaceAll("DATA", `"./data.${ext}"`)}];
              console.log(JSON.stringify(json), ...views.map(view => view === json));
            })();
          `,
          "/reexport.js": /* js */ `
            export { default, default as renamed } from "./data.${ext}";
            export * as star from "./data.${ext}";
          `,
          [`/data.${ext}`]: dataFiles[ext],
        },
        ...options,
        ...(dataIsEntry && { entryPoints: [`/data.${ext}`, "/entry.js"] }),
        ...(multipleOutputs && { outdir: "/out", outputPaths: ["/out/entry.js"] }),
        run: {
          file: multipleOutputs ? "/out/entry.js" : undefined,
          stdout: [whole, ...views.map(() => "true")].join(" "),
        },
      };
    }

    for (const ext of Object.keys(dataFiles) as Ext[]) {
      itBundled(`bun/loader-data-default-require-${ext}`, fixture(ext, "require"));
    }
    for (const shape of ["import", "split-import", "cjs-entry", "iife-entry"] as const) {
      itBundled(`bun/loader-data-default-${shape}`, fixture("json", shape));
    }
    itBundled("bun/loader-data-default-require-cjs-node", {
      ...fixture("json", "require"),
      format: "cjs",
      target: "node",
    });
    itBundled("bun/loader-data-default-import-iife-bun", {
      ...fixture("json", "import"),
      format: "iife",
      target: "bun",
    });

    // require() of the file still returns the data: its `default` key is 5.
    itBundled("bun/loader-data-default-beside-required-value", {
      files: {
        "/entry.js": /* js */ `
          import json, { default as named } from "./data.json";
          export { default } from "./data.json";
          export { json, named };
          const required = require("./data.json");
          console.log(JSON.stringify({ json }), typeof json, json === named, json === required);
          console.log(required.default, require("./data.json").default, required.x);
        `,
        "/data.json": dataFiles.json,
      },
      run: { stdout: `{"json":${whole}} object true true\n5 5 1` },
    });
    itBundled("bun/loader-data-default-minified", {
      files: {
        "/entry.js": /* js */ `
          import json from "./data.json";
          console.log(JSON.stringify(json), json === require("./data.json"));
        `,
        "/data.json": dataFiles.json,
      },
      minifyIdentifiers: true,
      minifySyntax: true,
      minifyWhitespace: true,
      run: { stdout: `${whole} true` },
    });

    // A statement that also reads a name or the namespace.
    for (const [name, imports, reads] of [
      ["named", `import json, { x } from "./data.json";`, "x"],
      ["star", `import json, * as ns from "./data.json";`, "ns.x, ns.default === json"],
      ["named-in-other-statement", `import json from "./data.json"; import { x } from "./data.json";`, "x"],
    ] as const) {
      itBundled(`bun/loader-data-default-with-${name}`, {
        files: {
          "/entry.js": /* js */ `
            ${imports}
            console.log(JSON.stringify(json), json === require("./data.json"), ${reads});
          `,
          "/data.json": dataFiles.json,
        },
        run: { stdout: `${whole} true 1${name === "star" ? " true" : ""}` },
      });
    }

    // The default re-exported through two files, then imported.
    itBundled("bun/loader-data-default-reexport-chain", {
      files: {
        "/entry.js": /* js */ `
          import json, { renamed, local } from "./outer.js";
          console.log(JSON.stringify(json), json === renamed, json === local, json === require("./data.json"));
        `,
        "/outer.js": /* js */ `
          export { default, renamed, local } from "./inner.js";
        `,
        "/inner.js": /* js */ `
          import json from "./data.json";
          export { default, default as renamed } from "./data.json";
          export const local = json;
        `,
        "/data.json": dataFiles.json,
      },
      run: { stdout: `${whole} true true true` },
    });

    // The re-exporting file is in a chunk that two entry points share.
    itBundled("bun/loader-data-default-reexport-across-chunks", {
      files: {
        "/a.js": /* js */ `
          import json from "./shared.js";
          console.log("a", JSON.stringify(json), json === require("./data.json"));
        `,
        "/b.js": /* js */ `
          import json, { renamed } from "./shared.js";
          console.log("b", JSON.stringify(json), json === renamed);
        `,
        "/shared.js": /* js */ `
          export { default, default as renamed } from "./data.json";
        `,
        "/data.json": dataFiles.json,
      },
      entryPoints: ["/a.js", "/b.js"],
      splitting: true,
      outdir: "/out",
      run: [
        { file: "/out/a.js", stdout: `a ${whole} true` },
        { file: "/out/b.js", stdout: `b ${whole} true` },
      ],
    });

    // The importer is itself wrapped (`__esm`) because the entry require()s it.
    itBundled("bun/loader-data-default-wrapped-esm-importer", {
      files: {
        "/entry.js": /* js */ `
          const { json, read } = require("./importer.js");
          console.log(JSON.stringify(json), json === read(), json === require("./data.json"));
        `,
        "/importer.js": /* js */ `
          import json from "./data.json";
          export { json };
          export const read = () => json;
        `,
        "/data.json": dataFiles.json,
      },
      run: { stdout: `${whole} true true` },
    });

    // The importer has an import statement and is a CommonJS module.
    itBundled("bun/loader-data-default-commonjs-importer", {
      files: {
        "/entry.js": /* js */ `
          const { json, required } = require("./importer.js");
          console.log(JSON.stringify(json), json === required);
        `,
        "/importer.js": /* js */ `
          import json from "./data.json";
          module.exports = { json, required: require("./data.json") };
        `,
        "/data.json": dataFiles.json,
      },
      run: { stdout: `${whole} true` },
    });

    // The entry point exports the default and its output is an ES module or a
    // CommonJS module.
    for (const format of ["esm", "cjs"] as const) {
      itBundled(`bun/loader-data-default-entry-reexport-${format}`, {
        files: {
          "/entry.js": /* js */ `
            export { default, default as renamed } from "./data.json";
            export const required = require("./data.json");
          `,
          "/data.json": dataFiles.json,
        },
        format,
        target: "bun",
        outdir: "/out",
        runtimeFiles: {
          "/test.js": /* js */ `
            const { default: json, renamed, required } = ${format === "esm" ? `await import("./out/entry.js")` : `require("./out/entry.js")`};
            console.log(JSON.stringify(json), json === renamed, json === required);
          `,
        },
        run: { file: "/test.js", stdout: `${whole} true true` },
      });
    }

    // Two importers of one data file, one an ES module by type and one not,
    // in two chunks: both get the same object.
    itBundled("bun/loader-data-default-importers-of-both-module-types", {
      files: {
        "/a.js": /* js */ `
          import json from "./data.json";
          import { fromMjs } from "./b.mjs";
          console.log(JSON.stringify(json), json === fromMjs, json === require("./data.json"));
        `,
        "/b.mjs": /* js */ `
          import json from "./data.json";
          export const fromMjs = json;
          console.log(JSON.stringify(json));
        `,
        "/data.json": dataFiles.json,
      },
      entryPoints: ["/a.js", "/b.mjs"],
      splitting: true,
      outdir: "/out",
      outputPaths: ["/out/a.js", "/out/b.js"],
      run: [
        { file: "/out/a.js", stdout: `${whole}\n${whole} true true` },
        { file: "/out/b.js", stdout: whole },
      ],
    });

    // A CommonJS module whose exports have the same two keys keeps CommonJS
    // interop, also when its exports are the data.
    itBundled("bun/loader-data-default-commonjs-module-keeps-interop", {
      files: {
        "/entry.js": /* js */ `
          import json from "./data.json";
          import literal from "./literal.cjs";
          import required from "./required.cjs";
          console.log(JSON.stringify(json), literal, required, JSON.stringify(require("./data.json")));
        `,
        "/literal.cjs": `module.exports = { __esModule: true, default: 5, x: 1 };`,
        "/required.cjs": `const data = require("./data.json"); module.exports = data;`,
        "/data.json": dataFiles.json,
      },
      run: { stdout: `${whole} 5 5 ${whole}` },
    });

    // A file that is only `module.exports = require(x)` is linked as `x` in
    // ES module output, so an import of it is an import of the data file.
    itBundled("bun/loader-data-default-through-redirect-file", {
      files: {
        "/entry.js": /* js */ `
          import json from "./redirect.cjs";
          console.log(JSON.stringify(json), json === require("./data.json"));
        `,
        "/redirect.cjs": `module.exports = require("./data.json");`,
        "/data.json": dataFiles.json,
      },
      run: { stdout: `${whole} true` },
    });

    // import(): the namespace object has the named keys of the data, and its
    // `default` is the whole value.
    itBundled("bun/loader-data-default-import-call", {
      files: {
        "/entry.js": /* js */ `
          import json from "./data.json";
          (async () => {
            const { default: destructured } = await import("./data.json");
            const ns = await import("./data.json");
            const escaped = await import("./data.json").then(ns => [ns][0]);
            console.log(JSON.stringify(json), json === destructured, json === ns.default, ns.x, json === escaped.default, escaped.x);
          })();
        `,
        "/data.json": dataFiles.json,
      },
      run: { stdout: `${whole} true true 1 true 1` },
    });
    itBundled("bun/loader-data-default-import-call-from-commonjs", {
      files: {
        "/entry.cjs": /* js */ `
          import("./data.json").then(ns => {
            console.log(JSON.stringify(ns.default), ns.default === require("./data.json"), ns.x);
          });
        `,
        "/data.json": dataFiles.json,
      },
      run: { stdout: `${whole} true 1` },
    });
    itBundled("bun/loader-data-default-split-import-call", {
      files: {
        "/entry.js": /* js */ `
          (async () => {
            const { default: json } = await import("./data.json");
            const ns = await import("./data.json");
            console.log(JSON.stringify(json), json === require("./data.json"), json === ns.default, ns.x);
          })();
        `,
        "/data.json": dataFiles.json,
      },
      splitting: true,
      outdir: "/out",
      run: { file: "/out/entry.js", stdout: `${whole} true true 1` },
    });

    // A data file in a package on the CommonJS unwrap list. A default import
    // alone gives it the CommonJS form. A require() of it is an import there,
    // and keeps the namespace object it has.
    itBundled("bun/loader-data-default-in-unwrapped-package", {
      files: {
        "/entry.js": /* js */ `
          import json from "react/data.json";
          console.log(JSON.stringify(json));
        `,
        "/node_modules/react/data.json": dataFiles.json,
      },
      run: { stdout: whole },
    });
    itBundled("bun/loader-data-default-require-in-unwrapped-package", {
      files: {
        "/entry.js": /* js */ `
          import json from "react/data.json";
          import { required } from "react";
          console.log(JSON.stringify(json), required.default, required.x);
        `,
        "/node_modules/react/index.js": `exports.required = require("./data.json");`,
        "/node_modules/react/data.json": dataFiles.json,
      },
      run: { stdout: `${whole} 5 1` },
    });
  });

  // Lazy-export modules (JSON, TOML, CSS modules, ...) used to crash the
  // printer when bundled with the dev server's module format.
  // https://github.com/oven-sh/bun/issues/31943
  describe("internal_bake_dev lazy exports", () => {
    itBundled("bake-dev/loader-json-default-import", {
      format: "internal_bake_dev",
      files: {
        "/entry.ts": /* js */ `
          import data from "./data.json";
          console.log(data.value);
        `,
        "/data.json": `{"value": 1}`,
      },
      onAfterBundle(api) {
        const output = api.readFile("/out.js");
        expect(output).toContain('"data.json"(hmr, module, exports) {');
        expect(output).toContain("module.exports = { value: 1 }");
        expect(output).toContain("import_data.default.value");
      },
    });

    itBundled("bake-dev/loader-json-named-and-star-import", {
      format: "internal_bake_dev",
      files: {
        "/entry.ts": /* js */ `
          import { value } from "./data.json";
          import * as ns from "./data.json";
          console.log(value, ns.value);
        `,
        "/data.json": `{"value": 1}`,
      },
      onAfterBundle(api) {
        const output = api.readFile("/out.js");
        expect(output).toContain('"data.json"(hmr, module, exports) {');
        expect(output).toContain("module.exports = { value: 1 }");
      },
    });

    itBundled("bake-dev/loader-json-require", {
      format: "internal_bake_dev",
      files: {
        "/entry.ts": /* js */ `
          const data = require("./data.json");
          console.log(data.value);
        `,
        "/data.json": `{"value": 1}`,
      },
      onAfterBundle(api) {
        const output = api.readFile("/out.js");
        expect(output).toContain('"data.json"(hmr, module, exports) {');
        expect(output).toContain("module.exports = { value: 1 }");
      },
    });

    itBundled("bake-dev/loader-json-entry-point", {
      format: "internal_bake_dev",
      files: {
        "/data.json": `{"value": 1}`,
      },
      entryPoints: ["/data.json"],
      onAfterBundle(api) {
        const output = api.readFile("/out.js");
        expect(output).toContain('"data.json"(hmr, module, exports) {');
        expect(output).toContain("module.exports = { value: 1 }");
      },
    });

    itBundled("bake-dev/loader-jsonc-default-import", {
      format: "internal_bake_dev",
      files: {
        "/entry.ts": /* js */ `
          import data from "./data.jsonc";
          console.log(data.value);
        `,
        "/data.jsonc": `{
          // comment
          "value": 1,
        }`,
      },
      onAfterBundle(api) {
        const output = api.readFile("/out.js");
        expect(output).toContain('"data.jsonc"(hmr, module, exports) {');
        expect(output).toContain("module.exports = {");
        expect(output).toContain("value: 1");
      },
    });

    itBundled("bake-dev/loader-toml-default-import", {
      format: "internal_bake_dev",
      files: {
        "/entry.ts": /* js */ `
          import data from "./data.toml";
          console.log(data.value);
        `,
        "/data.toml": `value = 1`,
      },
      onAfterBundle(api) {
        const output = api.readFile("/out.js");
        expect(output).toContain('"data.toml"(hmr, module, exports) {');
        expect(output).toContain("module.exports = {");
        expect(output).toContain("value: 1");
        expect(output).toContain("import_data.default.value");
      },
    });

    itBundled("bake-dev/loader-empty-cjs-import", {
      format: "internal_bake_dev",
      files: {
        "/entry.ts": /* js */ `
          import x from "./empty.cjs";
          console.log(x);
        `,
        "/empty.cjs": "",
      },
      onAfterBundle(api) {
        const output = api.readFile("/out.js");
        expect(output).toContain('"empty.cjs"(hmr, module, exports) {');
        expect(output).toContain("module.exports = {}");
      },
    });

    itBundled("bake-dev/loader-empty-mjs-import", {
      format: "internal_bake_dev",
      files: {
        "/entry.ts": /* js */ `
          import x from "./empty.mjs";
          console.log(x);
        `,
        "/empty.mjs": "",
      },
      onAfterBundle(api) {
        const output = api.readFile("/out.js");
        expect(output).toContain('"empty.mjs"(hmr, module, exports) {');
        expect(output).toContain("module.exports = undefined");
      },
    });

    // CSS imports are delivered out-of-band by the dev server, so the JS
    // chunk only contains the importing module. This used to panic while
    // linking the CSS file's lazy-export JS stub.
    itBundled("bake-dev/loader-css-module-import", {
      format: "internal_bake_dev",
      outdir: "/out",
      files: {
        "/entry.ts": /* js */ `
          import styles from "./styles.module.css";
          console.log(styles.foo);
        `,
        "/styles.module.css": `.foo { color: red; }`,
      },
      onAfterBundle(api) {
        const jsFile = readdirSync(api.outdir).find(x => x.endsWith(".js"))!;
        expect(api.readFile(join("/out", jsFile))).toContain('"entry.ts"');
        const cssFile = readdirSync(api.outdir).find(x => x.endsWith(".css"))!;
        expect(api.readFile(join("/out", cssFile))).toContain("color: red");
      },
    });
  });
});
