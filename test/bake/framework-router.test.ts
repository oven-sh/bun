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

describe("scan errors", () => {
  // Everything found while scanning is thrown at once. A collision names the file being
  // inserted first, which depends on scan order, so the two names are sorted here.
  function scanErrors(style: string, files: Record<string, string>): string[] {
    using dir = tempDir("fsr-scan-errors", files);
    let thrown: unknown;
    try {
      new FrameworkRouter({ root: String(dir), style });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as AggregateError).message).toBe("Errors scanning routes");
    return (thrown as AggregateError).errors
      .map((e: Error) =>
        e.message
          .replaceAll("\\", "/")
          .replace(/: "(.*)" and "(.*)"$/, (_, a, b) => `: "${[a, b].sort().join('" and "')}"`),
      )
      .sort();
  }

  test("two files on the same route", () => {
    expect(
      scanErrors("nextjs-pages", {
        "about.tsx": "1",
        "about/index.tsx": "1",
        "_layout.tsx": "1",
        "_layout.js": "1",
      }),
    ).toEqual([
      'Multiple layout matching the same route pattern is ambiguous: "_layout.js" and "_layout.tsx"',
      'Multiple pages matching the same route pattern is ambiguous: "about.tsx" and "about/index.tsx"',
    ]);
  });

  test("two dynamic routes with the same shape", () => {
    expect(
      scanErrors("nextjs-pages", {
        "blog/[id].tsx": "1",
        "blog/[slug].tsx": "1",
      }),
    ).toEqual(['Multiple pages matching the same route pattern is ambiguous: "blog/[id].tsx" and "blog/[slug].tsx"']);
  });

  test("a route group aliasing a static route", () => {
    expect(
      scanErrors("nextjs-app-ui", {
        "docs/page.tsx": "1",
        "(marketing)/docs/page.tsx": "1",
      }),
    ).toEqual([
      'Multiple pages matching the same route pattern is ambiguous: "(marketing)/docs/page.tsx" and "docs/page.tsx"',
    ]);
  });

  test("invalid routes and collisions are reported together", () => {
    const params = Array.from({ length: 65 }, (_, i) => `[p${i}]`).join("/");
    expect(
      scanErrors("nextjs-pages", {
        "blog-[slug].tsx": "1",
        [`${params}.tsx`]: "1",
        "[id].tsx": "1",
        "[name].tsx": "1",
      }),
    ).toEqual([
      `Invalid route "${params}.tsx": Pattern cannot have more than 64 params`,
      'Invalid route "blog-[slug].tsx": Parameters must take up the entire file name',
      'Multiple pages matching the same route pattern is ambiguous: "[id].tsx" and "[name].tsx"',
    ]);
  });
});
