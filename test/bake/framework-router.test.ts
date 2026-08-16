import { frameworkRouterInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, MAX_PATH_BYTES, tempDir } from "harness";
import path from "path";

const { parseRoutePattern, FrameworkRouter } = frameworkRouterInternals;

const testRoutePattern = (style: string) => {
  // The 'expected' is a one-off string serialization that is only used for testing.
  // Params are serialized as ":param", catch all as ":*param", and optional catch all as ":*?param".
  const fn = (pattern: string, expected: string, kind: "page" | "layout" | "extra" = "page") => {
    test(`[${style}] pass: ${JSON.stringify(pattern)}`, () => {
      const result = parseRoutePattern(style, pattern);
      if (result === null) {
        throw new Error("Parser said this file is not a route");
      }
      expect(result.kind, "expected route kind to match").toBe(kind);
      expect(result.pattern, "expected route pattern to match").toBe(expected);
    });
  };
  fn.fails = (pattern: string, msg: string) => {
    test(`[${style}] error: ${JSON.stringify(pattern)}`, () => {
      expect(() => parseRoutePattern(style, pattern)).toThrow(msg);
    });
  };
  fn.isNull = (pattern: string) => {
    test(`[${style}] ignore: ${JSON.stringify(pattern)}`, () => {
      expect(parseRoutePattern(style, pattern)).toBeNull();
    });
  };
  return fn;
};

describe("pattern parse", () => {
  const testPages = testRoutePattern("nextjs-pages");
  testPages("/index.tsx", "", "page");
  testPages("/_layout.tsx", "", "layout");
  testPages("/subdir/index.tsx", "/subdir", "page");
  testPages("/subdir/_layout.tsx", "/subdir", "layout");
  testPages("/subdir/[page].tsx", "/subdir/:page", "page");
  testPages("/[user]/posts.tsx", "/:user/posts", "page");
  testPages("/[user]/_layout.tsx", "/:user", "layout");
  testPages("/subdir/[page]/[other].tsx", "/subdir/:page/:other", "page");
  testPages("/[page]/[other]/index.js", "/:page/:other", "page");
  testPages("/[...data].js", "/:*data", "page");
  testPages("/[[...data]].js", "/:*?data", "page");
  testPages("/[...data]/index.tsx", "/:*data", "page");
  testPages("/[[...data]]/index.jsx", "/:*?data", "page");
  testPages("/hello/[...data]/index.tsx", "/hello/:*data", "page");
  testPages("/hello/[[...data]]/index.jsx", "/hello/:*?data", "page");
  testPages("/[...data]/_layout.tsx", "/:*data", "layout");
  testPages("/[[...data]]/_layout.jsx", "/:*?data", "layout");
  testPages("/hello/[...data]/_layout.tsx", "/hello/:*data", "layout");
  testPages("/hello/[[...data]]/_layout.jsx", "/hello/:*?data", "layout");
  // Parenthesis is the error location (column:length)
  testPages.fails("/subdir/[", 'Missing "]" to match this route parameter (8:1)');
  testPages.fails("/subdir/[a", 'Missing "]" to match this route parameter (8:2)');
  testPages.fails("/subdir/[page.tsx", 'Missing "]" to match this route parameter (8:9)');
  testPages.fails("/subdir/[]/hello", "Parameter needs a name (8:2)");
  testPages.fails("/subdir/[.hello]-hello.tsx", 'Parameter name cannot start with "." (use "..." for catch-all) (8:8)');
  testPages.fails(
    "/subdir/[..hello]-hello.tsx",
    'Parameter name cannot start with "." (use "..." for catch-all) (8:9)',
  );
  testPages.fails("/subdir/[...hello]-hello.tsx", "Parameters must take up the entire file name (8:10)");
  testPages.fails("/subdir/[...hello]/bar.tsx", "Catch-all parameter must be at the end of a route (8:10)");
  testPages.fails(
    "/hello/[[optional_param]]/_layout.tsx",
    'Optional parameters can only be catch-all (change to "[[...optional_param]]" or remove extra brackets) (7:18)',
  );

  const testApp = testRoutePattern("nextjs-app-ui");
  testApp("/page.tsx", "", "page");
  testApp("/layout.tsx", "", "layout");
  testApp("/route/[param]/page.tsx", "/route/:param", "page");
  testApp("/route/(group)/page.tsx", "/route/(group)", "page");
  testApp("/route/[param]/not-found.tsx", "/route/:param", "extra");
  testApp.isNull("/route/_layout.tsx");
});

test("discovers from filesystem paths", () => {
  using dir = tempDir("fsr", {
    "hello.tsx": "1",
    "meow/_layout.tsx": "1",
    "meow/bark/[param]/hello.tsx": "1",
    "[world].tsx": "1",
  });
  const router = new FrameworkRouter({ root: dir, style: "nextjs-pages" });
  expect(router.toJSON()).toEqual({
    part: "/",
    page: null,
    layout: null,
    children: [
      {
        part: "/:world",
        page: path.join(dir, "[world].tsx"),
        layout: null,
        children: [],
      },
      {
        part: "/meow",
        page: null,
        layout: path.join(dir, "meow/_layout.tsx"),
        children: [
          {
            part: "/bark",
            page: null,
            layout: null,
            children: [
              {
                part: "/:param",
                page: null,
                layout: null,
                children: [
                  {
                    part: "/hello",
                    page: path.join(dir, "meow/bark/[param]/hello.tsx"),
                    layout: null,
                    children: [],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        part: "/hello",
        page: path.join(dir, "hello.tsx"),
        layout: null,
        children: [],
      },
    ],
  });
});

describe.concurrent("fileSystemRouterTypes[n].root that does not fit in a path buffer", () => {
  // Longer than MAX_PATH_BYTES on every platform.
  const tooLongRoot = `Buffer.alloc(100_000, "a").toString()`;
  // An absolute root resolves to itself, so this resolves to exactly `length` bytes
  // ("/aaa..." on POSIX, "C:\\aaa..." on Windows). Evaluated inside the fixture.
  const absoluteRootOfLength = (length: number) =>
    `(prefix => prefix + Buffer.alloc(${length} - prefix.length, "a").toString())(path.parse(process.cwd()).root)`;
  const rootError = (index: number) =>
    `ENAMETOOLONG: Failed to resolve 'fileSystemRouterTypes[${index}].root' for framework: the resolved path must be shorter than ${MAX_PATH_BYTES} bytes`;
  const rejected = "threw: Framework is missing required files!";

  const serverEntryPoint = `
    export function render(req, meta) {
      return meta.pageModule.default(req, meta);
    }
  `;
  const appWithRoots = (...roots: string[]) => `{
    app: {
      framework: {
        fileSystemRouterTypes: [
          ${roots.map(root => `{ root: ${root}, style: "nextjs-pages", serverEntryPoint: "./server.ts" },`).join("\n")}
        ],
      },
    },
  }`;
  // Prints one line per attempt: "started" if Bun.serve accepted the options, "threw: <message>" otherwise.
  const serveFixture = (...attempts: string[]) => `
    import path from "path";
    for (const options of [${attempts.join(", ")}]) {
      try {
        const server = Bun.serve({ port: 0, development: true, ...options, fetch: () => new Response("") });
        server.stop(true);
        console.log("started");
      } catch (e) {
        console.log("threw: " + e.message);
      }
    }
  `;

  const buildFixture = (root: string) => ({
    "server.ts": serverEntryPoint,
    "bun.app.ts": `
      import path from "path";
      export default ${appWithRoots(root)};
    `,
  });

  async function run(dir: string, args: string[], env = bunEnv) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      cwd: dir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  // Every `bun build --app` trips the exception check validator while loading its config (until #38949) and
  // leaks its transpilers at exit (until #38233), which is why production.test.ts is exempt from both checks.
  const build = (dir: string) =>
    run(dir, ["build", "--app"], {
      ...bunEnv,
      BUN_JSC_validateExceptionChecks: undefined,
      BUN_JSC_dumpSimulatedThrows: undefined,
      ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":"),
    });

  test("the internal FrameworkRouter constructor throws instead of crashing", () => {
    const prefix = path.parse(process.cwd()).root;
    const root = prefix + Buffer.alloc(MAX_PATH_BYTES - prefix.length, "a").toString();
    expect(() => new FrameworkRouter({ root, style: "nextjs-pages" })).toThrow(
      `options.root must resolve to a path shorter than ${MAX_PATH_BYTES} bytes`,
    );
  });

  // Windows' own path limit is below MAX_PATH_BYTES, so such a tree cannot be created there.
  test.skipIf(isWindows)("scanning a root skips the entries whose paths do not fit instead of crashing", () => {
    using dir = tempDir("fsr-scan-long-entries", {});
    // About 200 bytes below the limit: the root's own short files fit, entries with a maximum-length name do not.
    // Every segment adds at least two bytes (separator included), so this terminates whatever length `dir` has.
    let root = String(dir);
    while (root.length < MAX_PATH_BYTES - 200) {
      const part = Math.max(1, Math.min(200, MAX_PATH_BYTES - 200 - root.length - 1));
      root = path.join(root, Buffer.alloc(part, "d").toString());
    }
    mkdirSync(root, { recursive: true });
    writeFileSync(path.join(root, "index.ts"), "");
    // The OS rejects their absolute paths too, so these can only be created relative to the root.
    const longName = Buffer.alloc(252, "x").toString();
    const create = Bun.spawnSync({
      cmd: [
        bunExe(),
        "-e",
        `
          import { mkdirSync, writeFileSync } from "fs";
          writeFileSync(${JSON.stringify(`${longName}.ts`)}, "");
          mkdirSync(${JSON.stringify(`${longName}dir`)});
          writeFileSync(${JSON.stringify(`${longName}dir/index.ts`)}, "");
        `,
      ],
      cwd: root,
      env: bunEnv,
    });
    expect(create.stderr.toString()).toBe("");
    expect(create.exitCode).toBe(0);

    const router = new FrameworkRouter({ root, style: "nextjs-pages" });
    expect(router.toJSON()).toEqual({ part: "/", page: path.join(root, "index.ts"), layout: null, children: [] });
  });

  test("Bun.serve({ app }) reports every root that does not fit instead of crashing", async () => {
    using dir = tempDir("fsr-long-root-app", {
      "server.ts": serverEntryPoint,
      "start.ts": serveFixture(appWithRoots(tooLongRoot, `"/" + ${tooLongRoot}`)),
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["start.ts"]);
    expect(stderr).toContain(rootError(0));
    expect(stderr).toContain(rootError(1));
    expect(stdout).toBe(`${rejected}\n`);
    expect(exitCode).toBe(0);
  });

  test("Bun.serve({ routes: { '/*': { dir, style } } }) reports the root instead of crashing", async () => {
    using dir = tempDir("fsr-long-root-routes", {
      "start.ts": serveFixture(`{ routes: { "/*": { dir: ${tooLongRoot}, style: "nextjs-pages" } } }`),
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["start.ts"]);
    expect(stderr).toContain(rootError(0));
    expect(stdout).toBe(`${rejected}\n`);
    expect(exitCode).toBe(0);
  });

  test("Bun.serve({ app }) accepts a root one byte below the limit and rejects one at the limit", async () => {
    using dir = tempDir("fsr-root-at-limit-app", {
      "server.ts": serverEntryPoint,
      "start.ts": serveFixture(
        // The directory does not exist, so the accepted root is skipped like any other missing root.
        appWithRoots(absoluteRootOfLength(MAX_PATH_BYTES - 1)),
        appWithRoots(absoluteRootOfLength(MAX_PATH_BYTES)),
      ),
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["start.ts"]);
    expect(stdout).toBe(`started\n${rejected}\n`);
    expect(stderr).toContain(rootError(0));
    expect(stderr.match(/ENAMETOOLONG/g) ?? []).toHaveLength(1);
    expect(exitCode).toBe(0);
  });

  test("bun build --app fails on a root at the limit instead of crashing", async () => {
    using dir = tempDir("fsr-root-at-limit-build", buildFixture(absoluteRootOfLength(MAX_PATH_BYTES)));
    const { stderr, exitCode } = await build(String(dir));
    expect(stderr).toContain(rootError(0));
    expect(exitCode).toBe(1);
  });

  test("bun build --app looks up a root one byte below the limit like any other missing directory", async () => {
    using dir = tempDir("fsr-root-below-limit-build", buildFixture(absoluteRootOfLength(MAX_PATH_BYTES - 1)));
    const { stdout, stderr, exitCode } = await build(String(dir));
    expect(stderr).not.toContain("ENAMETOOLONG");
    expect(stderr).toContain("Bundling routes");
    expect(stdout).toContain("done");
    expect(exitCode).toBe(0);
  });

  test("a root that only normalizes down to a path that fits is served", async () => {
    using dir = tempDir("fsr-long-root-normalizes", {
      "server.ts": serverEntryPoint,
      "routes/index.ts": `export default () => new Response("hello from routes");`,
      "start.ts": `
        // 100 KB as written, "routes" once the ".." segments are resolved.
        const root = "routes" + Buffer.alloc(100_000, "/../routes").toString();
        using server = Bun.serve({
          port: 0,
          development: true,
          ...${appWithRoots("root")},
          fetch: () => new Response("not routed", { status: 404 }),
        });
        const res = await fetch(\`http://localhost:\${server.port}/\`);
        console.log(res.status, await res.text());
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["start.ts"]);
    expect(stderr).not.toContain("ENAMETOOLONG");
    expect(stdout).toBe("200 hello from routes\n");
    expect(exitCode).toBe(0);
  });
});
