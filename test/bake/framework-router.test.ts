import { frameworkRouterInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
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

describe("dynamic route precedence", () => {
  /** Scans a router made of `files` and returns, for each url, the page file (relative to the root) that serves it. */
  function servedBy(files: string[], urls: string[]): Record<string, string | null> {
    using dir = tempDir("fsr-precedence", Object.fromEntries(files.map(file => [file, "1"])));
    const router = new FrameworkRouter({ root: String(dir), style: "nextjs-pages" });
    return Object.fromEntries(
      urls.map(url => {
        const match = router.match(url);
        return [url, match === null ? null : path.relative(String(dir), match.route.page).replaceAll("\\", "/")];
      }),
    );
  }

  // Routes are inserted in the order the directory scan visits them, which is
  // derived from the file names. The names in each case below are chosen so
  // that the scan visits the losing route first, so every case depends on the
  // router sorting the routes rather than matching them in scan order.
  test.each([
    [
      "a static segment beats a param",
      ["blog/[slug].tsx", "[section]/[slug].tsx"],
      { "/blog/hello": "blog/[slug].tsx", "/news/hello": "[section]/[slug].tsx" },
    ],
    [
      "a static segment beats a param after a shared param",
      ["[user]/posts/[id].tsx", "[user]/[section]/[id].tsx"],
      { "/joe/posts/1": "[user]/posts/[id].tsx", "/joe/likes/1": "[user]/[section]/[id].tsx" },
    ],
    [
      "a static segment beats a catch-all after a shared param",
      ["[team]/docs/[[...path]].tsx", "[team]/[...path].tsx"],
      {
        "/acme/docs": "[team]/docs/[[...path]].tsx",
        "/acme/docs/a/b": "[team]/docs/[[...path]].tsx",
        "/acme/billing": "[team]/[...path].tsx",
      },
    ],
    [
      "a static segment followed by an optional catch-all beats a param",
      ["[id].tsx", "opt/[[...rest]].tsx"],
      { "/opt": "opt/[[...rest]].tsx", "/opt/a": "opt/[[...rest]].tsx", "/other": "[id].tsx" },
    ],
    ["a param beats a catch-all", ["[slug].tsx", "[...rest].tsx"], { "/a": "[slug].tsx", "/a/b": "[...rest].tsx" }],
    [
      "a param beats an optional catch-all",
      ["[slug].tsx", "[[...rest]].tsx"],
      { "/a": "[slug].tsx", "/a/b": "[[...rest]].tsx" },
    ],
    [
      "a catch-all beats an optional catch-all",
      ["[...slug].tsx", "[[...slug]].tsx"],
      { "/a": "[...slug].tsx", "/a/b": "[...slug].tsx" },
    ],
    [
      "two params beat a catch-all",
      ["[slug]/[id].tsx", "[...rest].tsx"],
      { "/a/b": "[slug]/[id].tsx", "/a/b/c": "[...rest].tsx" },
    ],
    [
      "the route that ends first beats one that continues with an optional catch-all",
      ["[slug].tsx", "[slug]/[[...rest]].tsx"],
      { "/a": "[slug].tsx", "/a/b": "[slug]/[[...rest]].tsx" },
    ],
  ])("%s", (_, files, expected) => {
    expect(servedBy(files, Object.keys(expected))).toEqual(expected);
  });

  test("precedence is decided at the first segment that differs", () => {
    const files = [
      "[...all].tsx",
      "[[...opt]].tsx",
      "[slug].tsx",
      "[slug]/[id].tsx",
      "[slug]/[...rest].tsx",
      "[team]/docs/[[...path]].tsx",
      "docs/[page]/[[...rest]].tsx",
      "docs/[...rest].tsx",
      "opt/[[...rest]].tsx",
    ];
    const expected = {
      "/a": "[slug].tsx",
      "/a/b": "[slug]/[id].tsx",
      "/a/b/c": "[slug]/[...rest].tsx",
      "/acme/docs": "[team]/docs/[[...path]].tsx",
      "/acme/docs/intro": "[team]/docs/[[...path]].tsx",
      "/docs/intro": "docs/[page]/[[...rest]].tsx",
      "/docs/intro/b": "docs/[page]/[[...rest]].tsx",
      "/opt": "opt/[[...rest]].tsx",
      "/opt/a": "opt/[[...rest]].tsx",
    };
    expect(servedBy(files, Object.keys(expected))).toEqual(expected);
  });
});
