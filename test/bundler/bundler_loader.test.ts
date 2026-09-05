import { fileURLToPath, Loader } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import fs, { readdirSync } from "node:fs";
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

  // The `json` loader must agree with `bun run`: the runtime exposes every
  // top-level key as a named export and parses the file with `JSON.parse`.
  describe("json loader matches the runtime", () => {
    // Keys that are not identifiers, plus keywords, `default`, and a key that
    // collides with the mangled name of another (`a b` becomes `a_b`).
    const keysJson = `{
      "a b": 1, "foo-bar": 2, "café": 3, "日本": 4, "🔥": 5, "": 6, "123": 7, "1e3": 8,
      "let": 9, "class": 10, "if": 11, "default": 12, "a_b": 13
    }`;
    const keysEntry = /* js */ `
      import * as ns from "./data.json";
      import def from "./data.json";
      import {
        "a b" as ab, "foo-bar" as fooBar, "café" as cafe, "日本" as jp, "🔥" as fire, "" as empty,
        "123" as n123, "1e3" as n1e3, "let" as let_, "class" as class_, "if" as if_, a_b,
      } from "./data.json";
      console.log(JSON.stringify([ab, fooBar, cafe, jp, fire, empty, n123, n1e3, let_, class_, if_, a_b]));
      console.log(JSON.stringify([
        ns["a b"], ns["foo-bar"], ns["café"], ns["日本"], ns["🔥"], ns[""], ns["123"], ns["1e3"],
        ns.let, ns.class, ns.if, ns.a_b,
      ]));
      console.log(JSON.stringify(Object.keys(ns).sort()));
      console.log(JSON.stringify(def), def.default, ns.default === def);
    `;
    const keysStdout = [
      "[1,2,3,4,5,6,7,8,9,10,11,13]",
      "[1,2,3,4,5,6,7,8,9,10,11,13]",
      '["","123","1e3","a b","a_b","café","class","default","foo-bar","if","let","日本","🔥"]',
      '{"123":7,"a b":1,"foo-bar":2,"café":3,"日本":4,"🔥":5,"":6,"1e3":8,"let":9,"class":10,"if":11,"default":12,"a_b":13} 12 true',
    ].join("\n");

    for (const format of ["esm", "cjs", "iife"] as const) {
      for (const minify of [false, true]) {
        itBundled(`bun/loader-json-non-identifier-keys-${format}${minify ? "-minify" : ""}`, {
          target: "bun",
          format,
          minifyIdentifiers: minify,
          minifySyntax: minify,
          minifyWhitespace: minify,
          files: {
            "/entry.js": keysEntry,
            "/data.json": keysJson,
          },
          run: { stdout: keysStdout },
        });
      }
    }

    // A JSON entry point exports every key, with a string alias where the key
    // is not an identifier.
    itBundled("bun/loader-json-non-identifier-keys-entry-point", {
      target: "bun",
      format: "esm",
      entryPoints: ["/data.json"],
      files: {
        "/data.json": keysJson,
      },
      onAfterBundle(api) {
        const code = api.readFile("/out.js");
        expect(code).toContain('as "a b"');
        expect(code).toContain('as "foo-bar"');
        expect(code).toContain('as ""');
        expect(code).toContain('as "123"');
        // The emoji is written as escapes in ASCII-only output.
        expect(code).toMatch(/as "(🔥|\\uD83D\\uDD25)"/);
        expect(code).toContain("as if");
        expect(code).toContain("as default");
      },
    });

    // `export * from "./data.json"` and named re-exports see the same keys.
    itBundled("bun/loader-json-non-identifier-keys-export-star", {
      target: "bun",
      files: {
        "/entry.js": /* js */ `
          import * as barrel from "./barrel.js";
          import { "a b" as ab, "" as empty, renamed, "日本" as jp } from "./barrel.js";
          console.log(JSON.stringify([barrel["a b"], barrel[""], barrel["foo-bar"], barrel.if, barrel.default, ab, empty, renamed, jp]));
          console.log(JSON.stringify(Object.keys(barrel).sort()));
        `,
        "/barrel.js": /* js */ `
          export * from "./data.json";
          export { "a b" as renamed } from "./data.json";
        `,
        "/data.json": keysJson,
      },
      run: {
        stdout: [
          "[1,6,2,11,null,1,6,1,4]",
          '["","123","1e3","a b","a_b","café","class","foo-bar","if","let","renamed","日本","🔥"]',
        ].join("\n"),
      },
    });

    // Plain `.json` accepts exactly the number forms `JSON.parse` accepts.
    itBundled("bun/loader-json-rejects-javascript-number-syntax", {
      target: "bun",
      files: {
        "/entry.js": /* js */ `
          import hex from "./hex.json";
          import octal from "./octal.json";
          import binary from "./binary.json";
          import leadingZero from "./leading-zero.json";
          import leadingZeroDecimal from "./leading-zero-decimal.json";
          import separator from "./separator.json";
          import leadingDot from "./leading-dot.json";
          import trailingDot from "./trailing-dot.json";
          import minusGap from "./minus-gap.json";
          console.log(hex, octal, binary, leadingZero, leadingZeroDecimal, separator, leadingDot, trailingDot, minusGap);
        `,
        "/hex.json": `{"a": 0x10}`,
        "/octal.json": `{"a": 0o17}`,
        "/binary.json": `{"a": 0b101}`,
        "/leading-zero.json": `{"a": 0123}`,
        "/leading-zero-decimal.json": `[018]`,
        "/separator.json": `{"a": 1_000}`,
        "/leading-dot.json": `{"a": .5}`,
        "/trailing-dot.json": `{"a": 1.}`,
        "/minus-gap.json": `{"a": - 1}`,
      },
      bundleErrors: {
        "/hex.json": ["JSON does not support hexadecimal numbers"],
        "/octal.json": ["JSON does not support octal numbers"],
        "/binary.json": ["JSON does not support binary numbers"],
        "/leading-zero.json": ["JSON does not support numbers with leading zeros"],
        "/leading-zero-decimal.json": ["JSON does not support numbers with leading zeros"],
        "/separator.json": ["JSON does not support numeric separators"],
        "/leading-dot.json": ['JSON numbers must have a digit before "."'],
        "/trailing-dot.json": ['JSON numbers must have a digit after "."'],
        "/minus-gap.json": ['JSON numbers must have a digit after "-"'],
      },
    });

    itBundled("bun/loader-json-accepts-json-numbers", {
      target: "bun",
      files: {
        "/entry.js": /* js */ `
          import data from "./numbers.json";
          console.log(JSON.stringify(data));
        `,
        "/numbers.json": `[0, -0, 10, -10, 0.5, -0.5, 0e1, 0E+1, 1e5, 1E-5, 12.5e-1, 1.5E+2, 123456789012]`,
      },
      run: { stdout: "[0,0,10,-10,0.5,-0.5,0,0,100000,0.00001,1.25,150,123456789012]" },
    });

    // The same source prints the same values under `bun run` and after `bun build`,
    // and a file that `JSON.parse` rejects fails both ways.
    test("bun run and bun build agree on a JSON module", async () => {
      using dir = tempDir("json-loader-runtime", {
        "data.json": keysJson,
        "entry.js": keysEntry,
        "hex.json": `{"a": 0x10}`,
        "hex.js": `import hex from "./hex.json"; console.log(hex);`,
      });
      const run = async (...args: string[]) => {
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

      const runtime = await run("entry.js");
      expect(runtime.stderr).toBe("");
      expect(runtime.stdout).toBe(keysStdout + "\n");
      expect(runtime.exitCode).toBe(0);

      const build = await run("build", "entry.js", "--outfile=out.js");
      expect(build.stderr).toBe("");
      expect(build.exitCode).toBe(0);
      const bundled = await run("out.js");
      expect(bundled.stderr).toBe("");
      expect(bundled.stdout).toBe(runtime.stdout);
      expect(bundled.exitCode).toBe(0);

      const runtimeHex = await run("hex.js");
      expect(runtimeHex.stderr).toContain("JSON Parse error");
      expect(runtimeHex.exitCode).toBe(1);
      const buildHex = await run("build", "hex.js", "--outfile=out-hex.js");
      expect(buildHex.stderr).toContain("JSON does not support hexadecimal numbers");
      expect(buildHex.exitCode).toBe(1);
    });

    // JSONC and the config files keep the JavaScript number syntax.
    itBundled("bun/loader-jsonc-accepts-javascript-number-syntax", {
      target: "bun",
      files: {
        "/entry.js": /* js */ `
          import jsonc from "./data.jsonc";
          import pkg from "./package.json";
          import tsconfig from "./tsconfig.json";
          import viaLoader from "./data.notjson" with { type: "jsonc" };
          console.log(JSON.stringify([jsonc, pkg, tsconfig, viaLoader]));
        `,
        "/data.jsonc": `{"a": 0x10, "b": 0o17, "c": 0b101, "d": 0123, "e": 1_000, "f": .5, "g": 1., "h": - 1, /* c */}`,
        "/package.json": `{"name": "x", "a": 0x10, "b": .5,}`,
        "/tsconfig.json": `{"compilerOptions": {"a": 1_000}, // c\n}`,
        "/data.notjson": `{"a": 0x10}`,
      },
      run: {
        stdout:
          '[{"a":16,"b":15,"c":5,"d":83,"e":1000,"f":0.5,"g":1,"h":-1},{"name":"x","a":16,"b":0.5},{"compilerOptions":{"a":1000}},{"a":16}]',
      },
    });
  });
});
