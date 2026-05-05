import { FileSystemRouter } from "bun";
import { expect, it } from "bun:test";
import fs, { mkdirSync, rmSync } from "fs";
import { bunEnv, bunExe, isMacOS, isWindows, tempDir, tmpdirSync } from "harness";
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

it("reload() preserves custom fileExtensions and assetPrefix across multiple reloads", () => {
  // Regression: reload() shallow-copied the []string of extensions into the new arena but
  // left the inner []const u8 pointing into the old arena (which is then freed). The second
  // reload() would scan routes against dangling extension bytes, dropping every route (and
  // tripping ASAN). asset_prefix_path was not copied at all.
  const { dir } = make(["index.tsx", "posts/[id].tsx", "posts.tsx"]);

  const router = new Bun.FileSystemRouter({
    dir,
    style: "nextjs",
    fileExtensions: [".tsx"],
    assetPrefix: "/_next/static/",
    origin: "https://nextjs.org",
  });

  const expected = {
    "/": `${dir}/index.tsx`,
    "/posts": `${dir}/posts.tsx`,
    "/posts/[id]": `${dir}/posts/[id].tsx`,
  };

  expect(router.routes).toEqual(expected);

  // First reload() happens while the original arena is still live during loadRoutes,
  // so it appears to work even with the shallow copy. The second and subsequent reloads
  // read extension strings that were freed by the previous reload.
  for (let i = 0; i < 5; i++) {
    router.reload();
    expect(router.routes).toEqual(expected);
    const { name, src } = router.match("/posts/hello-world")!;
    expect(name).toBe("/posts/[id]");
    expect(src).toBe("https://nextjs.org/_next/static/posts/[id].tsx");
  }
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

it("MatchedRoute.params does not leak", async () => {
  using dir = tempDir("fsr-params-leak", {
    "pages/[a]/[b]/[c]/[d].tsx": "export default 1;",
  });

  // Each match()+.params access lazily allocates a QueryStringMap (param name/value
  // buffer + MultiArrayList of params) which must be freed when the MatchedRoute is
  // garbage-collected. Use long segment values so any leak is large enough to
  // dominate RSS noise.
  const code = /* ts */ `
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
    const before = process.memoryUsage.rss();

    for (let i = 0; i < 30000; i++) router.match(url).params;
    Bun.gc(true);
    const growthMB = (process.memoryUsage.rss() - before) / 1024 / 1024;
    console.error("RSS growth: " + growthMB.toFixed(2) + "MB");
    if (growthMB > 20) throw new Error("leaked " + growthMB.toFixed(2) + "MB");
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
