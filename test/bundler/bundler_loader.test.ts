import { fileURLToPath, Loader } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import fs, { readdirSync } from "node:fs";
import { basename, join } from "path";
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

  // A file read strips a UTF-8 byte order mark and transcodes UTF-16LE to UTF-8, for the parsers.
  // A loader that emits the file itself gets the bytes on disk.
  describe("inputs that start with a byte order mark", () => {
    const utf8Mark = Buffer.from([0xef, 0xbb, 0xbf]);
    const utf16leMark = Buffer.from([0xff, 0xfe]);
    const encoders = {
      utf8: (source: string) => Buffer.concat([utf8Mark, Buffer.from(source)]),
      utf16le: (source: string) => Buffer.concat([utf16leMark, Buffer.from(source, "utf16le")]),
    };
    // More than the 16 KiB that the first read of a file holds.
    const long = Buffer.alloc(20000, "bun ");
    const samples = {
      utf8: Buffer.concat([utf8Mark, Buffer.from("a,b\n")]),
      // A lone surrogate and an odd length: UTF-16LE to UTF-8 and back cannot restore these.
      utf16le: Buffer.concat([utf16leMark, Buffer.from([0x41, 0x00, 0xd8, 0xd8, 0x09])]),
      utf8_long: Buffer.concat([utf8Mark, long]),
      utf16le_long: Buffer.concat([utf16leMark, long]),
      utf8_mark_only: utf8Mark,
      utf16le_one_byte: Buffer.concat([utf16leMark, Buffer.from([0x41])]),
      utf32le_mark: Buffer.concat([utf16leMark, Buffer.from([0x00, 0x00])]),
      mark_not_first: Buffer.from([0x01, 0xef, 0xbb, 0xbf, 0xff, 0xfe]),
    };
    const summary = (bytes: Uint8Array) => ({
      length: bytes.length,
      start: Buffer.from(bytes.subarray(0, 8)).toString("hex"),
      hash: Bun.hash(bytes).toString(16),
    });

    // Every loader whose output is the input file.
    const copyLoaders = [
      { loader: "file", ext: ".bin", attributes: ' with { type: "file" }' },
      { loader: "wasm", ext: ".wasm", attributes: "" },
      { loader: "napi", ext: ".node", attributes: "" },
      { loader: "sqlite_embedded", ext: ".sqlite", attributes: ' with { type: "sqlite", embed: "true" }' },
    ];
    const assets = copyLoaders.flatMap(({ loader, ext, attributes }) =>
      Object.entries(samples).map(([sample, bytes]) => ({ name: `${loader}_${sample}`, ext, attributes, bytes })),
    );
    const assetFiles = Object.fromEntries(assets.map(asset => [`/${asset.name}${asset.ext}`, asset.bytes]));
    const assetEntry =
      assets.map(asset => `import ${asset.name} from "./${asset.name}${asset.ext}"${asset.attributes};`).join("\n") +
      `\nexport { ${assets.map(asset => asset.name).join(", ")} };`;
    const sourceSummaries = Object.fromEntries(assets.map(asset => [asset.name, [summary(asset.bytes)]]));
    // Assets are emitted as `[name]-[hash].[ext]`.
    const emittedNames = (outdir: string) =>
      Object.fromEntries(
        assets.map(asset => [
          asset.name,
          readdirSync(outdir).filter(output => output.startsWith(`${asset.name}-`) && output.endsWith(asset.ext)),
        ]),
      );
    const emittedSummaries = (outdir: string) =>
      Object.fromEntries(
        Object.entries(emittedNames(outdir)).map(([name, outputs]) => [
          name,
          outputs.map(output => summary(fs.readFileSync(join(outdir, output)))),
        ]),
      );

    for (const backend of ["api", "cli"] as const) {
      itBundled(`bun/loader-copy-keeps-byte-order-mark-${backend}`, {
        backend,
        target: "bun",
        outdir: "/out",
        files: { "/entry.ts": assetEntry, ...assetFiles },
        async onAfterBundle(api) {
          expect(emittedSummaries(api.outdir)).toEqual(sourceSummaries);
          if (backend !== "api") return;
          // `[hash]` covers the bytes on disk: a build that takes the same bytes from memory gives the same names.
          const fromMemory = await Bun.build({
            entrypoints: ["/entry.ts"],
            files: { "/entry.ts": assetEntry, ...assetFiles },
            target: "bun",
          });
          expect(
            fromMemory.outputs
              .filter(output => output.kind === "asset")
              .map(output => basename(output.path))
              .sort(),
          ).toEqual(Object.values(emittedNames(api.outdir)).flat().sort());
        },
      });
    }

    const script = (name: string) =>
      `#!/usr/bin/env bun\nexport default "${name}";\nif (!Bun.isMainThread) postMessage("${name}");\n`;

    // The executable holds the bytes of an asset. A text import, and an asset that is loaded as a module, are text.
    itBundled("bun/compile-embeds-byte-order-mark", {
      compile: true,
      files: {
        "/entry.ts": /* js */ `
          import utf8 from "./utf8.bin" with { type: "file" };
          import utf16le from "./utf16le.bin" with { type: "file" };
          import utf8Text from "./utf8.txt";
          import utf16leText from "./utf16le.txt";
          import utf8Script from "./utf8-script.js" with { type: "file" };
          import utf16leScript from "./utf16le-script.js" with { type: "file" };
          const hex = async (path: string) => Buffer.from(await Bun.file(path).arrayBuffer()).toString("hex");
          const imported = async (path: string) => (await import(path)).default;
          const posted = (path: string) =>
            new Promise(resolve => {
              const worker = new Worker(path);
              worker.onmessage = event => {
                resolve(event.data);
                worker.terminate();
              };
              worker.onerror = event => resolve(event.message);
            });
          console.log(
            JSON.stringify({
              assets: [await hex(utf8), await hex(utf16le)],
              text: [utf8Text, utf16leText],
              imported: [await imported(utf8Script), await imported(utf16leScript)],
              posted: [await posted(utf8Script), await posted(utf16leScript)],
            }),
          );
        `,
        "/utf8.bin": samples.utf8,
        "/utf16le.bin": samples.utf16le,
        "/utf8.txt": encoders.utf8("h\u00e9llo"),
        "/utf16le.txt": encoders.utf16le("h\u00e9llo"),
        // A UTF-8 mark before "#!" is the case that the JavaScript parser does not take.
        "/utf8-script.js": encoders.utf8(script("utf8")),
        "/utf16le-script.js": encoders.utf16le(script("utf16le")),
      },
      run: {
        stdout: JSON.stringify({
          assets: [samples.utf8.toString("hex"), samples.utf16le.toString("hex")],
          text: ["h\u00e9llo", "h\u00e9llo"],
          imported: ["utf8", "utf16le"],
          posted: ["utf8", "utf16le"],
        }),
      },
    });

    itBundled("bun/html-asset-keeps-byte-order-mark", {
      outdir: "/out",
      entryPoints: ["/index.html"],
      files: {
        "/index.html": `<!DOCTYPE html><html><head><link rel="icon" href="./utf8.svg"></head><body><img src="./utf16le.png"></body></html>`,
        "/utf8.svg": samples.utf8,
        "/utf16le.png": samples.utf16le_long,
      },
      onAfterBundle(api) {
        const emitted = (ext: string) =>
          readdirSync(api.outdir)
            .filter(output => output.endsWith(ext))
            .map(output => summary(fs.readFileSync(join(api.outdir, output))));
        expect({ svg: emitted(".svg"), png: emitted(".png") }).toEqual({
          svg: [summary(samples.utf8)],
          png: [summary(samples.utf16le_long)],
        });
      },
    });

    itBundled("bun/css-url-inlines-byte-order-mark", {
      outdir: "/out",
      entryPoints: ["/style.css"],
      files: {
        "/style.css": `.utf8 { background: url("./utf8.png"); } .utf16le { background: url("./utf16le.png"); }`,
        "/utf8.png": Buffer.concat([utf8Mark, Buffer.from([1, 2, 3])]),
        "/utf16le.png": Buffer.concat([utf16leMark, Buffer.from([1, 2, 3, 4])]),
      },
      onAfterBundle(api) {
        const css = api.readFile("/out/style.css");
        expect(css).toContain(`url("data:image/png;base64,77u/AQID")`);
        expect(css).toContain(`url("data:image/png;base64,//4BAgME")`);
      },
    });

    // Text is still decoded wherever a file is read to be parsed.
    const longComment = `/* ${long.toString()} */`;
    const textFiles = (encode: (source: string) => Buffer) => ({
      "module.js": encode(`export const fromModule = "module";`),
      "long.js": encode(`${longComment}\nexport const fromLong = "long";`),
      "data.json": encode(`{ "fromJson": "json" }`),
      "text.txt": encode("text"),
      "long.txt": encode(`${longComment}text`),
      // `main` is read from a package.json with a mark, and `paths` from a tsconfig.json with one.
      "node_modules/pkg/package.json": encode(`{ "name": "pkg", "main": "./lib/main.js" }`),
      "node_modules/pkg/lib/main.js": `module.exports = "package";`,
      "tsconfig.json": encode(`{ "compilerOptions": { "paths": { "@alias/*": ["./aliased/*"] } } }`),
      "aliased/value.ts": `export const fromAlias = "alias";`,
      "imports.ts": /* js */ `
        import { fromModule } from "./module.js";
        import { fromLong } from "./long.js";
        import { fromJson } from "./data.json";
        import fromText from "./text.txt";
        import fromLongText from "./long.txt";
        import fromPackage from "pkg";
        import { fromAlias } from "@alias/value";
        export default [fromModule, fromLong, fromJson, fromText, fromLongText.length, fromPackage, fromAlias];
      `,
    });
    const textValues = ["module", "long", "json", "text", longComment.length + 4, "package", "alias"];
    const emptyAfterMark = {
      "/mark_only.txt": utf8Mark,
      "/mark_only.js": utf8Mark,
      "/mark_one_byte.txt": samples.utf16le_one_byte,
    };

    itBundled("bun/loader-text-converts-byte-order-mark", {
      target: "bun",
      files: {
        "/entry.ts": /* js */ `
          import utf8 from "./utf8/imports.ts";
          import utf16le from "./utf16le/imports.ts";
          import markOnly from "./mark_only.txt";
          import "./mark_only.js";
          import markOneByte from "./mark_one_byte.txt";
          console.write(JSON.stringify({ utf8, utf16le, markOnly, markOneByte }));
        `,
        ...Object.fromEntries(Object.entries(textFiles(encoders.utf8)).map(([name, file]) => [`/utf8/${name}`, file])),
        ...Object.fromEntries(
          Object.entries(textFiles(encoders.utf16le)).map(([name, file]) => [`/utf16le/${name}`, file]),
        ),
        ...emptyAfterMark,
      },
      run: { stdout: JSON.stringify({ utf8: textValues, utf16le: textValues, markOnly: "", markOneByte: "" }) },
    });

    // macOS and Windows read files on the IO pool by default.
    test.concurrent("a copied asset keeps its byte order mark when the IO pool reads it", async () => {
      using dir = tempDir("loader-copy-bom-io-pool", {
        "entry.ts": assetEntry,
        ...Object.fromEntries(assets.map(asset => [`${asset.name}${asset.ext}`, asset.bytes])),
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "./entry.ts", "--outdir", "out", "--target", "bun"],
        env: { ...bunEnv, BUN_FEATURE_FLAG_FORCE_IO_POOL: "1" },
        cwd: String(dir),
        stdout: "ignore",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(emittedSummaries(join(String(dir), "out"))).toEqual(sourceSummaries);
      expect(exitCode).toBe(0);
    });

    for (const [encoding, encode] of Object.entries(encoders)) {
      test.concurrent(`the runtime decodes ${encoding} modules, package.json and tsconfig.json`, async () => {
        using dir = tempDir(`runtime-bom-${encoding}`, {
          ...textFiles(encode),
          "entry.ts": encode(`import values from "./imports.ts";\nconsole.log(JSON.stringify(values));`),
        });
        await using proc = Bun.spawn({
          cmd: [bunExe(), "entry.ts"],
          env: bunEnv,
          cwd: String(dir),
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stderr).toBe("");
        expect(stdout).toBe(JSON.stringify(textValues) + "\n");
        expect(exitCode).toBe(0);
      });

      test.concurrent(`bun build --no-bundle decodes a ${encoding} CSS entry point`, async () => {
        using dir = tempDir(`no-bundle-css-bom-${encoding}`, { "style.css": encode(`.mark { color: red; }`) });
        await using proc = Bun.spawn({
          cmd: [bunExe(), "build", "--no-bundle", "./style.css"],
          env: bunEnv,
          cwd: String(dir),
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stderr).toBe("");
        expect(stdout).toBe(".mark {\n  color: red;\n}\n");
        expect(exitCode).toBe(0);
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
