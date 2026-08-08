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

describe("url matching", () => {
  // Builds a router over `files` and returns match(url) normalized to
  // { file: <relative page path>, params } or null for no match.
  const makeMatcher = (...files: string[]) => {
    const dir = tempDir("fsr-match", Object.fromEntries(files.map(file => [file, "1"])));
    const router = new FrameworkRouter({ root: String(dir), style: "nextjs-pages" });
    return {
      router,
      match(url: string): { file: string; params: Record<string, string | string[]> | null } | null {
        const result = router.match(url);
        if (result === null) return null;
        return {
          file: path.relative(String(dir), result.route.page).replaceAll("\\", "/"),
          params: result.params,
        };
      },
      /** Top-level route parts in scan order (= dynamic candidate order). */
      rootParts(): string[] {
        return router.toJSON().children.map((child: { part: string }) => child.part);
      },
      [Symbol.dispose]() {
        dir[Symbol.dispose]();
      },
    };
  };

  test("every dynamic segment must be present in the url", () => {
    using r = makeMatcher("[category]/[year]/[slug].tsx");
    expect(r.match("/a/b/c")).toEqual({
      file: "[category]/[year]/[slug].tsx",
      params: { category: "a", year: "b", slug: "c" },
    });
    // Missing segments must not match as empty params.
    expect(r.match("/first-post")).toBe(null);
    expect(r.match("/a/b")).toBe(null);
    expect(r.match("/a/b/c/d")).toBe(null);
  });

  test("a url with fewer segments matches the shorter pattern, not a longer one with empty params", () => {
    using r = makeMatcher("[slug].tsx", "[category]/[year]/[slug].tsx");
    expect(r.match("/first-post")).toEqual({
      file: "[slug].tsx",
      params: { slug: "first-post" },
    });
    expect(r.match("/a/b/c")).toEqual({
      file: "[category]/[year]/[slug].tsx",
      params: { category: "a", year: "b", slug: "c" },
    });
  });

  test("params never match an empty segment", () => {
    using r = makeMatcher("[slug].tsx", "a/[b].tsx");
    expect(r.match("/")).toBe(null);
    expect(r.match("//")).toBe(null);
    expect(r.match("/a//")).toBe(null);
    expect(r.match("/a/b")).toEqual({ file: "a/[b].tsx", params: { b: "b" } });
  });

  test("required catch-all needs at least one segment", () => {
    using r = makeMatcher("docs/[...slug].tsx");
    expect(r.match("/docs")).toBe(null);
    expect(r.match("/docs/")).toBe(null);
    expect(r.match("/docs/a")).toEqual({
      file: "docs/[...slug].tsx",
      params: { slug: "a" },
    });
    expect(r.match("/docs/a/b")).toEqual({
      file: "docs/[...slug].tsx",
      params: { slug: ["a", "b"] },
    });
    // Empty segments never match, same as params.
    expect(r.match("/docs//")).toBe(null);
    expect(r.match("/docs//a")).toBe(null);
    expect(r.match("/docs/a//b")).toBe(null);
  });

  test("params capture before a required catch-all", () => {
    using r = makeMatcher("docs/[section]/[...rest].tsx");
    expect(r.match("/docs/x")).toBe(null);
    expect(r.match("/docs/x/")).toBe(null);
    expect(r.match("/docs/x/y")).toEqual({
      file: "docs/[section]/[...rest].tsx",
      params: { section: "x", rest: "y" },
    });
    expect(r.match("/docs/x/y/z")).toEqual({
      file: "docs/[section]/[...rest].tsx",
      params: { section: "x", rest: ["y", "z"] },
    });
  });

  test("param followed by an optional catch-all with zero segments", () => {
    using r = makeMatcher("[a]/[[...opt]].tsx");
    expect(r.match("/v")).toEqual({ file: "[a]/[[...opt]].tsx", params: { a: "v" } });
    expect(r.match("/v/w")).toEqual({ file: "[a]/[[...opt]].tsx", params: { a: "v", opt: "w" } });
  });

  test("required catch-all at the root does not match /", () => {
    using r = makeMatcher("[...slug].tsx");
    expect(r.match("/")).toBe(null);
    expect(r.match("/a/b")).toEqual({
      file: "[...slug].tsx",
      params: { slug: ["a", "b"] },
    });
  });

  test("dynamic pattern ending in a static segment matches without a trailing slash", () => {
    using r = makeMatcher("[user]/posts.tsx");
    expect(r.match("/joe/posts")).toEqual({ file: "[user]/posts.tsx", params: { user: "joe" } });
    expect(r.match("/joe/posts/")).toEqual({ file: "[user]/posts.tsx", params: { user: "joe" } });
    expect(r.match("/joe")).toBe(null);
    expect(r.match("/joe/other")).toBe(null);
    expect(r.match("/joe/posts/extra")).toBe(null);
  });

  test("a failed candidate's captures don't leak into a later zero-segment match", () => {
    using r = makeMatcher("[category]/[year]/[slug].tsx", "blog/[[...slug]].tsx");
    // Premise: candidates run in scan order, so the three-param pattern must
    // come first for this test to exercise the leak (it captures
    // category="blog", fails on [year], then the catch-all matches with zero
    // segments). If this assert breaks, reorder or rename the routes.
    expect(r.rootParts()).toEqual(["/:category", "/blog"]);
    expect(r.match("/blog")).toEqual({ file: "blog/[[...slug]].tsx", params: null });
  });

  test("match rejects a path that is empty or does not start with a slash", () => {
    using r = makeMatcher("docs/[...slug].tsx");
    expect(() => r.router.match("")).toThrow("should be non-empty and start with a slash");
    expect(() => r.router.match("docs/a")).toThrow("should be non-empty and start with a slash");
  });

  test("optional catch-all matches zero segments", () => {
    using r = makeMatcher("blog/[[...slug]].tsx");
    expect(r.match("/blog")).toEqual({ file: "blog/[[...slug]].tsx", params: null });
    expect(r.match("/blog/")).toEqual({ file: "blog/[[...slug]].tsx", params: null });
    expect(r.match("/blog/a")).toEqual({
      file: "blog/[[...slug]].tsx",
      params: { slug: "a" },
    });
    expect(r.match("/blog/a/b")).toEqual({
      file: "blog/[[...slug]].tsx",
      params: { slug: ["a", "b"] },
    });
    // One trailing slash is tolerated, an empty segment is not.
    expect(r.match("/blog//")).toBe(null);
  });
});
