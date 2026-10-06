import { FileSystemRouter } from "bun";
import { describe, expect, it } from "bun:test";
import fs, { mkdirSync, rmSync } from "fs";
import { bunEnv, bunExe, isASAN, isMacOS, isWindows, normalizeBunSnapshot, tempDir, tmpdirSync } from "harness";
import os from "os";
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

// The directory-entry cache is process-global and keyed by path. Each case
// builds its own tree, so what one case makes the resolver cache cannot reach
// another.
describe("a route's path does not depend on what the resolver cached first", () => {
  const primers: Record<string, (pages: string, files: string[]) => void | Promise<unknown>> = {
    "nothing": () => {},
    "Bun.resolveSync": (pages, files) => {
      for (const file of files) Bun.resolveSync(path.join(pages, file), pages);
    },
    "Bun.build": (pages, files) =>
      Bun.build({ entrypoints: files.map(file => path.join(pages, file)), target: "bun", throw: false }),
  };

  it.each(Object.keys(primers))("routes dir reached through a symlink, after %s", async primer => {
    using dir = tempDir("fsr-symlinked-dir", {
      "real/pages/index.tsx": "export default 0;\n",
      "real/pages/a.tsx": "export default 1;\n",
      "real/pages/sub/d.tsx": "export default 2;\n",
      "shared/e.tsx": "export default 3;\n",
      "other/x.tsx": "export default 4;\n",
    });
    const root = String(dir).replaceAll("\\", "/");
    fs.symlinkSync(path.join(root, "real"), path.join(root, "link"), "junction");
    fs.symlinkSync(path.join(root, "other"), path.join(root, "real", "pages", "linked"), "junction");
    fs.symlinkSync(path.join(root, "shared", "e.tsx"), path.join(root, "real", "pages", "c.tsx"), "file");
    const pages = path.join(root, "link", "pages");
    const files = ["index.tsx", "a.tsx", "c.tsx", "sub/d.tsx", "linked/x.tsx"];

    await primers[primer](pages, files);
    const router = new FileSystemRouter({ dir: pages, style: "nextjs", fileExtensions: [".tsx"] });

    const routes = {
      "/": `${root}/real/pages/index.tsx`,
      "/a": `${root}/real/pages/a.tsx`,
      "/c": `${root}/shared/e.tsx`,
      "/sub/d": `${root}/real/pages/sub/d.tsx`,
      "/linked/x": `${root}/other/x.tsx`,
    };
    expect({
      routes: router.routes,
      a: { filePath: router.match("/a")!.filePath, src: router.match("/a")!.src },
      d: { filePath: router.match("/sub/d")!.filePath, src: router.match("/sub/d")!.src },
      // The resolver loads each route file under the path the router reports.
      resolved: files.map(file => Bun.resolveSync(path.join(pages, file), pages).replaceAll("\\", "/")),
    }).toEqual({
      routes,
      a: { filePath: routes["/a"], src: "a.tsx" },
      d: { filePath: routes["/sub/d"], src: "sub/d.tsx" },
      resolved: Object.values(routes),
    });
  });

  it.each(Object.keys(primers))(
    "a symlinked file and a symlinked subdirectory in a plain routes dir, after %s and across reload()",
    async primer => {
      using dir = tempDir("fsr-links-below-root", {
        "pages/a.tsx": "export default 1;\n",
        "shared/e.tsx": "export default 2;\n",
        "other/x.tsx": "export default 3;\n",
      });
      const root = String(dir).replaceAll("\\", "/");
      const pages = path.join(root, "pages");
      fs.symlinkSync(path.join(root, "shared", "e.tsx"), path.join(pages, "c.tsx"), "file");
      fs.symlinkSync(path.join(root, "other"), path.join(pages, "linked"), "junction");

      await primers[primer](pages, ["a.tsx", "c.tsx", "linked/x.tsx"]);
      const router = new FileSystemRouter({ dir: pages, style: "nextjs", fileExtensions: [".tsx"] });
      const read = () => ({ routes: router.routes, src: router.match("/a")!.src });
      const first = read();
      router.reload();

      const expected = {
        routes: {
          "/a": `${root}/pages/a.tsx`,
          "/c": `${root}/shared/e.tsx`,
          "/linked/x": `${root}/other/x.tsx`,
        },
        src: "a.tsx",
      };
      expect({ first, afterReload: read() }).toEqual({ first: expected, afterReload: expected });
    },
  );

  it("no symlink, after an import that spells the file name in another letter case", () => {
    using dir = tempDir("fsr-case-import", {
      "pages/a.tsx": "export default 1;\n",
      "pages/b.tsx": "export default 2;\n",
    });
    const root = String(dir).replaceAll("\\", "/");
    const pages = path.join(root, "pages");

    // The resolver finds `b.tsx` for `B` (its directory lookup ignores case) and
    // caches the spelling of the import. A file system that tells `B.tsx` from
    // `b.tsx` has no such file, so the resolve is allowed to fail.
    try {
      Bun.resolveSync(path.join(pages, "B"), pages);
    } catch {}
    const router = new FileSystemRouter({ dir: pages, style: "nextjs", fileExtensions: [".tsx"] });
    const first = router.routes;
    router.reload();

    const expected = {
      "/a": `${root}/pages/a.tsx`,
      "/b": `${root}/pages/b.tsx`,
    };
    expect({ first, afterReload: router.routes }).toEqual({ first: expected, afterReload: expected });
  });
});

it("a router does not change which tsconfig.json the bundler applies to a route file", async () => {
  // `proj/link` points outside `proj`. The bundler takes tsconfig.json from the
  // directories above the path as imported (`proj/`), not from those above the
  // real path, so the JSX import source below applies to the route file.
  async function jsxImportSource(routerFirst: boolean) {
    using dir = tempDir("fsr-tsconfig", {
      "proj/tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "react-jsx", jsxImportSource: "custom-src" } }),
      "elsewhere/real/pages/b.tsx": "export default <div />;\n",
    });
    const root = String(dir);
    fs.symlinkSync(path.join(root, "elsewhere", "real"), path.join(root, "proj", "link"), "junction");
    const pages = path.join(root, "proj", "link", "pages");

    if (routerFirst) new FileSystemRouter({ dir: pages, style: "nextjs", fileExtensions: [".tsx"] });
    const build = await Bun.build({ entrypoints: [path.join(pages, "b.tsx")], target: "bun", external: ["*"] });
    const output = await build.outputs[0].text();
    return output.match(/from "([^"/]+)\/jsx/)?.[1];
  }

  expect({
    buildOnly: await jsxImportSource(false),
    routerFirst: await jsxImportSource(true),
  }).toEqual({
    buildOnly: "custom-src",
    routerFirst: "custom-src",
  });
});

// The symlinked file is compared with what the resolver returns in the same
// process: whether --preserve-symlinks keeps a file's link is the resolver's rule.
it.each(["the router", "Bun.resolveSync"])(
  "with --preserve-symlinks a route's path is the one the resolver returns, %s first",
  async first => {
    using dir = tempDir("fsr-preserve-symlinks", {
      "real/pages/a.tsx": "export default 1;\n",
      "shared/e.tsx": "export default 2;\n",
      "fixture.ts": /* ts */ `
        import path from "path";
        const pages = path.join(import.meta.dir, "link", "pages");
        const resolve = () =>
          ["a.tsx", "c.tsx"].map(file => Bun.resolveSync(path.join(pages, file), pages).replaceAll("\\\\", "/"));
        const before = process.argv[2] === "Bun.resolveSync" ? resolve() : undefined;
        const router = new Bun.FileSystemRouter({ dir: pages, style: "nextjs", fileExtensions: [".tsx"] });
        const read = () => ({ routes: router.routes, src: router.match("/a")!.src });
        const constructed = read();
        router.reload();
        console.log(JSON.stringify({ constructed, reloaded: read(), resolved: before ?? resolve() }));
      `,
    });
    const root = String(dir).replaceAll("\\", "/");
    fs.symlinkSync(path.join(root, "real"), path.join(root, "link"), "junction");
    fs.symlinkSync(path.join(root, "shared", "e.tsx"), path.join(root, "real", "pages", "c.tsx"), "file");

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--preserve-symlinks", "fixture.ts", first],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const { resolved = [], ...routers } = stdout ? JSON.parse(stdout) : {};

    const linkA = `${root}/link/pages/a.tsx`;
    expect([`${root}/shared/e.tsx`, `${root}/link/pages/c.tsx`]).toContain(resolved[1]);
    const expected = { routes: { "/a": linkA, "/c": resolved[1] }, src: "a.tsx" };
    expect({ ...routers, resolved, stderr, exitCode }).toEqual({
      constructed: expected,
      reloaded: expected,
      resolved: [linkA, resolved[1]],
      stderr: "",
      exitCode: 0,
    });
  },
);

it("a dangling symlink is a route, as the resolver resolves it to its own path", async () => {
  using dir = tempDir("fsr-dangling-link", {
    "pages/ok.tsx": "export default 1;\n",
  });
  const root = String(dir).replaceAll("\\", "/");
  const pages = path.join(root, "pages");
  fs.symlinkSync(path.join(root, "missing.tsx"), path.join(pages, "dead.tsx"), "file");

  const router = new FileSystemRouter({ dir: pages, style: "nextjs", fileExtensions: [".tsx"] });
  const first = router.routes;
  router.reload();

  const expected = {
    "/dead": `${root}/pages/dead.tsx`,
    "/ok": `${root}/pages/ok.tsx`,
  };
  expect({
    first,
    afterReload: router.routes,
    resolved: Bun.resolveSync(path.join(pages, "dead.tsx"), pages).replaceAll("\\", "/"),
  }).toEqual({ first: expected, afterReload: expected, resolved: expected["/dead"] });
  await expect(import(expected["/dead"])).rejects.toThrow("ENOENT");
});

// On Windows a backslash separates directories, so no file has one in its name.
it.skipIf(isWindows)("a file name with a backslash is a route under its own path", () => {
  using dir = tempDir("fsr-backslash-name", {
    "pages/ok.tsx": "export default 1;\n",
  });
  const root = String(dir);
  fs.writeFileSync(path.join(root, "pages", "a\\b.tsx"), "export default 2;\n");

  const router = new FileSystemRouter({ dir: path.join(root, "pages"), style: "nextjs", fileExtensions: [".tsx"] });
  expect(router.routes).toEqual({
    "/a\\b": `${root}/pages/a\\b.tsx`,
    "/ok": `${root}/pages/ok.tsx`,
  });
});

it("a new router reads the directory listing the resolver cached, reload() reads the disk", () => {
  using dir = tempDir("fsr-cached-listing", {
    "pages/keep.tsx": "export default 1;\n",
    "pages/gone.tsx": "export default 2;\n",
  });
  const pages = path.join(String(dir), "pages");

  Bun.resolveSync(path.join(pages, "keep.tsx"), pages);
  fs.rmSync(path.join(pages, "gone.tsx"));
  fs.writeFileSync(path.join(pages, "new.tsx"), "export default 3;\n");

  const router = new FileSystemRouter({ dir: pages, style: "nextjs", fileExtensions: [".tsx"] });
  const first = Object.keys(router.routes).sort();
  router.reload();
  expect({ first, afterReload: Object.keys(router.routes).sort() }).toEqual({
    first: ["/gone", "/keep"],
    afterReload: ["/keep", "/new"],
  });
});

// Only a file system that ignores letter case lets `dir` name the directory in another case.
const tmp = fs.realpathSync(os.tmpdir());
const fileSystemIgnoresCase = fs.existsSync(tmp.toUpperCase()) && fs.existsSync(tmp.toLowerCase());
it.skipIf(!fileSystemIgnoresCase)("filePath keeps the letter case of the dir option, like the resolver", () => {
  using dir = tempDir("fsr-dir-case", {
    "pages/a.tsx": "export default 1;\n",
  });
  const root = String(dir).replaceAll("\\", "/");
  const pages = path.join(root, "PAGES");

  const router = new FileSystemRouter({ dir: pages, style: "nextjs", fileExtensions: [".tsx"] });
  expect({
    routes: router.routes,
    resolved: Bun.resolveSync(path.join(pages, "a.tsx"), pages).replaceAll("\\", "/"),
  }).toEqual({
    routes: { "/a": `${root}/PAGES/a.tsx` },
    resolved: `${root}/PAGES/a.tsx`,
  });
});

// A save by rename reaches the hot reloader as an event on the directory. It
// used to find the watched module through the resolver's cached path of the
// directory entry, which `reload()` clears and only refilled for route files.
// Windows cannot rename over an open file and reports these changes on the
// file, so it has no such event.
it.skipIf(isWindows)(
  "--hot reloads a module saved by rename after reload() re-read its directory",
  async () => {
    using dir = tempDir("fsr-hot-after-reload", {
      "pages/a.tsx": `export default "a1";\n`,
      "pages/helper.ts": `export default "h1";\n`,
      "server.ts": /* ts */ `
        import helper from "./pages/helper.ts";
        const router = new Bun.FileSystemRouter({
          dir: import.meta.dir + "/pages",
          style: "nextjs",
          fileExtensions: [".tsx"],
        });
        const route = (await import(router.match("/a")!.filePath)).default;
        router.reload();
        console.log(route, helper);
      `,
    });
    const root = String(dir);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--hot", "server.ts"],
      env: bunEnv,
      cwd: root,
      stdout: "pipe",
      stderr: "inherit",
      stdin: "ignore",
    });

    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    // The next line that differs from `previous`: one save can reload twice.
    async function lineAfter(previous: string | undefined) {
      while (true) {
        const newline = buffered.indexOf("\n");
        if (newline !== -1) {
          const line = buffered.slice(0, newline);
          buffered = buffered.slice(newline + 1);
          if (line !== previous) return line;
          continue;
        }
        const { value, done } = await reader.read();
        if (done) throw new Error(`--hot exited after ${JSON.stringify(previous)}`);
        buffered += decoder.decode(value, { stream: true });
      }
    }
    function saveByRename(file: string, text: string) {
      fs.writeFileSync(path.join(root, file + ".tmp"), text);
      fs.renameSync(path.join(root, file + ".tmp"), path.join(root, file));
    }

    const first = await lineAfter(undefined);
    saveByRename("pages/helper.ts", `export default "h2";\n`);
    const second = await lineAfter(first);
    saveByRename("pages/a.tsx", `export default "a2";\n`);
    const third = await lineAfter(second);

    expect([first, second, third]).toEqual(["a1 h1", "a1 h2", "a2 h2"]);
  },
  30_000,
);
