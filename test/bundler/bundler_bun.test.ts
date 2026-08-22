import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, bunRun, tempDir } from "harness";
import { join } from "path";
import { itBundled } from "./expectBundled";

describe("bundler", () => {
  // https://github.com/oven-sh/bun/issues/18899
  itBundled("bun/import-bun-format-cjs", {
    target: "bun",
    format: "cjs",
    bytecode: true,
    outdir: "/out",
    files: {
      "/entry.ts": /* js */ `
        import {RedisClient} from 'bun';
        import * as BunStar from 'bun';
        const bunRequire = require("bun");
        if (RedisClient.name !== "RedisClient") {
          throw new Error("RedisClient.name is not RedisClient");
        }
        if (BunStar.RedisClient.name !== "RedisClient") {
          throw new Error("BunStar.RedisClient.name is not RedisClient");
        }
        if (bunRequire.RedisClient.name !== "RedisClient") {
          throw new Error("bunRequire.RedisClient.name is not RedisClient");
        }

        console.log(RedisClient.name);
        console.log(BunStar.RedisClient.name);
        console.log(bunRequire.RedisClient.name);

        export class RedisCache {
          constructor(config: any) {
            this.connectServer(config);
          }
          
        }
      `,
    },
    run: { stdout: "RedisClient\nRedisClient\nRedisClient\n" },
  });
  itBundled("bun/embedded-sqlite-file", {
    target: "bun",
    outfile: "",
    outdir: "/out",
    files: {
      "/entry.ts": /* js */ `
        import db from './db.sqlite' with {type: "sqlite", embed: "true"};
        console.log(db.query("select message from messages LIMIT 1").get().message);
      `,
      "/db.sqlite": (() => {
        const db = new Database(":memory:");
        db.exec("create table messages (message text)");
        db.exec("insert into messages values ('Hello, world!')");
        return db.serialize();
      })(),
    },
    run: { stdout: "Hello, world!" },
  });
  itBundled("bun/sqlite-file", {
    target: "bun",
    files: {
      "/entry.ts": /* js */ `
        import db from './db.sqlite' with {type: "sqlite"};
        console.log(db.query("select message from messages LIMIT 1").get().message);
      `,
    },
    runtimeFiles: {
      "/db.sqlite": (() => {
        const db = new Database(":memory:");
        db.exec("create table messages (message text)");
        db.exec("insert into messages values ('Hello, world!')");
        return db.serialize();
      })(),
    },
    run: { stdout: "Hello, world!", setCwd: true },
  });
  itBundled("bun/TargetBunNoSourcemapMessage", {
    target: "bun",
    files: {
      "/entry.ts": /* js */ `
        // this file has comments and weird whitespace, intentionally
        // to make it obvious if sourcemaps were generated and mapped properly
        if           (true) code();
        function code() {
          // hello world
                  throw new
            Error("Hello World");
        }
      `,
    },
    run: {
      exitCode: 1,
      validate({ stderr }) {
        expect(stderr).toInclude("\nnote: missing sourcemaps for ");
        expect(stderr).toInclude("\nnote: consider bundling with '--sourcemap' to get unminified traces\n");
      },
    },
  });
  itBundled("bun/TargetBunSourcemapInline", {
    target: "bun",
    files: {
      "/entry.ts": /* js */ `
        // this file has comments and weird whitespace, intentionally
        // to make it obvious if sourcemaps were generated and mapped properly
        if           (true) code();
        function code() {
          // hello world
                  throw   new
            Error("Hello World");
        }
      `,
    },
    sourceMap: "inline",
    run: {
      exitCode: 1,
      validate({ stderr }) {
        expect(stderr).toStartWith(
          `1 | // this file has comments and weird whitespace, intentionally
2 | // to make it obvious if sourcemaps were generated and mapped properly
3 | if           (true) code();
4 | function code() {
5 |   // hello world
6 |           throw   new
                      ^
error: Hello World`,
        );
        expect(stderr).toInclude("entry.ts:6:19");
      },
    },
  });
  itBundled("bun/unicode comment", {
    target: "bun",
    files: {
      "/a.ts": /* js */ `
        /* æ */
      `,
    },
    run: { stdout: "" },
  });
  if (Bun.version.startsWith("1.4") || Bun.version.startsWith("1.3") || Bun.version.startsWith("1.2")) {
    for (const backend of ["api", "cli"] as const) {
      itBundled("bun/ExportsConditionsDevelopment" + backend.toUpperCase(), {
        files: {
          "src/entry.js": `import 'pkg1'`,
          "node_modules/pkg1/package.json": /* json */ `
        {
          "exports": {
            "development": "./custom1.js",
            "default": "./default.js"
          }
        }
      `,
          "node_modules/pkg1/custom1.js": `console.log('SUCCESS')`,
          "node_modules/pkg1/default.js": `console.log('FAIL')`,
        },
        backend,
        outfile: "out.js",
        define: { "process.env.NODE_ENV": '"development"' },
        run: {
          stdout: "SUCCESS",
        },
      });
      itBundled("bun/ExportsConditionsDevelopmentInProduction" + backend.toUpperCase(), {
        files: {
          "src/entry.js": `import 'pkg1'`,
          "node_modules/pkg1/package.json": /* json */ `
        {
          "exports": {
            "development": "./custom1.js",
            "default": "./default.js"
          }
        }
      `,
          "node_modules/pkg1/custom1.js": `console.log('FAIL')`,
          "node_modules/pkg1/default.js": `console.log('SUCCESS')`,
        },
        backend,
        outfile: "/Users/user/project/out.js",
        define: { "process.env.NODE_ENV": '"production"' },
        run: {
          stdout: "SUCCESS",
        },
      });
    }
  }
});

// docs/bundler/index.mdx ("target"): a build with no explicit target defaults to
// target "bun" when an entry point starts with `#!/usr/bin/env bun`.
describe.concurrent("bundler hashbang target default", () => {
  const hashbang = "#!/usr/bin/env bun";
  const backends = ["api", "cli"] as const;

  // Imports node:fs so the selected target is observable at runtime: the bun
  // target keeps the import, the browser target replaces it with an empty stub.
  const usesNodeFs = (firstLine: string) =>
    `${firstLine}import { readFileSync } from "node:fs";\nconsole.log(typeof readFileSync);\n`;

  /** Builds `entries` (relative to `dir`) into `dir/out` and returns each entry's output text. */
  async function build(
    backend: (typeof backends)[number],
    dir: string,
    entries: string[],
    { target, format }: { target?: "node" | "browser"; format?: "cjs" } = {},
  ): Promise<string[]> {
    if (backend === "api") {
      const result = await Bun.build({
        entrypoints: entries.map(entry => join(dir, entry)),
        outdir: join(dir, "out"),
        ...(target ? { target } : {}),
        ...(format ? { format } : {}),
      });
      expect(result.success).toBe(true);
    } else {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          ...entries,
          "--outdir",
          "out",
          ...(target ? [`--target=${target}`] : []),
          ...(format ? [`--format=${format}`] : []),
        ],
        cwd: dir,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited, proc.stdout.text()]);
      expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    }
    return Promise.all(entries.map(entry => Bun.file(join(dir, "out", entry)).text()));
  }

  const firstLines = [
    { name: "LF", source: `${hashbang}\n`, bun: true },
    { name: "CRLF", source: `${hashbang}\r\n`, bun: true },
    { name: "flags", source: `${hashbang} --smol\n`, bun: true },
    { name: "node", source: `#!/usr/bin/env node\n`, bun: false },
    { name: "bunx", source: `${hashbang}x\n`, bun: false },
  ];

  for (const backend of backends) {
    test.each(firstLines)(`${backend}: $name hashbang`, async ({ source, bun }) => {
      using dir = tempDir("hashbang-target", { "cli.js": usesNodeFs(source) });
      const [output] = await build(backend, String(dir), ["cli.js"]);
      const hashbangLine = source.split(/\r?\n/)[0];
      if (bun) {
        expect(output).toStartWith(`${hashbangLine}\n// @bun\n`);
      } else {
        expect(output).toStartWith(`${hashbangLine}\n`);
        expect(output).not.toContain("// @bun");
      }
      expect(await bunRun(join(String(dir), "out", "cli.js"))).toSpawn(bun ? "function" : "undefined");
    });

    test(`${backend}: a file containing only the hashbang`, async () => {
      using dir = tempDir("hashbang-target", { "cli.js": hashbang });
      const [output] = await build(backend, String(dir), ["cli.js"]);
      expect(output).toStartWith(`${hashbang}\n// @bun\n`);
    });

    test(`${backend}: dependencies of the hashbang entry are built for bun too`, async () => {
      using dir = tempDir("hashbang-target", {
        "cli.js": `${hashbang}\nimport { depHasFs } from "./dep.js";\nconsole.log(depHasFs);\n`,
        "dep.js": `import { readFileSync } from "node:fs";\nexport const depHasFs = typeof readFileSync;\n`,
      });
      const [output] = await build(backend, String(dir), ["cli.js"]);
      expect(output).toStartWith(`${hashbang}\n// @bun\n`);
      expect(await bunRun(join(String(dir), "out", "cli.js"))).toSpawn("function");
    });

    test(`${backend}: a hashbang on a later entry point applies to the whole build`, async () => {
      using dir = tempDir("hashbang-target", {
        "lib.js": usesNodeFs(""),
        "cli.js": usesNodeFs(`${hashbang}\n`),
      });
      const [lib, cli] = await build(backend, String(dir), ["lib.js", "cli.js"]);
      expect(lib).toStartWith("// @bun\n");
      expect(cli).toStartWith(`${hashbang}\n// @bun\n`);
      expect(await bunRun(join(String(dir), "out", "lib.js"))).toSpawn("function");
    });

    test.each(["node", "browser"] as const)(
      `${backend}: an explicit --target=%s wins over the hashbang`,
      async target => {
        using dir = tempDir("hashbang-target", {
          "cli.js": `${hashbang}\nimport { Shared } from "./shared.js";\nimport { ReExported } from "./reexport.js";\nconsole.log(Shared === ReExported);\n`,
          "shared.js": `export class Shared {}\n`,
          "reexport.js": `import { Shared } from "./shared.js";\nexport const ReExported = Shared;\n`,
        });
        const [output] = await build(backend, String(dir), ["cli.js"], { target });
        expect(output).toStartWith(`${hashbang}\n`);
        expect(output).not.toContain("// @bun");
        // The whole build shares one target, so shared.js is bundled exactly once.
        expect(output.split("class Shared").length - 1).toBe(1);
        expect(await bunRun(join(String(dir), "out", "cli.js"))).toSpawn("true");
      },
    );

    // Only an explicit target disables the default; format: "cjs" alone does not.
    test(`${backend}: the hashbang still selects bun with format cjs`, async () => {
      using dir = tempDir("hashbang-target", { "cli.js": `${hashbang}\nconsole.log("cjs");\n` });
      const [output] = await build(backend, String(dir), ["cli.js"], { format: "cjs" });
      expect(output).toStartWith(`${hashbang}\n// @bun @bun-cjs\n`);
      expect(await bunRun(join(String(dir), "out", "cli.js"))).toSpawn("cjs");
    });
  }

  test("api: an in-memory `files` entry is checked instead of the file on disk", async () => {
    using dir = tempDir("hashbang-target", {
      "plain.js": usesNodeFs(""),
      "cli.js": usesNodeFs(`${hashbang}\n`),
    });
    const plain = join(String(dir), "plain.js");
    const cli = join(String(dir), "cli.js");

    const inMemoryHashbang = await Bun.build({
      entrypoints: [plain],
      files: { [plain]: usesNodeFs(`${hashbang}\n`) },
    });
    expect(await inMemoryHashbang.outputs[0].text()).toStartWith(`${hashbang}\n// @bun\n`);

    const inMemoryPlain = await Bun.build({
      entrypoints: [cli],
      files: { [cli]: usesNodeFs("") },
    });
    expect(await inMemoryPlain.outputs[0].text()).not.toContain("// @bun");
  });
});
