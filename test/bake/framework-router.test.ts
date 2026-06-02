import { frameworkRouterInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithFiles } from "harness";
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
  const dir = tempDirWithFiles("fsr", {
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

// Regression: printing a route syntax error crashed the dev server instead of
// reporting it. The 65+ parameter check recorded its message without a cursor
// position, leaving `TinyLog.cursor_at` at the `u32::MAX` sentinel, and
// `TinyLog.print` sliced `rel_path[cursor_at..]` with it.
// The 65-directory fixture exceeds Windows' MAX_PATH; the code under test is
// platform-independent.
test.skipIf(isWindows)("dev server reports route syntax errors without crashing", async () => {
  const manyParams = Array.from({ length: 65 }, (_, i) => `[p${i}]`).join("/");
  const dir = tempDirWithFiles("fsr-syntax-error", {
    "server.ts": `
      export function render(req, meta) {
        return meta.pageModule.default(req, meta);
      }
    `,
    "main.ts": `
      export default {
        port: 0,
        development: true,
        app: {
          framework: {
            fileSystemRouterTypes: [
              { root: "routes", style: "nextjs-pages", serverEntryPoint: "./server.ts" },
            ],
          },
        },
      };
    `,
    "routes/index.tsx": `export default () => new Response("ok");`,
    "routes/[bad.tsx": `export default () => new Response("bad");`,
    [`routes/${manyParams}/index.tsx`]: `export default () => new Response("deep");`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.ts"],
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  // The route scan runs during server startup, so "Started development
  // server" only prints after both syntax errors were reported. Without the
  // fix the process dies while printing the 65-param error.
  let stdout = "";
  let url: string | undefined;
  const decoder = new TextDecoder();
  for await (const chunk of proc.stdout) {
    stdout += decoder.decode(chunk, { stream: true });
    url = stdout.match(/Started development server: (http:\/\/\S+)/)?.[1];
    if (url) break;
  }
  expect(url).toBeDefined();

  // The server must still respond after reporting the errors.
  const res = await fetch(url!);
  expect(await res.text()).toBe("ok");

  proc.kill();
  const stderr = await proc.stderr.text();
  await proc.exited;
  // The caret/underline must line up with the offending "[" — column
  // 8 for the `error: "` prefix plus 7 for `routes/`.
  expect(stderr).toContain(
    'error: "routes/[bad.tsx" is not a valid route\n' +
      " ".repeat(8 + 7) +
      "-------\n" +
      " ".repeat(8 + 7) +
      'Missing "]" to match this route parameter',
  );
  expect(stderr).toContain("Pattern cannot have more than 64 param");
});
