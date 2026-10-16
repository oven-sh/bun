import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

// Every option here is declared as `string` or `boolean` in bake.d.ts. A value
// of another type must throw ERR_INVALID_ARG_TYPE from Bun.serve, before any
// dev server starts.
test("Bun.serve({ app }) rejects wrong-typed framework options", async () => {
  using dir = tempDir("bake-app-options", {
    "fixture.ts": `
      const fsr = { root: "routes", style: "nextjs-pages", serverEntryPoint: "./server.ts" };
      const framework = { fileSystemRouterTypes: [fsr] };
      const cases = {
        "root": { framework, root: 123 },
        "fileSystemRouterTypes[].root": { framework: { fileSystemRouterTypes: [{ ...fsr, root: 123 }] } },
        "fileSystemRouterTypes[].ignoreUnderscores": {
          framework: { fileSystemRouterTypes: [{ ...fsr, ignoreUnderscores: "yes" }] },
        },
        "fileSystemRouterTypes[].layouts": { framework: { fileSystemRouterTypes: [{ ...fsr, layouts: 1 }] } },
        "serverComponents.serverRuntimeImportSource": {
          framework: { ...framework, serverComponents: { separateSSRGraph: false, serverRuntimeImportSource: 5 } },
        },
        "plugins[].name": { framework, plugins: [{ name: 42, setup() {} }] },
        "plugins[].setup": { framework, plugins: [{ name: "p", setup: "nope" }] },
      };
      for (const [name, app] of Object.entries(cases)) {
        let result;
        try {
          Bun.serve({ port: 0, development: true, app, fetch: () => new Response() }).stop(true);
          result = "no error";
        } catch (e) {
          result = e.code + ": " + e.message;
        }
        console.log(name + " -> " + result);
      }
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toMatchInlineSnapshot(`
    "root -> ERR_INVALID_ARG_TYPE: The "root" property must be of type string, got number
    fileSystemRouterTypes[].root -> ERR_INVALID_ARG_TYPE: The "root" property must be of type string, got number
    fileSystemRouterTypes[].ignoreUnderscores -> ERR_INVALID_ARG_TYPE: The "ignoreUnderscores" property must be of type boolean, got string
    fileSystemRouterTypes[].layouts -> ERR_INVALID_ARG_TYPE: The "layouts" property must be of type boolean, got number
    serverComponents.serverRuntimeImportSource -> ERR_INVALID_ARG_TYPE: The "serverRuntimeImportSource" property must be of type string, got number
    plugins[].name -> ERR_INVALID_ARG_TYPE: The "name" property must be of type string, got number
    plugins[].setup -> ERR_INVALID_ARG_TYPE: setup must be a function
    "
  `);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

const appFiles = {
  "server.ts": `export function render(req, meta) { return meta.pageModule.default(); }`,
  "routes/index.ts": `export default () => new Response("index route");`,
};
const fsr = `{ root: "routes", style: "nextjs-pages", serverEntryPoint: "./server.ts" }`;

// The dev server strips `app.root` off absolute file paths to build route
// patterns and module ids, so it needs an absolute path. A relative `root`
// names a directory relative to the working directory.
describe("app.root", () => {
  // `root` defaults to the working directory. Every other spelling names that same directory.
  const spellings: (string | undefined)[] = [undefined, "", ".", "./", "routes/..", "<cwd>/"];
  test.concurrent.each(spellings)("routes are served when root is %p", async spelling => {
    using dir = tempDir("bake-app-root", {
      ...appFiles,
      "fixture.ts": `
        const { root } = JSON.parse(process.argv[2]);
        const server = Bun.serve({
          port: 0,
          development: true,
          app: { framework: { fileSystemRouterTypes: [${fsr}] }, root: root?.replace("<cwd>", process.cwd()) },
          fetch: () => new Response("fallback"),
        });
        const res = await fetch(server.url);
        console.log(JSON.stringify({ status: res.status, body: await res.text() }));
        await server.stop(true);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.ts", JSON.stringify({ root: spelling })],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The dev server also prints a "Bundled page" line to stdout.
    const line = stdout.split("\n").find(l => l.startsWith("{"));
    expect(line, stderr).toBeDefined();
    expect(JSON.parse(line!)).toEqual({ status: 200, body: "index route" });
    expect(exitCode).toBe(0);
  });
});

// `app.root`, a router root, and the `dir` of a `style` route are all joined
// against the working directory. Each is user input of any length.
describe("a directory that does not fit a path buffer is an error", () => {
  // The limit is the size of a path buffer: 4096 on Linux, 1024 on macOS, larger on Windows.
  const withoutLimit = (text: string) => text.replace(/shorter than \d+ bytes/g, "shorter than N bytes");
  const routerRootError =
    "ENAMETOOLONG: Failed to resolve 'fileSystemRouterTypes[0].root' for framework: the resolved path must be shorter than N bytes\n";
  const fixture = `
    const long = Buffer.alloc(100_000, "a").toString();
    const fsr = ${fsr};
    const options = {
      "app.root": { app: { root: long, framework: { fileSystemRouterTypes: [fsr] } } },
      "fileSystemRouterTypes[0].root": { app: { framework: { fileSystemRouterTypes: [{ ...fsr, root: long }] } } },
      // This one needs no feature flag: the \`dir\` becomes a router root.
      'routes["/*"].dir': { routes: { "/*": { dir: long, style: "nextjs-pages" } } },
    }[process.argv[2]];
    try {
      Bun.serve({ port: 0, development: true, ...options, fetch: () => new Response("fallback") }).stop(true);
      console.log("no error");
    } catch (e) {
      console.log(e.message);
    }
  `;

  test.concurrent.each([
    ["app.root", "'app.root' must resolve to a path shorter than N bytes\n", ""],
    ["fileSystemRouterTypes[0].root", "Framework is missing required files!\n", routerRootError],
    ['routes["/*"].dir', "Framework is missing required files!\n", routerRootError],
  ])("Bun.serve: %s", async (option, expectedStdout, expectedStderr) => {
    using dir = tempDir("bake-long-dir", { ...appFiles, "fixture.ts": fixture });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.ts", option],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(withoutLimit(stdout)).toBe(expectedStdout);
    if (option.startsWith("routes")) {
      // A `style` route uses the built-in React framework. Before the router
      // root, stderr names the React packages that this directory does not have.
      expect(withoutLimit(stderr)).toEndWith(expectedStderr);
    } else {
      expect(withoutLimit(stderr)).toBe(expectedStderr);
    }
    expect(exitCode).toBe(0);
  });

  // Every entry point above shares one resolver, so one entry point pins its limit.
  test.concurrent("FrameworkRouter of bun:internal-for-testing: root, at and past the limit", async () => {
    using dir = tempDir("bake-long-dir-limit", {});
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { FrameworkRouter } = require("bun:internal-for-testing").frameworkRouterInternals;
          const attempt = length => {
            try {
              new FrameworkRouter({ root: Buffer.alloc(length, "a").toString(), style: "nextjs-pages" });
              return "accepted";
            } catch (e) {
              return e.message;
            }
          };
          const farPast = attempt(100_000);
          const limit = Number(/shorter than (\\d+) bytes/.exec(farPast)[1]);
          // The root is joined to the working directory with one separator.
          const longest = limit - 1 - Buffer.byteLength(process.cwd()) - 1;
          console.log(JSON.stringify({ farPast, atLimit: attempt(longest), onePast: attempt(longest + 1) }));
        `,
      ],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const rejected = "options.root must resolve to a path shorter than N bytes";
    expect(stderr).toBe("");
    expect(JSON.parse(withoutLimit(stdout))).toEqual({ farPast: rejected, atLimit: "accepted", onePast: rejected });
    expect(exitCode).toBe(0);
  });

  const buildApp = async (rootLength: number) => {
    using dir = tempDir("bake-long-dir-build", {
      ...appFiles,
      "app.ts": `
        const long = Buffer.alloc(${rootLength}, "a").toString();
        export default { app: { framework: { fileSystemRouterTypes: [{ ...${fsr}, root: long }] } } };
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--app", "./app.ts"],
      // CI runs production.test.ts the same way: `bun build --app` fails exception validation while it
      // loads any config (#41185), and its leak check at exit takes about 5 s on an ASAN build.
      env: {
        ...bunEnv,
        BUN_JSC_validateExceptionChecks: "0",
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":"),
      },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr: withoutLimit(stderr), exitCode };
  };

  test.concurrent("bun build --app: fileSystemRouterTypes[0].root", async () => {
    const { stdout, stderr, exitCode } = await buildApp(100_000);
    expect(stderr).toEndWith(routerRootError + "error: Failed to resolve all imports required by the framework\n");
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  });

  // 5,000 bytes fit a path buffer on Windows only. There the root is a directory that does not exist.
  test.concurrent.skipIf(!isWindows)("bun build --app: a root between 4096 bytes and the limit", async () => {
    const { stdout, stderr, exitCode } = await buildApp(5_000);
    expect(stderr).toEndWith("Bundling routes\n");
    expect(stdout).toBe("done\n");
    expect(exitCode).toBe(0);
  });
});
