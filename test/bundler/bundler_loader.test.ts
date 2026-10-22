import { fileURLToPath, Loader } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, runCommandMaxRSS, tempDir, withoutAsanQuarantine } from "harness";
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

  describe("a copied asset", () => {
    // A slow build gets smaller files and runs one test at a time, to stay inside the default timeout.
    const slow = isDebug || isASAN;
    const concurrentTest = slow ? test : test.concurrent;

    // The bundler reads a copied asset once, and the output file (or the asset store of the dev
    // server) takes that buffer. It read the file into the worker arena and then copied it for
    // the output, so each asset was in memory twice until the end of the build.
    describe("is in memory once", () => {
      const assetSize = (slow ? 32 : 64) * 1024 * 1024;
      const buildFixture = `
        const [target, outdir] = process.argv.slice(2);
        const build = await Bun.build({ entrypoints: [import.meta.dir + "/entry.js"], target, outdir });
        console.log(build.outputs.find(output => output.kind === "asset").size);
      `;
      const serveFixture = `
        import page from "./index.html";
        const server = Bun.serve({ port: 0, development: true, routes: { "/": page } });
        const html = await (await fetch(server.url)).text();
        const script = await (await fetch(new URL(html.match(/src="([^"]+)"/)[1], server.url))).text();
        const asset = await fetch(new URL(script.match(/\\/_bun\\/asset\\/[0-9a-f]+\\.bin/)[0], server.url));
        console.log(asset.headers.get("content-length"));
        await asset.body.cancel();
        await server.stop(true);
      `;
      const sizeOnDisk = (cwd: string) => {
        const outdir = join(cwd, "out");
        const asset = readdirSync(outdir).find(name => name.startsWith("asset-"))!;
        return fs.statSync(join(outdir, asset)).size;
      };
      const sizeOnStdout = (_cwd: string, stdout: string) => Number(stdout.trim());
      const importedFile = { asset: "asset.bin", entry: `import url from "./asset.bin";\nconsole.log(url);\n` };
      // Each loader that copies its file is in one row.
      const routes: Record<
        string,
        {
          asset: string;
          entry: string;
          files?: Record<string, string>;
          args: string[];
          env?: Record<string, string>;
          emittedSize: (cwd: string, stdout: string) => number;
          skip?: boolean;
        }
      > = {
        "Bun.build with outdir, wasm loader": {
          asset: "asset.wasm",
          entry: `import url from "./asset.wasm";\nconsole.log(url);\n`,
          args: ["build-fixture.js", "browser", "out"],
          emittedSize: sizeOnDisk,
        },
        // macOS and Windows read files on the IO pool. This runs that route on Linux too.
        "Bun.build with outdir and the file read on the IO pool, napi loader": {
          asset: "asset.node",
          entry: `console.log(require("./asset.node"));\n`,
          args: ["build-fixture.js", "bun", "out"],
          env: { BUN_FEATURE_FLAG_FORCE_IO_POOL: "1" },
          emittedSize: sizeOnDisk,
        },
        "Bun.build in memory, embedded sqlite loader": {
          asset: "asset.db",
          entry: `import db from "./asset.db" with { type: "sqlite", embed: "true" };\nconsole.log(db);\n`,
          args: ["build-fixture.js", "bun"],
          emittedSize: sizeOnStdout,
        },
        "dev server, file loader": { ...importedFile, args: ["serve-fixture.js"], emittedSize: sizeOnStdout },
        // The plugin's buffer of zeros is never touched, so only Bun's copy of it is in the peak.
        "dev server, file loader of a JS onLoad plugin": {
          ...importedFile,
          files: {
            "bunfig.toml": `[serve.static]\nplugins = ["./plugin.ts"]\n`,
            "plugin.ts": `
              import { statSync } from "node:fs";
              export default {
                name: "asset",
                setup(build) {
                  build.onLoad({ filter: /asset\\.bin$/ }, ({ path }) => ({
                    contents: new Uint8Array(statSync(path).size),
                    loader: "file",
                  }));
                },
              };
            `,
          },
          args: ["serve-fixture.js"],
          emittedSize: sizeOnStdout,
        },
        "bun build --outdir, file loader": {
          ...importedFile,
          args: ["build", "entry.js", "--outdir", "out"],
          emittedSize: sizeOnDisk,
          // The peak of a child is never below the peak of its spawner (see `runCommandMaxRSS`).
          // `bun build` starts no JS VM: in a debug or ASAN build it stays below that floor.
          skip: slow,
        },
      };

      for (const [name, { asset, entry, files, args, env, emittedSize, skip }] of Object.entries(routes)) {
        const routeTest = test.skipIf(!!skip);
        (slow ? routeTest : routeTest.concurrent)(name, async () => {
          const fixture = {
            "entry.js": entry,
            [asset]: "x",
            "index.html": `<!doctype html><script type="module" src="./entry.js"></script>`,
            "build-fixture.js": buildFixture,
            "serve-fixture.js": serveFixture,
            ...files,
          };
          using dir = tempDir("bundler-asset-once", { small: fixture, big: fixture });
          // A hole: the file takes no disk space.
          fs.truncateSync(join(String(dir), "big", asset), assetSize);

          const run = async (which: "small" | "big") => {
            const cwd = join(String(dir), which);
            const { stdout, stderr, exitCode, maxRSS } = await runCommandMaxRSS({
              cmd: [bunExe(), ...args],
              cwd,
              env: withoutAsanQuarantine({ ...bunEnv, ...env }),
            });
            expect(exitCode, stderr).toBe(0);
            return { size: emittedSize(cwd, stdout), maxRSS };
          };
          const [small, big] = await Promise.all([run("small"), run("big")]);
          expect({ small: small.size, big: big.size }).toEqual({ small: 1, big: assetSize });

          // The two runs differ only in the bytes of the asset. An asset that is in memory once
          // adds 0.9 to 1.2 times its size to the peak. In memory twice, it added 1.9 to 2.2 times.
          expect((big.maxRSS - small.maxRSS) / assetSize).toBeLessThan(1.6);
        });
      }
    });

    // The buffer of a copied file is on the global heap, so every exit of a build has to free
    // it. This build reads two of them: an asset that loads, and a .node file that the browser
    // target refuses.
    concurrentTest("is freed when the build fails", async () => {
      const fileSize = 4 * 1024 * 1024;
      const rounds = slow ? 12 : 24;
      // One buffer that every build leaves behind is three times this limit.
      const limit = (rounds / 3) * fileSize;
      using dir = tempDir("bundler-asset-failed-build", {
        "entry.js": `import url from "./asset.bin";\nconsole.log(url, require("./addon.node"));\n`,
        "asset.bin": "x",
        "addon.node": "x",
        "failed-build-fixture.js": `
          import { bundlerWorkerLiveCount } from "bun:internal-for-testing";
          const build = () =>
            Bun.build({ entrypoints: [import.meta.dir + "/entry.js"], target: "browser", throw: false });
          // A build frees its files after its promise settles, on the bundle thread and on the pool threads.
          const settledRSS = async ceiling => {
            const deadline = Date.now() + 2000;
            for (;;) {
              while (bundlerWorkerLiveCount() > 0 && Date.now() < deadline) await Bun.sleep(5);
              Bun.gc(true);
              const rss = process.memoryUsage.rss();
              if (rss <= ceiling || Date.now() >= deadline) return rss;
              await Bun.sleep(10);
            }
          };
          // The first builds start the thread pool and fill the caches of the allocator.
          for (let i = 0; i < 4; i++) await build();
          const before = await settledRSS(Infinity);
          let result;
          for (let i = 0; i < ${rounds}; i++) result = await build();
          const growth = (await settledRSS(before + ${limit})) - before;
          console.log(JSON.stringify({ success: result.success, logs: result.logs.map(log => log.message), growth }));
        `,
      });
      for (const name of ["asset.bin", "addon.node"]) fs.truncateSync(join(String(dir), name), fileSize);

      await using proc = Bun.spawn({
        cmd: [bunExe(), "failed-build-fixture.js"],
        cwd: String(dir),
        env: withoutAsanQuarantine(bunEnv),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const { growth, ...result } = JSON.parse(stdout || "{}");
      expect({ ...result, stderr, exitCode }).toEqual({
        success: false,
        logs: [`Loading .node files won't work in the browser. Make sure to set target to "bun" or "node"`],
        stderr: "",
        exitCode: 0,
      });
      expect(growth).toBeLessThan(limit);
    });

    describe("keeps its bytes at every size around the first read", () => {
      const sizes = [0, 1, 16382, 16383, 16384, 16385, 100_000];
      const contents = (size: number) => {
        const bytes = Buffer.alloc(size);
        for (let i = 0; i < size; i++) bytes[i] = (i * 31 + 7) & 0xff;
        return bytes;
      };
      const digest = (bytes: Uint8Array) => ({ size: bytes.length, sha256: Bun.SHA256.hash(bytes, "hex") });
      const files = {
        "entry.js":
          sizes.map(size => `import size${size} from "./size${size}.bin";\n`).join("") +
          `console.log(${sizes.map(size => `size${size}`).join(", ")});\n`,
        ...Object.fromEntries(sizes.map(size => [`size${size}.bin`, contents(size)])),
      };
      const emitted = async (build: Bun.BuildOutput) => {
        const assets: Record<string, { size: number; sha256: string }> = {};
        for (const output of build.outputs) {
          if (output.kind !== "asset") continue;
          assets[output.path.match(/size\d+/)![0]] = digest(new Uint8Array(await output.arrayBuffer()));
        }
        return assets;
      };
      const expected = Object.fromEntries(sizes.map(size => [`size${size}`, digest(contents(size))]));

      // The read fills a 16 KiB buffer first, and takes the size of the file only when that buffer is full.
      concurrentTest("on disk", async () => {
        using dir = tempDir("bundler-asset-sizes", files);
        expect(await emitted(await Bun.build({ entrypoints: [join(String(dir), "entry.js")] }))).toEqual(expected);
      });

      // These bytes have another owner, so the output file copies them.
      concurrentTest("in the files map", async () => {
        const inMemory = Object.fromEntries(Object.entries(files).map(([name, bytes]) => ["/" + name, bytes]));
        expect(await emitted(await Bun.build({ entrypoints: ["/entry.js"], files: inMemory }))).toEqual(expected);
      });
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
