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

  const testAppRoutes = testRoutePattern("nextjs-app-routes");
  testAppRoutes("/route.ts", "", "page");
  testAppRoutes("/api/[id]/route.ts", "/api/:id", "page");
  testAppRoutes.isNull("/api/page.tsx");
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

// Custom router styles are not implemented. A function has to be rejected while the options are
// parsed, like any other value that is not a built-in style name, instead of being accepted and
// crashing the process once the router is used.
describe.concurrent("a style that is not a built-in style name", () => {
  const message = `'style' must be either "nextjs-pages", "nextjs-app-ui", or "nextjs-app-routes"`;
  const error = expect.objectContaining({ name: "TypeError", code: "ERR_INVALID_ARG_TYPE", message });
  const invalidStyles: [description: string, style: any][] = [
    ["a function", () => null],
    ["an unknown name", "remix"],
  ];

  test.each(invalidStyles)("parseRoutePattern rejects %s", (_, style) => {
    expect(() => parseRoutePattern(style, "/index.tsx")).toThrow(error);
  });

  test.each(invalidStyles)("new FrameworkRouter() rejects %s", (_, style) => {
    using dir = tempDir("fsr-style", { "index.tsx": "1" });
    expect(() => new FrameworkRouter({ root: String(dir), style })).toThrow(error);
  });

  test.each(invalidStyles)("Bun.serve() rejects %s in a directory route", (_, style) => {
    using dir = tempDir("fsr-style-dir-route", { "pages/index.tsx": "1" });
    expect(() =>
      Bun.serve({
        port: 0,
        development: true,
        routes: { "/*": { dir: path.join(String(dir), "pages"), style } },
      }),
    ).toThrow(error);
  });

  // The `app` option shared by `Bun.serve()` and `bun build --app`; `style` is JS source.
  const app = (style: string) => `{
    framework: {
      fileSystemRouterTypes: [{ root: "pages", style: ${style}, serverEntryPoint: "./server.ts" }],
    },
  }`;
  const appFiles = {
    "server.ts": "export default {};",
    "pages/index.tsx": "export default () => null;",
  };

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

  test("Bun.serve({ app }) rejects it", async () => {
    using dir = tempDir("fsr-style-serve", {
      ...appFiles,
      "start.ts": `
        for (const app of [${app("() => null")}, ${app('"remix"')}]) {
          try {
            Bun.serve({ port: 0, development: true, app }).stop(true);
            console.log("started");
          } catch (e) {
            console.log("threw: " + e.message);
          }
        }
      `,
    });
    expect(await run(String(dir), ["start.ts"])).toEqual({
      stdout: `threw: ${message}\nthrew: ${message}\n`,
      stderr: "",
      exitCode: 0,
    });
  });

  test("bun build --app rejects a function", async () => {
    using dir = tempDir("fsr-style-build", {
      ...appFiles,
      "bun.app.ts": `export default { app: ${app("() => null")} };`,
    });
    const { stderr, exitCode } = await run(String(dir), ["build", "--app", "./bun.app.ts"], {
      ...bunEnv,
      // Every `bun build --app` trips the exception check validator while loading its config (#38949).
      BUN_JSC_validateExceptionChecks: undefined,
      BUN_JSC_dumpSimulatedThrows: undefined,
    });
    expect(stderr).toContain(`TypeError: ${message}`);
    expect(exitCode).toBe(1);
  });
});
