import { crash_handler, frameworkRouterInternals } from "bun:internal-for-testing";
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

// Covers the param-push paths in `FrameworkRouter::matches` that
// https://github.com/oven-sh/bun/issues/30861 rewrote.
describe("match() param collection", () => {
  describe("catch-all binds the last segment", () => {
    // One entry is pushed per segment; duplicate `slug` keys collapse to the
    // last one in the JS result object.
    test.each([
      ["/a", "a"],
      ["/one/two/three", "three"],
      ["/a/b/c/d/e/f", "f"],
    ])("%s → slug=%j", (p, expected) => {
      using dir = tempDir("fsr-match-catchall", {
        "[...slug].tsx": "1",
      });
      const router = new FrameworkRouter({ root: dir, style: "nextjs-pages" });
      expect(router.match(p).params).toEqual({ slug: expected });
    });
  });

  test("single-param route still matches", () => {
    using dir = tempDir("fsr-match-param", {
      "[name].tsx": "1",
    });
    const router = new FrameworkRouter({ root: dir, style: "nextjs-pages" });

    expect(router.match("/hello").params).toEqual({ name: "hello" });
  });

  test("unmatched path returns null", () => {
    using dir = tempDir("fsr-match-miss", {
      "known.tsx": "1",
    });
    const router = new FrameworkRouter({ root: dir, style: "nextjs-pages" });

    expect(router.match("/unknown/path")).toBeNull();
  });

  // On `/nested/a/b` the `[name]` pattern pushes `name="nested"` and then
  // fails; without the `clear()` in `matches()` that entry leaks into the
  // catch-all's result as `{ name: "nested", slug: "b" }`.
  test("stale params from a failed prior pattern don't leak", () => {
    using dir = tempDir("fsr-match-stale", {
      "[name].tsx": "1",
      "nested/[...slug].tsx": "1",
    });
    const router = new FrameworkRouter({ root: dir, style: "nextjs-pages" });

    // Sanity: the param-only route still works for single-segment paths.
    expect(router.match("/x").params).toEqual({ name: "x" });

    // The failing-then-succeeding case must not leak the failed pattern's push.
    expect(router.match("/nested/a/b").params).toEqual({ slug: "b" });
  });

  // Probes the `BoundedArray::resize` contract itself (issue #30861),
  // independently of the router, via the binding in `crash_handler_jsc.rs`.
  test("BoundedArray::resize refuses to grow", () => {
    expect(crash_handler.boundedArrayResizeGrowReturnsErr()).toBe(true);
  });
});
