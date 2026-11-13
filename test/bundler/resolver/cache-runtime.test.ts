import { describe, expect, test } from "bun:test";
import { promises as fs, readdirSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import * as path from "path";

// These tests verify that the resolver properly invalidates cache at runtime
// when using require() across file system changes within the same process.
// These test the same cache invalidation logic as the Bun.build tests but for runtime require().

describe.concurrent("runtime cache invalidation", () => {
  test("directory with index.js deleted then recreated", async () => {
    using dir = tempDir("runtime-cache-index-js", {
      "subdir/index.js": `module.exports = { value: 42 };`,
    });

    const subdirPath = path.join(String(dir), "subdir");
    const requirePath = subdirPath;

    // Require 1: Should succeed
    const result1 = require(requirePath);
    expect(result1.value).toBe(42);

    // Clear require cache
    const resolvedPath = require.resolve(requirePath);
    delete require.cache[resolvedPath];

    // Delete directory
    await fs.rm(subdirPath, { recursive: true });

    // Require 2: Should fail
    let require2Failed = false;
    try {
      require(requirePath);
    } catch (e) {
      require2Failed = true;
    }
    expect(require2Failed).toBe(true);

    // Recreate directory with new content
    await fs.mkdir(subdirPath);
    await fs.writeFile(path.join(subdirPath, "index.js"), `module.exports = { value: 99 };`);

    // Require 3: Should succeed with new value
    const result3 = require(requirePath);
    expect(result3.value).toBe(99);
  });

  test("direct file deleted then recreated", async () => {
    using dir = tempDir("runtime-cache-direct-file", {
      "config.js": `module.exports = { version: 1 };`,
    });

    const configPath = path.join(String(dir), "config.js");

    // Require 1: Should succeed
    const result1 = require(configPath);
    expect(result1.version).toBe(1);

    // Clear require cache
    const resolvedPath = require.resolve(configPath);
    delete require.cache[resolvedPath];

    // Delete file
    await fs.rm(configPath);

    // Require 2: Should fail
    let require2Failed = false;
    try {
      require(configPath);
    } catch (e) {
      require2Failed = true;
    }
    expect(require2Failed).toBe(true);

    // Recreate file with new content
    await fs.writeFile(configPath, `module.exports = { version: 2 };`);

    // Require 3: Should succeed with new value
    const result3 = require(configPath);
    expect(result3.version).toBe(2);
  });

  test("nested directory deleted then recreated", async () => {
    using dir = tempDir("runtime-cache-nested", {
      "deep/nested/module.js": `module.exports = { value: "original" };`,
    });

    const modulePath = path.join(String(dir), "deep", "nested", "module.js");
    const deepPath = path.join(String(dir), "deep");

    // Require 1: Should succeed
    const result1 = require(modulePath);
    expect(result1.value).toBe("original");

    // Clear require cache
    delete require.cache[require.resolve(modulePath)];

    // Delete parent directory
    await fs.rm(deepPath, { recursive: true });

    // Require 2: Should fail
    let require2Failed = false;
    try {
      require(modulePath);
    } catch (e) {
      require2Failed = true;
    }
    expect(require2Failed).toBe(true);

    // Recreate directory structure
    const nestedPath = path.join(deepPath, "nested");
    await fs.mkdir(deepPath);
    await fs.mkdir(nestedPath);
    await fs.writeFile(path.join(nestedPath, "module.js"), `module.exports = { value: "recreated" };`);

    // Require 3: Should succeed
    const result3 = require(modulePath);
    expect(result3.value).toBe("recreated");
  });
});

// Every resolver in a process reads a package.json from one shared cache: the runtime, a macro,
// each Bun.build(), and the browser side of a build that has an HTML page. Each of them takes the
// package entry that its own main-field list selects, whichever of them read the package first.
describe.concurrent("main fields of a package.json that another resolver read first", () => {
  const files = {
    // "main" for a server, and the string form of "browser" for a browser.
    "node_modules/dual/package.json": JSON.stringify({ name: "dual", main: "./node.js", browser: "./browser.js" }),
    "node_modules/dual/node.js": `module.exports = "NODE";`,
    "node_modules/dual/browser.js": `module.exports = "BROWSER";`,
    // "jsnext:main" is a default main field of the browser and bun targets, not of the node target.
    "node_modules/jsnext/package.json": JSON.stringify({
      name: "jsnext",
      "main": "./main.js",
      "jsnext:main": "./next.js",
    }),
    "node_modules/jsnext/main.js": `module.exports = "MAIN";`,
    "node_modules/jsnext/next.js": `export default "JSNEXT";`,
    "node_modules/jsnext-only/package.json": JSON.stringify({ name: "jsnext-only", "jsnext:main": "./next.js" }),
    "node_modules/jsnext-only/next.js": `export default "JSNEXT";`,
    "node_modules/jsnext-only/other.js": `export default "OTHER";`,
    // "custom" is not a default main field of any target: only --main-fields names it.
    "node_modules/custom/package.json": JSON.stringify({ name: "custom", main: "./main.js", custom: "./custom.js" }),
    "node_modules/custom/main.js": `module.exports = "MAIN";`,
    "node_modules/custom/custom.js": `module.exports = "CUSTOM";`,
    "node_modules/custom-only/package.json": JSON.stringify({ name: "custom-only", custom: "./custom.js" }),
    "node_modules/custom-only/custom.js": `module.exports = "CUSTOM";`,
    "node_modules/custom-only/other.js": `module.exports = "OTHER";`,
    // In the parsed file, the rows of "publishConfig" are before the rows of the root object.
    "node_modules/custom-nested/package.json": JSON.stringify({
      name: "custom-nested",
      publishConfig: { custom: "./nested.js" },
      main: "./main.js",
      custom: "./custom.js",
    }),
    "node_modules/custom-nested/main.js": `module.exports = "MAIN";`,
    "node_modules/custom-nested/custom.js": `module.exports = "CUSTOM";`,
    "node_modules/custom-nested/nested.js": `module.exports = "NESTED";`,
    "node_modules/custom-dual/package.json": JSON.stringify({
      name: "custom-dual",
      main: "./main.js",
      browser: "./browser.js",
      custom: "./custom.js",
    }),
    "node_modules/custom-dual/main.js": `module.exports = "MAIN";`,
    "node_modules/custom-dual/browser.js": `module.exports = "BROWSER";`,
    "node_modules/custom-dual/custom.js": `module.exports = "CUSTOM";`,
    // "module" for an import and "main" for a require(), when the list is the default of the target.
    "node_modules/both/package.json": JSON.stringify({ name: "both", main: "./main.js", module: "./module.js" }),
    "node_modules/both/main.js": `module.exports = "MAIN";`,
    "node_modules/both/module.js": `export default "MODULE";`,
    // A list that does not name "main" takes the index file.
    "node_modules/main-index/package.json": JSON.stringify({ name: "main-index", main: "./main.js" }),
    "node_modules/main-index/main.js": `module.exports = "MAIN";`,
    "node_modules/main-index/index.js": `module.exports = "INDEX";`,
    "lib.ts": `
      let entries = 0;
      // The package file that a build of 'import it from "<specifier>"' bundles, or why the build fails.
      export async function build(specifier: string, target: "bun" | "browser" | "node") {
        const entry = "./entry" + entries++ + ".ts";
        await Bun.write(entry, "import it from " + JSON.stringify(specifier) + "; console.log(it);");
        const { success, outputs, logs } = await Bun.build({ entrypoints: [entry], target, throw: false });
        if (!success) return logs.map(log => log.message).join("; ");
        return /"(NODE|BROWSER|MAIN|JSNEXT|CUSTOM|OTHER|NESTED|INDEX)"/.exec(await outputs[0].text())?.[1];
      }
      // The package file that the runtime loads, or why it does not load.
      export async function load(specifier: string) {
        try {
          return (await import(specifier)).default;
        } catch (error) {
          return error.message;
        }
      }
    `,
  };

  // Each is a process of its own: `run` is the body of an async function, in the order it says.
  const orders: { name: string; flags?: string[]; run: string; expected: unknown }[] = [
    ...[
      `await import("dual")`,
      `require("dual")`,
      `Bun.resolveSync("dual", import.meta.dir)`,
      `import.meta.resolve("dual")`,
      `require.resolve("dual")`,
      `require.resolve("dual/package.json")`,
    ].map(touch => ({
      name: `${touch}, then a browser build`,
      run: `${touch}; return await build("dual", "browser");`,
      expected: "BROWSER",
    })),
    {
      name: "builds for bun, browser, node, browser",
      run: `return [await build("dual", "bun"), await build("dual", "browser"), await build("dual", "node"), await build("dual", "browser")];`,
      expected: ["NODE", "BROWSER", "NODE", "BROWSER"],
    },
    {
      name: `"jsnext:main" in a browser build after a node build`,
      run: `return [await build("jsnext", "node"), await build("jsnext", "browser")];`,
      expected: ["MAIN", "JSNEXT"],
    },
    {
      name: `"jsnext:main" at runtime after a node build`,
      run: `return [await build("jsnext-only/other.js", "node"), await load("jsnext-only")];`,
      expected: ["OTHER", "JSNEXT"],
    },
    {
      name: "a --main-fields name at runtime after a build",
      flags: ["--main-fields=custom", "--main-fields=main"],
      run: `return [await build("custom", "browser"), await load("custom")];`,
      expected: ["MAIN", "CUSTOM"],
    },
    {
      name: "a --main-fields name at runtime after a build, in a package with no other main field",
      flags: ["--main-fields=custom"],
      run: `return [await build("custom-only/other.js", "browser"), await load("custom-only")];`,
      expected: ["OTHER", "CUSTOM"],
    },
    {
      name: "a browser build after the runtime loaded the package under --main-fields",
      flags: ["--main-fields=custom"],
      run: `return [await load("custom"), await build("custom", "browser")];`,
      expected: ["CUSTOM", "MAIN"],
    },
    {
      name: "a --main-fields name that a nested object of the package.json has too",
      flags: ["--main-fields=custom", "--main-fields=main"],
      run: `return [await build("custom-nested", "browser"), await load("custom-nested")];`,
      expected: ["MAIN", "CUSTOM"],
    },
    {
      name: `a browser build after the runtime skipped "main" under --main-fields`,
      flags: ["--main-fields=custom"],
      run: `return [await load("main-index"), await build("main-index", "browser")];`,
      expected: ["INDEX", "MAIN"],
    },
    {
      name: `the runtime skips "main" under --main-fields after a browser build took it`,
      flags: ["--main-fields=custom"],
      run: `return [await build("main-index", "browser"), await load("main-index")];`,
      expected: ["MAIN", "INDEX"],
    },
  ];

  test.each(orders)("$name", async ({ flags = [], run, expected }) => {
    using dir = tempDir("main-fields-read-first", {
      ...files,
      "run.ts": `
        import { build, load } from "./lib.ts";
        console.log(JSON.stringify(await (async () => { ${run} })()));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...flags, "run.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout === "" ? stderr : JSON.parse(stdout)).toEqual(expected);
    expect(exitCode).toBe(0);
  });

  // The macro runs while its importer is parsed, so the macro's resolver reads the package first.
  test("a browser build whose macro imports the package", async () => {
    using dir = tempDir("main-fields-read-first-macro", {
      ...files,
      "macro.ts": `import it from "dual"; export const macro = () => "macro " + it;`,
      "entry.ts": `import { macro } from "./macro.ts" with { type: "macro" }; import it from "dual"; console.log(macro(), it);`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--target=browser", "entry.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.match(/"(?:macro )?(?:NODE|BROWSER)"/g) ?? stderr).toEqual([`"BROWSER"`, `"macro NODE"`]);
    expect(exitCode).toBe(0);
  });

  // One build, two resolvers: the server's entry is resolved before the page's script.
  test("the page of a server build whose entry imports the package too", async () => {
    using dir = tempDir("main-fields-read-first-page", {
      ...files,
      "index.html": `<!DOCTYPE html><html><head></head><body><script type="module" src="./client.ts"></script></body></html>`,
      "client.ts": `import it from "dual"; console.log(it);`,
      "server.ts": `import it from "dual"; import page from "./index.html"; console.log(it, page);`,
      "run.ts": `
        const { outputs } = await Bun.build({ entrypoints: ["./server.ts"], target: "bun" });
        const bundled: Record<string, string | undefined> = {};
        for (const output of outputs) {
          if (!output.path.endsWith(".js")) continue;
          bundled[output.path.endsWith("server.js") ? "server" : "page"] = /"(NODE|BROWSER)"/.exec(await output.text())?.[1];
        }
        console.log(JSON.stringify(bundled));
      `,
    });
    await using proc = Bun.spawn({ cmd: [bunExe(), "run.ts"], env: bunEnv, cwd: String(dir), stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout === "" ? stderr : JSON.parse(stdout)).toEqual({ server: "NODE", page: "BROWSER" });
    expect(exitCode).toBe(0);
  });

  // `bun build --main-fields` gives the list to the server. The page keeps the list of a browser.
  const serverWithPage = (server: string, client: string) => ({
    ...files,
    "index.html": `<!DOCTYPE html><html><head></head><body><script type="module" src="./client.ts"></script></body></html>`,
    "client.ts": client,
    "server.ts": `${server} import page from "./index.html"; console.log(it, page);`,
  });

  // The package file in the server's chunk and in the chunk of the page.
  async function buildServerWithPage(dir: string) {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        "--target=bun",
        "--main-fields=custom",
        "--main-fields=main",
        "server.ts",
        "--outdir=out",
      ],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) return stderr;
    const bundled: Record<string, string | undefined> = {};
    for (const name of readdirSync(path.join(dir, "out"))) {
      if (!name.endsWith(".js")) continue;
      const text = await Bun.file(path.join(dir, "out", name)).text();
      bundled[name === "server.js" ? "server" : "page"] = /"(BROWSER|MAIN|MODULE|CUSTOM)"/.exec(text)?.[1];
    }
    return bundled;
  }

  test('the server of a --main-fields build and its page share a package with a string "browser"', async () => {
    using dir = tempDir(
      "main-fields-read-first-cli-page",
      serverWithPage(`import it from "custom-dual";`, `import it from "custom-dual"; console.log(it);`),
    );
    expect(await buildServerWithPage(String(dir))).toEqual({ server: "CUSTOM", page: "BROWSER" });
  });

  // The page is two files away from the package and the server is a hundred, so the page reads it first.
  test("the server of a --main-fields build reaches a package after its page", async () => {
    const chain = Array.from({ length: 100 }, (_, i) => [
      `chain${i}.ts`,
      i === 99 ? `export { default } from "custom";` : `export { default } from "./chain${i + 1}.ts";`,
    ]);
    using dir = tempDir("main-fields-read-first-cli-chain", {
      ...serverWithPage(`import it from "./chain0.ts";`, `import it from "custom"; console.log(it);`),
      ...Object.fromEntries(chain),
    });
    expect(await buildServerWithPage(String(dir))).toEqual({ server: "CUSTOM", page: "MAIN" });
  });

  // The page's list is the default of a browser, so its require() takes "main" and not "module".
  test.each([
    ["and the server imports it too", `import it from "both";`, { server: "MAIN", page: "MAIN" }],
    ["and the server does not import it", `const it = 0;`, { page: "MAIN" }],
  ])('the page of a --main-fields build requires a package with "module", %s', async (_, server, expected) => {
    using dir = tempDir(
      "main-fields-read-first-cli-require",
      serverWithPage(server, `const it = require("both"); console.log(it);`),
    );
    expect(await buildServerWithPage(String(dir))).toEqual(expected);
  });
});
