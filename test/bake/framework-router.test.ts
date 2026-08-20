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

test("match() releases the param strings it creates", async () => {
  using dir = tempDir("fsr-params-leak", {
    "[a]/[b]/[c]/[d].tsx": "1",
  });

  // Each matched param value is copied into a WTF string that the JS string
  // then refs; the copy's own ref has to be released or every match leaks all
  // four values (4 x 256 KiB here, about 200 MiB over the measured loop).
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "--smol",
      "-e",
      /* js */ `
        const { frameworkRouterInternals } = require("bun:internal-for-testing");
        const rss = process.platform === "darwin" && typeof Bun.unsafe.memoryFootprint === "function" ? Bun.unsafe.memoryFootprint : process.memoryUsage.rss;
        const router = new frameworkRouterInternals.FrameworkRouter({ root: ${JSON.stringify(String(dir))}, style: "nextjs-pages" });
        const segment = Buffer.alloc(256 * 1024, "x").toString();
        const url = "/" + segment + "/" + segment + "/" + segment + "/" + segment;
        const lengths = {};
        for (const [name, value] of Object.entries(router.match(url).params)) lengths[name] = value.length;
        console.log(JSON.stringify(lengths));
        for (let i = 0; i < 20; i++) router.match(url);
        Bun.gc(true);
        const before = rss();
        for (let i = 0; i < 200; i++) router.match(url);
        Bun.gc(true);
        const growthMB = (rss() - before) / 1024 / 1024;
        if (growthMB > 64) throw new Error("leaked " + growthMB.toFixed(2) + "MB");
      `,
    ],
    env: {
      ...bunEnv,
      // Under ASAN freed allocations sit in the quarantine (default
      // quarantine_size_mb=256) instead of leaving RSS, which would hide the
      // difference between releasing and leaking. Ignored by non-ASAN builds.
      ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "quarantine_size_mb=0"].filter(Boolean).join(":"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: '{"a":262144,"b":262144,"c":262144,"d":262144}\n',
    stderr: "",
    exitCode: 0,
  });
});
