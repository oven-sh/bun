import { FileSystemRouter } from "bun";
import { describe, expect, it } from "bun:test";
import fs, { mkdirSync, rmSync } from "fs";
import {
  bunEnv,
  bunExe,
  isASAN,
  isDebug,
  isLinux,
  isMacOS,
  isWindows,
  normalizeBunSnapshot,
  tempDir,
  tmpdirSync,
  unprivilegedSpawnOptions,
} from "harness";
import path, { dirname } from "path";

function createTree(basedir: string, paths: string[]) {
  for (const end of paths) {
    const abs = path.join(basedir, end);
    try {
      const dir = dirname(abs);
      if (dir.length > 0 && dir !== "/") fs.mkdirSync(dir, { recursive: true });
    } catch (e) {}
    fs.writeFileSync(abs, "export default " + JSON.stringify(end) + ";\n");
  }
}
var count = 0;
function make(files: string[]) {
  const dir = tmpdirSync().replaceAll("\\", "/");
  rmSync(dir, {
    recursive: true,
    force: true,
  });

  createTree(dir, files);
  if (files.length === 0) mkdirSync(dir, { recursive: true });
  return {
    dir,
  };
}

it("should find files", () => {
  const { dir } = make([
    `index.tsx`,
    `[id].tsx`,
    `a.tsx`,
    `abc/index.tsx`,
    `abc/[id].tsx`,
    `abc/def/[id].tsx`,
    `abc/def/ghi/index.tsx`,
    `abc/def/ghi/[id].tsx`,
    `abc/def/ghi/jkl/index.tsx`,
    `abc/def/ghi/jkl/[id].tsx`,
    `abc/def/index.tsx`,
    `b.tsx`,
    `foo/[id].tsx`,
    `catch-all/[[...id]].tsx`,

    // https://github.com/oven-sh/bun/issues/8276
    // https://github.com/oven-sh/bun/issues/8278
    ...Array.from({ length: 65 }, (_, i) => `files/a${i}.tsx`),
  ]);

  const router = new FileSystemRouter({
    dir,
    fileExtensions: [".tsx"],
    style: "nextjs",
  });

  const routes = router.routes;
  const fixture: Record<string, string> = {
    "/": `${dir}/index.tsx`,
    "/[id]": `${dir}/[id].tsx`,
    "/a": `${dir}/a.tsx`,
    "/abc": `${dir}/abc/index.tsx`,
    "/abc/[id]": `${dir}/abc/[id].tsx`,
    "/abc/def/[id]": `${dir}/abc/def/[id].tsx`,
    "/abc/def/ghi": `${dir}/abc/def/ghi/index.tsx`,
    "/abc/def/ghi/[id]": `${dir}/abc/def/ghi/[id].tsx`,
    "/abc/def/ghi/jkl": `${dir}/abc/def/ghi/jkl/index.tsx`,
    "/abc/def/ghi/jkl/[id]": `${dir}/abc/def/ghi/jkl/[id].tsx`,
    "/abc/def": `${dir}/abc/def/index.tsx`,
    "/b": `${dir}/b.tsx`,
    "/foo/[id]": `${dir}/foo/[id].tsx`,
    "/catch-all/[[...id]]": `${dir}/catch-all/[[...id]].tsx`,

    // https://github.com/oven-sh/bun/issues/8276
    // https://github.com/oven-sh/bun/issues/8278
    ...Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`/files/a${i}`, `${dir}/files/a${i}.tsx`])),
  };

  for (const route in fixture) {
    if (!(route in routes)) {
      throw new Error(`Route ${route} not found`);
    }

    expect(routes[route]).toBe(fixture[route]);
  }

  expect(Object.keys(routes).length).toBe(Object.keys(fixture).length);
  expect(Object.values(routes).length).toBe(Object.values(fixture).length);
});

it("should handle routes under GC pressure", () => {
  // Regression test for BUN-1K54: fromEntries used ObjectInitializationScope
  // with putDirect, which could crash when GC triggers during string allocation.
  const files = Array.from({ length: 128 }, (_, i) => `route${i}/index.tsx`);
  const { dir } = make(files);

  const router = new FileSystemRouter({
    dir,
    fileExtensions: [".tsx"],
    style: "nextjs",
  });

  // Access routes repeatedly with GC pressure to exercise the fromEntries path
  for (let i = 0; i < 10; i++) {
    Bun.gc(true);
    const routes = router.routes;
    const keys = Object.keys(routes);
    expect(keys.length).toBe(128);
    for (let j = 0; j < 128; j++) {
      expect(routes[`/route${j}`]).toBe(`${dir}/route${j}/index.tsx`);
    }
  }
});

it("should handle empty dirs", () => {
  const { dir } = make([]);

  const router = new FileSystemRouter({
    dir,
    fileExtensions: [".tsx"],
    style: "nextjs",
  });

  // assert this doesn't crash
  // @ts-ignore
  expect(router.bar).toBeUndefined();

  const routes = router.routes;
  expect(Object.keys(routes).length).toBe(0);
  expect(Object.values(routes).length).toBe(0);
});

it("should match dynamic routes", () => {
  // set up the test
  const { dir } = make(["index.tsx", "posts/[id].tsx", "posts.tsx"]);

  const router = new Bun.FileSystemRouter({
    dir,
    style: "nextjs",
  });

  const { name, filePath } = router.match("/posts/hello-world")!;

  expect(name).toBe("/posts/[id]");
  expect(filePath).toBe(`${dir}/posts/[id].tsx`);
});

it(".params works on dynamic routes", () => {
  // set up the test
  const { dir } = make(["index.tsx", "posts/[id].tsx", "posts.tsx"]);

  const router = new Bun.FileSystemRouter({
    dir,
    style: "nextjs",
  });

  const {
    params: { id },
  } = router.match("/posts/hello-world")!;

  expect(id).toBe("hello-world");
});

it("should support static routes", () => {
  // set up the test
  const { dir } = make(["index.tsx", "posts/[id].tsx", "posts.tsx", "posts/hey.tsx"]);

  const router = new Bun.FileSystemRouter({
    dir,
    style: "nextjs",
  });

  const { name, params, filePath } = router.match("/posts/hey")!;

  expect(name).toBe("/posts/hey");
  expect(filePath).toBe(`${dir}/posts/hey.tsx`);
});

it("should support optional catch-all routes", () => {
  // set up the test
  const { dir } = make(["index.tsx", "posts/[id].tsx", "posts.tsx", "posts/hey.tsx", "posts/[[...id]].tsx"]);

  const router = new Bun.FileSystemRouter({
    dir,
    style: "nextjs",
  });

  for (let fixture of ["/posts/123", "/posts/hey", "/posts/zorp", "/posts", "/index", "/posts/"]) {
    expect(router.match(fixture)?.name).not.toBe("/posts/[[...id]]");
  }

  for (let fixture of ["/posts/hey/there", "/posts/hey/there/you", "/posts/zorp/123"]) {
    const { name, params, filePath } = router.match(fixture)!;

    expect(name).toBe("/posts/[[...id]]");
    expect(filePath).toBe(`${dir}/posts/[[...id]].tsx`);
    expect(params.id).toBe(fixture.split("/").slice(2).join("/"));
  }
});

it("should support catch-all routes", () => {
  // set up the test
  const { dir } = make([
    "index.tsx",
    "posts/[id].tsx",
    "posts.tsx",
    "posts/hey.tsx",
    "posts/[...id].tsx",
    "posts/wow/[[...id]].tsx",
  ]);

  const router = new Bun.FileSystemRouter({
    dir,
    style: "nextjs",
  });

  for (let fixture of ["/posts/123", "/posts/hey", "/posts/zorp", "/posts", "/index", "/posts/"]) {
    const match = router.match(fixture);
    expect(match?.name).not.toBe("/posts/[...id]");
  }

  for (let fixture of ["/posts/hey/there", "/posts/hey/there/you", "/posts/zorp/123", "/posts/wow/hey/there"]) {
    const { name, params, filePath } = router.match(fixture)!;

    expect(name).toBe("/posts/[...id]");
    expect(filePath).toBe(`${dir}/posts/[...id].tsx`);
    expect(params.id).toBe(fixture.split("/").slice(2).join("/"));
  }
});

it("should support index routes", () => {
  // set up the test
  const { dir } = make(["index.tsx", "posts/[id].tsx", "posts.tsx", "posts/hey.tsx"]);

  const router = new Bun.FileSystemRouter({
    dir,
    style: "nextjs",
  });

  for (let route of ["/", "/index"]) {
    const { name, params, filePath } = router.match(route)!;

    expect(name).toBe("/");
    expect(filePath).toBe(`${dir}/index.tsx`);
    expect(Object.keys(params).length).toBe(0);
  }

  for (let route of ["/posts", "/posts/index", "/posts/"]) {
    const { name, params, filePath } = router.match(route)!;

    expect(name).toBe("/posts");
    expect(filePath).toBe(`${dir}/posts.tsx`);
    expect(Object.keys(params).length).toBe(0);
  }
});

it("should support Request", async () => {
  // set up the test
  const { dir } = make(["index.tsx", "posts/[id].tsx", "posts.tsx"]);

  const router = new Bun.FileSystemRouter({
    dir,
    style: "nextjs",
  });

  for (let current of [
    new Request({ url: "https://example.com123/posts/hello-world" }),
    new Request({ url: "http://example.com/posts/hello-world" }),
  ]) {
    const {
      name,
      params: { id },
      filePath,
    } = router.match(current)!;
    expect(name).toBe("/posts/[id]");
    expect(filePath).toBe(`${dir}/posts/[id].tsx`);
    expect(id).toBe("hello-world");
  }
});

it("assetPrefix, src, and origin", async () => {
  // set up the test
  const { dir } = make(["index.tsx", "posts/[id].tsx", "posts.tsx"]);

  const router = new Bun.FileSystemRouter({
    dir,
    style: "nextjs",
    assetPrefix: "/_next/static/",
    origin: "https://nextjs.org",
  });

  for (let current of [
    // Reuqest
    new Request({ url: "http://helloooo.com/posts/hello-world" }),
    new Request({ url: "https://nextjs.org/posts/hello-world" }),
  ]) {
    const {
      name,
      src,
      filePath,
      // @ts-ignore
      checkThisDoesntCrash,
    } = router.match(current)!;
    expect(name).toBe("/posts/[id]");

    // check nothing is weird on the MatchedRoute object
    expect(checkThisDoesntCrash).toBeUndefined();

    expect(src).toBe("https://nextjs.org/_next/static/posts/[id].tsx");
    expect(filePath).toBe(`${dir}/posts/[id].tsx`);
  }
});

it("src keeps a protocol-relative origin and a one-character host", () => {
  using dir = tempDir("fsr-origin", {
    "pages/index.tsx": "export default 1;",
    "pages/posts/[id].tsx": "export default 1;",
  });

  const srcFor = (origin: string) =>
    new Bun.FileSystemRouter({
      dir: path.join(String(dir), "pages"),
      style: "nextjs",
      assetPrefix: "/_next/static/",
      origin,
    }).match("/posts/hello-world")!.src;

  // `//host` used to parse with an empty host, and so did `a/` (any second byte
  // of `/` was taken as the start of a protocol-relative URL). Both silently
  // dropped the origin and the assetPrefix from `src`.
  expect({
    "//nextjs.org": srcFor("//nextjs.org"),
    "//nextjs.org:8080": srcFor("//nextjs.org:8080"),
    "//nextjs.org/ignored": srcFor("//nextjs.org/ignored"),
    "a/": srcFor("a/"),
    "https://nextjs.org/ignored": srcFor("https://nextjs.org/ignored"),
    "nextjs.org:8080": srcFor("nextjs.org:8080"),
    "ab/": srcFor("ab/"),
  }).toEqual({
    "//nextjs.org": "//nextjs.org/_next/static/posts/[id].tsx",
    "//nextjs.org:8080": "//nextjs.org:8080/_next/static/posts/[id].tsx",
    "//nextjs.org/ignored": "//nextjs.org/_next/static/posts/[id].tsx",
    "a/": "a/_next/static/posts/[id].tsx",
    "https://nextjs.org/ignored": "https://nextjs.org/_next/static/posts/[id].tsx",
    "nextjs.org:8080": "nextjs.org:8080/_next/static/posts/[id].tsx",
    "ab/": "ab/_next/static/posts/[id].tsx",
  });
});

it(".query works", () => {
  // set up the test
  const { dir } = make(["posts.tsx"]);

  const router = new Bun.FileSystemRouter({
    dir,
    style: "nextjs",
    assetPrefix: "/_next/static/",
    origin: "https://nextjs.org",
  });

  for (let [current, object] of [
    [new URL("https://example.com/posts?hello=world").href, { hello: "world" }],
    [new URL("https://example.com/posts?hello=world&second=2").href, { hello: "world", second: "2" }],
    [
      new URL("https://example.com/posts?hello=world&second=2&third=3").href,
      { hello: "world", second: "2", third: "3" },
    ],
    [new URL("https://example.com/posts").href, {}],
  ] as const) {
    const {
      name,
      src,
      filePath,
      // @ts-ignore
      checkThisDoesntCrash,
      query,
    } = router.match(current)!;
    expect(name).toBe("/posts");

    // check nothing is weird on the MatchedRoute object
    expect(checkThisDoesntCrash).toBeUndefined();

    expect(JSON.stringify(query)).toBe(JSON.stringify(object));
    expect(filePath).toBe(`${dir}/posts.tsx`);
  }
});

it(".query skips empty-key pairs instead of terminating the parse", () => {
  const { dir } = make(["posts.tsx", "posts/[id].tsx"]);

  const router = new Bun.FileSystemRouter({
    dir,
    style: "nextjs",
  });

  // An empty-key pair ("=value") should be skipped, not treated as end-of-query.
  // Previously "?=v&x=1&y=2" yielded {} and "?x=1&=v&y=2" dropped y.
  for (const [current, expected] of [
    ["/posts?x=1&y=2", { x: "1", y: "2" }],
    ["/posts?=v&x=1&y=2", { x: "1", y: "2" }],
    ["/posts?x=1&=v&y=2", { x: "1", y: "2" }],
    ["/posts?x=1&y=2&=v", { x: "1", y: "2" }],
    ["/posts?=v", {}],
    ["/posts?=&x=1", { x: "1" }],
    ["/posts?==&x=1", { x: "1" }],
    ["/posts?=v&=w&x=1", { x: "1" }],
    ["/posts?&&&x=1", { x: "1" }],
    ["/posts?a=%20&=v&b=2", { a: " ", b: "2" }],
  ] as const) {
    expect({ input: current, query: router.match(current)!.query }).toEqual({ input: current, query: expected });
  }

  // Same scanner is used when path params are present (init_with_scanner path).
  for (const [current, expected] of [
    ["/posts/123?=v&x=1&y=2", { id: "123", x: "1", y: "2" }],
    ["/posts/123?x=1&=v&y=2", { id: "123", x: "1", y: "2" }],
  ] as const) {
    expect({ input: current, query: router.match(current)!.query }).toEqual({ input: current, query: expected });
  }
});

it("reload() works", () => {
  // set up the test
  const { dir } = make(["posts.tsx"]);

  const router = new Bun.FileSystemRouter({
    dir,
    style: "nextjs",
    assetPrefix: "/_next/static/",
    origin: "https://nextjs.org",
  });

  expect(router.match("/posts")!.name).toBe("/posts");
  router.reload();
  expect(router.match("/posts")!.name).toBe("/posts");
});

it("reload() works with new dirs/files", () => {
  const { dir } = make(["posts.tsx"]);

  const router = new Bun.FileSystemRouter({
    dir,
    style: "nextjs",
    assetPrefix: "/_next/static/",
    origin: "https://nextjs.org",
  });

  expect(router.match("/posts")!.name).toBe("/posts");
  createTree(dir, ["test/recursive/index.ts"]);
  router.reload();
  expect(router.match("/test/recursive")!.name).toBe("/test/recursive");
  rmSync(`${dir}/test/recursive`, {
    recursive: true,
    force: true,
  });
  router.reload();
  expect(router.match("/test/recursive")).toBe(null);
  createTree(dir, ["test/test2/index.ts"]);
  router.reload();
  expect(router.match("/test/test2")!.name).toBe("/test/test2");
});

it(".query works with dynamic routes, including params", () => {
  // set up the test
  const { dir } = make(["posts/[id].tsx"]);

  const router = new Bun.FileSystemRouter({
    dir,
    style: "nextjs",
    assetPrefix: "/_next/static/",
    origin: "https://nextjs.org",
  });

  for (let [current, object] of [
    [new URL("https://example.com/posts/123?hello=world").href, { id: "123", hello: "world" }],
    [new URL("https://example.com/posts/123?hello=world&second=2").href, { id: "123", hello: "world", second: "2" }],
    [
      new URL("https://example.com/posts/123?hello=world&second=2&third=3").href,
      { id: "123", hello: "world", second: "2", third: "3" },
    ],
    [new URL("https://example.com/posts/123").href, { id: "123" }],
  ] as const) {
    const {
      name,
      src,
      filePath,
      // @ts-ignore
      checkThisDoesntCrash,
      query,
    } = router.match(current)!;
    expect(name).toBe("/posts/[id]");

    // check nothing is weird on the MatchedRoute object
    expect(checkThisDoesntCrash).toBeUndefined();

    expect(JSON.stringify(query)).toBe(JSON.stringify(object));
    expect(filePath).toBe(`${dir}/posts/[id].tsx`);
  }
});

it("dir should be validated", async () => {
  expect(() => {
    //@ts-ignore
    new Bun.FileSystemRouter({
      style: "nextjs",
    });
  }).toThrow("Expected dir to be a string");

  expect(() => {
    new Bun.FileSystemRouter({
      //@ts-ignore
      dir: undefined,
      style: "nextjs",
    });
  }).toThrow("Expected dir to be a string");

  expect(() => {
    new Bun.FileSystemRouter({
      //@ts-ignore
      dir: 123,
      style: "nextjs",
    });
  }).toThrow("Expected dir to be a string");
});

it("origin should be validated", async () => {
  const { dir } = make(["posts.tsx"]);

  expect(() => {
    new Bun.FileSystemRouter({
      dir,
      //@ts-ignore
      origin: 123,
      style: "nextjs",
    });
  }).toThrow("Expected origin to be a string");
});

// POSIX allows arbitrary bytes (except '/' and NUL) in filenames, including 0xFF.
// The route sorter's lookup table must cover the full u8 range.
// Windows and macOS (APFS/HFS+) require filenames to be valid Unicode, so skip there.
it.skipIf(isWindows || isMacOS)("handles filenames containing byte 0xFF", () => {
  using dir = tempDir("fsr-byte-ff", {});
  // Static routes sharing a prefix so the sorter must compare the 0xFF byte.
  // tempDir's string-keyed map can't express raw 0xFF, so write via Buffer paths.
  for (const name of [[0x61, 0xff], [0x61, 0x62], [0xff]]) {
    fs.writeFileSync(
      Buffer.concat([Buffer.from(String(dir) + "/"), Buffer.from(name), Buffer.from(".tsx")]),
      "export default 1;\n",
    );
  }

  const router = new FileSystemRouter({
    dir: String(dir),
    fileExtensions: [".tsx"],
    style: "nextjs",
  });

  const routes = Object.keys(router.routes);
  expect(routes.length).toBe(3);
  expect(routes).toContain("/ab");
});

it("src is relative to dir when no origin is given", () => {
  const { dir } = make(["index.tsx", "posts/[id].tsx"]);

  for (const opts of [{}, { assetPrefix: "/_next/static/" }]) {
    const router = new Bun.FileSystemRouter({ dir, style: "nextjs", ...opts });
    expect({
      index: router.match("/")!.src,
      post: router.match("/posts/hello-world")!.src,
    }).toEqual({
      index: "index.tsx",
      post: "posts/[id].tsx",
    });
  }
});

// The 0xFF byte is not valid UTF-8, so the JS string gets U+FFFD in its place.
it.skipIf(isWindows || isMacOS)("src replaces invalid UTF-8 in the route path with U+FFFD", () => {
  using dir = tempDir("fsr-src-byte-ff", {});
  fs.writeFileSync(
    Buffer.concat([Buffer.from(String(dir) + "/a"), Buffer.from([0xff]), Buffer.from(".tsx")]),
    "export default 1;\n",
  );

  const relative = new Bun.FileSystemRouter({ dir: String(dir), style: "nextjs", fileExtensions: [".tsx"] });
  const absolute = new Bun.FileSystemRouter({
    dir: String(dir),
    style: "nextjs",
    fileExtensions: [".tsx"],
    assetPrefix: "/_next/static/",
    origin: "https://example.com",
  });

  expect({
    relative: relative.match("/a%FF")!.src,
    absolute: absolute.match("/a%FF")!.src,
  }).toEqual({
    relative: "a\uFFFD.tsx",
    absolute: "https://example.com/_next/static/a\uFFFD.tsx",
  });
});

it("MatchedRoute.params does not leak", async () => {
  using dir = tempDir("fsr-params-leak", {
    "pages/[a]/[b]/[c]/[d].tsx": "export default 1;",
  });

  // Each match()+.params access lazily allocates a QueryStringMap (param name/value
  // buffer + MultiArrayList of params) which must be freed when the MatchedRoute is
  // garbage-collected. Use long segment values so any leak is large enough to
  // dominate RSS noise.
  const code = /* ts */ `
    const rss = process.memoryUsage.rss;
    const router = new Bun.FileSystemRouter({
      dir: ${JSON.stringify(path.join(String(dir), "pages"))},
      style: "nextjs",
      fileExtensions: [".tsx"],
    });
    const seg = "x".repeat(512);
    const url = "/" + seg + "/" + seg + "/" + seg + "/" + seg;

    // warm up
    for (let i = 0; i < 1000; i++) router.match(url).params;
    Bun.gc(true);
    const before = rss();

    for (let i = 0; i < 30000; i++) router.match(url).params;
    Bun.gc(true);
    const growthMB = (rss() - before) / 1024 / 1024;
    console.error("RSS growth: " + growthMB.toFixed(2) + "MB");
    // ASAN's quarantine retains freed allocations (default 256 MB) so RSS
    // deltas run far higher under bun-asan; widen the threshold there.
    if (growthMB > ${isASAN ? 400 : 20}) throw new Error("leaked " + growthMB.toFixed(2) + "MB");
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--smol", "-e", code],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("leaked");
  expect(stdout).toBe("");
  expect(exitCode).toBe(0);
}, 60_000);

it("throws a clean error for invalid route filenames (no use-after-free)", async () => {
  // The constructor's log is backed by an arena allocator. When route loading
  // produces errors (e.g. a filename like `[foo.tsx` missing its closing bracket),
  // the arena must not be freed before log.toJS() reads the messages.
  // Run in a subprocess so an ASAN crash doesn't take down the test runner.
  using dir = tempDir("fsr-invalid-route", {
    "pages/[foo.tsx": "export default 1;",
  });

  const code = /* ts */ `
    try {
      new Bun.FileSystemRouter({
        style: "nextjs",
        dir: ${JSON.stringify(path.join(String(dir), "pages"))},
        fileExtensions: [".tsx"],
      });
      console.log("no-throw");
    } catch (e) {
      console.log("caught:" + (e?.message ?? String(e)));
    }
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("caught:Route is missing a closing bracket]");
  expect(exitCode).toBe(0);
});

it("decodes percent-encoded path segments and keeps params and pathname stable after later matches", async () => {
  // The buffer that backs a MatchedRoute's decoded pathname, query string and
  // param values must stay alive (and unshared) for as long as the MatchedRoute
  // object does. Two back-to-back matches with equal-length encoded segments
  // are used so that, if the first match's decode buffer were released or
  // shared, the second match would immediately reuse and overwrite it.
  // Run in a subprocess so a memory error in the child cannot take down the
  // test runner.
  using dir = tempDir("fsr-percent-decode", {
    "pages/posts/[id].tsx": "export default 1;",
  });

  const code = /* ts */ `
    const router = new Bun.FileSystemRouter({
      dir: ${JSON.stringify(path.join(String(dir), "pages"))},
      style: "nextjs",
      fileExtensions: [".tsx"],
    });
    const enc = s => [...s].map(c => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join("");

    const a = "alpha-" + "a".repeat(58);
    const b = "bravo-" + "b".repeat(58);
    const ma = router.match("/posts/" + enc(a));
    const mb = router.match("/posts/" + enc(b));
    if (!ma || !mb) throw new Error("expected both URLs to match");
    if (ma.name !== "/posts/[id]") throw new Error("bad name: " + ma.name);
    if (ma.params.id !== a) throw new Error("first param corrupted: " + JSON.stringify(ma.params.id));
    if (ma.pathname !== "/posts/" + a) throw new Error("first pathname corrupted: " + JSON.stringify(ma.pathname));
    if (mb.params.id !== b) throw new Error("second param corrupted: " + JSON.stringify(mb.params.id));
    if (mb.pathname !== "/posts/" + b) throw new Error("second pathname corrupted: " + JSON.stringify(mb.pathname));

    // Un-encoded URLs must keep working.
    const plain = router.match("/posts/hello-world");
    if (!plain || plain.params.id !== "hello-world") throw new Error("plain param: " + JSON.stringify(plain && plain.params.id));
    console.log("ok");
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
});

it(".params decodes percent escapes in a route segment exactly once", () => {
  const { dir } = make(["index.tsx", "posts/[id].tsx"]);

  const router = new Bun.FileSystemRouter({
    dir,
    style: "nextjs",
  });

  const spaced = router.match("/posts/a%20b")!;
  expect(spaced.name).toBe("/posts/[id]");
  expect(spaced.pathname).toBe("/posts/a b");
  expect(spaced.params.id).toBe("a b");

  const escaped = router.match("/posts/%252e%252e%252fetc")!;
  expect(escaped.name).toBe("/posts/[id]");
  expect(escaped.pathname).toBe("/posts/%2e%2e%2fetc");
  expect(escaped.params.id).toBe("%2e%2e%2fetc");

  const percent = router.match("/posts/100%2525")!;
  expect(percent.pathname).toBe("/posts/100%25");
  expect(percent.params.id).toBe("100%25");
});

it("caps the number of parsed query string parameters instead of crashing", async () => {
  // A query string with more parameters than the iterator's fixed-size visited
  // bitset (2048 entries) must not be able to take down the process when
  // `.query` is read. Run in a subprocess so an abort is observable as output
  // on stderr / a nonzero exit code instead of killing the test runner.
  using dir = tempDir("fsr-many-query-params", {
    "pages/posts.tsx": "export default 1;",
  });

  const code = /* ts */ `
    const router = new Bun.FileSystemRouter({
      dir: ${JSON.stringify(path.join(String(dir), "pages"))},
      style: "nextjs",
      fileExtensions: [".tsx"],
    });
    const qs = Array.from({ length: 3000 }, (_, i) => "k" + i + "=v" + i).join("&");
    const match = router.match("/posts?" + qs);
    if (!match) throw new Error("expected /posts to match");
    const query = match.query;
    const keys = Object.keys(query);
    if (keys.length < 1 || keys.length > 3000) throw new Error("unexpected key count: " + keys.length);
    if (query.k0 !== "v0") throw new Error("first param wrong: " + JSON.stringify(query.k0));
    console.log("ok " + keys.length);
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.trim()).toMatch(/^ok \d+$/);
  expect(exitCode).toBe(0);
});

it("does not match a dynamic route whose static segment merely collides on length and 32-bit hash", () => {
  const low32 = (input: string) => Number(BigInt.asUintN(32, BigInt(Bun.hash.wyhash(input))));
  const seen = new Map<number, string>();
  let pair: [string, string] | null = null;
  for (let i = 0; i < 600_000; i++) {
    const candidate = "s" + i.toString(36).padStart(9, "0");
    const h = low32(candidate);
    const prev = seen.get(h);
    if (prev !== undefined) {
      pair = [prev, candidate];
      break;
    }
    seen.set(h, candidate);
  }
  expect(pair).not.toBeNull();
  const [routeSegment, collidingSegment] = pair!;
  expect(collidingSegment).not.toBe(routeSegment);
  expect(collidingSegment.length).toBe(routeSegment.length);

  const { dir } = make([`${routeSegment}/[id].tsx`]);
  const router = new Bun.FileSystemRouter({
    dir,
    style: "nextjs",
  });

  expect(router.match(`/${routeSegment}/42`)?.name).toBe(`/${routeSegment}/[id]`);
  expect(router.match(`/${collidingSegment}/42`)).toBeNull();
}, 60_000);

it("match() does not panic on a leading '?' or a path that percent-decodes to empty", async () => {
  // URLPath::parse assumed the decoded pathname was non-empty and had a leading
  // byte to skip. A bare query string ("?", "?foo") makes the path slice end at 0
  // while the start is hardcoded to 1, and "%PUBLIC_URL%" (which the fault-tolerant
  // decoder consumes entirely) yields an empty decoded pathname; either case used
  // to trigger a slice bounds panic. Run in a subprocess so a panic is observable
  // as a nonzero exit / missing stdout instead of killing the test runner.
  using dir = tempDir("fsr-degenerate-path", {
    "pages/index.tsx": "export default 1;",
  });

  const code = /* ts */ `
    const router = new Bun.FileSystemRouter({
      dir: ${JSON.stringify(path.join(String(dir), "pages"))},
      style: "nextjs",
      fileExtensions: [".tsx"],
    });
    const out = {};
    for (const input of ["?", "?foo=bar", "%PUBLIC_URL%", "%PUBLIC_URL%?x=1"]) {
      const m = router.match(input);
      out[input] = m ? { name: m.name, query: m.query } : null;
    }
    console.log(JSON.stringify(out));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  // These inputs do not start with '/', so they are not valid path strings and
  // must not match any route (including the index route). The subprocess still
  // proves the original invariant: no panic on degenerate input.
  expect(JSON.parse(stdout.trim())).toEqual({
    "?": null,
    "?foo=bar": null,
    "%PUBLIC_URL%": null,
    "%PUBLIC_URL%?x=1": null,
  });
  expect(exitCode).toBe(0);
});

it("match() returns null when the path string does not start with '/'", () => {
  const { dir } = make(["index.tsx", "top.tsx", "op.tsx", "sub/[id].tsx"]);
  const router = new Bun.FileSystemRouter({ dir, style: "nextjs" });

  // Control: '/'-prefixed inputs resolve.
  expect(router.match("/top")?.name).toBe("/top");
  expect(router.match("/op")?.name).toBe("/op");
  expect(router.match("/sub/x")).toMatchObject({ name: "/sub/[id]", params: { id: "x" } });
  expect(router.match("/")?.name).toBe("/");
  expect(router.match("/?q=1")).toMatchObject({ name: "/", query: { q: "1" } });
  expect(router.match("")?.name).toBe("/");

  // URLPath::parse used to strip byte 0 unconditionally, so any single junk byte
  // in the '/' position produced a match against the rest of the string.
  for (const input of ["Xtop", " top", "\ttop", "\\top", ".top", "%58top", "%2Ftop"]) {
    expect({ input, match: router.match(input) }).toEqual({ input, match: null });
  }
  // The bare name (no prefix at all) must not match either: previously "top"
  // became "op" and matched the /op route.
  expect(router.match("top")).toBeNull();
  expect(router.match("ttop")).toBeNull();
  // Dynamic routes were affected the same way.
  expect(router.match("Xsub/x")).toBeNull();
  expect(router.match("sub/x")).toBeNull();
  // A leading '?' has no path component and must not fall through to index.
  expect(router.match("?anything")).toBeNull();
});

it("reload() while Bun.build() resolves the same directory", async () => {
  // The router's route-load loop and Bun.build's entry-point resolution (which
  // runs on the bundler thread) share the process-global directory-entry cache.
  // Run in a subprocess so a crash is observable as a signal instead of taking
  // down the test runner.
  const files: Record<string, string> = {
    "fixture.ts": /* ts */ `
      import path from "path";
      const pagesDir = path.join(import.meta.dir, "pages");
      const entrypoints: string[] = [];
      for (let i = 1; i <= 40; i++) {
        entrypoints.push(path.join(pagesDir, "p" + i + ".tsx"));
        entrypoints.push(path.join(pagesDir, "sub", "s" + i + ".tsx"));
      }
      const router = new Bun.FileSystemRouter({
        dir: pagesDir,
        style: "nextjs",
        fileExtensions: [".tsx"],
      });
      // The first build completes with generation 0 and the bundle thread then
      // bumps its generation, so every later build's resolver re-reads the
      // directory listing in place. reload() iterates the same listing on the
      // main thread, and that in-place re-read is what the reload loop races.
      await Bun.build({ entrypoints, target: "bun", throw: false });
      let matches = 0;
      let buildsOk = true;
      for (let round = 0; round < 40; round++) {
        const builds = Array.from({ length: 4 }, () =>
          Bun.build({ entrypoints, target: "bun", throw: false }),
        );
        for (let i = 0; i < 50; i++) {
          router.reload();
          const m = router.match("/p7");
          if (m && m.filePath.endsWith("p7.tsx")) matches++;
        }
        const results = await Promise.all(builds);
        buildsOk &&= results.every(r => r.success);
      }
      console.log("matches", matches, "builds-ok", buildsOk);
    `,
  };
  for (let i = 1; i <= 40; i++) {
    files[`pages/p${i}.tsx`] = `export default ${i};\n`;
    files[`pages/sub/s${i}.tsx`] = `export default ${i};\n`;
  }
  using dir = tempDir("fsr-reload-build-race", files);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({
    stdout: normalizeBunSnapshot(stdout, String(dir)),
    stderr: normalizeBunSnapshot(stderr, String(dir)),
    exitCode,
    signalCode: proc.signalCode,
  }).toEqual({ stdout: "matches 2000 builds-ok true", stderr: "", exitCode: 0, signalCode: null });
}, 60_000);

it("loads routes from a directory already cached by Bun.build()", async () => {
  // The resolver caches the directory name without a trailing slash while the
  // router spells it with one; loading routes out of the already-populated
  // entry cache must accept either spelling. Run in a subprocess so a crash is
  // observable as a nonzero exit instead of taking down the test runner.
  using dir = tempDir("fsr-prewarmed-entry-cache", {
    "fixture.ts": /* ts */ `
      import path from "path";
      const pagesDir = path.join(import.meta.dir, "pages");
      await Bun.build({ entrypoints: [path.join(pagesDir, "a.tsx")], target: "bun", throw: false });
      const router = new Bun.FileSystemRouter({
        dir: pagesDir,
        style: "nextjs",
        fileExtensions: [".tsx"],
      });
      console.log(Object.keys(router.routes).sort().join(" "), router.match("/b")?.name);
    `,
    "pages/a.tsx": "export default 1;\n",
    "pages/b.tsx": "export default 2;\n",
    "pages/sub/c.tsx": "export default 3;\n",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({
    stdout: normalizeBunSnapshot(stdout, String(dir)),
    stderr: normalizeBunSnapshot(stderr, String(dir)),
    exitCode,
    signalCode: proc.signalCode,
  }).toEqual({ stdout: "/a /b /sub/c /b", stderr: "", exitCode: 0, signalCode: null });
});

it(".query drops a pair with a malformed percent escape without shifting later parameters", () => {
  const { dir } = make(["posts.tsx", "shows/[id].tsx"]);

  const router = new Bun.FileSystemRouter({
    dir,
    style: "nextjs",
  });

  for (const [current, expected] of [
    ["/posts?a=x%25zz&b=hello", { b: "hello" }],
    ["/posts?a=xy%25zz&b=hello&c=3", { b: "hello", c: "3" }],
    ["/posts?a=%25zz&b=hello", { b: "hello" }],
    ["/shows/123?a=x%25zz&b=ok", { id: "123", b: "ok" }],
    ["/shows/123?a=xy%25zz&b=ok&c=3", { id: "123", b: "ok", c: "3" }],
  ] as const) {
    expect({ input: current, query: router.match(current)!.query }).toEqual({ input: current, query: expected });
  }
});

it(".query keeps the route parameter when a percent-encoded query name decodes to the same name", () => {
  const { dir } = make(["posts/[id].tsx"]);

  const router = new Bun.FileSystemRouter({
    dir,
    style: "nextjs",
  });

  for (const [current, expected] of [
    ["/posts/123?id=999", { id: "123" }],
    ["/posts/123?%2569d=999", { id: "123" }],
    ["/posts/123?%2569d=999&other=1", { id: "123", other: "1" }],
    ["/posts/123?other=1&%2569d=999", { id: "123", other: "1" }],
  ] as const) {
    expect({ input: current, query: router.match(current)!.query }).toEqual({ input: current, query: expected });
  }
});

it("match() returns null when the URL has fewer segments than a dynamic route requires", () => {
  {
    const { dir } = make(["[org]/settings/[id].tsx"]);
    const router = new Bun.FileSystemRouter({
      dir,
      style: "nextjs",
    });

    expect(router.match("/acme/settings/x")).toMatchObject({
      name: "/[org]/settings/[id]",
      params: { org: "acme", id: "x" },
    });
    expect(router.match("/acme")).toBeNull();
  }

  {
    const { dir } = make(["[team]/[...rest].tsx"]);
    const router = new Bun.FileSystemRouter({
      dir,
      style: "nextjs",
    });

    expect(router.match("/acme/a/b")).toMatchObject({
      name: "/[team]/[...rest]",
      params: { team: "acme", rest: "a/b" },
    });
    expect(router.match("/acme")).toBeNull();
  }
});

it.skipIf(isWindows || isMacOS)(
  "src is computed for a route whose path is longer than the fast-path buffer",
  async () => {
    using dir = tempDir("fsr-long-route-src", {
      "pages/keep.tsx": "export default 1;\n",
    });

    const code = /* ts */ `
    const fs = require("fs");
    const path = require("path");
    const pagesDir = ${JSON.stringify(path.join(String(dir), "pages"))};
    const seg = Buffer.alloc(200, "a").toString();
    const relDir = Array.from({ length: 11 }, (_, i) => seg + i).join("/");
    fs.mkdirSync(path.join(pagesDir, relDir), { recursive: true });
    fs.writeFileSync(path.join(pagesDir, relDir, "leaf.tsx"), "export default 1;\\n");
    const router = new Bun.FileSystemRouter({
      dir: pagesDir,
      style: "nextjs",
      fileExtensions: [".tsx"],
      assetPrefix: "/_next/static/",
      origin: "https://example.com",
    });
    const m = router.match("/" + relDir + "/leaf");
    if (!m) throw new Error("expected the deep route to match");
    const expected = "https://example.com/_next/static/" + relDir + "/leaf.tsx";
    if (m.src !== expected) throw new Error("unexpected src: " + JSON.stringify(m.src));
    console.log("ok " + m.src.length);
  `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", code],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("ok 2264");
    expect(exitCode).toBe(0);
  },
);

it("an absolute dir with '..' in it names routes like its normalized spelling", async () => {
  const { dir } = make([
    `pages/index.tsx`,
    `pages/api/x.tsx`,
    `pages/a-long-directory-name/deeper/page.tsx`,
    `other/keep.tsx`,
  ]);
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const routes = dir => Object.keys(new Bun.FileSystemRouter({ dir, style: "nextjs" }).routes).sort();
      console.log(JSON.stringify([routes(process.argv[1] + "/pages"), routes(process.argv[1] + "/other/../pages")]));
      `,
      dir,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const routes = ["/", "/a-long-directory-name/deeper/page", "/api/x"];
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: JSON.stringify([routes, routes]) + "\n",
    stderr: "",
    exitCode: 0,
  });
});

const page = "export default 1;\n";
const routeNames = (router: FileSystemRouter) => Object.keys(router.routes).sort();
const routerOver = (dir: string, options: { fileExtensions?: string[] } = {}) =>
  new FileSystemRouter({ style: "nextjs", dir, ...options });
/** `routes` with each file path relative to `root`, in POSIX form. */
const routesBelow = (router: FileSystemRouter, root: string) =>
  Object.fromEntries(
    Object.entries(router.routes)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([name, filePath]) => [name, path.relative(root, filePath).replaceAll("\\", "/")]),
  );

describe("a new router reads the directory from disk", () => {
  // Each of these leaves a record of `pages` in the resolver's directory cache.
  const recorders: Record<string, (pages: string) => unknown> = {
    "an earlier router": pages => routerOver(pages),
    "import()": pages => import(path.join(pages, "a.tsx")),
    "require()": pages => require(path.join(pages, "a.tsx")),
    "Bun.resolveSync()": pages => Bun.resolveSync("./a.tsx", pages),
    "Bun.build()": pages => Bun.build({ entrypoints: [path.join(pages, "a.tsx")], target: "bun", throw: false }),
  };
  it.each(Object.keys(recorders))("after %s read it", async recorder => {
    using dir = tempDir("fsr-fresh-recorded", { "pages/a.tsx": page, "pages/old.tsx": page });
    const pages = path.join(String(dir), "pages");
    await recorders[recorder](pages);

    fs.writeFileSync(path.join(pages, "new.tsx"), page);
    fs.rmSync(path.join(pages, "old.tsx"));
    expect(routesBelow(routerOver(pages), pages)).toEqual({ "/a": "a.tsx", "/new": "new.tsx" });
  });

  it("a file added to and a file removed from a subdirectory", () => {
    using dir = tempDir("fsr-fresh-subdir", { "pages/a.tsx": page, "pages/sub/old.tsx": page });
    const pages = path.join(String(dir), "pages");
    expect(routeNames(routerOver(pages))).toEqual(["/a", "/sub/old"]);

    fs.writeFileSync(path.join(pages, "sub", "new.tsx"), page);
    fs.rmSync(path.join(pages, "sub", "old.tsx"));
    expect(routeNames(routerOver(pages))).toEqual(["/a", "/sub/new"]);
    // A router over the subdirectory reads it too.
    expect(routeNames(routerOver(path.join(pages, "sub")))).toEqual(["/new"]);
  });

  it("a new and a removed subdirectory", () => {
    using dir = tempDir("fsr-fresh-dirs", { "pages/a.tsx": page, "pages/gone/post.tsx": page });
    const pages = path.join(String(dir), "pages");
    expect(routeNames(routerOver(pages))).toEqual(["/a", "/gone/post"]);

    fs.mkdirSync(path.join(pages, "blog"));
    fs.writeFileSync(path.join(pages, "blog", "post.tsx"), page);
    fs.rmSync(path.join(pages, "gone"), { recursive: true });
    expect(routeNames(routerOver(pages))).toEqual(["/a", "/blog/post"]);
  });

  it("a file replaced by a directory of the same name", () => {
    using dir = tempDir("fsr-fresh-swap", { "pages/a.tsx": page, "pages/b.tsx": page });
    const pages = path.join(String(dir), "pages");
    expect(routeNames(routerOver(pages))).toEqual(["/a", "/b"]);

    fs.rmSync(path.join(pages, "b.tsx"));
    fs.mkdirSync(path.join(pages, "b.tsx"));
    fs.writeFileSync(path.join(pages, "b.tsx", "c.tsx"), page);
    expect(routeNames(routerOver(pages))).toEqual(["/a", "/b.tsx/c"]);
  });

  it("a directory created after the constructor threw for it", () => {
    using dir = tempDir("fsr-fresh-missing", {});
    const pages = path.join(String(dir), "pages");
    expect(() => routerOver(pages)).toThrow("Unable to find directory");

    fs.mkdirSync(pages);
    fs.writeFileSync(path.join(pages, "a.tsx"), page);
    expect(routeNames(routerOver(pages))).toEqual(["/a"]);
  });

  it("in a Worker, after a router on the main thread", async () => {
    using dir = tempDir("fsr-fresh-worker", {
      "pages/a.tsx": page,
      "pages/old.tsx": page,
      "worker.mjs": `
        self.onmessage = event => {
          const router = new Bun.FileSystemRouter({ style: "nextjs", dir: event.data });
          postMessage(Object.keys(router.routes).sort());
        };
      `,
    });
    const pages = path.join(String(dir), "pages");
    expect(routeNames(routerOver(pages))).toEqual(["/a", "/old"]);
    fs.writeFileSync(path.join(pages, "new.tsx"), page);
    fs.rmSync(path.join(pages, "old.tsx"));

    const worker = new Worker(path.join(String(dir), "worker.mjs"));
    try {
      const { promise, resolve, reject } = Promise.withResolvers<string[]>();
      worker.onmessage = event => resolve(event.data);
      worker.onerror = reject;
      worker.postMessage(pages);
      expect(await promise).toEqual(["/a", "/new"]);
    } finally {
      worker.terminate();
    }
  });
});

it("reload() finds a subdirectory that was looked up before it existed", () => {
  using dir = tempDir("fsr-reload-not-found", { "pages/a.tsx": page });
  const pages = path.join(String(dir), "pages");
  const router = routerOver(pages);
  expect(() => routerOver(path.join(pages, "blog"))).toThrow("Unable to find directory");

  fs.mkdirSync(path.join(pages, "blog"));
  fs.writeFileSync(path.join(pages, "blog", "post.tsx"), page);
  router.reload();
  expect(routeNames(router)).toEqual(["/a", "/blog/post"]);
});

it("routes and match() keep the scan they came from until reload()", () => {
  using dir = tempDir("fsr-scan-snapshot", { "pages/a.tsx": page, "pages/old.tsx": page });
  const pages = path.join(String(dir), "pages");
  const router = routerOver(pages);
  const matched = router.match("/old")!;

  fs.writeFileSync(path.join(pages, "new.tsx"), page);
  fs.rmSync(path.join(pages, "old.tsx"));
  expect({ names: routeNames(router), old: router.match("/old")?.name, new: router.match("/new") }).toEqual({
    names: ["/a", "/old"],
    old: "/old",
    new: null,
  });

  router.reload();
  expect({ names: routeNames(router), old: router.match("/old"), new: router.match("/new")?.name }).toEqual({
    names: ["/a", "/new"],
    old: null,
    new: "/new",
  });
  // A match taken before reload() still reads its own route.
  Bun.gc(true);
  expect({
    name: matched.name,
    filePath: path.relative(pages, matched.filePath),
    src: matched.src,
    kind: matched.kind,
  }).toEqual({ name: "/old", filePath: "old.tsx", src: "old.tsx", kind: "exact" });
});

it("reload() keeps its routes while the directory is gone, and reads it again when it is back", () => {
  using dir = tempDir("fsr-reload-root-gone", { "pages/a.tsx": page });
  const pages = path.join(String(dir), "pages");
  const router = routerOver(pages);

  fs.rmSync(pages, { recursive: true });
  expect(() => router.reload()).toThrow("Unable to find directory");
  expect({ names: routeNames(router), match: router.match("/a")?.name }).toEqual({ names: ["/a"], match: "/a" });

  fs.mkdirSync(pages);
  fs.writeFileSync(path.join(pages, "b.tsx"), page);
  router.reload();
  expect(routeNames(router)).toEqual(["/b"]);
});

it("skips dot entries, node_modules and files with another extension", () => {
  using dir = tempDir("fsr-skips", {
    "pages/index.tsx": page,
    "pages/a.tsx": page,
    "pages/b.ts": page,
    "pages/c.css": "",
    "pages/README": "",
    "pages/.hidden.tsx": page,
    "pages/.hidden/x.tsx": page,
    "pages/node_modules/pkg/index.tsx": page,
    "pages/blog/index.tsx": page,
    "pages/blog/[slug]/index.tsx": page,
    "pages/blog/node_modules/x.tsx": page,
  });
  const pages = path.join(String(dir), "pages");
  expect({
    default: routesBelow(routerOver(pages), pages),
    tsxOnly: routeNames(routerOver(pages, { fileExtensions: [".tsx"] })),
  }).toEqual({
    default: {
      "/": "index.tsx",
      "/a": "a.tsx",
      "/b": "b.ts",
      "/blog": "blog/index.tsx",
      "/blog/[slug]": "blog/[slug]/index.tsx",
    },
    tsxOnly: ["/", "/a", "/blog", "/blog/[slug]"],
  });
});

it("a route with uppercase letters keeps its case and matches a lowercase path", () => {
  using dir = tempDir("fsr-uppercase", {
    "pages/About.tsx": page,
    "pages/Docs/Intro.tsx": page,
    "pages/Users/index.tsx": page,
    "pages/Users/[Id].tsx": page,
  });
  const pages = path.join(String(dir), "pages");
  const router = routerOver(pages);
  const match = (url: string) => {
    const matched = router.match(url);
    return matched && { name: matched.name, params: matched.params, src: matched.src };
  };
  expect({
    names: routeNames(router),
    exact: [match("/About"), match("/Docs/Intro"), match("/Users")],
    lowercase: [match("/about"), match("/docs/intro"), match("/users"), match("/users/42")],
  }).toEqual({
    names: ["/About", "/Docs/Intro", "/Users", "/Users/[Id]"],
    exact: [
      { name: "/About", params: {}, src: "About.tsx" },
      { name: "/Docs/Intro", params: {}, src: "Docs/Intro.tsx" },
      { name: "/Users", params: {}, src: "Users/index.tsx" },
    ],
    lowercase: [
      { name: "/About", params: {}, src: "About.tsx" },
      { name: "/Docs/Intro", params: {}, src: "Docs/Intro.tsx" },
      { name: "/Users", params: {}, src: "Users/index.tsx" },
      { name: "/Users/[Id]", params: { Id: "42" }, src: "Users/[Id].tsx" },
    ],
  });
});

it("throws for a dir that is missing or is a file", () => {
  using dir = tempDir("fsr-root-errors", { "file.tsx": page });
  expect(() => routerOver(path.join(String(dir), "missing"))).toThrow("Unable to find directory");
  expect(() => routerOver(path.join(String(dir), "file.tsx"))).toThrow("Unable to find directory");
});

it.skipIf(isWindows)("a dir that cannot be opened is an error, a subdirectory that cannot be is left out", async () => {
  using dir = tempDir("fsr-no-access", {
    "locked/a.tsx": page,
    "pages/a.tsx": page,
    "pages/private/b.tsx": page,
  });
  const locked = [path.join(String(dir), "locked"), path.join(String(dir), "pages", "private")];
  // Root ignores the mode of a directory, so the child does not run as root.
  using unprivileged = unprivilegedSpawnOptions(String(dir));
  for (const directory of locked) fs.chmodSync(directory, 0o000);
  try {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const router = dir => new Bun.FileSystemRouter({ style: "nextjs", dir });
        let error;
        try {
          router("locked");
        } catch (e) {
          error = { code: e.code, syscall: e.syscall, path: require("path").basename(e.path ?? "") };
        }
        console.log(JSON.stringify({ error, pages: Object.keys(router("pages").routes) }));
        `,
      ],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      ...unprivileged,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: JSON.stringify({ error: { code: "EACCES", syscall: "open", path: "locked" }, pages: ["/a"] }),
      stderr: "",
      exitCode: 0,
    });
  } finally {
    for (const directory of locked) fs.chmodSync(directory, 0o755);
  }
});

it.skipIf(isWindows)("follows a link to a file and a link to a directory", () => {
  using dir = tempDir("fsr-links", {
    "pages/a.tsx": page,
    "elsewhere/target.tsx": page,
    "elsewhere/folder/x.tsx": page,
    "elsewhere/folder/deep/y.tsx": page,
  });
  const root = String(dir);
  const pages = path.join(root, "pages");
  fs.symlinkSync(path.join(root, "elsewhere", "target.tsx"), path.join(pages, "s.tsx"));
  fs.symlinkSync(path.join(root, "elsewhere", "folder"), path.join(pages, "ln"));

  // The name comes from the link. The file path and `src` are those of the file the link leads to.
  const router = routerOver(pages);
  expect({
    routes: routesBelow(router, root),
    src: [router.match("/s")!.src, router.match("/ln/x")!.src, router.match("/ln/deep/y")!.src],
  }).toEqual({
    routes: {
      "/a": "pages/a.tsx",
      "/ln/deep/y": "elsewhere/folder/deep/y.tsx",
      "/ln/x": "elsewhere/folder/x.tsx",
      "/s": "elsewhere/target.tsx",
    },
    src: ["../elsewhere/target.tsx", "../elsewhere/folder/x.tsx", "../elsewhere/folder/deep/y.tsx"],
  });
});

it.skipIf(isWindows)("skips a link to nothing, a FIFO and a link to a FIFO", async () => {
  using dir = tempDir("fsr-not-a-file", { "pages/a.tsx": page });
  const root = String(dir);
  const pages = path.join(root, "pages");
  fs.symlinkSync(path.join(root, "nowhere.tsx"), path.join(pages, "dangling.tsx"));
  expect(Bun.spawnSync(["mkfifo", path.join(pages, "fifo.tsx"), path.join(root, "fifo-target")]).exitCode).toBe(0);
  fs.symlinkSync(path.join(root, "fifo-target"), path.join(pages, "link-to-fifo.tsx"));

  // In a subprocess: opening a FIFO to learn its path never returns.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `console.log(Object.keys(new Bun.FileSystemRouter({ style: "nextjs", dir: process.argv[1] }).routes).join(" "));`,
      pages,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 30_000,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toEqual({
    stdout: "/a\n",
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });
});

it.skipIf(isWindows)("a link that leads back into the tree is not followed again", () => {
  // One link per tree: two in one tree double the walk at every level until ELOOP stops it.
  using dir = tempDir("fsr-link-cycle", { "one/a.tsx": page, "two/a.tsx": page, "two/sub/b.tsx": page });
  const [one, two] = [path.join(String(dir), "one"), path.join(String(dir), "two")];
  fs.symlinkSync(".", path.join(one, "self"));
  fs.symlinkSync("..", path.join(two, "sub", "up"));
  expect({ one: routeNames(routerOver(one)), two: routeNames(routerOver(two)) }).toEqual({
    one: ["/a"],
    two: ["/a", "/sub/b"],
  });
});

it("a tsconfig.json or package.json that does not parse is not the router's error", () => {
  using dir = tempDir("fsr-broken-config", {
    "tsconfig.json": `{ "compilerOptions": { "paths": `,
    "pages/a.tsx": page,
    "pages/package.json": `{ "name": `,
    "pages/sub/b.tsx": page,
    "pages/sub/tsconfig.json": `{ "compilerOptions": `,
  });
  expect(routeNames(routerOver(path.join(String(dir), "pages")))).toEqual(["/a", "/sub/b"]);
});

it("a scan keeps no memory after the next one", async () => {
  // Under ASAN a freed scan stays in the quarantine, so only the bound of a release build can tell a leak.
  const scans = isASAN || isDebug ? 30 : 300;
  const files: Record<string, string> = {};
  for (let i = 0; i < 250; i++) {
    files[`pages/a-route-with-a-long-name-${i}.tsx`] = "";
    files[`pages/sub/a-route-with-a-long-name-${i}.tsx`] = "";
  }
  using dir = tempDir("fsr-scan-memory", files);

  const code = /* ts */ `
    const dir = ${JSON.stringify(path.join(String(dir), "pages"))};
    const scans = ${scans};
    const rss = () => (Bun.gc(true), process.memoryUsage.rss());
    const router = new Bun.FileSystemRouter({ style: "nextjs", dir });
    for (let i = 0; i < 10; i++) router.reload();
    const before = rss();
    for (let i = 0; i < scans; i++) new Bun.FileSystemRouter({ style: "nextjs", dir });
    for (let i = 0; i < scans; i++) router.reload();
    const growthMB = (rss() - before) / 1024 / 1024;
    console.error("RSS growth: " + growthMB.toFixed(2) + "MB");
    // 300 constructors and 300 reload() calls beside 500 routes kept 70 MB.
    if (growthMB > ${isASAN ? 400 : 20}) throw new Error("leaked " + growthMB.toFixed(2) + "MB");
    console.log(Object.keys(router.routes).length);
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--smol", "-e", code],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("leaked");
  expect(stdout).toBe("500\n");
  expect(exitCode).toBe(0);
}, 60_000);

describe("two files for one route", () => {
  it("the first in byte order defines a route, the next is an error", () => {
    using dir = tempDir("fsr-duplicate", { "pages/a.tsx": page, "pages/a.ts": page, "pages/b.tsx": page });
    const pages = path.join(String(dir), "pages");
    let message = "";
    try {
      routerOver(pages);
    } catch (e) {
      message = (e as Error).message.replaceAll(pages, "<pages>").replaceAll("\\", "/");
    }
    expect(message).toBe(`Route "/a" is already defined by <pages>/a.ts`);
  });

  it("the first index file in byte order is the index route", () => {
    using dir = tempDir("fsr-index-files", {
      "pages/index.tsx": page,
      "pages/index.ts": page,
      "pages/index.js": page,
      "pages/index.jsx": page,
    });
    const pages = path.join(String(dir), "pages");
    const router = routerOver(pages);
    expect({ routes: routesBelow(router, pages), match: path.relative(pages, router.match("/")!.filePath) }).toEqual({
      routes: { "/": "index.js" },
      match: "index.js",
    });
  });

  // Names that differ only in case are one name on macOS and Windows.
  it.skipIf(!isLinux)("names that differ only in case are the same route, directories are not", () => {
    using dir = tempDir("fsr-case", {
      "files/A.tsx": page,
      "files/a.tsx": page,
      "dirs/Blog/x.tsx": page,
      "dirs/blog/y.tsx": page,
    });
    const root = String(dir);
    let message = "";
    try {
      routerOver(path.join(root, "files"));
    } catch (e) {
      message = (e as Error).message.replaceAll(root, "<root>");
    }
    expect({ message, dirs: routeNames(routerOver(path.join(root, "dirs"))) }).toEqual({
      message: `Route "/a" is already defined by <root>/files/A.tsx`,
      dirs: ["/Blog/x", "/blog/y"],
    });
  });
});

describe("dir is reached through a link", () => {
  async function run(fixture: string, files: Record<string, string>, link: [target: string, name: string]) {
    using dir = tempDir("fsr-linked-dir", { "fixture.ts": fixture, ...files });
    fs.symlinkSync(path.join(String(dir), link[0]), path.join(String(dir), link[1]), "junction");
    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return {
      stdout: normalizeBunSnapshot(stdout, String(dir)),
      stderr: normalizeBunSnapshot(stderr, String(dir)),
      exitCode,
      signalCode: proc.signalCode,
    };
  }
  const names = `const names = router => Object.keys(router.routes).sort().join(" ");`;

  it("reload() names the routes as the constructor does", async () => {
    const result = await run(
      /* ts */ `
        import path from "path";
        ${names}
        const dir = path.join(import.meta.dir, "link", "pages");
        const router = new Bun.FileSystemRouter({ dir, style: "nextjs", fileExtensions: [".tsx"] });
        const before = names(router);
        router.reload();
        const again = new Bun.FileSystemRouter({ dir, style: "nextjs", fileExtensions: [".tsx"] });
        console.log([before, names(router), router.match("/sub/c")?.name, router.match("/")?.name, names(again)].join(" | "));
      `,
      { "real/pages/index.tsx": page, "real/pages/b.tsx": page, "real/pages/sub/c.tsx": page },
      ["real", "link"],
    );
    expect(result).toEqual({
      stdout: "/ /b /sub/c | / /b /sub/c | /sub/c | / | / /b /sub/c",
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  it("reload() follows the link to where it leads now", async () => {
    const result = await run(
      /* ts */ `
        import fs from "fs";
        import path from "path";
        ${names}
        const link = path.join(import.meta.dir, "link");
        const router = new Bun.FileSystemRouter({ dir: path.join(link, "pages"), style: "nextjs" });
        const before = names(router);
        // A junction is a directory to Windows.
        if (process.platform === "win32") fs.rmdirSync(link);
        else fs.unlinkSync(link);
        fs.symlinkSync(path.join(import.meta.dir, "second"), link, "junction");
        router.reload();
        const match = router.match("/two");
        console.log([before, names(router), path.relative(import.meta.dir, match.filePath).replaceAll("\\\\", "/"), match.src].join(" | "));
      `,
      { "first/pages/one.tsx": page, "second/pages/two.tsx": page },
      ["first", "link"],
    );
    expect(result).toEqual({
      stdout: "/one | /two | second/pages/two.tsx | two.tsx",
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });
});

it("reload() returns when the resolver has dir cached without a trailing separator", async () => {
  // The failed resolve and the router over `sub` leave `pages` cached without a trailing separator.
  using dir = tempDir("fsr-reload-failed-resolve", {
    "fixture.ts": /* ts */ `
      import path from "path";
      const pagesDir = path.join(import.meta.dir, "pages");
      try {
        Bun.resolveSync("./does-not-exist.ts", pagesDir);
      } catch {}
      new Bun.FileSystemRouter({ dir: path.join(pagesDir, "sub"), style: "nextjs", fileExtensions: [".tsx"] });
      const router = new Bun.FileSystemRouter({ dir: pagesDir, style: "nextjs", fileExtensions: [".tsx"] });
      const before = Object.keys(router.routes).sort().join(" ");
      router.reload();
      console.log(before, "|", Object.keys(router.routes).sort().join(" "), router.match("/")?.name);
    `,
    "pages/index.tsx": "export default 1;\n",
    "pages/b.tsx": "export default 2;\n",
    "pages/sub/c.tsx": "export default 3;\n",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({
    stdout: normalizeBunSnapshot(stdout, String(dir)),
    stderr: normalizeBunSnapshot(stderr, String(dir)),
    exitCode,
    signalCode: proc.signalCode,
  }).toEqual({ stdout: "/ /b /sub/c | / /b /sub/c /", stderr: "", exitCode: 0, signalCode: null });
});
