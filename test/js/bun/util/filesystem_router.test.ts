import { FileSystemRouter } from "bun";
import { dlopen, ptr } from "bun:ffi";
import { heapStats } from "bun:jsc";
import { beforeAll, describe, expect, it } from "bun:test";
import fs, { mkdirSync, rmSync } from "fs";
import {
  bunEnv,
  bunExe,
  dtUnknownReaddir,
  expectRssDeltaBelow,
  isASAN,
  isDebug,
  isLinux,
  isMacOS,
  isWindows,
  libcPathForDlopen,
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

it.each([
  [["[team]/settings.tsx", "[team]/[section]/[item].tsx"], { team: "bob", section: "settings", item: "profile" }],
  [["[a]/settings.tsx", "[z]/[b]/[c].tsx"], { z: "bob", b: "settings", c: "profile" }],
])("params from a route that didn't match aren't included in the result: %j", (files, params) => {
  const { dir } = make(files);
  const router = new Bun.FileSystemRouter({ dir, style: "nextjs" });
  expect(router.match("/bob/settings/profile")!.params).toEqual(params);
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

it(".query and .params hold a name that is an index once", () => {
  const { dir } = make(["posts.tsx", "[0].tsx"]);
  const router = new Bun.FileSystemRouter({ dir, style: "nextjs" });

  for (const read of [() => router.match("/posts?0=a&x=y")!.query, () => router.match("/a")!.params]) {
    expect(Object.values(read()).filter(value => value === "a")).toHaveLength(1);
    expect(Object.isFrozen(Object.freeze(read()))).toBe(true);
    const written = read();
    written[0] = "b";
    expect(Object.entries(written)[0]).toEqual(["0", "b"]);
    const deleted = read();
    expect(delete deleted[0]).toBe(true);
    expect(Object.keys(deleted)).not.toContain("0");
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

it("the constructor and reload() don't create allocator heaps", () => {
  const { dir } = make(["index.tsx", "posts/[id].tsx"]);
  const heapsCreatedBy = (fn: () => void) => {
    const before = heapStats().mimalloc.heaps.total;
    for (let i = 0; i < 50; i++) fn();
    return heapStats().mimalloc.heaps.total - before;
  };

  for (const fileExtensions of [undefined, [".tsx", ".ts"]]) {
    const create = () => new FileSystemRouter({ dir, style: "nextjs", fileExtensions });
    const router = create();
    router.reload();

    // The allocator counts another thread's heaps late, so a few can show up here.
    expect(heapsCreatedBy(create)).toBeLessThan(10);
    expect(heapsCreatedBy(() => router.reload())).toBeLessThan(10);
    expect(Object.keys(router.routes).sort()).toEqual(["/", "/posts/[id]"]);
  }
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
  }).toThrow("FileSystemRouterOptions.dir is required");

  expect(() => {
    new Bun.FileSystemRouter({
      //@ts-ignore
      dir: undefined,
      style: "nextjs",
    });
  }).toThrow("FileSystemRouterOptions.dir is required");

  expect(() => {
    new Bun.FileSystemRouter({
      //@ts-ignore
      dir: 123,
      style: "nextjs",
    });
  }).toThrow("FileSystemRouterOptions.dir must be a string");
});

it("rejects a dir with a null byte", () => {
  const { dir } = make(["index.tsx"]);
  expect(() => new FileSystemRouter({ style: "nextjs", dir: `${dir}\0suffix` })).toThrow(
    expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
  );
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
  }).toThrow("FileSystemRouterOptions.origin must be a string");
});

function routesWithExtension(extension: String) {
  using dir = tempDir("fsr-string-object", { "posts.tsx": "", "about.mdx": "" });
  const router = new Bun.FileSystemRouter({
    dir: String(dir),
    style: "nextjs",
    // @ts-expect-error
    fileExtensions: [extension],
  });
  return Object.keys(router.routes);
}

it("reads an extension that is a String object with its toString()", () => {
  expect(routesWithExtension(Object.assign(new String(""), { toString: () => ".mdx" }))).toEqual(["/about"]);
});

it("skips an extension that is a String object whose toString() is empty", () => {
  // None is left, so the default ones are used.
  expect(routesWithExtension(Object.assign(new String(".mdx"), { toString: () => "" }))).toEqual(["/posts"]);
});

it("takes options that are an array", () => {
  using dir = tempDir("fsr-array-options", { "posts.tsx": "" });
  const router = new Bun.FileSystemRouter(Object.assign([], { dir: String(dir), style: "nextjs" as const }));
  expect(Object.keys(router.routes)).toEqual(["/posts"]);
});

it("names a directory that is absent as it was joined", () => {
  using dir = tempDir("fsr-absent", {});
  for (const absent of [`${dir}${path.sep}absent`, `${dir}${path.sep}absent${path.sep}`]) {
    expect(() => new Bun.FileSystemRouter({ dir: absent, style: "nextjs" })).toThrow(
      expect.objectContaining({ name: "Error", message: `Unable to find directory: ${absent}` }),
    );
  }
});

it("refuses options that are not an object, and a route that is not a string, Request or Response", () => {
  using dir = tempDir("fsr-wrong-arguments", { "posts.tsx": "" });
  const router = new Bun.FileSystemRouter({ dir: String(dir), style: "nextjs" });
  const refusal = (message: string) =>
    expect.objectContaining({ name: "TypeError", code: "ERR_INVALID_ARG_TYPE", message });
  for (const wrong of [undefined, null, 1, "posts"]) {
    // @ts-expect-error
    expect(() => new Bun.FileSystemRouter(wrong)).toThrow(refusal("Expected object"));
  }
  for (const wrong of [undefined, null, 1, {}]) {
    // @ts-expect-error
    expect(() => router.match(wrong)).toThrow(refusal("Expected string, Request or Response"));
  }
});

it("assetPrefix and origin are what the router was given, or null", () => {
  using tmp = tempDir("fsr-asset-prefix", { "posts.tsx": "" });
  const dir = String(tmp);
  const router = new Bun.FileSystemRouter({
    dir,
    style: "nextjs",
    assetPrefix: "_next/static/",
    origin: "https://a.test",
  });
  expect(router.assetPrefix).toBe("_next/static/");
  expect(router.origin).toBe("https://a.test");
  const bare = new Bun.FileSystemRouter({ dir, style: "nextjs" });
  expect(bare.assetPrefix).toBeNull();
  expect(bare.origin).toBeNull();
  const empty = new Bun.FileSystemRouter({ dir, style: "nextjs", assetPrefix: "", origin: "" });
  expect(empty.assetPrefix).toBeNull();
  expect(empty.origin).toBeNull();
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
  // Bun.build's entry-point resolution runs on the bundler thread and rewrites
  // the process-global directory-entry cache in place. On the main thread,
  // reload() drops the records of the same directories from that cache and
  // Bun.resolveSync() reads them into it again.
  // Run in a subprocess so a crash is observable as a signal instead of taking
  // down the test runner.
  // On a debug build the builds of 40 rounds alone take longer than the test may run.
  const rounds = isDebug ? 10 : 40;
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
      // directory listing in place. The reload loop races that in-place re-read.
      await Bun.build({ entrypoints, target: "bun", throw: false });
      let matches = 0;
      let resolved = 0;
      let buildsOk = true;
      for (let round = 0; round < ${rounds}; round++) {
        const builds = Array.from({ length: 4 }, () =>
          Bun.build({ entrypoints, target: "bun", throw: false }),
        );
        for (let i = 0; i < 50; i++) {
          router.reload();
          const m = router.match("/p7");
          if (m && m.filePath.endsWith("p7.tsx")) matches++;
          if (Bun.resolveSync("./sub/s7.tsx", pagesDir).endsWith("s7.tsx")) resolved++;
          try {
            Bun.resolveSync("./missing.tsx", pagesDir);
          } catch {
            resolved++;
          }
        }
        const results = await Promise.all(builds);
        buildsOk &&= results.every(r => r.success);
      }
      console.log("matches", matches, "resolved", resolved, "builds-ok", buildsOk);
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
  }).toEqual({
    stdout: `matches ${rounds * 50} resolved ${rounds * 100} builds-ok true`,
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });
}, 60_000);

it("loads routes from a directory already cached by Bun.build()", async () => {
  // The resolver has the directory cached, and under a name without a trailing
  // slash while the router spells it with one. The router names its routes from
  // its own walk of the directory. Run in a subprocess so a crash is
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

it("throws ERR_STRING_TOO_LONG for an origin or assetPrefix over the string limit", async () => {
  using dir = tempDir("fsr-string-limit", { "index.tsx": "export default 1;" });
  const code = /* js */ `
    const dir = process.argv[1];
    const LIMIT = 64 * 1024;
    const pad = (prefix, len) => prefix + Buffer.alloc(len - prefix.length, "x").toString();
    const attempt = (key, value) => {
      try {
        new Bun.FileSystemRouter({ dir, style: "nextjs", [key]: value });
        return "ok";
      } catch (e) {
        return e?.code ?? e?.name;
      }
    };
    console.log(
      JSON.stringify({
        originAtLimit: attempt("origin", pad("https://a.example/", LIMIT)),
        originPastLimit: attempt("origin", pad("https://b.example/", LIMIT + 1)),
        originPastLimitAgain: attempt("origin", pad("https://b.example/", LIMIT + 1)),
        assetPrefixPastLimit: attempt("assetPrefix", pad("/static/", LIMIT + 1)),
      }),
    );
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code, String(dir)],
    env: { ...bunEnv, BUN_FEATURE_FLAG_SYNTHETIC_MEMORY_LIMIT: String(64 * 1024) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({
    stdout: {
      originAtLimit: "ok",
      originPastLimit: "ERR_STRING_TOO_LONG",
      originPastLimitAgain: "ERR_STRING_TOO_LONG",
      assetPrefixPastLimit: "ERR_STRING_TOO_LONG",
    },
    stderr: "",
    exitCode: 0,
  });
});

it(".query and .params support names that look like array indices", () => {
  const { dir } = make(["posts.tsx", "[0].tsx"]);
  const router = new Bun.FileSystemRouter({ dir, style: "nextjs" });

  const query = router.match("/posts?0=a&0=b&1=c&x=y")!.query;
  expect(query).toEqual({ 0: ["a", "b"], 1: "c", x: "y" });
  expect(query[0]).toEqual(["a", "b"]);

  const params = router.match("/hello")!.params;
  expect(params).toEqual({ 0: "hello" });
  expect(params[0]).toBe("hello");
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
    expect(() => routerOver(pages)).toThrow(`Unable to find directory: ${pages}`);

    fs.mkdirSync(pages);
    fs.writeFileSync(path.join(pages, "a.tsx"), page);
    expect(routeNames(routerOver(pages))).toEqual(["/a"]);
  });

  it("a directory removed after a router read it", () => {
    using dir = tempDir("fsr-fresh-removed", { "pages/a.tsx": page });
    const pages = path.join(String(dir), "pages");
    expect(routeNames(routerOver(pages))).toEqual(["/a"]);

    fs.rmSync(pages, { recursive: true });
    expect(() => routerOver(pages)).toThrow(
      expect.objectContaining({ name: "Error", message: `Unable to find directory: ${pages}` }),
    );
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

describe("a directory that the resolver looked for before it existed", () => {
  // Each of these leaves a "not found" record of `pages/blog` and of `pages/blog/deep` in the resolver.
  const lookups: Record<string, (pages: string) => unknown> = {
    "Bun.resolveSync()": pages => [
      expect(() => Bun.resolveSync("./blog/post", pages)).toThrow(notFound),
      expect(() => Bun.resolveSync("./blog/deep/post", pages)).toThrow(notFound),
    ],
    "require()": pages => [
      expect(() => require(path.join(pages, "blog", "post.tsx"))).toThrow(),
      expect(() => require(path.join(pages, "blog", "deep", "post.tsx"))).toThrow(),
    ],
    "import()": async pages => [
      await expect(import(path.join(pages, "blog", "post.tsx"))).rejects.toThrow(),
      await expect(import(path.join(pages, "blog", "deep", "post.tsx"))).rejects.toThrow(),
    ],
  };
  const expected = { "/a": "a.tsx", "/blog/deep/post": "blog/deep/post.tsx", "/blog/post": "blog/post.tsx" };
  const create = (pages: string) => {
    fs.mkdirSync(path.join(pages, "blog", "deep"), { recursive: true });
    fs.writeFileSync(path.join(pages, "blog", "post.tsx"), page);
    fs.writeFileSync(path.join(pages, "blog", "deep", "post.tsx"), page);
  };

  it.each(Object.keys(lookups))("is listed by the first reload() after %s missed it", async lookup => {
    using dir = tempDir("fsr-reload-not-found", { "pages/a.tsx": page });
    const pages = path.join(String(dir), "pages");
    const router = routerOver(pages);
    await lookups[lookup](pages);
    create(pages);

    router.reload();
    expect(routesBelow(router, pages)).toEqual(expected);
  });

  it.each(Object.keys(lookups))("is listed by a new router after %s missed it", async lookup => {
    using dir = tempDir("fsr-new-not-found", { "pages/a.tsx": page });
    const pages = path.join(String(dir), "pages");
    await lookups[lookup](pages);
    create(pages);

    expect(routesBelow(routerOver(pages), pages)).toEqual(expected);
  });
});

describe("bun --hot", () => {
  /** Runs `server.js` under `--hot`, calls `change` after its first line, and returns all it wrote when it exits. */
  async function run(root: string, firstLine: string, change: () => void) {
    await using runner = Bun.spawn({
      cmd: [bunExe(), "--hot", "--no-clear-screen", "server.js"],
      env: bunEnv,
      cwd: root,
      stdout: "pipe",
      stderr: "inherit",
      stdin: "ignore",
    });
    const reader = runner.stdout.getReader();
    const decoder = new TextDecoder();
    let stdout = "";
    while (!stdout.includes("\n")) {
      const { value, done } = await reader.read();
      if (done) break;
      stdout += decoder.decode(value, { stream: true });
    }
    expect(stdout).toBe(firstLine);
    change();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      stdout += decoder.decode(value, { stream: true });
    }
    return { stdout, exitCode: await runner.exited };
  }

  it("a module-level router lists the pages added since the last run", async () => {
    const server = (run: number) => `
      const router = new Bun.FileSystemRouter({ style: "nextjs", dir: import.meta.dir + "/pages" });
      console.log("run ${run}: " + Object.keys(router.routes).sort().join(" "));
      ${run === 2 ? "process.exit(0);" : ""}
    `;
    using dir = tempDir("fsr-hot-new", { "server.js": server(1), "pages/index.tsx": page, "pages/blog/a.tsx": page });
    const root = String(dir);
    const result = await run(root, "run 1: / /blog/a\n", () => {
      fs.writeFileSync(path.join(root, "pages", "new.tsx"), page);
      fs.writeFileSync(path.join(root, "pages", "blog", "b.tsx"), page);
      fs.writeFileSync(path.join(root, "server.js"), server(2));
    });
    expect(result).toEqual({ stdout: "run 1: / /blog/a\nrun 2: / /blog/a /blog/b /new\n", exitCode: 0 });
  });

  // With inotify the reloader finds the module of a renamed file through the resolver's record of its directory,
  // which reload() drops. Each case saves `saved` by a rename after the first run.
  const router = `new Bun.FileSystemRouter({ style: "nextjs", dir: import.meta.dir + "/pages", fileExtensions: [".tsx", ".js"] })`;
  const cases: Record<string, { files: Record<string, string>; saved: string; link?: [string, string] }> = {
    "a route after reload()": {
      files: {
        "server.js": `const router = ${router};
          const imported = await import(router.match("/blog/post").filePath);
          router.reload();`,
        "pages/blog/post.tsx": "export default 1;\n",
      },
      saved: "pages/blog/post.tsx",
    },
    "a module that a route imports after reload()": {
      files: {
        "server.js": `const router = ${router};
          const imported = await import(router.match("/blog/post").filePath);
          router.reload();`,
        "pages/blog/post.tsx": `export { default } from "./helper.ts";\n`,
        "pages/blog/helper.ts": "export default 1;\n",
      },
      saved: "pages/blog/helper.ts",
    },
    "a file with a route extension that is not the route after reload()": {
      files: {
        "server.js": `const router = ${router};
          const imported = await import("./pages/index.tsx");
          router.reload();`,
        "pages/index.js": "export default 0;\n",
        "pages/index.tsx": "export default 1;\n",
      },
      saved: "pages/index.tsx",
    },
    "a module below a linked directory after reload()": {
      files: {
        "server.js": `const router = ${router};
          const imported = await import("./pages/lib/config.ts");
          router.reload();`,
        "pages/a.tsx": "export default 0;\n",
        "shared/config.ts": "export default 1;\n",
      },
      link: ["shared", "pages/lib"],
      saved: "shared/config.ts",
    },
    "a route after reload() in a Worker": {
      files: {
        "server.js": `const router = ${router};
          const imported = await import(router.match("/blog/post").filePath);
          const worker = new Worker(import.meta.dir + "/worker.js");
          await new Promise(done => (worker.onmessage = done));
          worker.terminate();`,
        "worker.js": `${router}.reload();
          postMessage("reloaded");`,
        "pages/blog/post.tsx": "export default 1;\n",
      },
      saved: "pages/blog/post.tsx",
    },
  };
  it.skipIf(!isLinux).each(Object.keys(cases))("a save by a rename reloads %s", async name => {
    const { files, saved, link } = cases[name];
    files["server.js"] += `
      console.log("version " + imported.default);
      if (imported.default === 2) process.exit(0);
    `;
    using dir = tempDir("fsr-hot-reload", { ...files, "saved": "export default 2;\n" });
    const root = String(dir);
    if (link) fs.symlinkSync(path.join(root, link[0]), path.join(root, link[1]));
    const result = await run(root, "version 1\n", () => {
      fs.renameSync(path.join(root, "saved"), path.join(root, saved));
    });
    expect(result).toEqual({ stdout: "version 1\nversion 2\n", exitCode: 0 });
  });
});

it("routes and match() keep the scan they came from until reload()", () => {
  using dir = tempDir("fsr-scan-snapshot", { "pages/a.tsx": page, "pages/old.tsx": page, "pages/[id]/post.tsx": page });
  const pages = path.join(String(dir), "pages");
  const read = (matched: ReturnType<FileSystemRouter["match"]>) => ({
    name: matched!.name,
    filePath: path.relative(pages, matched!.filePath).replaceAll("\\", "/"),
    src: matched!.src,
    kind: matched!.kind,
    params: matched!.params,
    query: matched!.query,
  });
  const router = routerOver(pages);
  // Not read before the route table they came from is gone.
  const matched = [router.match("/old"), router.match("/42/post?tab=a")];

  fs.writeFileSync(path.join(pages, "new.tsx"), page);
  fs.rmSync(path.join(pages, "old.tsx"));
  fs.rmSync(path.join(pages, "[id]"), { recursive: true });
  expect({ names: routeNames(router), old: router.match("/old")?.name, new: router.match("/new") }).toEqual({
    names: ["/[id]/post", "/a", "/old"],
    old: "/old",
    new: null,
  });

  router.reload();
  expect({ names: routeNames(router), old: router.match("/old"), new: router.match("/new")?.name }).toEqual({
    names: ["/a", "/new"],
    old: null,
    new: "/new",
  });
  router.reload();
  Bun.gc(true);
  expect(matched.map(read)).toEqual([
    { name: "/old", filePath: "old.tsx", src: "old.tsx", kind: "exact", params: {}, query: {} },
    {
      name: "/[id]/post",
      filePath: "[id]/post.tsx",
      src: "[id]/post.tsx",
      kind: "dynamic",
      params: { id: "42" },
      query: { id: "42", tab: "a" },
    },
  ]);

  // A match also outlives the router it came from.
  const orphan = (() => routerOver(pages).match("/new"))();
  Bun.gc(true);
  expect(read(orphan)).toEqual({
    name: "/new",
    filePath: "new.tsx",
    src: "new.tsx",
    kind: "exact",
    params: {},
    query: {},
  });
});

const notFound = expect.objectContaining({ code: "ERR_MODULE_NOT_FOUND" });
/** What the resolver answers for `specifier` from `from`: a path below `from`, or "not found". */
const resolved = (specifier: string, from: string) => {
  try {
    return path.relative(from, Bun.resolveSync(specifier, from)).replaceAll("\\", "/");
  } catch {
    return "not found";
  }
};

it("reload() finds a directory that was deleted and created again", () => {
  using dir = tempDir("fsr-reload-recreated", { "pages/keep.tsx": page, "pages/a/b/one.tsx": page });
  const pages = path.join(String(dir), "pages");
  const router = routerOver(pages);
  expect(routeNames(router)).toEqual(["/a/b/one", "/keep"]);

  fs.rmSync(path.join(pages, "a"), { recursive: true });
  router.reload();
  expect(routeNames(router)).toEqual(["/keep"]);

  fs.mkdirSync(path.join(pages, "a", "b"), { recursive: true });
  fs.writeFileSync(path.join(pages, "a", "b", "two.tsx"), page);
  router.reload();
  expect({ routes: routesBelow(router, pages), one: router.match("/a/b/one") }).toEqual({
    routes: { "/a/b/two": "a/b/two.tsx", "/keep": "keep.tsx" },
    one: null,
  });

  // Nothing changed since the last scan.
  router.reload();
  expect(routeNames(router)).toEqual(["/a/b/two", "/keep"]);
});

it("reload() throws while dir is gone, keeps its routes, and lists dir again when it is back", () => {
  using dir = tempDir("fsr-reload-root-gone", { "pages/keep.tsx": page, "pages/a/b/one.tsx": page });
  const pages = path.join(String(dir), "pages");
  const router = routerOver(pages);
  const held = router.match("/a/b/one")!;
  const ask = () => [resolved("./keep.tsx", pages), resolved("./a/b/one.tsx", pages)];
  // The resolver has a record of each directory from here on.
  expect(ask()).toEqual(["keep.tsx", "a/b/one.tsx"]);

  fs.rmSync(pages, { recursive: true });
  const gone = expect.objectContaining({ name: "Error", message: `Unable to find directory: ${pages}${path.sep}` });
  expect(() => router.reload()).toThrow(gone);
  // A reload() that fails keeps the last route table.
  expect({ names: routeNames(router), held: path.relative(pages, held.filePath).replaceAll("\\", "/") }).toEqual({
    names: ["/a/b/one", "/keep"],
    held: "a/b/one.tsx",
  });
  // The resolver finds no module below a directory that reload() did not find.
  expect(ask()).toEqual(["not found", "not found"]);
  expect(() => router.reload()).toThrow(gone);

  fs.mkdirSync(path.join(pages, "a", "b"), { recursive: true });
  fs.writeFileSync(path.join(pages, "a", "b", "two.tsx"), page);
  router.reload();
  expect(routesBelow(router, pages)).toEqual({ "/a/b/two": "a/b/two.tsx" });
});

it("after reload(), the resolver finds no module in a directory that was renamed or removed", () => {
  using dir = tempDir("fsr-reload-removed", {
    "pages/a.tsx": page,
    "pages/blog/post.tsx": page,
    "pages/gone/deep/b.tsx": page,
  });
  const pages = path.join(String(dir), "pages");
  const router = routerOver(pages);
  const ask = () =>
    ["./blog/post.tsx", "./posts/post.tsx", "./gone/deep/b.tsx"].map(specifier => resolved(specifier, pages));
  expect(ask()).toEqual(["blog/post.tsx", "not found", "gone/deep/b.tsx"]);

  fs.renameSync(path.join(pages, "blog"), path.join(pages, "posts"));
  fs.rmSync(path.join(pages, "gone"), { recursive: true });
  router.reload();
  expect({ routes: routeNames(router), resolver: ask() }).toEqual({
    routes: ["/a", "/posts/post"],
    resolver: ["not found", "posts/post.tsx", "not found"],
  });
});

it("reload() finds what is new in a directory that the resolver cached before the router listed it", () => {
  using dir = tempDir("fsr-reload-resolver-first", { "pages/keep.tsx": page });
  const pages = path.join(String(dir), "pages");
  const router = routerOver(pages);
  expect(routeNames(router)).toEqual(["/keep"]);

  // Each failed lookup leaves a "not found" record for the directory.
  expect(() => Bun.resolveSync("./n/one.tsx", pages)).toThrow(notFound);
  expect(() => Bun.resolveSync("./n/m/two.tsx", pages)).toThrow(notFound);
  fs.mkdirSync(path.join(pages, "n", "m"), { recursive: true });
  fs.writeFileSync(path.join(pages, "n", "one.tsx"), page);
  fs.writeFileSync(path.join(pages, "n", "m", "two.tsx"), page);

  // This lookup leaves a listing of `seen` that has only `one.tsx`.
  fs.mkdirSync(path.join(pages, "seen"));
  fs.writeFileSync(path.join(pages, "seen", "one.tsx"), page);
  expect(resolved("./seen/one.tsx", pages)).toBe("seen/one.tsx");
  fs.writeFileSync(path.join(pages, "seen", "two.tsx"), page);

  router.reload();
  expect(routesBelow(router, pages)).toEqual({
    "/keep": "keep.tsx",
    "/n/m/two": "n/m/two.tsx",
    "/n/one": "n/one.tsx",
    "/seen/one": "seen/one.tsx",
    "/seen/two": "seen/two.tsx",
  });
});

// Replay a failure with BUN_FSR_RELOAD_SEED=<seed>.
it("reload() and a new router list what is on disk after random changes to the directories", () => {
  const seed = Number(process.env.BUN_FSR_RELOAD_SEED ?? 3) >>> 0;
  let state = seed;
  const int = (n: number) => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
  };
  using tmp = tempDir("fsr-reload-model", { "keep.tsx": "" });
  const dir = String(tmp).replaceAll("\\", "/");

  // directory ("" is the root, "/d0/d2") -> names of the route files in it
  const tree = new Map<string, Set<string>>([["", new Set(["keep"])]]);
  const anyDir = () => [...tree.keys()][int(tree.size)];
  const ops = [
    function touch() {
      const parent = anyDir();
      const name = `f${int(3)}`;
      fs.writeFileSync(`${dir}${parent}/${name}.tsx`, "");
      tree.get(parent)!.add(name);
      return `touch ${parent}/${name}.tsx`;
    },
    function makeDirs() {
      let child = anyDir();
      for (let i = 1 + int(2); i > 0 && child.split("/").length < 4; i--) {
        child += `/d${int(3)}`;
        if (!tree.has(child)) tree.set(child, new Set());
      }
      mkdirSync(dir + child, { recursive: true });
      return `mkdir -p ${child}`;
    },
    function removeDir() {
      const gone = anyDir();
      if (!gone) return "nothing";
      rmSync(dir + gone, { recursive: true, force: true });
      for (const key of [...tree.keys()]) if (key === gone || key.startsWith(gone + "/")) tree.delete(key);
      return `rm -rf ${gone}`;
    },
    // What a failed import leaves in the resolver's cache for a directory.
    function failedResolve() {
      const from = `${anyDir()}/d${int(3)}`;
      expect(() => Bun.resolveSync("./missing.tsx", dir + from)).toThrow(notFound);
      return `resolve in ${from}`;
    },
  ];

  const router = new FileSystemRouter({ dir, style: "nextjs" });
  const history: string[] = [];
  for (let round = 0; round < 100; round++) {
    const steps: string[] = [];
    for (let i = 1 + int(3); i > 0; i--) steps.push(ops[int(ops.length)]());
    history.push(steps.join("; "));
    router.reload();
    const onDisk = Object.fromEntries(
      [...tree].flatMap(([parent, names]) =>
        [...names].map(name => [`${parent}/${name}`, `${dir}${parent}/${name}.tsx`]),
      ),
    );
    const context = { seed, round, last: history.slice(-4) };
    expect({ ...context, routes: router.routes }).toEqual({ ...context, routes: onDisk });
    if (round % 10 === 9) {
      expect({ ...context, routes: new FileSystemRouter({ dir, style: "nextjs" }).routes }).toEqual({
        ...context,
        routes: onDisk,
      });
    }
  }
});

// inotify
it.skipIf(!isLinux)("reload() and a new router open each directory once", () => {
  using dir = tempDir("fsr-reload-once-inotify", { "pages/index.tsx": "", "pages/sub/page.tsx": "" });
  const pages = path.join(String(dir), "pages");
  const libc = dlopen(libcPathForDlopen(), {
    inotify_init1: { args: ["int"], returns: "int" },
    inotify_add_watch: { args: ["int", "ptr", "u32"], returns: "int" },
    read: { args: ["int", "ptr", "usize"], returns: "isize" },
    close: { args: ["int"], returns: "int" },
  });
  const IN_CLOSE_NOWRITE = 0x10;
  const IN_OPEN = 0x20;
  const IN_NONBLOCK = 0o4000;
  const fd = libc.symbols.inotify_init1(IN_NONBLOCK);
  try {
    expect(fd).toBeGreaterThan(-1);
    // The close between two opens of one directory keeps them from being merged into one queued event.
    const watch = (p: string) => libc.symbols.inotify_add_watch(fd, Buffer.from(p + "\0"), IN_OPEN | IN_CLOSE_NOWRITE);
    const router = routerOver(pages);
    const watched = { root: watch(pages), sub: watch(path.join(pages, "sub")) };
    expect(Math.min(watched.root, watched.sub)).toBeGreaterThan(-1);
    const buf = new Uint8Array(1 << 16);
    const view = new DataView(buf.buffer);
    const opens = () => {
      const counts = { root: 0, sub: 0 };
      for (;;) {
        const length = Number(libc.symbols.read(fd, ptr(buf), buf.length));
        if (length <= 0) break;
        for (let offset = 0; offset < length;) {
          const descriptor = view.getInt32(offset, true);
          const mask = view.getUint32(offset + 4, true);
          const nameLength = view.getUint32(offset + 12, true);
          // No name: the event is about the watched directory itself.
          if (nameLength === 0 && mask & IN_OPEN) {
            if (descriptor === watched.root) counts.root++;
            if (descriptor === watched.sub) counts.sub++;
          }
          offset += 16 + nameLength;
        }
      }
      return counts;
    };
    router.reload();
    expect(opens()).toEqual({ root: 1, sub: 1 });
    router.reload();
    expect(opens()).toEqual({ root: 1, sub: 1 });
    expect(routeNames(router)).toEqual(["/", "/sub/page"]);
    // A new router reads each directory once too, whatever the resolver has cached.
    routerOver(pages);
    expect(opens()).toEqual({ root: 1, sub: 1 });
  } finally {
    libc.symbols.close(fd);
    libc.close();
  }
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

it("a dir that is a file, is below a file, is a link to itself or has a name too long is not found", () => {
  using dir = tempDir("fsr-root-absent", { "file.tsx": page });
  const root = String(dir);
  const absent = [path.join(root, "file.tsx"), path.join(root, "file.tsx", "below")];
  // Windows has other errors for these two, and a junction does not lead to itself.
  if (!isWindows) {
    fs.symlinkSync("loop", path.join(root, "loop"));
    absent.push(path.join(root, "loop"), path.join(root, Buffer.alloc(300, "a").toString()));
  }
  const messages = absent.map(pages => {
    try {
      routerOver(pages);
      return "no error";
    } catch (e) {
      return `${(e as Error).name}: ${(e as Error).message}`;
    }
  });
  expect(messages).toEqual(absent.map(pages => `Error: Unable to find directory: ${pages}`));
});

// The owner of a file reads it on Windows whatever its mode is.
it.skipIf(isWindows)("an unreadable dir is an error, and what is unreadable below it is left out", async () => {
  using dir = tempDir("fsr-no-access", {
    "locked/a.tsx": page,
    "pages/a.tsx": page,
    "pages/private/b.tsx": page,
    "pages/secret.tsx": page,
    "elsewhere/hidden.tsx": page,
    "elsewhere/sealed/c.tsx": page,
  });
  const root = String(dir);
  const pages = path.join(root, "pages");
  fs.symlinkSync(path.join(root, "elsewhere", "hidden.tsx"), path.join(pages, "to-hidden.tsx"));
  fs.symlinkSync(path.join(root, "elsewhere", "sealed", "c.tsx"), path.join(pages, "into-sealed.tsx"));
  fs.symlinkSync(path.join(root, "elsewhere", "sealed"), path.join(pages, "sealed"));
  const locked = [
    path.join(root, "locked"),
    path.join(pages, "private"),
    path.join(pages, "secret.tsx"),
    path.join(root, "elsewhere", "hidden.tsx"),
    path.join(root, "elsewhere", "sealed"),
  ];
  // Root ignores the mode of a file, so the child does not run as root.
  using unprivileged = unprivilegedSpawnOptions(root);
  for (const file of locked) fs.chmodSync(file, 0o000);
  try {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const path = require("path");
        const router = dir => new Bun.FileSystemRouter({ style: "nextjs", dir });
        let error;
        try {
          router("locked");
        } catch (e) {
          error = { code: e.code, syscall: e.syscall, path: path.basename(e.path ?? "") };
        }
        const pages = router("pages");
        const routes = () =>
          Object.fromEntries(Object.entries(pages.routes).map(([name, file]) => [name, path.relative(process.cwd(), file)]));
        const listed = routes();
        // A route file that cannot be read is a route. The import of it is what fails.
        const imported = await import(pages.match("/secret").filePath).then(
          () => "no error",
          e => /EACCES/.exec(e.message)?.[0],
        );
        pages.reload();
        console.log(JSON.stringify({ error, listed, imported, reloaded: routes() }));
        `,
      ],
      env: bunEnv,
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
      ...unprivileged,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const routes = { "/a": "pages/a.tsx", "/secret": "pages/secret.tsx", "/to-hidden": "elsewhere/hidden.tsx" };
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: JSON.stringify({
        error: { code: "EACCES", syscall: "open", path: "locked" },
        listed: routes,
        imported: "EACCES",
        reloaded: routes,
      }),
      stderr: "",
      exitCode: 0,
    });
  } finally {
    for (const file of locked) fs.chmodSync(file, 0o755);
  }
});

// ulimit: the limit of a Windows process is not one a shell sets.
it.skipIf(isWindows)("a scan with no file descriptor left is an error, not a table with routes missing", async () => {
  using dir = tempDir("fsr-no-descriptor", {
    "pages/a.tsx": page,
    "pages/sub/b.tsx": page,
    "fixture.ts": /* ts */ `
      import fs from "fs";
      import path from "path";
      const options = { style: "nextjs", dir: path.join(import.meta.dir, "pages") } as const;
      const router = new Bun.FileSystemRouter(options);
      const held: number[] = [];
      try {
        for (;;) held.push(fs.openSync(import.meta.path, "r"));
      } catch {}
      const codes: string[] = [];
      for (const scan of [() => router.reload(), () => new Bun.FileSystemRouter(options)]) {
        try {
          scan();
          codes.push("no error");
        } catch (e) {
          codes.push(e.code);
        }
      }
      const kept = Object.keys(router.routes).sort();
      for (const fd of held) fs.closeSync(fd);
      console.log(JSON.stringify({ codes, kept, reloaded: Object.keys(router.reload().routes).sort() }));
    `,
  });
  await using proc = Bun.spawn({
    cmd: ["sh", "-c", 'ulimit -n 256 && exec "$@"', "sh", bunExe(), "fixture.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
    stdout: JSON.stringify({ codes: ["EMFILE", "EMFILE"], kept: ["/a", "/sub/b"], reloaded: ["/a", "/sub/b"] }),
    stderr: "",
    exitCode: 0,
  });
});

it("follows a link to a directory", () => {
  using dir = tempDir("fsr-link-dir", {
    "pages/a.tsx": page,
    "elsewhere/folder/x.tsx": page,
    "elsewhere/folder/deep/y.tsx": page,
  });
  const root = String(dir);
  const pages = path.join(root, "pages");
  fs.symlinkSync(path.join(root, "elsewhere", "folder"), path.join(pages, "ln"), "junction");

  // The name comes from the link. The file path and `src` are those of the file the link leads to.
  const router = routerOver(pages);
  expect({
    routes: routesBelow(router, root),
    src: [router.match("/ln/x")!.src, router.match("/ln/deep/y")!.src],
  }).toEqual({
    routes: {
      "/a": "pages/a.tsx",
      "/ln/deep/y": "elsewhere/folder/deep/y.tsx",
      "/ln/x": "elsewhere/folder/x.tsx",
    },
    src: ["../elsewhere/folder/x.tsx", "../elsewhere/folder/deep/y.tsx"],
  });
});

// A link to a file needs a privilege on Windows.
const canLinkToFile = (() => {
  if (!isWindows) return true;
  using probe = tempDir("fsr-link-probe", { "target": "" });
  try {
    fs.symlinkSync(path.join(String(probe), "target"), path.join(String(probe), "link"), "file");
    return true;
  } catch (err: any) {
    if (err.code === "EPERM" || err.code === "EACCES") return false;
    throw err;
  }
})();

it.skipIf(!canLinkToFile)("follows a link to a file", () => {
  using dir = tempDir("fsr-link-file", { "pages/a.tsx": page, "elsewhere/deep/target.tsx": page });
  const root = String(dir);
  const pages = path.join(root, "pages");
  fs.symlinkSync(path.join(root, "elsewhere", "deep", "target.tsx"), path.join(pages, "s.tsx"), "file");
  // A link to a link to the file.
  fs.symlinkSync("s.tsx", path.join(pages, "t.tsx"), "file");

  const router = routerOver(pages);
  expect({ routes: routesBelow(router, root), src: router.match("/s")!.src }).toEqual({
    routes: { "/a": "pages/a.tsx", "/s": "elsewhere/deep/target.tsx", "/t": "elsewhere/deep/target.tsx" },
    src: "../elsewhere/deep/target.tsx",
  });
});

it("skips a link to nothing", () => {
  using dir = tempDir("fsr-link-nowhere", { "pages/a.tsx": page });
  const root = String(dir);
  const pages = path.join(root, "pages");
  // A junction is a link to a directory on Windows. Elsewhere the type is not used.
  fs.symlinkSync(path.join(root, "nowhere.tsx"), path.join(pages, "dangling.tsx"), "junction");
  fs.symlinkSync(path.join(root, "nowhere"), path.join(pages, "dangling"), "junction");
  if (canLinkToFile) fs.symlinkSync(path.join(root, "nowhere.tsx"), path.join(pages, "gone.tsx"), "file");
  if (!isWindows) {
    // To itself, to below a file, and to a name that is too long.
    fs.symlinkSync("loop.tsx", path.join(pages, "loop.tsx"));
    fs.symlinkSync("a.tsx/below.tsx", path.join(pages, "below-file.tsx"));
    fs.symlinkSync(Buffer.alloc(300, "n").toString(), path.join(pages, "long.tsx"));
  }
  expect(routeNames(routerOver(pages))).toEqual(["/a"]);
});

// mkfifo: Windows has no FIFO in a directory.
it.skipIf(isWindows)("skips a FIFO and a link to a FIFO", async () => {
  using dir = tempDir("fsr-not-a-file", { "pages/a.tsx": page });
  const root = String(dir);
  const pages = path.join(root, "pages");
  expect(Bun.spawnSync(["mkfifo", path.join(pages, "fifo.tsx"), path.join(root, "fifo-target")]).exitCode).toBe(0);
  fs.symlinkSync(path.join(root, "fifo-target"), path.join(pages, "link-to-fifo.tsx"));

  // In a subprocess: a router that opens a FIFO to learn its path never returns.
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

it("a link that leads back into the tree is not followed again", () => {
  using dir = tempDir("fsr-link-cycle", {
    "one/a.tsx": page,
    "two/a.tsx": page,
    "two/sub/b.tsx": page,
    "three/a.tsx": page,
    "three/sub/deeper/c.tsx": page,
  });
  const [one, two, three] = ["one", "two", "three"].map(name => path.join(String(dir), name));
  // To the routes directory from it and from below it, and to a directory below it.
  fs.symlinkSync(one, path.join(one, "self"), "junction");
  fs.symlinkSync(two, path.join(two, "sub", "up"), "junction");
  fs.symlinkSync(path.join(three, "sub"), path.join(three, "sub", "deeper", "back"), "junction");
  expect({
    one: routeNames(routerOver(one)),
    two: routeNames(routerOver(two)),
    three: routeNames(routerOver(three)),
  }).toEqual({
    one: ["/a"],
    two: ["/a", "/sub/b"],
    three: ["/a", "/sub/deeper/c"],
  });
});

// On Windows the bound is what 16 bits count and not the length of a path: 1,285 junctions deep.
it.skipIf(isWindows)("a chain of links ends where a route name is as long as a path can be", async () => {
  // Each link adds 51 bytes to the name of a route and leads to a directory with a short path,
  // so the length of a path does not end the walk. The whole chain makes a name of 71,400 bytes.
  using dir = tempDir("fsr-link-chain", {
    "fixture.ts": /* ts */ `
      import fs from "fs";
      import path from "path";
      const root = import.meta.dir;
      const link = Buffer.alloc(50, "l").toString();
      fs.mkdirSync(path.join(root, "pages"));
      for (let i = 0; i < 1400; i++) {
        fs.mkdirSync(path.join(root, "d" + i));
        fs.writeFileSync(path.join(root, "d" + i, "p.tsx"), "");
        fs.symlinkSync(path.join(root, "d" + i), path.join(root, i === 0 ? "pages" : "d" + (i - 1), link));
      }
      const names = Object.keys(new Bun.FileSystemRouter({ style: "nextjs", dir: path.join(root, "pages") }).routes);
      console.log(JSON.stringify({ routes: names.length, longest: Math.max(...names.map(name => name.length)) }));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // A route's directory and file name are shorter than PATH_MAX: 4096 bytes on Linux, 1024 on macOS.
  const expected = isLinux ? { routes: 80, longest: 4082 } : { routes: 19, longest: 971 };
  expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toEqual({
    stdout: JSON.stringify(expected) + "\n",
    stderr: "",
    exitCode: 0,
    signalCode: null,
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

it("reload() and new routers in a loop keep no memory of the scans before", async () => {
  const files: Record<string, string> = {};
  for (let i = 0; i < 50; i++) files[`pages/folder-${i}/Route-${i}.tsx`] = "";
  using dir = tempDir("fsr-scan-memory", files);

  // Each reload() used to leave the resolver's records of 51 directories behind: about 420 KB.
  const code = /* ts */ `
    const options = { style: "nextjs", dir: ${JSON.stringify(path.join(String(dir), "pages"))} };
    const router = new Bun.FileSystemRouter(options);
    const scan = count => {
      for (let i = 0; i < count; i++) {
        router.reload();
        new Bun.FileSystemRouter(options);
      }
      Bun.gc(true);
    };
    scan(20);
    const before = process.memoryUsage.rss();
    scan(100);
    console.log(JSON.stringify({ deltaMiB: (process.memoryUsage.rss() - before) / 1024 / 1024 }));
  `;
  await expectRssDeltaBelow(["-e", code], { release: 10, debug: 10 });
});

describe("two files for one route", () => {
  const message = (pages: string, root: string) => {
    try {
      routerOver(pages);
      return "no error";
    } catch (e) {
      return (e as Error).message.replaceAll("\\", "/").replaceAll(root.replaceAll("\\", "/"), "<root>");
    }
  };

  // The walk reads the names of a directory in their order without case, and a directory before what is below the next name.
  it("the first file of the walk defines a route, and the next is an error for a new router", () => {
    using dir = tempDir("fsr-duplicate", {
      "static/a.tsx": page,
      "static/a.ts": page,
      "static/b.tsx": page,
      "dynamic/[id].tsx": page,
      "dynamic/[id].ts": page,
      "index/blog/index.tsx": page,
      "index/blog/index.ts": page,
      "folder/blog.tsx": page,
      "folder/blog/index.tsx": page,
      "case/Home.tsx": page,
      "case/home/index.tsx": page,
      "dynamic-case/[Id].tsx": page,
      "dynamic-case/[id].ts": page,
    });
    const root = String(dir);
    const trees = ["static", "dynamic", "index", "folder", "case", "dynamic-case"];
    expect(trees.map(tree => message(path.join(root, tree), root))).toEqual([
      `Route "/a" is already defined by <root>/static/a.ts`,
      `Route "/[id]" is already defined by <root>/dynamic/[id].ts`,
      `Route "/blog" is already defined by <root>/index/blog/index.ts`,
      `Route "/blog" is already defined by <root>/folder/blog/index.tsx`,
      `Route "/Home" is already defined by <root>/case/home/index.tsx`,
      `Route "/[Id]" is already defined by <root>/dynamic-case/[id].ts`,
    ]);
  });

  it("reload() keeps the first file of the walk for a route", () => {
    using dir = tempDir("fsr-duplicate-reload", {
      "pages/a.tsx": page,
      "pages/[id].tsx": page,
      "pages/blog/index.tsx": page,
    });
    const pages = path.join(String(dir), "pages");
    const router = routerOver(pages);
    for (const file of ["a.ts", "[id].ts", "blog/index.ts", "blog.tsx"]) fs.writeFileSync(path.join(pages, file), page);
    router.reload();
    expect(routesBelow(router, pages)).toEqual({ "/[id]": "[id].ts", "/a": "a.ts", "/blog": "blog/index.ts" });
  });

  it("the first index file of the walk is the index route, with no error", () => {
    using dir = tempDir("fsr-index-files", {
      "pages/index.tsx": page,
      "pages/index.ts": page,
      "pages/index.js": page,
      "pages/index.jsx": page,
    });
    const pages = path.join(String(dir), "pages");
    const index = (fileExtensions?: string[]) => {
      const router = routerOver(pages, { fileExtensions });
      return { routes: routesBelow(router, pages), match: path.relative(pages, router.match("/")!.filePath) };
    };
    expect([index(), index([".tsx", ".ts"])]).toEqual([
      { routes: { "/": "index.js" }, match: "index.js" },
      { routes: { "/": "index.ts" }, match: "index.ts" },
    ]);
  });

  // Names that differ only in case are one name on macOS and Windows.
  it.skipIf(!isLinux)("of names that differ only in case, the route is the one an import loads", async () => {
    const files = ["About.tsx", "about.tsx", "B.tsx", "b.tsx", "page.tsx", "PAGE.tsx", "Blog/x.tsx", "blog/x.tsx"];
    // A route extension in another case is not one.
    files.push("c.tsx", "C.TSX", "[Id].tsx", "[id].tsx", "Gone.tsx");
    using dir = tempDir(
      "fsr-case-twins",
      Object.fromEntries(files.map(file => [`pages/${file}`, `export default ${JSON.stringify(file)};\n`])),
    );
    const pages = path.join(String(dir), "pages");
    // The resolver has this name for `Gone.tsx` if the directory returns it last.
    fs.symlinkSync("nowhere", path.join(pages, "gone.tsx"));
    const router = routerOver(pages);
    const routes = Object.entries(routesBelow(router, pages));
    const loaded = await Promise.all(
      routes.map(async ([name, file]) => [name, (await import(path.join(pages, file))).default]),
    );
    // One route for each of the first five pairs. The last two pairs have a name that is no route.
    expect({ count: routes.length >= 5 && routes.length <= 7, loaded }).toEqual({ count: true, loaded: routes });
    router.reload();
    expect(Object.entries(routesBelow(router, pages))).toEqual(routes);
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

it("after reload(), the resolver reads again each directory that the scan read", async () => {
  using dir = tempDir("fsr-reload-resolver", {
    "fixture.ts": /* ts */ `
      import fs from "fs";
      import path from "path";
      const root = import.meta.dir;
      const pages = path.join(root, "pages");
      const elsewhere = path.join(root, "elsewhere");
      const other = path.join(root, "other");
      const [linked, real] = ["linked", "real"].map(name => path.join(root, name, "pages"));
      const resolve = (specifier: string, from: string) => {
        try {
          return path.relative(root, Bun.resolveSync(specifier, from)).replaceAll("\\\\", "/");
        } catch {
          return "not found";
        }
      };
      const build = async () =>
        (await Bun.build({ entrypoints: [path.join(pages, "entry.tsx")], target: "bun", throw: false })).success;
      // Each answer comes from a directory that the resolver has a record of after the first call.
      const ask = async () => ({
        file: resolve("./x", pages),
        below: resolve("./sub/y", pages),
        twoBelow: resolve("./sub/deep/v", pages),
        linkInside: [resolve("./ln/z", pages), resolve("./z", elsewhere)],
        belowLinkInside: [resolve("./ln/deep/u", pages), resolve("./deep/u", elsewhere)],
        linkToDir: [resolve("./w", linked), resolve("./w", real)],
        twoBelowLinkToDir: [resolve("./sub/deep/s", linked), resolve("./sub/deep/s", real)],
        linkBelowLinkToDir: [resolve("./via/m", linked), resolve("./via/m", real), resolve("./m", other)],
        caseOfName: resolve("./renamed.tsx", pages),
        build: await build(),
      });

      const router = new Bun.FileSystemRouter({ style: "nextjs", dir: pages });
      const throughLink = new Bun.FileSystemRouter({ style: "nextjs", dir: linked });
      const before = await ask();

      // Each module gets another extension, one gets another case, and the entry point gets a new import.
      fs.renameSync(path.join(pages, "x.tsx"), path.join(pages, "x.ts"));
      fs.renameSync(path.join(pages, "sub", "y.tsx"), path.join(pages, "sub", "y.ts"));
      fs.renameSync(path.join(pages, "sub", "deep", "v.tsx"), path.join(pages, "sub", "deep", "v.ts"));
      fs.renameSync(path.join(elsewhere, "z.tsx"), path.join(elsewhere, "z.ts"));
      fs.renameSync(path.join(elsewhere, "deep", "u.tsx"), path.join(elsewhere, "deep", "u.ts"));
      fs.renameSync(path.join(real, "w.tsx"), path.join(real, "w.ts"));
      fs.renameSync(path.join(real, "sub", "deep", "s.tsx"), path.join(real, "sub", "deep", "s.ts"));
      fs.renameSync(path.join(other, "m.tsx"), path.join(other, "m.ts"));
      fs.renameSync(path.join(pages, "Renamed.tsx"), path.join(pages, "renamed.tsx"));
      fs.writeFileSync(path.join(pages, "added.ts"), "export default 1;\\n");
      fs.writeFileSync(path.join(pages, "entry.tsx"), 'export { default } from "./added";\\n');

      router.reload();
      throughLink.reload();
      console.log(JSON.stringify({ before, after: await ask() }));
    `,
    "pages/entry.tsx": page,
    "pages/x.tsx": page,
    "pages/Renamed.tsx": page,
    "pages/sub/y.tsx": page,
    "pages/sub/deep/v.tsx": page,
    "elsewhere/z.tsx": page,
    "elsewhere/deep/u.tsx": page,
    "real/pages/w.tsx": page,
    "real/pages/sub/deep/s.tsx": page,
    "other/m.tsx": page,
  });
  const root = String(dir);
  fs.symlinkSync(path.join(root, "elsewhere"), path.join(root, "pages", "ln"), "junction");
  fs.symlinkSync(path.join(root, "real"), path.join(root, "linked"), "junction");
  fs.symlinkSync(path.join(root, "other"), path.join(root, "real", "pages", "via"), "junction");

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.ts"],
    env: bunEnv,
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const answers = (extension: string, renamed: string) => ({
    file: `pages/x.${extension}`,
    below: `pages/sub/y.${extension}`,
    twoBelow: `pages/sub/deep/v.${extension}`,
    linkInside: [`elsewhere/z.${extension}`, `elsewhere/z.${extension}`],
    belowLinkInside: [`elsewhere/deep/u.${extension}`, `elsewhere/deep/u.${extension}`],
    linkToDir: [`real/pages/w.${extension}`, `real/pages/w.${extension}`],
    twoBelowLinkToDir: [`real/pages/sub/deep/s.${extension}`, `real/pages/sub/deep/s.${extension}`],
    linkBelowLinkToDir: [`other/m.${extension}`, `other/m.${extension}`, `other/m.${extension}`],
    caseOfName: `pages/${renamed}.tsx`,
    build: true,
  });
  expect({ stdout: stdout.trim(), stderr, exitCode, signalCode: proc.signalCode }).toEqual({
    stdout: JSON.stringify({ before: answers("tsx", "Renamed"), after: answers("ts", "renamed") }),
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });
});

describe.skipIf(!dtUnknownReaddir.available)("on a file system whose readdir reports no entry type", () => {
  let env: NodeJS.Dict<string>;
  // Compiles the shim, which can take longer than a hook may on a busy machine.
  beforeAll(async () => {
    if (dtUnknownReaddir.available) env = await dtUnknownReaddir.env();
  }, 30_000);

  it("a router lists the same routes, and a new router reads the disk", async () => {
    using dir = tempDir("fsr-dt-unknown", {
      "pages/index.tsx": page,
      "pages/a.tsx": page,
      "pages/posts/[id].tsx": page,
      "pages/api.v1/z.tsx": page,
      "pages/README.md": "",
      "pages/noext": "",
      "pages/.hidden.tsx": page,
      "pages/node_modules/pkg/index.tsx": page,
      "outside/linked-file.tsx": page,
      "outside/linked-dir/in-linked.tsx": page,
    });
    const root = String(dir);
    const pages = path.join(root, "pages");
    fs.symlinkSync(path.join(root, "outside", "linked-file.tsx"), path.join(pages, "lf.tsx"));
    fs.symlinkSync(path.join(root, "outside", "linked-dir"), path.join(pages, "ld"));
    fs.symlinkSync(path.join(root, "outside", "nowhere.tsx"), path.join(pages, "dangling.tsx"));
    expect(Bun.spawnSync(["mkfifo", path.join(pages, "fifo.tsx")]).exitCode).toBe(0);

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const fs = require("fs");
        const path = require("path");
        const list = () =>
          Object.fromEntries(
            Object.entries(new Bun.FileSystemRouter({ style: "nextjs", dir: "pages" }).routes)
              .sort(([a], [b]) => (a < b ? -1 : 1))
              .map(([name, file]) => [name, path.relative(process.cwd(), file)]),
          );
        const first = list();
        fs.writeFileSync("pages/posts/new.tsx", "export default 1;");
        fs.mkdirSync("pages/added");
        fs.writeFileSync("pages/added/b.tsx", "export default 1;");
        console.log(JSON.stringify({ first, second: list() }));
        `,
      ],
      env,
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const first = {
      "/": "pages/index.tsx",
      "/a": "pages/a.tsx",
      "/api.v1/z": "pages/api.v1/z.tsx",
      "/ld/in-linked": "outside/linked-dir/in-linked.tsx",
      "/lf": "outside/linked-file.tsx",
      "/posts/[id]": "pages/posts/[id].tsx",
    };
    const second = { ...first, "/added/b": "pages/added/b.tsx", "/posts/new": "pages/posts/new.tsx" };
    // The shim says that it changed a record. Without this line the test covers nothing.
    expect(stderr).toContain(dtUnknownReaddir.marker);
    expect({ stdout: stdout.trim(), exitCode }).toEqual({
      stdout: JSON.stringify({
        first,
        second: Object.fromEntries(Object.entries(second).sort(([a], [b]) => (a < b ? -1 : 1))),
      }),
      exitCode: 0,
    });
  });
});

it("with --preserve-symlinks a route below a link is named by the link, as the resolver names it", async () => {
  using dir = tempDir("fsr-preserve-symlinks", {
    "fixture.ts": /* ts */ `
      import path from "path";
      const root = import.meta.dir;
      const below = (file: string) => path.relative(root, file).replaceAll("\\\\", "/");
      const pages = path.join(root, "pages");
      const linked = path.join(root, "linked", "pages");
      const inside = new Bun.FileSystemRouter({ style: "nextjs", dir: pages });
      const through = new Bun.FileSystemRouter({ style: "nextjs", dir: linked });
      const report = async () => {
        const [x, w] = [inside.match("/ln/x")!, through.match("/w")!];
        return {
          routes: [Object.values(inside.routes).map(below).sort(), Object.values(through.routes).map(below)],
          src: [x.src, w.src],
          resolver: [below(Bun.resolveSync("./ln/x.tsx", pages)), below(Bun.resolveSync("./w.tsx", linked))],
          oneModule: [
            (await import(x.filePath)) === (await import(path.join(pages, "ln", "x.tsx"))),
            (await import(w.filePath)) === (await import(path.join(linked, "w.tsx"))),
          ],
        };
      };
      const first = await report();
      inside.reload();
      through.reload();
      console.log(JSON.stringify({ first, reloaded: await report() }));
    `,
    "pages/a.tsx": page,
    "elsewhere/x.tsx": page,
    "real/pages/w.tsx": page,
  });
  const root = String(dir);
  fs.symlinkSync(path.join(root, "elsewhere"), path.join(root, "pages", "ln"), "junction");
  fs.symlinkSync(path.join(root, "real"), path.join(root, "linked"), "junction");
  // A link back to a directory the walk is inside of, by another name than the walk has for it.
  fs.symlinkSync(path.join(root, "pages"), path.join(root, "elsewhere", "back"), "junction");

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--preserve-symlinks", "fixture.ts"],
    env: bunEnv,
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const report = {
    routes: [["pages/a.tsx", "pages/ln/x.tsx"], ["linked/pages/w.tsx"]],
    src: ["ln/x.tsx", "w.tsx"],
    resolver: ["pages/ln/x.tsx", "linked/pages/w.tsx"],
    oneModule: [true, true],
  };
  expect({ stdout: stdout.trim(), stderr, exitCode, signalCode: proc.signalCode }).toEqual({
    stdout: JSON.stringify({ first: report, reloaded: report }),
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });
});

it.each([".", ""])("reload() of dir %j makes the resolver read the current directory again", async cwd => {
  using dir = tempDir("fsr-reload-cwd", { "x.tsx": page, "sub/y.tsx": page });
  const root = String(dir);
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const fs = require("fs");
      const path = require("path");
      const router = new Bun.FileSystemRouter({ style: "nextjs", dir: process.argv[1] });
      const ask = () => ["./x", "./sub/y"].map(specifier => path.basename(Bun.resolveSync(specifier, process.cwd())));
      const before = ask();
      fs.renameSync("x.tsx", "x.ts");
      fs.renameSync("sub/y.tsx", "sub/y.ts");
      router.reload();
      console.log(JSON.stringify({ before, after: ask(), routes: Object.keys(router.routes).sort() }));
      `,
      cwd,
    ],
    env: bunEnv,
    // The resolver spells a Windows path with the drive letter in uppercase and the rest as it is given.
    cwd: isWindows ? root.toLowerCase() : root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
    stdout: JSON.stringify({ before: ["x.tsx", "y.tsx"], after: ["x.ts", "y.ts"], routes: ["/sub/y", "/x"] }),
    stderr: "",
    exitCode: 0,
  });
});

// A name on Windows has no backslash.
it.skipIf(isWindows)("a backslash in a name is a part of the name", () => {
  using dir = tempDir("fsr-backslash", { "pages/a/b.tsx": "slash" });
  const root = String(dir);
  fs.mkdirSync(path.join(root, "pages", "mid\\dle"));
  fs.writeFileSync(path.join(root, "pages", "a\\b.tsx"), "backslash");
  fs.writeFileSync(path.join(root, "pages", "mid\\dle", "y.tsx"), "below a backslash");
  const router = routerOver(path.join(root, "pages"));
  const read = Object.fromEntries(
    Object.entries(router.routes).map(([name, file]) => [
      name,
      [path.relative(root, file), fs.readFileSync(file, "utf8")],
    ]),
  );
  expect({ read, match: path.relative(root, router.match("/a%5Cb")!.filePath) }).toEqual({
    read: {
      "/a\\b": ["pages/a\\b.tsx", "backslash"],
      "/a/b": ["pages/a/b.tsx", "slash"],
      "/mid\\dle/y": ["pages/mid\\dle/y.tsx", "below a backslash"],
    },
    match: "pages/a\\b.tsx",
  });
});

// The length of a path is 4,096 bytes here. Elsewhere the fixture cannot be made with these calls.
it.skipIf(!isLinux)("a directory whose real path is too long to name is an error as dir and left out below dir", () => {
  using dir = tempDir("fsr-unnameable", { "pages/top.tsx": page });
  const root = String(dir);
  // Two links keep each path that a call gets short. The real path of `unnameable` has 4,400 bytes.
  const half = Array(11).fill(Buffer.alloc(200, "s").toString()).join("/");
  fs.mkdirSync(path.join(root, half), { recursive: true });
  fs.symlinkSync(path.join(root, half), path.join(root, "l1"));
  fs.mkdirSync(path.join(root, "l1", half), { recursive: true });
  fs.symlinkSync(path.join("l1", half), path.join(root, "unnameable"));
  fs.writeFileSync(path.join(root, "unnameable", "a.tsx"), page);
  fs.symlinkSync("../unnameable", path.join(root, "pages", "dir"));
  fs.symlinkSync("../unnameable/a.tsx", path.join(root, "pages", "file.tsx"));

  let error: { code?: string; path?: string } = {};
  try {
    routerOver(path.join(root, "unnameable"));
  } catch (e) {
    error = e as typeof error;
  }
  expect({
    asDir: { code: error.code, path: error.path },
    belowDir: routeNames(routerOver(path.join(root, "pages"))),
  }).toEqual({
    asDir: { code: "ENAMETOOLONG", path: path.join(root, "unnameable") },
    belowDir: ["/top"],
  });
});
