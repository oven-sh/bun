import { frameworkRouterInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import fs from "node:fs";
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

test("match() returns null for a path that doesn't start with a slash", () => {
  using dir = tempDir("fsr-match", { "blog/[slug].tsx": "1" });
  const router = new FrameworkRouter({ root: String(dir), style: "nextjs-pages" });
  expect(router.match("/blog/abc")).toMatchObject({ params: { slug: "abc" } });
  expect(router.match("")).toBeNull();
  expect(router.match("blog/abc")).toBeNull();
});

test("match() supports a param whose name is an array index", () => {
  using dir = tempDir("fsr-index-param", {
    "index.tsx": "1",
    "posts/[0]/[1].tsx": "1",
  });
  const router = new FrameworkRouter({ root: dir, style: "nextjs-pages" });
  const { params } = router.match("/posts/a/b");
  expect(params).toEqual({ 0: "a", 1: "b" });
  expect([params[0], params[1]]).toEqual(["a", "b"]);
});

// Directory links. A page behind a link is named by the path of the link. The scan does not enter
// a link, or a directory behind a link, that leads back to a directory it is already inside.

// `links` maps the path of a link to the path of its target. Both are relative to the tree.
function linkedTree(files: string[], links: Record<string, string>) {
  const dir = tempDir("framework-router-links", Object.fromEntries(files.map(file => [file, "1"])));
  for (const [at, target] of Object.entries(links)) {
    // A junction needs no privilege on Windows. Its target must be absolute.
    fs.symlinkSync(path.join(String(dir), target), path.join(String(dir), at), "junction");
  }
  return dir;
}

// The route of each page.
function pageRoutes(router: any) {
  const routes: string[] = [];
  (function visit(route: any, at: string) {
    if (route.part !== "/") at += route.part;
    if (route.page) routes.push(at);
    for (const child of route.children) visit(child, at);
  })(router.toJSON(), "");
  return routes.sort();
}

test.each<{ name: string; files: string[]; links: Record<string, string>; routes: string[] }>([
  // A link that leads back. A scan that follows it lists each page again at every level, until the
  // operating system refuses a path with so many links.
  {
    name: "a link to the root",
    files: ["pages/a.tsx"],
    links: { "pages/self": "pages" },
    routes: ["/a"],
  },
  {
    name: "a link to the root from below",
    files: ["pages/a.tsx", "pages/sub/b.tsx"],
    links: { "pages/sub/back": "pages" },
    routes: ["/a", "/sub/b"],
  },
  {
    name: "a link to the directory above the root",
    files: ["pages/a.tsx", "other/o.tsx"],
    links: { "pages/up": "." },
    routes: ["/a", "/up/other/o"],
  },
  {
    name: "two directories that link to each other",
    files: ["pages/a/p.tsx", "pages/b/q.tsx"],
    links: { "pages/a/x": "pages/b", "pages/b/y": "pages/a" },
    routes: ["/a/p", "/a/x/q", "/b/q", "/b/y/p"],
  },
  {
    name: "a directory two levels behind a link that is the target of a followed link",
    files: ["pages/a.tsx", "outside/x/y/z.tsx", "outside/w.tsx"],
    links: { "pages/in": "outside/x/y", "outside/x/y/up": "outside" },
    routes: ["/a", "/in/up/w", "/in/z"],
  },
  // What stays: the scan follows a link that does not lead back, and the path of the link is the name.
  {
    name: "a link beside its target",
    files: ["pages/real/b.tsx"],
    links: { "pages/alias": "pages/real" },
    routes: ["/alias/b", "/real/b"],
  },
  {
    name: "links to directories whose names end like the names of the directories above the links",
    files: ["pages/a/b/p.tsx", "pages/a-b/q.tsx", "pages/ab/r.tsx"],
    links: { "pages/a/b/l": "pages/a-b", "pages/a/b/m": "pages/ab" },
    routes: ["/a-b/q", "/a/b/l/q", "/a/b/m/r", "/a/b/p", "/ab/r"],
  },
])("directory links: $name", ({ files, links, routes }) => {
  using dir = linkedTree(files, links);
  const router = new FrameworkRouter({ root: path.join(String(dir), "pages"), style: "nextjs-pages" });
  expect(pageRoutes(router)).toEqual(routes);
});

// Each case scans in a child. `script` gets the root as `root` and a function `routes` that scans it.
async function scanInChild(root: string, script: string) {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      /* ts */ `
        import { frameworkRouterInternals } from "bun:internal-for-testing";
        import fs from "fs";
        import path from "path";
        const root = process.argv[1];
        const routes = () => {
          const router = new frameworkRouterInternals.FrameworkRouter({ root, style: "nextjs-pages" });
          return router.toJSON().children.map(route => route.part).sort();
        };
        ${script}
      `,
      root,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    // A scan that follows two links back does not return. The child is killed before it uses up the memory.
    timeout: 10_000,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signalCode: proc.signalCode };
}

test("directory links: the scan returns when two links lead back", async () => {
  using dir = linkedTree(["pages/a.tsx"], { "pages/x": "pages", "pages/y": "pages" });
  // With two links back, a scan that follows them reads twice as many directories at each level.
  expect(await scanInChild(path.join(String(dir), "pages"), `console.log(JSON.stringify(routes()));`)).toEqual({
    stdout: '["/a"]\n',
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });
  // More than the time after which the child is killed.
}, 30_000);

test("directory links: a directory that took the name of a link is read as a directory", async () => {
  using dir = linkedTree(["pages/a.tsx"], { "pages/x": "pages" });
  const script = /* ts */ `
    const withLink = routes();
    fs.rmSync(path.join(root, "x"), { recursive: true, force: true });
    fs.mkdirSync(path.join(root, "x"));
    fs.writeFileSync(path.join(root, "x", "b.tsx"), "1");
    // A later build makes the bundler's resolver read the listing of the root again. That read
    // keeps the entry of "x". The scan reads what the resolver has.
    let withDirectory = routes();
    for (let builds = 0; builds < 10 && withDirectory.length === 1; builds++) {
      await Bun.build({ entrypoints: [path.join(root, "a.tsx")], target: "bun" });
      withDirectory = routes();
    }
    console.log(JSON.stringify([withLink, withDirectory]));
  `;
  expect(await scanInChild(path.join(String(dir), "pages"), script)).toEqual({
    stdout: '[["/a"],["/a","/x"]]\n',
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });
});
