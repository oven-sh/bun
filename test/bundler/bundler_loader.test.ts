import { fileURLToPath, Loader } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
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
      // One file imported under two `with { type }` loaders is two modules
      // with two values. The bundler used to key modules by path alone, so the
      // first loader won for every import of the file.
      // The plugin variant resolves every import through the onResolve
      // fallback path (a plugin that matches but defers to the default resolver).
      // Its first import takes the other path: onResolve returns aliased.json.
      // The import keeps its `with { type }` on the path the plugin returned,
      // and the plain import that follows is the parsed object.
      for (const withPlugin of [false, true]) {
        const deferred: string[] = [];
        itBundled(`bun/loader-same-file-under-two-import-attributes${withPlugin ? "-plugin" : ""}`, {
          target,
          outdir: "/out",
          files: {
            "/entry.ts": /* js */ `
          ${
            withPlugin
              ? `import aliased from 'alias:aliased' with { type: 'text' };
          import aliasedObj from './aliased.json';`
              : `const aliased = '{"k":2}', aliasedObj = { k: 2 };`
          }
          import { readFileSync } from 'node:fs';
          import { join } from 'node:path';
          import obj from './data.json';
          import { text, cfg as cfgFromAsText } from './as-text';
          import * as shadow from './as-text';
          const dynamicText = (await import('./data.json', { with: { type: 'text' } })).default;
          const dynamicObj = (await import('./data.json')).default;
          // At runtime these two still share one module (#32999).
          import pageText from './page.html' with { type: 'text' };
          import pageFile from './page.html' with { type: 'file' };
          // Two importers of one (path, loader) pair share one module: the same object.
          import cfg from './cfg.txt' with { type: 'json' };
          console.write(JSON.stringify([
            typeof obj, obj.j,
            typeof text, text,
            dynamicText === text, dynamicObj === obj, shadow.text === text,
            pageText,
            pageFile !== pageText, readFileSync(join(import.meta.dirname, pageFile), 'utf8') === pageText,
            cfg.c, cfg === cfgFromAsText,
            aliased, typeof aliasedObj, aliasedObj.k,
          ]));
        `,
            "/as-text.ts": /* js */ `
          import text from './data.json' with { type: 'text' };
          import cfg from './cfg.txt' with { type: 'json' };
          export { text, cfg };
        `,
            "/data.json": `{"j":1}`,
            "/aliased.json": `{"k":2}`,
            "/cfg.txt": `{"c":3}`,
            "/page.html": `<p>hi</p>`,
          },
          plugins: withPlugin
            ? builder => {
                builder.onResolve({ filter: /^alias:aliased$/ }, args => ({
                  path: join(args.importer, "../aliased.json"),
                }));
                builder.onResolve({ filter: /.*/ }, args => {
                  deferred.push(args.path);
                  return undefined;
                });
              }
            : undefined,
          onAfterBundle() {
            if (withPlugin) {
              expect(deferred).toEqual(
                expect.arrayContaining(["./data.json", "./as-text", "./page.html", "./cfg.txt", "./aliased.json"]),
              );
            }
          },
          run: {
            stdout:
              '["object",1,"string","{\\"j\\":1}",true,true,true,"<p>hi</p>",true,true,3,true,"{\\"k\\":2}","object",2]',
          },
        });
      }
    });
  }

  // a.mjs and b.mjs are parsed on worker threads. The one whose result reached
  // the bundle thread first used to decide the loader for both imports of the
  // shared file, so the same sources gave several bundles, and none of them
  // gave each importer the value it asked for.
  describe("one file imported plainly and as text builds to one bundle", () => {
    const cases = {
      "code and text": {
        shared: { name: "lib.mjs", contents: "export const n = 1;\nexport default 0;\n" },
        plainImporter: `import { n } from "./lib.mjs";\nconsole.log("a", n);\n`,
        stdout: `a 1\nb "export const n = 1;\\nexport default 0;\\n"\n`,
      },
      "json and text": {
        shared: { name: "d.json", contents: `{ "x": 1 }\n` },
        plainImporter: `import o from "./d.json";\nconsole.log("a", JSON.stringify(o));\n`,
        stdout: `a {"x":1}\nb "{ \\"x\\": 1 }\\n"\n`,
      },
    };
    // A debug build takes about a quarter of a second for each build.
    const builds = isASAN || isDebug ? 12 : 30;

    for (const [name, { shared, plainImporter, stdout }] of Object.entries(cases)) {
      test.concurrent(
        `${name}: ${builds} builds`,
        async () => {
          using dir = tempDir("loader-plain-and-text", {
            [shared.name]: shared.contents,
            "app.mjs": `import "./a.mjs";\nimport "./b.mjs";\n`,
            "a.mjs": plainImporter,
            "b.mjs": `import t from "./${shared.name}" with { type: "text" };\nconsole.log("b", JSON.stringify(t));\n`,
            // The builds run at once in one process: they share one thread pool, so the
            // parse results reach each build in a different order.
            "build-many.mjs": `
              const builds = await Promise.all(
                Array.from({ length: ${builds} }, async () => {
                  const build = await Bun.build({ entrypoints: ["./app.mjs"], target: "node", throw: false });
                  return build.success ? await build.outputs[0].text() : "the build failed: " + build.logs.join("\\n");
                }),
              );
              const bundles = [...new Set(builds)];
              await Bun.write("bundle.js", bundles[0]);
              console.log(JSON.stringify(bundles.map(bundle => builds.filter(build => build === bundle).length)));
            `,
          });
          const cwd = String(dir);
          const run = async (cmd: string[]) => {
            await using proc = Bun.spawn({ cmd: [bunExe(), ...cmd], cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
            const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
            return { stdout, stderr, exitCode };
          };

          // How many builds gave each distinct bundle: one bundle, from every build.
          expect(await run(["build-many.mjs"])).toEqual({ stdout: `[${builds}]\n`, stderr: "", exitCode: 0 });
          expect(await run(["bundle.js"])).toEqual({ stdout, stderr: "", exitCode: 0 });

          // `bun build` gives the same result.
          const cli = await run(["build", "--no-install", "app.mjs", "--target=node", "--outdir=out"]);
          expect({ stderr: cli.stderr, exitCode: cli.exitCode }).toEqual({ stderr: "", exitCode: 0 });
          expect(await run([join("out", "app.js")])).toEqual({ stdout, stderr: "", exitCode: 0 });
        },
        30_000,
      );
    }
  });

  // An HTML import from a server build turns into a manifest module plus a
  // browser entry point that the linker finds again by path, so it stays keyed
  // by path even when `with { type: "html" }` is not the path's default loader.
  itBundled("bun/loader-html-type-attribute-on-non-html-extension", {
    target: "bun",
    outdir: "/out",
    files: {
      "/entry.ts": /* js */ `
      import page from './page.htm' with { type: 'html' };
      console.write(JSON.stringify([typeof page.index, page.files.some(f => f.path === page.index)]));
    `,
      "/page.htm": `<!DOCTYPE html><html><head></head><body><h1>hi</h1></body></html>`,
    },
    run: { stdout: '["string",true]' },
  });

  // The two imports sit in one module, in either order. The second run entry
  // runs the source file: `bun run` gives the same two values.
  for (const [order, imports] of Object.entries({
    "text-first": `import asText from "./data.json" with { type: "text" };\nimport asJson from "./data.json";`,
    "json-first": `import asJson from "./data.json";\nimport asText from "./data.json" with { type: "text" };`,
  })) {
    itBundled(`bun/loader-same-file-under-two-import-attributes-in-one-module-${order}`, {
      target: "bun",
      files: {
        "/entry.ts": /* js */ `
          ${imports}
          console.log(JSON.stringify({ text: asText.trim(), json: asJson }));
        `,
        "/data.json": `{"a":1}`,
      },
      onAfterBundle(api) {
        const out = api.readFile("/out.js");
        expect(out).toContain("// data.json with { type: 'text' }\n");
        expect(out).toContain("// data.json\n");
      },
      run: [
        { stdout: '{"text":"{\\"a\\":1}","json":{"a":1}}' },
        { file: "/entry.ts", stdout: '{"text":"{\\"a\\":1}","json":{"a":1}}' },
      ],
    });
  }

  // A re-export keeps its `with { type }`. The parser used to drop it, so the
  // file took the loader of its extension unless a direct import with the type
  // came first.
  itBundled("bun/loader-type-attribute-on-re-export", {
    target: "bun",
    outdir: "/out",
    files: {
      "/entry.ts": /* js */ `
        import direct from "./direct.mustache" with { type: "text" };
        import { viaBarrel, ns, onlyViaBarrel } from "./barrel.ts";
        console.log(JSON.stringify([direct, viaBarrel, ns.default, onlyViaBarrel]));
      `,
      "/barrel.ts": /* js */ `
        export { default as viaBarrel } from "./direct.mustache" with { type: "text" };
        export * as ns from "./direct.mustache" with { type: "text" };
        export { default as onlyViaBarrel } from "./barrel-only.mustache" with { type: "text" };
      `,
      "/direct.mustache": `Hello {{name}}`,
      "/barrel-only.mustache": `Bye {{name}}`,
    },
    run: { stdout: '["Hello {{name}}","Hello {{name}}","Hello {{name}}","Bye {{name}}"]' },
  });

  // A typed sqlite re-export is external, like a typed sqlite import. The type
  // used to be dropped, and the database became a file asset.
  itBundled("bun/loader-sqlite-type-attribute-on-re-export", {
    target: "bun",
    outdir: "/out",
    files: {
      "/entry.ts": `export { default as db } from "./data.db" with { type: "sqlite" };`,
      "/data.db": "not read at build time",
    },
    onAfterBundle(api) {
      expect(api.readFile("/out/entry.js")).toContain(`from "./data.db" with { type: "sqlite" }`);
      expect(readdirSync(api.outdir)).toEqual(["entry.js"]);
    },
  });

  // A .json path is JSON by default, so `with { type: "jsonc" }` asks for another
  // module of it. The first of the two loaders to arrive used to parse the file
  // for both importers.
  itBundled("bun/loader-json-next-to-jsonc", {
    target: "bun",
    files: {
      "/entry.ts": /* js */ `
        import strict from "./config.json";
        import { lenient } from "./lenient";
        console.log(JSON.stringify([strict, lenient, strict === lenient]));
      `,
      "/lenient.ts": /* js */ `
        import lenient from "./config.json" with { type: "jsonc" };
        export { lenient };
      `,
      "/config.json": `{"a":1}`,
    },
    run: { stdout: '[{"a":1},{"a":1},false]' },
  });

  // An onResolve plugin answers a typed import with a path. The import keeps its
  // `with { type }` on that path, beside a direct import of the same file or
  // alone, and the plain import of the file is the parsed object. Each module of
  // the file is loaded once.
  {
    const loaded: string[] = [];
    itBundled("bun/loader-type-attribute-on-a-path-a-plugin-returned", {
      target: "bun",
      files: {
        "/entry.ts": /* js */ `
          import viaPlugin from "virtual:data" with { type: "text" };
          import direct from "./data.json" with { type: "text" };
          import plain from "./data.json";
          import aloneViaPlugin from "virtual:alone" with { type: "text" };
          console.log(JSON.stringify([viaPlugin, direct, plain, aloneViaPlugin]));
        `,
        "/data.json": `{"j":1}`,
        "/alone.json": `{"k":2}`,
      },
      plugins(builder) {
        builder.onResolve({ filter: /^virtual:/ }, args => ({
          path: join(args.importer, "..", args.path === "virtual:data" ? "data.json" : "alone.json"),
        }));
        builder.onLoad({ filter: /\.json$/ }, args => {
          loaded.push(args.path.replaceAll("\\", "/").split("/").pop()!);
          return undefined;
        });
      },
      onAfterBundle() {
        expect(loaded.sort()).toEqual(["alone.json", "data.json", "data.json"]);
      },
      run: { stdout: '["{\\"j\\":1}","{\\"j\\":1}",{"j":1},"{\\"k\\":2}"]' },
    });
  }

  // An import that stays external is not a module of the build, whatever its
  // path is. `external: ["<dir>/*"]` matches the specifier of b.mjs's import and
  // not a.mjs's. The external import used to be bound to the bundled file when
  // that file was in the graph first.
  test.concurrent(
    "bun/loader-external-import-by-the-path-of-a-bundled-file",
    async () => {
      using dir = tempDir("loader-external-absolute", {
        "lib.mjs": `console.log("lib runs");\nexport default "lib";\n`,
        "a.mjs": `import lib from "./lib.mjs";\nconsole.log("a", lib);\n`,
        "app.mjs": `import "./a.mjs";\nimport "./b.mjs";\n`,
      });
      const cwd = String(dir);
      const external = join(cwd, "lib.mjs").replaceAll("\\", "/");
      await Bun.write(join(cwd, "b.mjs"), `import lib from ${JSON.stringify(external)};\nconsole.log("b", lib);\n`);
      await Bun.write(
        join(cwd, "build-many.mjs"),
        `
          const builds = await Promise.all(
            Array.from({ length: ${isASAN || isDebug ? 12 : 30} }, async () => {
              const build = await Bun.build({ entrypoints: ["./app.mjs"], target: "node", external: [${JSON.stringify(external.slice(0, -"lib.mjs".length) + "*")}], throw: false });
              return build.success ? await build.outputs[0].text() : "the build failed: " + build.logs.join("\\n");
            }),
          );
          const bundles = [...new Set(builds)];
          await Bun.write("bundle.mjs", bundles[0]);
          console.log(bundles.length);
        `,
      );
      const run = async (cmd: string[]) => {
        await using proc = Bun.spawn({ cmd: [bunExe(), ...cmd], cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        return { stdout, stderr, exitCode };
      };
      expect(await run(["build-many.mjs"])).toEqual({ stdout: "1\n", stderr: "", exitCode: 0 });
      // The external import loads the file itself: it runs a second time, first.
      expect(await run(["bundle.mjs"])).toEqual({
        stdout: "lib runs\nlib runs\na lib\nb lib\n",
        stderr: "",
        exitCode: 0,
      });
    },
    30_000,
  );

  // The text request used to be folded into the entry point's own JS module:
  // `No matching export in "entry.ts" for import "default"`.
  itBundled("bun/loader-entry-point-imports-itself-as-text", {
    target: "bun",
    files: {
      "/entry.ts": /* js */ `
        import source from "./entry.ts" with { type: "text" };
        console.log(typeof source, source.includes('with { type: "text" }'));
      `,
    },
    run: [{ stdout: "string true" }, { file: "/entry.ts", stdout: "string true" }],
  });

  // A stylesheet's url() takes the file as an asset, and a script imports the
  // same file as text. The url() used to get the text module:
  // `data:text/plain;base64,...`, which no browser renders as an image.
  itBundled("bun/loader-css-url-and-text-import-of-one-file", {
    target: "bun",
    outdir: "/out",
    files: {
      "/entry.js": /* js */ `
        import svg from "./icon.svg" with { type: "text" };
        import "./style.css";
        console.log(typeof svg, svg.startsWith("<svg"));
      `,
      "/style.css": `.a { background: url("./icon.svg"); }`,
      "/icon.svg": `<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>`,
    },
    onAfterBundle(api) {
      expect(api.readFile("/out/entry.css")).toContain("data:image/svg+xml;base64,");
    },
    run: { stdout: "string true" },
  });

  // package.json and tsconfig.json are jsonc by default. `with { type: "json" }`
  // on one of them is not a second loader: as before, there is one module.
  itBundled("bun/loader-package-json-with-type-json", {
    target: "bun",
    files: {
      "/entry.ts": /* js */ `
        import pkg from "./package.json" with { type: "json" };
        import { name } from "./other";
        console.log(pkg.name, name);
      `,
      "/other.ts": /* js */ `
        import pkg from "./package.json";
        export const name = pkg.name;
      `,
      "/package.json": `{"name":"only-once"}`,
    },
    onAfterBundle(api) {
      expect(api.readFile("/out.js").split("only-once").length - 1).toBe(1);
    },
    run: { stdout: "only-once only-once" },
  });

  // shim.txt loaded as js is a `module.exports = require()` redirect to
  // target.js. The redirect belongs to that module alone: a later plain import
  // of shim.txt still gets the text module.
  itBundled("bun/loader-commonjs-redirect-under-a-type-attribute", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        import viaShim from "./shim.txt" with { type: "js" };
        import later from "./later1.js";
        console.log(viaShim.value, later);
      `,
      "/shim.txt": `module.exports = require("./target.js");`,
      "/target.js": `module.exports = { value: "from target" };`,
      "/later1.js": `export { default } from "./later2.js";`,
      "/later2.js": `export { default } from "./later3.js";`,
      "/later3.js": /* js */ `
        import text from "./shim.txt";
        export default typeof text;
      `,
    },
    run: { stdout: "from target string" },
  });

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
});
