import { fileURLToPath, Loader } from "bun";
import { describe, expect } from "bun:test";
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

  // https://github.com/oven-sh/bun/issues/12981
  for (const target of ["bun", "browser"] as const) {
    itBundled(`bun/loader-text-file-invalid-utf8-${target}`, {
      target,
      files: {
        "/entry.ts": /* js */ `
          import t from './f.txt';
          console.log(JSON.stringify([...t].map(c => c.codePointAt(0))));
        `,
        "/f.txt": Buffer.from([0x61, 0xff, 0xfe, 0x62]),
      },
      run: { stdout: "[97,65533,65533,98]" },
    });
  }

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

  const moon = await Bun.file(
    fileURLToPath(import.meta.resolve("../js/bun/util/text-loader-fixture-text-file.backslashes.txt")),
  ).text();

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
});
