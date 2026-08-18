import { frameworkRouterInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, MAX_PATH_BYTES, tempDir } from "harness";
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

// Custom router styles are not implemented: a function is rejected at option parsing, like any unknown name.
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
    expect(await run(String(dir), ["start.ts"])).toStrictEqual({
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
    const { stderr, exitCode } = await run(String(dir), ["build", "--app", "./bun.app.ts"]);
    expect(stderr).toContain(`TypeError: ${message}`);
    expect(exitCode).toBe(1);
  });
});

describe.concurrent("fileSystemRouterTypes[n].root that does not fit in a path buffer", () => {
  // Longer than MAX_PATH_BYTES on every platform.
  const tooLongRoot = `Buffer.alloc(100_000, "a").toString()`;
  // An absolute root resolves to itself, so this resolves to exactly `length` bytes; evaluated inside the fixture.
  const absoluteRootOfLength = (length: number) =>
    `(prefix => prefix + Buffer.alloc(${length} - prefix.length, "a").toString())(path.parse(process.cwd()).root)`;
  const rootError = (index: number) =>
    `ENAMETOOLONG: Failed to resolve 'fileSystemRouterTypes[${index}].root' for framework: the resolved path must be shorter than ${MAX_PATH_BYTES} bytes`;
  const rejected = "threw: Framework is missing required files!";

  const serverEntryPoint = `
    export function render(req, meta) {
      return meta.pageModule.default(req, meta);
    }
  `;
  const appWithRoots = (...roots: string[]) => `{
    app: {
      framework: {
        fileSystemRouterTypes: [
          ${roots.map(root => `{ root: ${root}, style: "nextjs-pages", serverEntryPoint: "./server.ts" },`).join("\n")}
        ],
      },
    },
  }`;
  // Prints one line per attempt: "started" if Bun.serve accepted the options, "threw: <message>" otherwise.
  const serveFixture = (...attempts: string[]) => `
    import path from "path";
    for (const options of [${attempts.join(", ")}]) {
      try {
        const server = Bun.serve({ port: 0, development: true, ...options, fetch: () => new Response("") });
        server.stop(true);
        console.log("started");
      } catch (e) {
        console.log("threw: " + e.message);
      }
    }
  `;

  const buildFixture = (root: string) => ({
    "server.ts": serverEntryPoint,
    "bun.app.ts": `
      import path from "path";
      export default ${appWithRoots(root)};
    `,
  });

  const build = (dir: string) => run(dir, ["build", "--app"]);

  test("the internal FrameworkRouter constructor throws instead of crashing", () => {
    const prefix = path.parse(process.cwd()).root;
    const root = prefix + Buffer.alloc(MAX_PATH_BYTES - prefix.length, "a").toString();
    expect(() => new FrameworkRouter({ root, style: "nextjs-pages" })).toThrow(
      `options.root must resolve to a path shorter than ${MAX_PATH_BYTES} bytes`,
    );
  });

  // Windows' own path limit is below MAX_PATH_BYTES, so such a tree cannot be created there.
  test.skipIf(isWindows)("scanning a root skips the entries whose paths do not fit instead of crashing", () => {
    using dir = tempDir("fsr-scan-long-entries", {});
    // About 200 bytes below the limit: the root's own short files fit, entries with a maximum-length name do not.
    let root = String(dir);
    while (root.length < MAX_PATH_BYTES - 200) {
      const part = Math.max(1, Math.min(200, MAX_PATH_BYTES - 200 - root.length - 1));
      root = path.join(root, Buffer.alloc(part, "d").toString());
    }
    mkdirSync(root, { recursive: true });
    writeFileSync(path.join(root, "index.ts"), "");
    // The OS rejects their absolute paths too, so these can only be created relative to the root.
    const longName = Buffer.alloc(252, "x").toString();
    const create = Bun.spawnSync({
      cmd: [
        bunExe(),
        "-e",
        `
          import { mkdirSync, writeFileSync } from "fs";
          writeFileSync(${JSON.stringify(`${longName}.ts`)}, "");
          mkdirSync(${JSON.stringify(`${longName}dir`)});
          writeFileSync(${JSON.stringify(`${longName}dir/index.ts`)}, "");
        `,
      ],
      cwd: root,
      env: bunEnv,
    });
    expect(create.stderr.toString()).toBe("");
    expect(create.exitCode).toBe(0);

    const router = new FrameworkRouter({ root, style: "nextjs-pages" });
    expect(router.toJSON()).toStrictEqual({ part: "/", page: path.join(root, "index.ts"), layout: null, children: [] });
  });

  test("Bun.serve({ app }) reports every root that does not fit instead of crashing", async () => {
    using dir = tempDir("fsr-long-root-app", {
      "server.ts": serverEntryPoint,
      "start.ts": serveFixture(appWithRoots(tooLongRoot, `"/" + ${tooLongRoot}`)),
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["start.ts"]);
    expect(stderr).toContain(rootError(0));
    expect(stderr).toContain(rootError(1));
    expect(stdout).toBe(`${rejected}\n`);
    expect(exitCode).toBe(0);
  });

  test("Bun.serve({ routes: { '/*': { dir, style } } }) reports the root instead of crashing", async () => {
    using dir = tempDir("fsr-long-root-routes", {
      "start.ts": serveFixture(`{ routes: { "/*": { dir: ${tooLongRoot}, style: "nextjs-pages" } } }`),
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["start.ts"]);
    expect(stderr).toContain(rootError(0));
    expect(stdout).toBe(`${rejected}\n`);
    expect(exitCode).toBe(0);
  });

  test("Bun.serve({ app }) accepts a root one byte below the limit and rejects one at the limit", async () => {
    using dir = tempDir("fsr-root-at-limit-app", {
      "server.ts": serverEntryPoint,
      "start.ts": serveFixture(
        // The directory does not exist, so the accepted root is skipped like any other missing root.
        appWithRoots(absoluteRootOfLength(MAX_PATH_BYTES - 1)),
        appWithRoots(absoluteRootOfLength(MAX_PATH_BYTES)),
      ),
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["start.ts"]);
    expect(stdout).toBe(`started\n${rejected}\n`);
    expect(stderr).toContain(rootError(0));
    expect(stderr.match(/ENAMETOOLONG/g) ?? []).toHaveLength(1);
    expect(exitCode).toBe(0);
  });

  test("bun build --app fails on a root at the limit instead of crashing", async () => {
    using dir = tempDir("fsr-root-at-limit-build", buildFixture(absoluteRootOfLength(MAX_PATH_BYTES)));
    const { stderr, exitCode } = await build(String(dir));
    expect(stderr).toContain(rootError(0));
    expect(exitCode).toBe(1);
  });

  test("bun build --app looks up a root one byte below the limit like any other missing directory", async () => {
    using dir = tempDir("fsr-root-below-limit-build", buildFixture(absoluteRootOfLength(MAX_PATH_BYTES - 1)));
    const { stdout, stderr, exitCode } = await build(String(dir));
    expect(stderr).not.toContain("ENAMETOOLONG");
    expect(stderr).toContain("Bundling routes");
    expect(stdout).toContain("done");
    expect(exitCode).toBe(0);
  });

  test("a root that only normalizes down to a path that fits is served", async () => {
    using dir = tempDir("fsr-long-root-normalizes", {
      "server.ts": serverEntryPoint,
      "routes/index.ts": `export default () => new Response("hello from routes");`,
      "start.ts": `
        // 100 KB as written, "routes" once the ".." segments are resolved.
        const root = "routes" + Buffer.alloc(100_000, "/../routes").toString();
        using server = Bun.serve({
          port: 0,
          development: true,
          ...${appWithRoots("root")},
          fetch: () => new Response("not routed", { status: 404 }),
        });
        const res = await fetch(\`http://localhost:\${server.port}/\`);
        console.log(res.status, await res.text());
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["start.ts"]);
    expect(stderr).not.toContain("ENAMETOOLONG");
    expect(stdout).toBe("200 hello from routes\n");
    expect(exitCode).toBe(0);
  });
});

describe("url matching", () => {
  // Builds a router over `files`; match(url) is normalized to { file: <relative page path>, params } or null.
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
      [Symbol.dispose]() {
        dir[Symbol.dispose]();
      },
    };
  };

  test("every dynamic segment must be present in the url", () => {
    using r = makeMatcher("[category]/[year]/[slug].tsx");
    expect(r.match("/a/b/c")).toStrictEqual({
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
    expect(r.match("/first-post")).toStrictEqual({
      file: "[slug].tsx",
      params: { slug: "first-post" },
    });
    expect(r.match("/a/b/c")).toStrictEqual({
      file: "[category]/[year]/[slug].tsx",
      params: { category: "a", year: "b", slug: "c" },
    });
  });

  test("params never match an empty segment", () => {
    using r = makeMatcher("[slug].tsx", "a/[b].tsx");
    expect(r.match("/")).toBe(null);
    expect(r.match("//")).toBe(null);
    expect(r.match("/a//")).toBe(null);
    expect(r.match("/a/b")).toStrictEqual({ file: "a/[b].tsx", params: { b: "b" } });
  });

  test("required catch-all needs at least one segment", () => {
    using r = makeMatcher("docs/[...slug].tsx");
    expect(r.match("/docs")).toBe(null);
    expect(r.match("/docs/")).toBe(null);
    expect(r.match("/docs/a")).toStrictEqual({
      file: "docs/[...slug].tsx",
      params: { slug: "a" },
    });
    expect(r.match("/docs/a/b")).toStrictEqual({
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
    expect(r.match("/docs/x/y")).toStrictEqual({
      file: "docs/[section]/[...rest].tsx",
      params: { section: "x", rest: "y" },
    });
    expect(r.match("/docs/x/y/z")).toStrictEqual({
      file: "docs/[section]/[...rest].tsx",
      params: { section: "x", rest: ["y", "z"] },
    });
  });

  test("param followed by an optional catch-all with zero segments", () => {
    using r = makeMatcher("[a]/[[...opt]].tsx");
    expect(r.match("/v")).toStrictEqual({ file: "[a]/[[...opt]].tsx", params: { a: "v" } });
    expect(r.match("/v/w")).toStrictEqual({ file: "[a]/[[...opt]].tsx", params: { a: "v", opt: "w" } });
  });

  test("required catch-all at the root does not match /", () => {
    using r = makeMatcher("[...slug].tsx");
    expect(r.match("/")).toBe(null);
    expect(r.match("/a/b")).toStrictEqual({
      file: "[...slug].tsx",
      params: { slug: ["a", "b"] },
    });
  });

  test("dynamic pattern ending in a static segment matches without a trailing slash", () => {
    using r = makeMatcher("[user]/posts.tsx");
    expect(r.match("/joe/posts")).toStrictEqual({ file: "[user]/posts.tsx", params: { user: "joe" } });
    expect(r.match("/joe/posts/")).toStrictEqual({ file: "[user]/posts.tsx", params: { user: "joe" } });
    expect(r.match("/joe")).toBe(null);
    expect(r.match("/joe/other")).toBe(null);
    expect(r.match("/joe/posts/extra")).toBe(null);
  });

  test("a failed candidate's captures don't leak into a later zero-segment match", () => {
    using r = makeMatcher("[category]/[year]/[slug].tsx", "blog/[[...slug]].tsx");
    expect(r.match("/blog")).toStrictEqual({ file: "blog/[[...slug]].tsx", params: null });
  });

  test("match rejects a path that is empty or does not start with a slash", () => {
    using r = makeMatcher("docs/[...slug].tsx");
    expect(() => r.router.match("")).toThrow("should be non-empty and start with a slash");
    expect(() => r.router.match("docs/a")).toThrow("should be non-empty and start with a slash");
  });

  test("optional catch-all matches zero segments", () => {
    using r = makeMatcher("blog/[[...slug]].tsx");
    expect(r.match("/blog")).toStrictEqual({ file: "blog/[[...slug]].tsx", params: null });
    expect(r.match("/blog/")).toStrictEqual({ file: "blog/[[...slug]].tsx", params: null });
    expect(r.match("/blog/a")).toStrictEqual({
      file: "blog/[[...slug]].tsx",
      params: { slug: "a" },
    });
    expect(r.match("/blog/a/b")).toStrictEqual({
      file: "blog/[[...slug]].tsx",
      params: { slug: ["a", "b"] },
    });
    // One trailing slash is tolerated, an empty segment is not.
    expect(r.match("/blog//")).toBe(null);
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

  // The file names in each case are chosen so that the directory scan visits the losing route first.
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
      { "/": "[[...rest]].tsx", "/a": "[slug].tsx", "/a/b": "[[...rest]].tsx" },
    ],
    [
      "a catch-all beats an optional catch-all",
      ["[...slug].tsx", "[[...slug]].tsx"],
      { "/": "[[...slug]].tsx", "/a": "[...slug].tsx", "/a/b": "[...slug].tsx" },
    ],
    [
      "a catch-all beats an optional catch-all after a shared static segment",
      ["docs/[...rest].tsx", "docs/[[...opt]].tsx"],
      { "/docs": "docs/[[...opt]].tsx", "/docs/a": "docs/[...rest].tsx" },
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
    expect(servedBy(files, Object.keys(expected))).toStrictEqual(expected);
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
      "/": "[[...opt]].tsx",
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
    expect(servedBy(files, Object.keys(expected))).toStrictEqual(expected);
  });
});

describe("scan errors", () => {
  // A collision names the file being inserted first, which depends on scan order, so the two names are sorted here.
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
    ).toStrictEqual([
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
    ).toStrictEqual([
      'Multiple pages matching the same route pattern is ambiguous: "blog/[id].tsx" and "blog/[slug].tsx"',
    ]);
  });

  // A route group adds no URL segment, so both files land on the same route.
  test("a route group next to the plain route", () => {
    expect(
      scanErrors("nextjs-app-ui", {
        "docs/page.tsx": "1",
        "(marketing)/docs/page.tsx": "1",
      }),
    ).toStrictEqual([
      'Multiple pages matching the same route pattern is ambiguous: "(marketing)/docs/page.tsx" and "docs/page.tsx"',
    ]);
  });

  test("app router files that are not pages or layouts", () => {
    expect(
      scanErrors("nextjs-app-ui", {
        "page.tsx": "1",
        "loading.tsx": "1",
        "docs/not-found.tsx": "1",
        // A plain error.tsx on Windows; on POSIX a name starting with ".\\" that the scan normalizes away.
        ".\\error.tsx": "1",
      }),
    ).toStrictEqual([
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
    ).toStrictEqual([
      `Invalid route "${params}.tsx": Pattern cannot have more than 64 params`,
      'Invalid route "blog-[slug].tsx": Parameters must take up the entire file name',
      'Multiple pages matching the same route pattern is ambiguous: "[id].tsx" and "[name].tsx"',
    ]);
  });
});
