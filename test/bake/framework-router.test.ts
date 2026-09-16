import { frameworkRouterInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isMacOS, isWindows, tempDir } from "harness";
import path from "path";

const { parseRoutePattern, FrameworkRouter } = frameworkRouterInternals;

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

// e.g. `../web/pages` from a sibling package in a monorepo: route patterns come from the path below that root.
describe.concurrent("fileSystemRouterTypes[n].root outside the project root", () => {
  // The project root is apps/api; prints "<pathname> <status> <body>" for each request.
  const serveFixture = (root: string) => ({
    "apps/api/server.ts": `
      export function render(req, meta) {
        return meta.pageModule.default(req, meta);
      }
    `,
    "apps/api/start.ts": `
      using server = Bun.serve({
        port: 0,
        development: true,
        app: {
          framework: {
            fileSystemRouterTypes: [{ root: ${JSON.stringify(root)}, style: "nextjs-pages", serverEntryPoint: "./server.ts" }],
          },
        },
        fetch: () => new Response("not routed", { status: 404 }),
      });
      for (const pathname of ["/", "/blog/hello-world"]) {
        const res = await fetch(new URL(pathname, server.url));
        console.log(pathname, res.status, await res.text());
      }
    `,
  });
  const pages = (prefix: string) => ({
    [`${prefix}/index.ts`]: `export default () => new Response("index");`,
    [`${prefix}/blog/[slug].ts`]: `export default (req, meta) => new Response("slug:" + meta.params.slug);`,
  });

  const start = (dir: string) => run(path.join(dir, "apps", "api"), ["start.ts"]);

  test("a sibling directory", async () => {
    using dir = tempDir("fsr-sibling-root", { ...serveFixture("../web/pages"), ...pages("apps/web/pages") });
    const { stdout, stderr, exitCode } = await start(String(dir));
    expect(stdout, stderr).toBe("/ 200 index\n/blog/hello-world 200 slug:hello-world\n");
    expect(exitCode).toBe(0);
  });

  test("an ancestor directory", async () => {
    using dir = tempDir("fsr-ancestor-root", { ...serveFixture(".."), ...pages("apps") });
    const { stdout, stderr, exitCode } = await start(String(dir));
    expect(stdout, stderr).toBe("/ 200 index\n/blog/hello-world 200 slug:hello-world\n");
    expect(exitCode).toBe(0);
  });

  // Both kinds of route error name the file relative to the project root and do not stop the server.
  test("route errors name the file relative to the project root", async () => {
    using dir = tempDir("fsr-sibling-root-errors", {
      ...serveFixture("../web/pages"),
      ...pages("apps/web/pages"),
      "apps/web/pages/[oops.ts": `export default () => new Response("");`,
      "apps/web/pages/about.ts": `export default () => new Response("");`,
      "apps/web/pages/about/index.ts": `export default () => new Response("");`,
    });
    const { stdout, stderr, exitCode } = await start(String(dir));
    expect(stdout, stderr).toBe("/ 200 index\n/blog/hello-world 200 slug:hello-world\n");
    expect(stderr).toContain('"../web/pages/[oops.ts" is not a valid route');
    expect(stderr).toContain('Missing "]" to match this route parameter');
    expect(stderr).toContain("Multiple pages matching the same route pattern is ambiguous");
    expect(stderr).toContain("  - ../web/pages/about.ts");
    expect(stderr).toContain("  - ../web/pages/about/index.ts");
    expect(exitCode).toBe(0);
  });

  // `app.root` is deeper than the router root and does not contain it, like `./src/app` with the routes in `./routes`.
  test("a directory next to an ancestor", async () => {
    using dir = tempDir("fsr-ancestor-sibling-root", { ...serveFixture("../../routes"), ...pages("routes") });
    const { stdout, stderr, exitCode } = await start(String(dir));
    expect(stdout, stderr).toBe("/ 200 index\n/blog/hello-world 200 slug:hello-world\n");
    expect(exitCode).toBe(0);
  });

  // The message of a route syntax error starts in the column of the character it is about.
  describe.each([
    ["pages", "apps/api/pages"],
    ["../web/pages", "apps/web/pages"],
  ])("a route syntax error under %s", (root, prefix) => {
    test("points at the bad character", async () => {
      using dir = tempDir("fsr-root-error-column", {
        ...serveFixture(root),
        ...pages(prefix),
        [`${prefix}/blog/[oops.ts`]: `export default () => new Response("");`,
      });
      const { stdout, stderr, exitCode } = await start(String(dir));
      expect(stdout, stderr).toBe("/ 200 index\n/blog/hello-world 200 slug:hello-world\n");
      const label = `${root}/blog/[oops.ts`;
      const indent = Buffer.alloc(`error: "`.length + label.indexOf("["), " ").toString();
      expect(stderr).toContain(`error: "${label}" is not a valid route\n`);
      expect(stderr).toContain(`\n${indent}Missing "]" to match this route parameter\n`);
      expect(exitCode).toBe(0);
    });
  });

  // The bad segment is above the project root, so the path relative to the project root cannot show it.
  test("a route syntax error above the project root names the path below the router root", async () => {
    const fixture = serveFixture("..");
    using dir = tempDir("fsr-root-error-above", {
      "apps/[api/server.ts": fixture["apps/api/server.ts"],
      "apps/[api/start.ts": fixture["apps/api/start.ts"],
      ...pages("apps"),
    });
    const { stdout, stderr, exitCode } = await run(path.join(String(dir), "apps", "[api"), ["start.ts"]);
    expect(stdout, stderr).toBe("/ 200 index\n/blog/hello-world 200 slug:hello-world\n");
    expect(stderr).toContain(`error: "/[api/server.ts" is not a valid route\n`);
    const indent = Buffer.alloc(`error: "/`.length, " ").toString();
    expect(stderr).toContain(`\n${indent}Missing "]" to match this route parameter\n`);
    expect(exitCode).toBe(0);
  });

  // Every segment of the project root becomes "../" in the label of a file outside it. The label can
  // outgrow a path buffer while both paths fit in one. The label is then the path below the router root.
  // MAX_PATH_BYTES is 98302 on Windows, and no two valid paths there give a label that long.
  test.skipIf(isWindows)("a route error label that does not fit a path buffer", async () => {
    const maxPathBytes = isMacOS ? 1024 : 4096;
    using dir = tempDir("fsr-long-label", {});
    // Long directories below the router root. The route file path stays under the limit.
    const longDirCount = Math.floor((maxPathBytes - String(dir).length - 80) / 201);
    const below = Array.from({ length: longDirCount }, () => Buffer.alloc(200, "d").toString()).join("/");
    // One-letter segments for the project root, enough of them to push the label over the limit.
    const depth = Math.ceil((maxPathBytes - below.length) / 3) + 10;
    const projectRoot = path.join(String(dir), "p", Buffer.alloc(depth * 2 - 1, "a/").toString());
    const fixture = serveFixture(Buffer.alloc((depth + 1) * 3, "../").toString() + "routes");

    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(path.join(projectRoot, "server.ts"), fixture["apps/api/server.ts"]);
    writeFileSync(path.join(projectRoot, "start.ts"), fixture["apps/api/start.ts"]);
    mkdirSync(path.join(String(dir), "routes", below), { recursive: true });
    writeFileSync(path.join(String(dir), "routes", below, "[oops.ts"), `export default () => new Response("");`);

    const { stdout, stderr, exitCode } = await run(projectRoot, ["start.ts"]);
    expect(stdout, stderr).toBe("/ 404 not routed\n/blog/hello-world 404 not routed\n");
    expect(stderr).toContain(`error: "/${below}/[oops.ts" is not a valid route\n`);
    expect(exitCode).toBe(0);
  });
});
