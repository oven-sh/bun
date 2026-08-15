import { frameworkRouterInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
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

describe.concurrent("fileSystemRouterTypes[n].root longer than the path buffer", () => {
  // 100 KB is longer than PATH_MAX on every platform (4 KB on Linux, 1 KB on
  // macOS, ~96 KB on Windows), so the resolved root cannot fit in a path buffer.
  const tooLongRoot = `Buffer.alloc(100_000, "a").toString()`;
  const tooLongRootError = "ENAMETOOLONG: Failed to resolve 'fileSystemRouterTypes[0].root' for framework";
  const serverEntryPoint = `
    export function render(req, meta) {
      return meta.pageModule.default(req, meta);
    }
  `;
  const serveOrReport = (options: string) => `
    try {
      const server = Bun.serve({
        port: 0,
        development: true,
        ${options},
        fetch: () => new Response(""),
      });
      server.stop(true);
      console.log("started");
    } catch (e) {
      console.log("threw: " + e.message);
    }
  `;

  async function run(dir: string, ...args: string[]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  for (const [kind, root] of [
    ["relative", tooLongRoot],
    ["absolute", `"/" + ${tooLongRoot}`],
  ]) {
    test(`Bun.serve({ app }) reports the root (${kind}) instead of crashing`, async () => {
      using dir = tempDir(`fsr-long-root-app-${kind}`, {
        "server.ts": serverEntryPoint,
        "start.ts": serveOrReport(`
          app: {
            framework: {
              fileSystemRouterTypes: [
                { root: ${root}, style: "nextjs-pages", serverEntryPoint: "./server.ts" },
              ],
            },
          }
        `),
      });
      const { stdout, stderr, exitCode } = await run(String(dir), "start.ts");
      expect(stderr).toContain(tooLongRootError);
      expect(stdout).toBe("threw: Framework is missing required files!\n");
      expect(exitCode).toBe(0);
    });
  }

  test("Bun.serve({ routes: { '/*': { dir, style } } }) reports the root instead of crashing", async () => {
    using dir = tempDir("fsr-long-root-routes", {
      "start.ts": serveOrReport(`routes: { "/*": { dir: ${tooLongRoot}, style: "nextjs-pages" } }`),
    });
    const { stdout, stderr, exitCode } = await run(String(dir), "start.ts");
    expect(stderr).toContain(tooLongRootError);
    expect(stdout).toBe("threw: Framework is missing required files!\n");
    expect(exitCode).toBe(0);
  });

  test("bun build --app reports the root instead of crashing", async () => {
    using dir = tempDir("fsr-long-root-build", {
      "server.ts": serverEntryPoint,
      "bun.app.ts": `
        export default {
          app: {
            framework: {
              fileSystemRouterTypes: [
                { root: ${tooLongRoot}, style: "nextjs-pages", serverEntryPoint: "./server.ts" },
              ],
            },
          },
        };
      `,
    });
    const { stderr, exitCode } = await run(String(dir), "build", "--app");
    expect(stderr).toContain(tooLongRootError);
    expect(exitCode).toBe(1);
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
          app: {
            framework: {
              fileSystemRouterTypes: [{ root, style: "nextjs-pages", serverEntryPoint: "./server.ts" }],
            },
          },
          fetch: () => new Response("not routed", { status: 404 }),
        });
        const res = await fetch(\`http://localhost:\${server.port}/\`);
        console.log(res.status, await res.text());
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), "start.ts");
    expect(stderr).not.toContain("ENAMETOOLONG");
    expect(stdout).toBe("200 hello from routes\n");
    expect(exitCode).toBe(0);
  });
});
