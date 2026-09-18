import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, MAX_PATH_BYTES, tempDir } from "harness";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { ESBUILD, itBundled } from "./expectBundled";

describe("bundler", () => {
  itBundled("naming/EntryNamingCollission", {
    files: {
      "/a/entry.js": /* js */ `
        console.log(1);
      `,
      "/b/entry.js": /* js */ `
        console.log(2);
      `,
    },
    entryNaming: "[name].[ext]",
    entryPointsRaw: ["./a/entry.js", "./b/entry.js"],
    bundleErrors: {
      // expectBundled does not support newlines.
      "<bun>": [`Multiple files share the same output path`],
    },
  });
  itBundled("naming/ImplicitOutbase1", {
    files: {
      "/a/entry.js": /* js */ `
        console.log(1);
      `,
      "/b/entry.js": /* js */ `
        console.log(2);
      `,
    },
    entryPointsRaw: ["./a/entry.js", "./b/entry.js"],
    run: [
      {
        file: "/out/a/entry.js",
        stdout: "1",
      },
      {
        file: "/out/b/entry.js",
        stdout: "2",
      },
    ],
  });
  itBundled("naming/ImplicitOutbase2", {
    files: {
      "/a/hello/entry.js": /* js */ `
        import data from '../dependency'
        console.log(data);
      `,
      "/a/dependency.js": /* js */ `
        export default 1;
      `,
      "/a/hello/world/entry.js": /* js */ `
        console.log(2);
      `,
      "/a/hello/world/a/a/a/a/a/a/a/entry.js": /* js */ `
        console.log(3);
      `,
    },
    entryPointsRaw: ["./a/hello/entry.js", "./a/hello/world/entry.js", "./a/hello/world/a/a/a/a/a/a/a/entry.js"],
    run: [
      {
        file: "/out/entry.js",
        stdout: "1",
      },
      {
        file: "/out/world/entry.js",
        stdout: "2",
      },
      {
        file: "/out/world/a/a/a/a/a/a/a/entry.js",
        stdout: "3",
      },
    ],
  });
  itBundled("naming/EntryNamingTemplate1", {
    files: {
      "/a/hello/entry.js": /* js */ `
        import data from '../dependency'
        console.log(data);
      `,
      "/a/dependency.js": /* js */ `
        export default 1;
      `,
      "/a/hello/world/entry.js": /* js */ `
        console.log(2);
      `,
      "/a/hello/world/a/a/a/a/a/a/a/entry.js": /* js */ `
        console.log(3);
      `,
    },
    entryNaming: "files/[dir]/file.[ext]",
    entryPointsRaw: ["./a/hello/entry.js", "./a/hello/world/entry.js", "./a/hello/world/a/a/a/a/a/a/a/entry.js"],
    run: [
      {
        file: "/out/files/file.js",
        stdout: "1",
      },
      {
        file: "/out/files/world/file.js",
        stdout: "2",
      },
      {
        file: "/out/files/world/a/a/a/a/a/a/a/file.js",
        stdout: "3",
      },
    ],
  });
  itBundled("naming/EntryNamingTemplate2", {
    todo: true,
    files: {
      "/src/first.js": /* js */ `
        console.log(1);
      `,
      "/src/second/third.js": /* js */ `
        console.log(2);
      `,
    },
    entryNaming: "[ext]/prefix[dir]suffix/file.[ext]",
    entryPointsRaw: ["./src/first.js", "./src/second/third.js"],
    run: [
      {
        file: "/out/js/prefix/secondsuffix/file.js",
        stdout: "2",
      },
      {
        file: "/out/js/prefix/suffix/file.js",
        stdout: "1",
      },
    ],
  });
  itBundled("naming/AssetNaming", {
    files: {
      "/src/lib/first/file.js": /* js */ `
        import file from "../second/data.file";
        console.log(file);
      `,
      "/src/lib/second/data.file": `
        this is a file
      `,
    },
    root: "/src",
    entryNaming: "hello.[ext]",
    assetNaming: "test.[ext]",
    entryPointsRaw: ["./src/lib/first/file.js"],
    run: {
      file: "/out/hello.js",
      stdout: "./test.file",
    },
  });
  itBundled("naming/AssetNamingMkdir", {
    files: {
      "/src/lib/first/file.js": /* js */ `
        import file from "../second/data.file";
        console.log(file);
      `,
      "/src/lib/second/data.file": `
        this is a file
      `,
    },
    root: "/src",
    entryNaming: "hello.[ext]",
    assetNaming: "subdir/test.[ext]",
    entryPointsRaw: ["./src/lib/first/file.js"],
    run: {
      file: "/out/hello.js",
      stdout: "./subdir/test.file",
    },
  });
  itBundled("naming/AssetNamingDir", {
    files: {
      "/src/lib/first/file.js": /* js */ `
        import file from "../second/data.file";
        console.log(file);
      `,
      "/src/lib/second/data.file": `
        this is a file
      `,
    },
    root: "/src",
    entryNaming: "hello.[ext]",
    assetNaming: "[dir]/test.[ext]",
    entryPointsRaw: ["./src/lib/first/file.js"],
    loader: ESBUILD
      ? {
          ".file": "file",
        }
      : undefined,
    run: [
      {
        file: "/out/hello.js",
        stdout: "./lib/second/test.file",
      },
    ],
  });
  itBundled("naming/EntryNamingTarget", {
    files: {
      "/src/entry.js": /* js */ `
        console.log(1);
      `,
    },
    root: "/src",
    target: "bun",
    entryNaming: "[target]/[name].[ext]",
    entryPointsRaw: ["./src/entry.js"],
    onAfterBundle(api) {
      expect(readdirSync(api.outdir)).toEqual(["bun"]);
    },
    run: {
      file: "/out/bun/entry.js",
      stdout: "1",
    },
  });
  itBundled("naming/AssetNamingTarget", {
    files: {
      "/src/entry.js": /* js */ `
        import file from "./data.file";
        console.log(file);
      `,
      "/src/data.file": `
        this is a file
      `,
    },
    root: "/src",
    target: "bun",
    assetNaming: "[target]/[name].[ext]",
    entryPointsRaw: ["./src/entry.js"],
    loader: {
      ".file": "file",
    },
    onAfterBundle(api) {
      expect(readdirSync(api.outdir).sort()).toEqual(["bun", "entry.js"]);
    },
    run: {
      file: "/out/entry.js",
      stdout: "./bun/data.file",
    },
  });
  itBundled("naming/AssetNoOverwrite", {
    todo: true,
    files: {
      "/src/entry.js": /* js */ `
        import asset1 from "./asset1.file";
        import asset2 from "./asset2.file";
        console.log(asset1, asset2);
      `,
      "/src/asset1.file": `
        file 1
      `,
      "/src/asset2.file": `
        file 2
      `,
    },
    root: "/src",
    assetNaming: "same-filename.txt",
    entryPointsRaw: ["./src/entry.js"],
    loader: {
      ".file": "file",
    },
    bundleErrors: {
      "<bun>": ['Multiple files share the same output path: "same-filename.txt"'],
    },
  });
  itBundled("naming/AssetFileLoaderPath1", {
    files: {
      "/src/entry.js": /* js */ `
        import asset1 from "./asset1.file";
        console.log(asset1);
      `,
      "/src/asset1.file": `
        file 1
      `,
      //
      "/out/hello/_": "",
    },
    root: "/src",
    entryNaming: "lib/entry.js",
    assetNaming: "hello/same-filename.txt",
    entryPointsRaw: ["./src/entry.js"],
    loader: {
      ".file": "file",
    },
  });
  itBundled("naming/NonexistantRoot", ({ root }) => ({
    backend: "cli",
    files: {
      "/src/entry.js": /* js */ `
        import asset1 from "./asset1.file";
        console.log(asset1);
      `,
      "/src/asset1.file": `
        file 1
      `,
    },
    root: "/lib",
    entryPointsRaw: ["./src/entry.js"],
    bundleErrors: {
      // "<bun>": [`FileNotFound: failed to open root directory: ${root}/lib`],
    },
  }));
  itBundled("naming/EntrypointOutsideOfRoot", {
    todo: true,
    files: {
      "/src/hello/entry.js": /* js */ `
        console.log(1);
      `,
      "/src/root/file.js": /* js */ `
        console.log(2);
      `,
    },
    root: "/src/root",
    entryPointsRaw: ["./src/hello/entry.js"],
    run: {
      file: "/out/_.._/hello/file.js",
    },
  });
  itBundled("naming/WithPathTraversal", {
    files: {
      "/a/hello/entry.js": /* js */ `
        import data from '../dependency'
        console.log(data);
      `,
      "/a/dependency.js": /* js */ `
        export default 1;
      `,
      "/a/hello/world/entry.js": /* js */ `
        console.log(2);
      `,
      "/a/hello/world/a/a/a/a/a/a/a/entry.js": /* js */ `
        console.log(3);
      `,
    },
    entryNaming: "foo/../bar/[dir]/file.[ext]",
    entryPointsRaw: ["./a/hello/entry.js", "./a/hello/world/entry.js", "./a/hello/world/a/a/a/a/a/a/a/entry.js"],
    run: [
      {
        file: "/out/bar/file.js",
        stdout: "1",
      },
      {
        file: "/out/bar/world/file.js",
        stdout: "2",
      },
      {
        file: "/out/bar/world/a/a/a/a/a/a/a/file.js",
        stdout: "3",
      },
    ],
  });
  // A non-ASCII ID_Continue basename char is preserved in the generated
  // CommonJS wrapper symbol, not replaced per-code-point (nor per-UTF-8-byte,
  // which once regressed to `require_caf__utils`).
  itBundled("naming/NonAsciiSourceFilenameSymbol", {
    files: {
      "/entry.js": /* js */ `
        const u = require("./café-utils.js");
        console.log(u.hi);
      `,
      "/café-utils.js": /* js */ `
        module.exports = { hi: 1 };
      `,
    },
    target: "bun",
    onAfterBundle(api) {
      // target: "bun" prints identifiers ASCII-only, so "é" is escaped.
      api.expectFile("/out.js").toContain("require_caf\\u{e9}_utils");
      api.expectFile("/out.js").not.toContain("require_caf__utils");
      api.expectFile("/out.js").not.toContain("require_caf_utils");
    },
    run: { stdout: "1" },
  });
  // Unterminated `[` used to panic path_template_print; CLI backend isolates the crash.
  for (const unterminated of ["[name", "[dir", "[ext", "[hash", "[target", "a[b.js", "[name]-[hash.js"]) {
    itBundled(`naming/UnterminatedPlaceholder/${unterminated}`, {
      backend: "cli",
      files: {
        "/src/entry.js": `console.log(1);`,
      },
      root: "/src",
      entryNaming: unterminated,
      entryPointsRaw: ["./src/entry.js"],
      bundleErrors: {
        "<bun>": [`--entry-naming: unterminated "[`],
      },
    });
  }
  for (const [opt, flag] of [
    ["chunkNaming", "--chunk-naming"],
    ["assetNaming", "--asset-naming"],
  ] as const) {
    itBundled(`naming/UnterminatedPlaceholder/${flag}`, {
      backend: "cli",
      files: {
        "/src/entry.js": `console.log(1);`,
      },
      root: "/src",
      [opt]: "[name]-[hash",
      entryPointsRaw: ["./src/entry.js"],
      bundleErrors: {
        "<bun>": [`${flag}: unterminated "[hash"`],
      },
    });
  }
  // An unknown `[placeholder]` is kept verbatim in the output path.
  itBundled("naming/UnknownPlaceholderIsLiteral", {
    backend: "cli",
    files: {
      "/src/entry.js": `console.log(1);`,
    },
    root: "/src",
    entryNaming: "[nonexistent]-[name].[ext]",
    entryPointsRaw: ["./src/entry.js"],
    onAfterBundle(api) {
      api.assertFileExists("/out/[nonexistent]-entry.js");
    },
    run: { file: "/out/[nonexistent]-entry.js", stdout: "1" },
  });
});

// Bun.build({ naming: "[name" }) used to SIGABRT; validation now rejects it.
describe("bundler", () => {
  for (const [naming, option] of [
    [`"[name"`, "naming"],
    [`{ entry: "[dir]/[name" }`, "naming.entry"],
    [`{ chunk: "[name]-[hash" }`, "naming.chunk"],
    [`{ asset: "pre[post" }`, "naming.asset"],
  ] as const) {
    test(`naming/UnterminatedPlaceholderAPI ${naming}`, async () => {
      using dir = tempDir("naming-unterminated", {
        "e.ts": `console.log("hi");`,
        "build.ts": `
          try {
            await Bun.build({ entrypoints: ["./e.ts"], outdir: "./out", throw: false, naming: ${naming} });
            console.log("SURVIVED no-error");
          } catch (e) {
            console.log("SURVIVED", String(e));
          }
        `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "build.ts"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout).toContain(`${option}: unterminated "[`);
      expect(stdout).toContain(`(missing "]")`);
      expect(exitCode).toBe(0);
    });
  }
});

// Output paths rendered from a naming template used to be copied into fixed-size
// path buffers unchecked, so a template that rendered too long aborted the
// process instead of failing the build. Every case spawns bun because the old
// behavior was a crash.
describe("bundler naming templates that render long output paths", () => {
  // Output paths also have to fit with a ".map" / ".jsc" sidecar extension appended.
  const maxOutputPathLen = MAX_PATH_BYTES - 1 - ".map".length;
  // Templates start with "./" so they render to exactly their own length.
  const templateOfLength = (length: number) => "./" + Buffer.alloc(length - 2, "a").toString();
  // `length` bytes of 200-byte directory names, so that a filesystem accepts each of them.
  const components = (length: number, char: string) => {
    const parts: string[] = [];
    let remaining = length;
    while (remaining > 201) {
      parts.push(Buffer.alloc(200, char).toString());
      remaining -= 201;
    }
    parts.push(Buffer.alloc(remaining, char).toString());
    return parts.join("/");
  };

  interface BuildReport {
    success: boolean;
    logs: { message: string; notes: string[] }[];
    outputs: { kind: string; path: string; text: string }[];
  }

  async function build(configSource: string): Promise<BuildReport> {
    using dir = tempDir("naming-long-output-path", {
      "asset.txt": "hello",
      "app.js": `import f from "./asset.txt" with { type: "file" }; console.log(f);`,
      "plain.js": `console.log(1);`,
      "dynamic.js": `import("./shared.js").then(m => console.log(m.x));`,
      "shared.js": `export const x = 1;`,
      "build.ts": `
        const result = await Bun.build({ throw: false, ...(${configSource}) });
        const outputs = [];
        for (const output of result.outputs) {
          outputs.push({ kind: output.kind, path: output.path.replaceAll("\\\\", "/"), text: await output.text() });
        }
        console.log(JSON.stringify({
          success: result.success,
          logs: result.logs.map(log => ({ message: log.message, notes: (log.notes ?? []).map(note => note.message) })),
          outputs,
        }));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    return JSON.parse(stdout);
  }

  /** The asset path printed into the entry point: its first string literal. */
  function reference(report: BuildReport): string {
    const entry = report.outputs.find(output => output.kind === "entry-point")!;
    return entry.text.match(/"([^"]*)"/)![1];
  }

  test.concurrent("asset naming rendering past the limit fails the build", async () => {
    const template = templateOfLength(MAX_PATH_BYTES + 100) + "-[name].[ext]";
    const report = await build(`{ entrypoints: ["./app.js"], naming: { asset: ${JSON.stringify(template)} } }`);
    expect(report).toEqual({
      success: false,
      logs: [
        {
          message: `Output path for "asset.txt" is too long (${template.length + "asset.txt".length - "[name].[ext]".length} bytes, the limit on this platform is ${maxOutputPathLen})`,
          notes: [`naming template is ${JSON.stringify(template)}`],
        },
      ],
      outputs: [],
    });
  });

  test.concurrent("chunk naming rendering past the limit fails the build", async () => {
    const template = templateOfLength(MAX_PATH_BYTES + 100) + "-[name]-[hash].[ext]";
    const report = await build(
      `{ entrypoints: ["./dynamic.js"], splitting: true, naming: { chunk: ${JSON.stringify(template)} } }`,
    );
    expect(report.outputs).toEqual([]);
    expect(report.logs.length).toBeGreaterThan(0);
    for (const log of report.logs) {
      expect(log.message).toMatch(
        /^Output path for ".+" is too long \(\d+ bytes, the limit on this platform is \d+\)$/,
      );
      expect(log.notes).toEqual([`naming template is ${JSON.stringify(template)}`]);
    }
    expect(report.success).toBe(false);
  });

  test.concurrent("entry naming rendering past the limit fails the build", async () => {
    const template = templateOfLength(MAX_PATH_BYTES + 100) + "-[name].[ext]";
    const report = await build(`{ entrypoints: ["./plain.js"], naming: { entry: ${JSON.stringify(template)} } }`);
    expect(report).toEqual({
      success: false,
      logs: [
        {
          message: `Output path for "plain.js" is too long (${template.length + "plain.js".length - "[name].[ext]".length} bytes, the limit on this platform is ${maxOutputPathLen})`,
          notes: [`naming template is ${JSON.stringify(template)}`],
        },
      ],
      outputs: [],
    });
  });

  test.concurrent("one byte past the limit is rejected", async () => {
    const template = templateOfLength(maxOutputPathLen + 1);
    const report = await build(`{ entrypoints: ["./app.js"], naming: { asset: ${JSON.stringify(template)} } }`);
    expect(report).toEqual({
      success: false,
      logs: [
        {
          message: `Output path for "asset.txt" is too long (${maxOutputPathLen + 1} bytes, the limit on this platform is ${maxOutputPathLen})`,
          notes: [`naming template is ${JSON.stringify(template)}`],
        },
      ],
      outputs: [],
    });
  });

  // These paths fit, but resolving them against the cwd while computing the import
  // specifier did not fit in a path buffer.
  test.concurrent("an output path exactly at the limit builds", async () => {
    const template = templateOfLength(maxOutputPathLen);
    const report = await build(`{ entrypoints: ["./app.js"], naming: { asset: ${JSON.stringify(template)} } }`);
    expect(report.logs).toEqual([]);
    expect(report.outputs.map(output => [output.kind, output.path])).toEqual([
      ["entry-point", "./app.js"],
      ["asset", template],
    ]);
    expect(reference(report)).toBe(template);
    expect(report.success).toBe(true);
  });

  test.concurrent("a chunk in a subdirectory can reference an output path at the limit", async () => {
    const template = templateOfLength(maxOutputPathLen);
    const report = await build(
      `{ entrypoints: ["./app.js"], naming: { entry: "./deep/[name].[ext]", asset: ${JSON.stringify(template)} } }`,
    );
    expect(report.logs).toEqual([]);
    expect(reference(report)).toBe("../" + template.slice("./".length));
    expect(report.success).toBe(true);
  });

  test.concurrent("an import() of a chunk whose path is at the limit is printed in full", async () => {
    // "shared" and the default 8-character hash render to the same lengths as their placeholders.
    const suffix = "-[name]-[hash].[ext]";
    const rendered = "-shared-01234567.js";
    const template = templateOfLength(maxOutputPathLen - rendered.length) + suffix;
    const report = await build(
      `{ entrypoints: ["./dynamic.js"], splitting: true, naming: { chunk: ${JSON.stringify(template)} } }`,
    );
    expect(report.logs).toEqual([]);
    const entry = report.outputs.find(output => output.kind === "entry-point")!;
    const chunk = report.outputs.find(output => output.kind === "chunk")!;
    expect(chunk.path).toHaveLength(maxOutputPathLen);
    expect(chunk.path).toStartWith(template.slice(0, -suffix.length) + "-shared-");
    expect(entry.text.match(/import\("([^"]*)"\)/)![1]).toBe(chunk.path);
    expect(report.success).toBe(true);
  });

  test.concurrent("an import specifier longer than a path buffer is printed in full", async () => {
    // The chunk path fits; the "../" per directory needed to get back out of it does not.
    const depth = Math.floor(MAX_PATH_BYTES * 0.4);
    const entry = "./" + Buffer.alloc(depth * 2, "a/").toString() + "[name].[ext]";
    const report = await build(
      `{ entrypoints: ["./app.js"], naming: { entry: ${JSON.stringify(entry)}, asset: "./[name].[ext]" } }`,
    );
    expect(report.logs).toEqual([]);
    const specifier = reference(report);
    expect(specifier).toBe(Buffer.alloc(depth * 3, "../").toString() + "asset.txt");
    expect(specifier.length).toBeGreaterThan(MAX_PATH_BYTES);
    expect(report.success).toBe(true);
  });

  // A template this long does not fit in a Windows command line, so the placeholders do the expanding.
  for (const [flag, extension, entry] of [
    ["--asset-naming", "txt", (name: string) => `import f from "./${name}.txt" with { type: "file" }; console.log(f);`],
    ["--chunk-naming", "js", (name: string) => `import("./${name}.js").then(m => console.log(m.x));`],
  ] as const) {
    test.concurrent(`bun build --splitting ${flag} reports placeholders that expand past the limit`, async () => {
      const name = Buffer.alloc(100, "b").toString();
      const template =
        Buffer.alloc("[name]".length * Math.ceil((MAX_PATH_BYTES + 100) / name.length), "[name]").toString() +
        "-[hash].[ext]";
      using dir = tempDir("naming-long-output-path-cli", {
        [`${name}.${extension}`]: extension === "js" ? "export const x = 1;" : "hello",
        "app.js": entry(name),
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "./app.js", "--splitting", "--outdir", "./out", flag, template],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toContain(`Output path for "${name}.${extension}" is too long (`);
      // The CLI roots a naming template at "./".
      expect(stderr).toContain(`naming template is "./${template}"`);
      expect(stdout).toBe("");
      expect(exitCode).toBe(1);
    });
  }

  // Each piece is a legal path on its own; only outdir + "/" + the rendered name passes
  // PATH_MAX. The bundler writes the file relative to the open outdir, so it exists.
  // macOS cannot open an outdir this long in the first place.
  test.skipIf(!isLinux)("BuildArtifact.path of an output whose absolute path is longer than PATH_MAX", async () => {
    using dir = tempDir("naming-long-absolute-output-path", { "e.js": "export default 1;" });
    const cwd = String(dir);
    const outdir = join(cwd, "o", components(2600 - cwd.length - 3, "d"));
    const nameDir = components(1587, "n");
    const expectedPath = join(outdir, nameDir, "e.js");
    expect(expectedPath.length).toBeGreaterThan(MAX_PATH_BYTES);

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `import { readdirSync } from "node:fs";
        const result = await Bun.build(${JSON.stringify({
          entrypoints: [join(cwd, "e.js")],
          outdir,
          naming: nameDir + "/[name].[ext]",
          throw: false,
        })});
        // The absolute path is too long for a syscall, so list the directory from inside the outdir.
        process.chdir(${JSON.stringify(outdir)});
        console.log(JSON.stringify({
          success: result.success,
          logs: result.logs.map(log => log.message),
          paths: result.outputs.map(output => output.path),
          written: readdirSync(${JSON.stringify(nameDir)}),
        }));`,
      ],
      env: bunEnv,
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ success: true, logs: [], paths: [expectedPath], written: ["e.js"] });
    expect(exitCode).toBe(0);
  });
});
