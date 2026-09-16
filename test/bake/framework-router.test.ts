import { frameworkRouterInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { existsSync } from "fs";
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

// `count` nested "[pN]" directories, and a URL path that binds a value to each of them.
function nestedParams(count: number) {
  const names = Array.from({ length: count }, (_, i) => `p${i + 1}`);
  return {
    dirs: names.map(name => `[${name}]`).join("/"),
    url: "/" + names.map(name => `${name}-value`).join("/"),
    params: Object.fromEntries(names.map(name => [name, `${name}-value`])),
  };
}

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

  test("a pattern holds 64 params and not 65", () => {
    const atLimit = nestedParams(64);
    using dir = tempDir("fsr-param-limit", { [`${atLimit.dirs}/index.tsx`]: "1" });
    const router = new FrameworkRouter({ root: String(dir), style: "nextjs-pages" });
    expect(router.match(atLimit.url)?.params).toEqual(atLimit.params);

    const overLimit = nestedParams(65);
    expect(scanErrors("nextjs-pages", { [`${overLimit.dirs}/index.tsx`]: "1" })).toEqual([
      `Invalid route "${overLimit.dirs}/index.tsx": Pattern cannot have more than 64 params`,
    ]);
  });

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

  // A route group adds no URL segment, so both files land on the same route.
  test("a route group next to the plain route", () => {
    expect(
      scanErrors("nextjs-app-ui", {
        "docs/page.tsx": "1",
        "(marketing)/docs/page.tsx": "1",
      }),
    ).toEqual([
      'Multiple pages matching the same route pattern is ambiguous: "(marketing)/docs/page.tsx" and "docs/page.tsx"',
    ]);
  });

  test("app router files that are not pages or layouts", () => {
    expect(
      scanErrors("nextjs-app-ui", {
        "page.tsx": "1",
        "loading.tsx": "1",
        "docs/not-found.tsx": "1",
        "error.tsx": "1",
      }),
    ).toEqual([
      'Invalid route "docs/not-found.tsx": Bun Bake currently does not support "not-found" files',
      'Invalid route "error.tsx": Bun Bake currently does not support "error" files',
      'Invalid route "loading.tsx": Bun Bake currently does not support "loading" files',
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

// The scan hands each error to its caller. The dev server prints it and keeps serving.
// `bun build --app` prints it and fails the build.
describe.concurrent("scan errors in the dev server and in bun build --app", () => {
  const index = `export default () => "index";`;
  const page = `export default () => "page";`;
  const tooManyParams = `pages/${nestedParams(65).dirs}/index.ts`;

  const collision = (...files: string[]) =>
    "error: Multiple pages matching the same route pattern is ambiguous\n" +
    files.map(file => `  - ${file}`).join("\n");
  // The underline and the message start below the character at `cursorAt`.
  const invalidRoute = (file: string, cursorAt: number, cursorLength: number, message: string) => {
    const indent = " ".repeat('error: "'.length + cursorAt);
    return [
      `error: "${file}" is not a valid route`,
      indent + Buffer.alloc(cursorLength - 1, "-").toString(),
      indent + message,
    ].join("\n");
  };
  const tooManyParamsReport = invalidRoute(
    tooManyParams,
    0,
    tooManyParams.length,
    "Pattern cannot have more than 64 params",
  );

  type Case = { name: string; routers: Record<string, string>; files: Record<string, string>; reports: string[] };
  const cases: Case[] = [
    {
      name: "a pattern with more than 64 params",
      routers: { pages: "nextjs-pages" },
      files: { "pages/index.ts": index, [tooManyParams]: page },
      reports: [tooManyParamsReport],
    },
    {
      name: "two files on the same route",
      routers: { pages: "nextjs-pages" },
      files: { "pages/index.ts": index, "pages/about.ts": page, "pages/about/index.ts": page },
      reports: [collision("pages/about.ts", "pages/about/index.ts")],
    },
    {
      name: "two dynamic routes with the same shape",
      routers: { pages: "nextjs-pages" },
      files: { "pages/index.ts": index, "pages/blog/[id].ts": page, "pages/blog/[slug].ts": page },
      reports: [collision("pages/blog/[id].ts", "pages/blog/[slug].ts")],
    },
    {
      name: "two routers with the same static route",
      routers: { pages: "nextjs-pages", docs: "nextjs-pages" },
      files: { "pages/index.ts": index, "pages/about.ts": page, "docs/about.ts": page },
      reports: [collision("docs/about.ts", "pages/about.ts")],
    },
    {
      name: "an app router file that is not a page or a layout",
      routers: { app: "nextjs-app-ui" },
      files: { "app/page.tsx": index, "app/loading.tsx": page },
      reports: [
        invalidRoute(
          "app/loading.tsx",
          "app/".length,
          "loading.tsx".length,
          'Bun Bake currently does not support "loading" files',
        ),
      ],
    },
    {
      name: "every error of one scan",
      routers: { pages: "nextjs-pages" },
      files: { "pages/index.ts": index, [tooManyParams]: page, "pages/[id].ts": page, "pages/[name].ts": page },
      reports: [collision("pages/[id].ts", "pages/[name].ts"), tooManyParamsReport],
    },
  ];

  // A framework that needs no packages. It serves the default export of the page module.
  const fixture = ({ routers, files }: Case) => ({
    "framework.ts": `
      export function render(request, meta) {
        return new Response(meta.pageModule.default());
      }
    `,
    "app.ts": `
      export default {
        app: {
          framework: {
            fileSystemRouterTypes: ${JSON.stringify(
              Object.entries(routers).map(([root, style]) => ({ root, style, serverEntryPoint: "./framework.ts" })),
            )},
          },
        },
      };
    `,
    "serve-fixture.ts": `
      import config from "./app.ts";
      const server = Bun.serve({ port: 0, hostname: "127.0.0.1", ...config });
      const response = await fetch(server.url);
      console.log(response.status, await response.text());
      process.exit(0);
    `,
    ...files,
  });

  // A report is an "error: " line plus the indented lines below it. The order of the reports, and of the two
  // files of a collision, follows the order in which the scan meets the files. That order is not part of the
  // contract, so both are sorted.
  function reportsOf(stderr: string): string[] {
    const reports: string[][] = [];
    let current: string[] | undefined;
    for (const line of stderr.replaceAll("\\", "/").split("\n")) {
      if (line.startsWith("error: ")) reports.push((current = [line]));
      else if (line.startsWith(" ")) current?.push(line);
      else current = undefined;
    }
    return reports
      .map(([first, ...rest]) => [first, ...(first.startsWith("error: Multiple") ? rest.sort() : rest)].join("\n"))
      .sort();
  }

  async function run(dir: string, env: typeof bunEnv, ...args: string[]) {
    await using proc = Bun.spawn({ cmd: [bunExe(), ...args], env, cwd: dir, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  // The ASAN lane runs the tests of `bun build --app` (test/bake/dev/production.test.ts) without exception check
  // validation and without LeakSanitizer: its config loader fails the validation, and its error exit leaves the
  // VM alive (test/no-validate-exceptions.txt, test/no-validate-leaksan.txt). These children get the same
  // settings. ASAN stays on.
  const buildEnv = {
    ...bunEnv,
    BUN_JSC_validateExceptionChecks: undefined,
    BUN_JSC_dumpSimulatedThrows: undefined,
    ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":"),
  };

  describe.each(cases)("$name", testCase => {
    const reports = testCase.reports.toSorted();

    test("dev server", async () => {
      using dir = tempDir("fsr-scan-errors-dev", fixture(testCase));
      const { stdout, stderr, exitCode } = await run(String(dir), bunEnv, "serve-fixture.ts");
      expect({ stdout, reports: reportsOf(stderr), exitCode }).toEqual({ stdout: "200 index\n", reports, exitCode: 0 });
    });

    test("bun build --app", async () => {
      using dir = tempDir("fsr-scan-errors-build", fixture(testCase));
      const { stderr, exitCode } = await run(String(dir), buildEnv, "build", "--app", "./app.ts", "--outdir", "./dist");
      const wroteOutput = existsSync(path.join(String(dir), "dist"));
      expect({ reports: reportsOf(stderr), exitCode, wroteOutput }).toEqual({
        reports,
        exitCode: 1,
        wroteOutput: false,
      });
    });
  });
});
