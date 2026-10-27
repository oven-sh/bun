import { fileURLToPath, Loader } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, compileFixture, isWindows, tempDir } from "harness";
import fs, { readdirSync } from "node:fs";
import { totalmem } from "node:os";
import { join } from "path";
import { itBundled } from "./expectBundled";

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

  // Nothing parses a copied asset: its module is one string. The parser's symbol tables were
  // sized from the length of the file all the same, about 7 bytes for each byte of the asset.
  test.concurrent("the module of a copied asset reserves no parser tables for the bytes of the asset", async () => {
    const assetSize = 64 * 1024 * 1024;
    using dir = tempDir("loader-asset-presize", {
      "entry-small.js": `import url from "./small.bin"; console.log(url);`,
      "entry-big.js": `import url from "./big.bin"; console.log(url);`,
      "small.bin": "x",
      "big.bin": "HEAD",
      "build-fixture.ts": `
        import { heapStats } from "bun:jsc";
        const build = async (entry: string) => {
          const result = await Bun.build({ entrypoints: [import.meta.dir + "/" + entry], throw: false });
          return { success: result.success, size: result.outputs.find(output => output.kind === "asset")?.size };
        };
        // The first build starts the thread pool and the allocator's arenas.
        const small = await build("entry-small.js");
        const before = heapStats().mimalloc.committed.peak;
        const big = await build("entry-big.js");
        const growth = heapStats().mimalloc.committed.peak - before;
        console.log(JSON.stringify({ small, big, growth }));
      `,
    });
    // A hole: the file takes no disk space.
    fs.truncateSync(join(String(dir), "big.bin"), assetSize);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build-fixture.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const { growth, ...builds } = stdout ? JSON.parse(stdout) : {};
    expect({ ...builds, stderr, exitCode }).toEqual({
      small: { success: true, size: 1 },
      big: { success: true, size: assetSize },
      stderr: "",
      exitCode: 0,
    });
    // The bytes that the build read are in the measure: 1.1 times the asset in an ASAN build,
    // 2.2 times with the copy for the output file. The tables took it past 9 times the asset.
    expect(growth).toBeGreaterThan(assetSize / 2);
    expect(growth).toBeLessThan(5 * assetSize);
  });

  // The source comes from the native plugin in fixtures/huge-source-plugin.c, which maps it:
  // a file of this size would be read into memory. `mmap` and a C compiler: not on Windows.
  const hasHugeSourcePlugin = !isWindows && !!(Bun.which("cc") || Bun.which("clang") || Bun.which("gcc"));
  describe.skipIf(!hasHugeSourcePlugin)("a source of 4 GiB or more", () => {
    const FOUR_GIB = 2 ** 32;
    const HEAD = Buffer.alloc(32, "HEAD").toString();

    // Compiled here and not in a test: a compiler that is not in the page cache takes seconds to start.
    const addon = hasHugeSourcePlugin
      ? compileFixture(join(import.meta.dir, "fixtures", "huge-source-plugin.c"), {
          flags: ["-I" + join(import.meta.dir, "..", "..", "packages", "bun-native-bundler-plugin-api")],
        })
      : "";

    // `symbol` names the plugin callback that replaces the source of `big.*`, "" for no plugin.
    type Case = { entry: string; symbol: string; options?: Partial<Bun.BuildConfig> };

    // Runs each case in its own `Bun.build`.
    async function build(dir: string, cases: Record<string, Case>) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "build-fixture.ts", addon, JSON.stringify(cases)],
        env: bunEnv,
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout: stdout && JSON.parse(stdout), stderr, exitCode };
    }

    const buildFixture = /* ts */ `
      const addon = { exports: {} };
      process.dlopen(addon, process.argv[2]);
      const results: Record<string, unknown> = {};
      for (const [name, { entry, symbol, options }] of Object.entries<any>(JSON.parse(process.argv[3]))) {
        const result = await Bun.build({
          entrypoints: [import.meta.dir + "/" + entry],
          throw: false,
          ...options,
          plugins: symbol
            ? [
                {
                  name: "huge_source",
                  setup(build) {
                    build.onBeforeParse({ filter: /big\\.\\w+$/ }, { napiModule: addon.exports, symbol });
                  },
                },
              ]
            : [],
        });
        const asset = result.outputs.find(output => output.kind === "asset");
        results[name] = {
          success: result.success,
          logs: result.logs.map(log => [log.message, ...(log.notes ?? []).map(note => note.message)]),
          asset: asset && {
            path: asset.path,
            size: asset.size,
            head: await asset.slice(0, 4).text(),
            tail: await asset.slice(-4).text(),
          },
        };
      }
      console.log(JSON.stringify(results));
    `;

    test.concurrent("is a build error unless a loader copies it as-is", async () => {
      using dir = tempDir("loader-four-gib-error", {
        "build-fixture.ts": buildFixture,
        "entry-txt.js": `import text from "./big.txt"; console.log(text.length);`,
        "entry-json.js": `import json from "./big.json"; console.log(json);`,
        "entry-js.js": `import "./big.js";`,
        "entry-css.js": `import "./big.css";`,
        "entry-bin.js": `import url from "./big.bin"; console.log(url);`,
        "entry-db.js": `import db from "./big.db"; import "./missing.js"; console.log(db);`,
        "index.html": `<!doctype html><img src="./big.bin">`,
        "big.txt": "",
        "big.json": "{}",
        "big.js": "",
        "big.css": "",
        "big.bin": "",
        "big.db": "",
      });
      const size = `(${FOUR_GIB} bytes, 4 GiB maximum)`;
      const refused = (...log: string[]) => ({ success: false, logs: [log] });
      const notCopied = refused(
        `File is too large ${size}`,
        `To copy the file to the output directory as-is, import it with { type: "file" }`,
      );
      expect(
        await build(String(dir), {
          txt: { entry: "entry-txt.js", symbol: "four_gib" },
          json: { entry: "entry-json.js", symbol: "four_gib" },
          js: { entry: "entry-js.js", symbol: "four_gib" },
          css: { entry: "entry-css.js", symbol: "four_gib" },
          // One byte less is for the parser to refuse.
          "js, 4 GiB - 1": { entry: "entry-js.js", symbol: "four_gib_less_one" },
          // Standalone HTML inlines every file, a standalone executable embeds it.
          "standalone HTML": {
            entry: "index.html",
            symbol: "four_gib",
            options: { compile: true, target: "browser" },
          },
          "executable": { entry: "entry-bin.js", symbol: "four_gib", options: { compile: true } },
          // The module of a database is its path. The build gets as far as the import that does not resolve.
          "executable, sqlite": {
            entry: "entry-db.js",
            symbol: "four_gib",
            options: { compile: true, loader: { ".db": "sqlite" } },
          },
        }),
      ).toEqual({
        stdout: {
          txt: notCopied,
          json: notCopied,
          js: notCopied,
          css: notCopied,
          "js, 4 GiB - 1": refused("File is too large to parse (2 GiB maximum)"),
          "standalone HTML": refused(
            `File is too large to inline into standalone HTML ${size}`,
            "Without --compile, Bun copies the file to the output directory as-is",
          ),
          "executable": refused(
            `File is too large to embed in a standalone executable ${size}`,
            "To keep the file out of the executable, read it from disk at run time, for example with Bun.file()",
          ),
          "executable, sqlite": refused(`Could not resolve: "./missing.js"`),
        },
        stderr: "",
        exitCode: 0,
      });
    });

    // The output file is a second copy of the bytes, and that one takes memory.
    test.skipIf(totalmem() < 12 * 1024 ** 3)(
      "is copied whole by the file loader",
      async () => {
        using dir = tempDir("loader-four-gib-copy", {
          "build-fixture.ts": buildFixture,
          "entry-bin.js": `import url from "./big.bin"; console.log(url);`,
          "big.bin": HEAD,
        });
        // The name has the hash of every byte: the second one is not the name of the first 32.
        expect({
          first32Bytes: await build(String(dir), { bin: { entry: "entry-bin.js", symbol: "" } }),
          whole: await build(String(dir), { bin: { entry: "entry-bin.js", symbol: "four_gib_and_markers" } }),
        }).toEqual({
          first32Bytes: {
            stdout: {
              bin: {
                success: true,
                logs: [],
                asset: { path: "./big-zg8npsdy.bin", size: 32, head: "HEAD", tail: "HEAD" },
              },
            },
            stderr: "",
            exitCode: 0,
          },
          whole: {
            stdout: {
              bin: {
                success: true,
                logs: [],
                asset: { path: "./big-wx7e3rrf.bin", size: FOUR_GIB + 32, head: "HEAD", tail: "TAIL" },
              },
            },
            stderr: "",
            exitCode: 0,
          },
        });
      },
      120_000,
    );
  });
});
