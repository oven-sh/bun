import { crash_handler, frameworkRouterInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { tempDirWithFiles } from "harness";
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

// https://github.com/oven-sh/bun/issues/30861
//
// The `match()` catch-all path pushes one parameter per path segment through
// the matched-params `BoundedArray`. The Rust fix makes `resize` shrink-only
// and routes the push through `append` instead. Because `append` — unlike the
// pre-fix `resize(param_num + 1)` — does NOT truncate, the reset of `params`
// on entry to each pattern's `matches()` also had to become explicit; without
// it, entries left behind by a dynamic pattern that matched partway and then
// returned `false` would leak into the next pattern that succeeds.
describe("match() param collection", () => {
  describe("catch-all binds the last segment", () => {
    // Internally the catch-all `[...slug]` pattern pushes one `{slug: seg}`
    // entry per path segment into the `MatchedParams` BoundedArray; the JS
    // binding then iterates them into an object, so duplicate `slug` keys
    // collapse to whichever entry was pushed last. That's the only
    // externally-observable outcome, but each push still flows through the
    // `append` code path we're exercising here.
    test.each([
      ["/a", "a"],
      ["/one/two/three", "three"],
      ["/a/b/c/d/e/f", "f"],
    ])("%s → slug=%j", (p, expected) => {
      const dir = tempDirWithFiles("fsr-match-catchall", {
        "[...slug].tsx": "1",
      });
      const router = new FrameworkRouter({ root: dir, style: "nextjs-pages" });
      expect(router.match(p).params).toEqual({ slug: expected });
    });
  });

  test("single-param route still matches", () => {
    const dir = tempDirWithFiles("fsr-match-param", {
      "[name].tsx": "1",
    });
    const router = new FrameworkRouter({ root: dir, style: "nextjs-pages" });

    expect(router.match("/hello").params).toEqual({ name: "hello" });
  });

  test("unmatched path returns null", () => {
    const dir = tempDirWithFiles("fsr-match-miss", {
      "known.tsx": "1",
    });
    const router = new FrameworkRouter({ root: dir, style: "nextjs-pages" });

    expect(router.match("/unknown/path")).toBeNull();
  });

  // Concrete trigger for the append-without-truncate hazard:
  //
  //   /[name].tsx          — root-level single-segment param
  //   /nested/[...slug].tsx — catch-all under /nested
  //
  // `match_slow` iterates dynamic patterns in insertion order. On the path
  // `/nested/a/b` the `[name]` pattern runs first, pushes `name="nested"`,
  // and then fails (one Param can only consume one segment, but the path
  // still has more to cover). The catch-all pattern runs second and matches.
  //
  // Pre-fix (append without clear on entry): the stale `name="nested"`
  // entry leaks into the result → `{ name: "nested", slug: "b" }`.
  // Post-fix (`params.clear()` at the top of `matches()`): only the
  // catch-all's own entries survive → `{ slug: "b" }`.
  test("stale params from a failed prior pattern don't leak", () => {
    const dir = tempDirWithFiles("fsr-match-stale", {
      "[name].tsx": "1",
      "nested/[...slug].tsx": "1",
    });
    const router = new FrameworkRouter({ root: dir, style: "nextjs-pages" });

    // Sanity: the param-only route still works for single-segment paths.
    expect(router.match("/x").params).toEqual({ name: "x" });

    // The failing-then-succeeding case must not leak the failed pattern's push.
    expect(router.match("/nested/a/b").params).toEqual({ slug: "b" });
  });

  // Direct probe of the `BoundedArray::resize` contract change from #30861.
  // `FrameworkRouter` is one user of the type; this assertion targets the
  // type itself via a Rust test binding in `crash_handler_jsc.rs` so the
  // soundness guarantee is locked in independently of the router.
  test("BoundedArray::resize refuses to grow", () => {
    // Seeded with `len = 1`, then `resize(4)` asks to grow over uninit slots.
    // Pre-fix: accepted (returns `Ok`), leaving three uninit `u8`s in `[1..4]`
    // that safe `.as_slice()` would then expose as `&[u8]`. Post-fix:
    // `Err(Overflow)`.
    expect(crash_handler.boundedArrayResizeGrowReturnsErr()).toBe(true);
  });
});
