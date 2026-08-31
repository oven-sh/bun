import { FileSystemRouter, type MatchedRoute } from "bun";
import { afterAll, describe, expect, it } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, expectRssDeltaBelow, isMacOS, isWindows, normalizeBunSnapshot, tempDir } from "harness";
import path from "path";

// A route tree in its own temp dir, one `export default` module per path.
// FileSystemRouter reports filePath with forward slashes on every platform, so
// `dir` is spelled that way too and the expected paths are built from it.
function routeDir(name: string, paths: string[]) {
  const tmp = tempDir(name, Object.fromEntries(paths.map(p => [p, `export default ${JSON.stringify(p)};\n`])));
  return { dir: String(tmp).replaceAll("\\", "/"), [Symbol.dispose]: () => tmp[Symbol.dispose]() };
}

// MatchedRoute exposes its fields through prototype getters, so toEqual on the
// object itself only sees `MatchedRoute {}`. Project the public fields first.
function matched(route: MatchedRoute | null) {
  if (route === null) return null;
  const { filePath, kind, name, params, pathname, query, src } = route;
  return { filePath, kind, name, params, pathname, query, src };
}

describe.concurrent("FileSystemRouter", () => {
  // Tests that only call match() share this tree. Tests that call reload() or
  // change files build their own.
  const sharedTree = routeDir("fsr-shared", ["index.tsx", "posts/[id].tsx", "posts.tsx", "posts/hey.tsx"]);
  afterAll(() => sharedTree[Symbol.dispose]());
  const shared = new FileSystemRouter({ dir: sharedTree.dir, style: "nextjs" });
  const sharedWithOrigin = new FileSystemRouter({
    dir: sharedTree.dir,
    style: "nextjs",
    assetPrefix: "/_next/static/",
    origin: "https://nextjs.org",
  });
  const helloWorld = {
    filePath: `${sharedTree.dir}/posts/[id].tsx`,
    kind: "dynamic",
    name: "/posts/[id]",
    params: { id: "hello-world" },
    pathname: "/posts/hello-world",
    query: { id: "hello-world" },
    src: "posts/[id].tsx",
  };

  it("should find files", () => {
    const paths = [
      "index.tsx",
      "[id].tsx",
      "a.tsx",
      "abc/index.tsx",
      "abc/[id].tsx",
      "abc/def/[id].tsx",
      "abc/def/ghi/index.tsx",
      "abc/def/ghi/[id].tsx",
      "abc/def/ghi/jkl/index.tsx",
      "abc/def/ghi/jkl/[id].tsx",
      "abc/def/index.tsx",
      "b.tsx",
      "foo/[id].tsx",
      "catch-all/[[...id]].tsx",

      // https://github.com/oven-sh/bun/issues/8276
      // https://github.com/oven-sh/bun/issues/8278
      ...Array.from({ length: 65 }, (_, i) => `files/a${i}.tsx`),
    ];
    using tree = routeDir("fsr-find-files", paths);

    const router = new FileSystemRouter({
      dir: tree.dir,
      fileExtensions: [".tsx"],
      style: "nextjs",
    });

    expect(router.routes).toEqual({
      "/": `${tree.dir}/index.tsx`,
      "/[id]": `${tree.dir}/[id].tsx`,
      "/a": `${tree.dir}/a.tsx`,
      "/abc": `${tree.dir}/abc/index.tsx`,
      "/abc/[id]": `${tree.dir}/abc/[id].tsx`,
      "/abc/def/[id]": `${tree.dir}/abc/def/[id].tsx`,
      "/abc/def/ghi": `${tree.dir}/abc/def/ghi/index.tsx`,
      "/abc/def/ghi/[id]": `${tree.dir}/abc/def/ghi/[id].tsx`,
      "/abc/def/ghi/jkl": `${tree.dir}/abc/def/ghi/jkl/index.tsx`,
      "/abc/def/ghi/jkl/[id]": `${tree.dir}/abc/def/ghi/jkl/[id].tsx`,
      "/abc/def": `${tree.dir}/abc/def/index.tsx`,
      "/b": `${tree.dir}/b.tsx`,
      "/foo/[id]": `${tree.dir}/foo/[id].tsx`,
      "/catch-all/[[...id]]": `${tree.dir}/catch-all/[[...id]].tsx`,
      ...Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`/files/a${i}`, `${tree.dir}/files/a${i}.tsx`])),
    });
  });

  it("should handle routes under GC pressure", () => {
    // Regression test for BUN-1K54: fromEntries used ObjectInitializationScope
    // with putDirect, which could crash when GC triggers during string allocation.
    const paths = Array.from({ length: 128 }, (_, i) => `route${i}/index.tsx`);
    using tree = routeDir("fsr-gc-pressure", paths);
    const expected = Object.fromEntries(paths.map((p, i) => [`/route${i}`, `${tree.dir}/${p}`]));

    // Build the routes object repeatedly with GC pressure to exercise the
    // fromEntries path. The getter caches its result per router, so each round
    // needs a fresh router.
    for (let i = 0; i < 10; i++) {
      const router = new FileSystemRouter({
        dir: tree.dir,
        fileExtensions: [".tsx"],
        style: "nextjs",
      });
      Bun.gc(true);
      expect(router.routes).toEqual(expected);
    }
  });

  it("should handle empty dirs", () => {
    using tree = routeDir("fsr-empty", []);

    const router = new FileSystemRouter({
      dir: tree.dir,
      fileExtensions: [".tsx"],
      style: "nextjs",
    });

    // assert this doesn't crash
    // @ts-ignore
    expect(router.bar).toBeUndefined();

    expect(router.routes).toEqual({});
    expect(router.match("/")).toBeNull();
  });

  it("should match dynamic routes", () => {
    expect(matched(shared.match("/posts/hello-world"))).toEqual(helloWorld);
  });

  it(".params works on dynamic routes", () => {
    expect(shared.match("/posts/hello-world")!.params).toEqual({ id: "hello-world" });
    expect(shared.match("/posts/hey")!.params).toEqual({});
  });

  it("should support static routes", () => {
    expect(matched(shared.match("/posts/hey"))).toEqual({
      filePath: `${sharedTree.dir}/posts/hey.tsx`,
      kind: "exact",
      name: "/posts/hey",
      params: {},
      pathname: "/posts/hey",
      query: {},
      src: "posts/hey.tsx",
    });
  });

  // Paths with a static, dynamic or index route must not fall through to a
  // catch-all route in the same directory.
  const notCatchAll = {
    "/posts/123": "/posts/[id]",
    "/posts/hey": "/posts/hey",
    "/posts/zorp": "/posts/[id]",
    "/posts": "/posts",
    "/index": "/",
    "/posts/": "/posts",
  };
  const namesOf = (router: FileSystemRouter, paths: string[]) =>
    Object.fromEntries(paths.map(p => [p, router.match(p)?.name ?? null]));

  it("should support optional catch-all routes", () => {
    using tree = routeDir("fsr-optional-catch-all", [
      "index.tsx",
      "posts/[id].tsx",
      "posts.tsx",
      "posts/hey.tsx",
      "posts/[[...id]].tsx",
    ]);

    const router = new FileSystemRouter({
      dir: tree.dir,
      style: "nextjs",
    });

    expect(namesOf(router, Object.keys(notCatchAll))).toEqual(notCatchAll);

    for (const pathname of ["/posts/hey/there", "/posts/hey/there/you", "/posts/zorp/123"]) {
      const id = pathname.slice("/posts/".length);
      expect(matched(router.match(pathname))).toEqual({
        filePath: `${tree.dir}/posts/[[...id]].tsx`,
        kind: "optional-catch-all",
        name: "/posts/[[...id]]",
        params: { id },
        pathname,
        query: { id },
        src: "posts/[[...id]].tsx",
      });
    }
  });

  it("should support catch-all routes", () => {
    using tree = routeDir("fsr-catch-all", [
      "index.tsx",
      "posts/[id].tsx",
      "posts.tsx",
      "posts/hey.tsx",
      "posts/[...id].tsx",
      "posts/wow/[[...id]].tsx",
    ]);

    const router = new FileSystemRouter({
      dir: tree.dir,
      style: "nextjs",
    });

    expect(namesOf(router, Object.keys(notCatchAll))).toEqual(notCatchAll);

    for (const pathname of ["/posts/hey/there", "/posts/hey/there/you", "/posts/zorp/123", "/posts/wow/hey/there"]) {
      const id = pathname.slice("/posts/".length);
      expect(matched(router.match(pathname))).toEqual({
        filePath: `${tree.dir}/posts/[...id].tsx`,
        kind: "catch-all",
        name: "/posts/[...id]",
        params: { id },
        pathname,
        query: { id },
        src: "posts/[...id].tsx",
      });
    }
  });

  it("should support index routes", () => {
    for (const pathname of ["/", "/index"]) {
      expect(matched(shared.match(pathname))).toEqual({
        filePath: `${sharedTree.dir}/index.tsx`,
        kind: "exact",
        name: "/",
        params: {},
        pathname,
        query: {},
        src: "index.tsx",
      });
    }

    for (const pathname of ["/posts", "/posts/index", "/posts/"]) {
      expect(matched(shared.match(pathname))).toEqual({
        filePath: `${sharedTree.dir}/posts.tsx`,
        kind: "exact",
        name: "/posts",
        params: {},
        pathname,
        query: {},
        src: "posts.tsx",
      });
    }
  });

  it("should support Request", () => {
    for (const request of [
      new Request({ url: "https://example.com123/posts/hello-world" }),
      new Request({ url: "http://example.com/posts/hello-world" }),
    ]) {
      expect(matched(shared.match(request))).toEqual(helloWorld);
    }
  });

  it("assetPrefix, src, and origin", () => {
    expect({ origin: sharedWithOrigin.origin, style: sharedWithOrigin.style }).toEqual({
      origin: "https://nextjs.org",
      style: "nextjs",
    });

    for (const request of [
      new Request({ url: "http://helloooo.com/posts/hello-world" }),
      new Request({ url: "https://nextjs.org/posts/hello-world" }),
    ]) {
      const match = sharedWithOrigin.match(request)!;
      expect(matched(match)).toEqual({ ...helloWorld, src: "https://nextjs.org/_next/static/posts/[id].tsx" });
      // scriptSrc is the legacy alias of src. An unknown property must not crash.
      // @ts-ignore
      expect({ scriptSrc: match.scriptSrc, checkThisDoesntCrash: match.checkThisDoesntCrash }).toEqual({
        scriptSrc: "https://nextjs.org/_next/static/posts/[id].tsx",
        checkThisDoesntCrash: undefined,
      });
    }
  });

  it(".query works", () => {
    for (const [url, query] of [
      ["https://example.com/posts?hello=world", { hello: "world" }],
      ["https://example.com/posts?hello=world&second=2", { hello: "world", second: "2" }],
      ["https://example.com/posts?hello=world&second=2&third=3", { hello: "world", second: "2", third: "3" }],
      ["https://example.com/posts", {}],
    ] as const) {
      expect(matched(sharedWithOrigin.match(url))).toEqual({
        filePath: `${sharedTree.dir}/posts.tsx`,
        kind: "exact",
        name: "/posts",
        params: {},
        // pathname keeps the query string (docs/runtime/file-system-router.mdx).
        pathname: url.slice("https://example.com".length),
        query,
        src: "https://nextjs.org/_next/static/posts.tsx",
      });
    }
  });

  it(".query skips empty-key pairs instead of terminating the parse", () => {
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
      expect({ input: current, query: shared.match(current)!.query }).toEqual({ input: current, query: expected });
    }

    // Same scanner is used when path params are present (init_with_scanner path).
    for (const [current, expected] of [
      ["/posts/123?=v&x=1&y=2", { id: "123", x: "1", y: "2" }],
      ["/posts/123?x=1&=v&y=2", { id: "123", x: "1", y: "2" }],
    ] as const) {
      expect({ input: current, query: shared.match(current)!.query }).toEqual({ input: current, query: expected });
    }
  });

  it("reload() works", () => {
    using tree = routeDir("fsr-reload", ["posts.tsx"]);

    const router = new FileSystemRouter({
      dir: tree.dir,
      style: "nextjs",
      assetPrefix: "/_next/static/",
      origin: "https://nextjs.org",
    });
    const posts = {
      filePath: `${tree.dir}/posts.tsx`,
      kind: "exact",
      name: "/posts",
      params: {},
      pathname: "/posts",
      query: {},
      src: "https://nextjs.org/_next/static/posts.tsx",
    };

    expect(matched(router.match("/posts"))).toEqual(posts);
    expect(router.reload()).toBe(router);
    expect(matched(router.match("/posts"))).toEqual(posts);
    expect(router.routes).toEqual({ "/posts": `${tree.dir}/posts.tsx` });
  });

  it("reload() works with new dirs/files", () => {
    using tree = routeDir("fsr-reload-new-files", ["posts.tsx"]);

    const router = new FileSystemRouter({
      dir: tree.dir,
      style: "nextjs",
      assetPrefix: "/_next/static/",
      origin: "https://nextjs.org",
    });
    const addRoute = (relative: string) => {
      fs.mkdirSync(path.dirname(`${tree.dir}/${relative}`), { recursive: true });
      fs.writeFileSync(`${tree.dir}/${relative}`, "export default 1;\n");
    };
    const indexRoute = (name: string) => ({
      filePath: `${tree.dir}${name}/index.ts`,
      kind: "exact",
      name,
      params: {},
      pathname: name,
      query: {},
      src: `https://nextjs.org/_next/static${name}/index.ts`,
    });

    expect(router.routes).toEqual({ "/posts": `${tree.dir}/posts.tsx` });

    addRoute("test/recursive/index.ts");
    router.reload();
    expect(matched(router.match("/test/recursive"))).toEqual(indexRoute("/test/recursive"));
    expect(router.routes).toEqual({
      "/posts": `${tree.dir}/posts.tsx`,
      "/test/recursive": `${tree.dir}/test/recursive/index.ts`,
    });

    fs.rmSync(`${tree.dir}/test/recursive`, { recursive: true, force: true });
    router.reload();
    expect(router.match("/test/recursive")).toBeNull();
    expect(router.routes).toEqual({ "/posts": `${tree.dir}/posts.tsx` });

    addRoute("test/test2/index.ts");
    router.reload();
    expect(matched(router.match("/test/test2"))).toEqual(indexRoute("/test/test2"));
    expect(router.routes).toEqual({
      "/posts": `${tree.dir}/posts.tsx`,
      "/test/test2": `${tree.dir}/test/test2/index.ts`,
    });
  });

  it("reload() throws and keeps the old routes when the directory is gone", () => {
    using tree = routeDir("fsr-reload-gone", ["posts.tsx"]);
    const router = new FileSystemRouter({ dir: tree.dir, style: "nextjs" });
    const posts = {
      filePath: `${tree.dir}/posts.tsx`,
      kind: "exact",
      name: "/posts",
      params: {},
      pathname: "/posts",
      query: {},
      src: "posts.tsx",
    };
    // The message names the directory the router re-reads, with a trailing
    // native separator. Compare it with forward slashes on every platform.
    const reloadError = () => {
      try {
        router.reload();
        return "no throw";
      } catch (e) {
        return (e as Error).message.replaceAll("\\", "/");
      }
    };

    expect(router.routes).toEqual({ "/posts": `${tree.dir}/posts.tsx` });
    fs.rmSync(tree.dir, { recursive: true, force: true });

    expect(reloadError()).toBe(`Unable to find directory: ${tree.dir}/`);
    expect(matched(router.match("/posts"))).toEqual(posts);
    expect(router.routes).toEqual({ "/posts": `${tree.dir}/posts.tsx` });
    expect(reloadError()).toBe(`Unable to find directory: ${tree.dir}/`);

    fs.mkdirSync(tree.dir);
    fs.writeFileSync(`${tree.dir}/other.tsx`, "export default 1;\n");
    expect(router.reload()).toBe(router);
    expect(router.routes).toEqual({ "/other": `${tree.dir}/other.tsx` });
    expect(router.match("/posts")).toBeNull();
  });

  it(".query works with dynamic routes, including params", () => {
    for (const [url, query] of [
      ["https://example.com/posts/123?hello=world", { id: "123", hello: "world" }],
      ["https://example.com/posts/123?hello=world&second=2", { id: "123", hello: "world", second: "2" }],
      [
        "https://example.com/posts/123?hello=world&second=2&third=3",
        { id: "123", hello: "world", second: "2", third: "3" },
      ],
      ["https://example.com/posts/123", { id: "123" }],
    ] as const) {
      expect(matched(sharedWithOrigin.match(url))).toEqual({
        filePath: `${sharedTree.dir}/posts/[id].tsx`,
        kind: "dynamic",
        name: "/posts/[id]",
        params: { id: "123" },
        pathname: url.slice("https://example.com".length),
        query,
        src: "https://nextjs.org/_next/static/posts/[id].tsx",
      });
    }
  });

  it("dir should be validated", () => {
    expect(() => {
      //@ts-ignore
      new FileSystemRouter({
        style: "nextjs",
      });
    }).toThrow("Expected dir to be a string");

    expect(() => {
      new FileSystemRouter({
        //@ts-ignore
        dir: undefined,
        style: "nextjs",
      });
    }).toThrow("Expected dir to be a string");

    expect(() => {
      new FileSystemRouter({
        //@ts-ignore
        dir: 123,
        style: "nextjs",
      });
    }).toThrow("Expected dir to be a string");

    expect(() => {
      new FileSystemRouter({
        dir: `${sharedTree.dir}/does-not-exist`,
        style: "nextjs",
      });
    }).toThrow(`Unable to find directory: ${sharedTree.dir}/does-not-exist`);
  });

  it("origin, assetPrefix, style and fileExtensions should be validated", () => {
    expect(() => {
      new FileSystemRouter({
        dir: sharedTree.dir,
        //@ts-ignore
        origin: 123,
        style: "nextjs",
      });
    }).toThrow("Expected origin to be a string");

    expect(() => {
      new FileSystemRouter({
        dir: sharedTree.dir,
        //@ts-ignore
        assetPrefix: 123,
        style: "nextjs",
      });
    }).toThrow("Expected assetPrefix to be a string");

    expect(() => {
      new FileSystemRouter({
        dir: sharedTree.dir,
        //@ts-ignore
        style: "remix",
      });
    }).toThrow("Only 'nextjs' style is currently implemented");

    expect(() => {
      new FileSystemRouter({
        dir: sharedTree.dir,
        //@ts-ignore
        fileExtensions: ".tsx",
        style: "nextjs",
      });
    }).toThrow("Expected fileExtensions to be an Array");

    expect(() => {
      new FileSystemRouter({
        dir: sharedTree.dir,
        //@ts-ignore
        fileExtensions: [".tsx", 1],
        style: "nextjs",
      });
    }).toThrow("Expected fileExtensions to be an Array of strings");
  });

  it("match() rejects anything but a string, Request or Response", () => {
    for (const input of [undefined, null, 123, {}, ["/posts"]]) {
      // @ts-ignore
      expect(() => shared.match(input)).toThrow("Expected string, Request or Response");
    }
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

    // The 0xFF byte is not valid UTF-8, so the JS strings get U+FFFD in its place.
    expect(router.routes).toEqual({
      "/ab": `${dir}/ab.tsx`,
      "/a\uFFFD": `${dir}/a\uFFFD.tsx`,
      "/\uFFFD": `${dir}/\uFFFD.tsx`,
    });
    expect(matched(router.match("/ab"))).toEqual({
      filePath: `${dir}/ab.tsx`,
      kind: "exact",
      name: "/ab",
      params: {},
      pathname: "/ab",
      query: {},
      src: "ab.tsx",
    });
    // The raw byte reaches the matcher through a percent escape. The UTF-8
    // encoding of U+FFFD is a different byte sequence and matches nothing.
    expect(matched(router.match("/a%FF"))).toEqual({
      filePath: `${dir}/a\uFFFD.tsx`,
      kind: "exact",
      name: "/a\uFFFD",
      params: {},
      pathname: "/a\uFFFD",
      query: {},
      src: "a\uFFFD.tsx",
    });
    expect(router.match("/a\uFFFD")).toBeNull();
  });

  it("src is relative to dir when no origin is given", () => {
    expect(shared.origin).toBeNull();
    for (const opts of [{}, { assetPrefix: "/_next/static/" }]) {
      const router = new FileSystemRouter({ dir: sharedTree.dir, style: "nextjs", ...opts });
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

    const relative = new FileSystemRouter({ dir: String(dir), style: "nextjs", fileExtensions: [".tsx"] });
    const absolute = new FileSystemRouter({
      dir: String(dir),
      style: "nextjs",
      fileExtensions: [".tsx"],
      assetPrefix: "/_next/static/",
      origin: "https://example.com",
    });

    expect({
      relative: matched(relative.match("/a%FF")),
      absolute: matched(absolute.match("/a%FF")),
    }).toEqual({
      relative: {
        filePath: `${dir}/a\uFFFD.tsx`,
        kind: "exact",
        name: "/a\uFFFD",
        params: {},
        pathname: "/a\uFFFD",
        query: {},
        src: "a\uFFFD.tsx",
      },
      absolute: {
        filePath: `${dir}/a\uFFFD.tsx`,
        kind: "exact",
        name: "/a\uFFFD",
        params: {},
        pathname: "/a\uFFFD",
        query: {},
        src: "https://example.com/_next/static/a\uFFFD.tsx",
      },
    });
  });

  it("MatchedRoute.params does not leak", async () => {
    using dir = tempDir("fsr-params-leak", {
      "pages/[a]/[b]/[c]/[d].tsx": "export default 1;",
    });

    // Each match()+.params access lazily allocates a QueryStringMap (param
    // name/value buffer + MultiArrayList of params) which must be freed when
    // the MatchedRoute is garbage-collected. Four 4 KiB segments make every
    // leaked match cost at least 16 KiB, so 5000 matches leak at least 78 MiB
    // (#29853 leaked about 3 KiB per match with 512-byte segments).
    const code = /* ts */ `
        const rss = process.platform === "darwin" && typeof Bun.unsafe.memoryFootprint === "function" ? Bun.unsafe.memoryFootprint : process.memoryUsage.rss;
        const router = new Bun.FileSystemRouter({
          dir: ${JSON.stringify(path.join(String(dir), "pages"))},
          style: "nextjs",
          fileExtensions: [".tsx"],
        });
        const seg = Buffer.alloc(4096, "x").toString();
        const url = "/" + seg + "/" + seg + "/" + seg + "/" + seg;
        if (router.match(url).params.d !== seg) throw new Error("the route did not match");

        // warm up
        for (let i = 0; i < 500; i++) router.match(url).params;
        Bun.gc(true);
        const before = rss();

        for (let i = 0; i < 5000; i++) router.match(url).params;
        Bun.gc(true);
        console.log(JSON.stringify({ deltaMiB: (rss() - before) / 1024 / 1024 }));
      `;

    await expectRssDeltaBelow(["--smol", "-e", code], { release: 20, debug: 30 });
  }, 30_000);

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
        console.log("caught " + e.name + ": " + e.message);
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
    expect(stdout).toBe("caught BuildMessage: Route is missing a closing bracket]\n");
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
    const a = "alpha-" + Buffer.alloc(58, "a").toString();
    const b = "bravo-" + Buffer.alloc(58, "b").toString();

    const code = /* ts */ `
      const router = new Bun.FileSystemRouter({
        dir: ${JSON.stringify(path.join(String(dir), "pages"))},
        style: "nextjs",
        fileExtensions: [".tsx"],
      });
      const enc = s => [...s].map(c => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
      const pick = m => m && { name: m.name, pathname: m.pathname, params: m.params };

      const first = router.match("/posts/" + enc(${JSON.stringify(a)}));
      const second = router.match("/posts/" + enc(${JSON.stringify(b)}));
      // Read the first match only after the second one exists.
      console.log(JSON.stringify({
        first: pick(first),
        second: pick(second),
        // Un-encoded URLs must keep working.
        plain: pick(router.match("/posts/hello-world")),
      }));
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", code],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      first: { name: "/posts/[id]", pathname: `/posts/${a}`, params: { id: a } },
      second: { name: "/posts/[id]", pathname: `/posts/${b}`, params: { id: b } },
      plain: { name: "/posts/[id]", pathname: "/posts/hello-world", params: { id: "hello-world" } },
    });
    expect(exitCode).toBe(0);
  });

  it(".params decodes percent escapes in a route segment exactly once", () => {
    for (const [input, id] of [
      ["/posts/a%20b", "a b"],
      ["/posts/%252e%252e%252fetc", "%2e%2e%2fetc"],
      ["/posts/100%2525", "100%25"],
    ]) {
      expect(matched(shared.match(input))).toEqual({
        filePath: `${sharedTree.dir}/posts/[id].tsx`,
        kind: "dynamic",
        name: "/posts/[id]",
        params: { id },
        pathname: `/posts/${id}`,
        query: { id },
        src: "posts/[id].tsx",
      });
    }
  });

  it("caps the number of parsed query string parameters instead of crashing", async () => {
    // A query string with more parameters than the iterator's fixed-size visited
    // bitset (MAX_QUERY_STRING_PARAMS = 2048 in src/url/lib.rs) must not be able
    // to take down the process when `.query` is read. Run in a subprocess so an
    // abort is observable as output on stderr / a nonzero exit code instead of
    // killing the test runner.
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
      const query = match.query;
      const keys = Object.keys(query);
      console.log(JSON.stringify({
        name: match.name,
        count: keys.length,
        first: [keys[0], query[keys[0]]],
        last: [keys[keys.length - 1], query[keys[keys.length - 1]]],
        hasK2048: "k2048" in query,
      }));
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", code],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      name: "/posts",
      count: 2048,
      first: ["k0", "v0"],
      last: ["k2047", "v2047"],
      hasK2048: false,
    });
    expect(exitCode).toBe(0);
  });

  it("does not match a dynamic route whose static segment merely collides on length and 32-bit hash", () => {
    // A static segment is compared by length and the low 32 bits of wyhash
    // (seed 0) before its bytes. These two segments differ but agree on both.
    // They were found by scanning "s" + i.toString(36).padStart(9, "0").
    const routeSegment = "s000000io9";
    const collidingSegment = "s000001eqf";
    const low32 = (input: string) => BigInt.asUintN(32, Bun.hash.wyhash(input));
    expect({
      sameLength: collidingSegment.length === routeSegment.length,
      sameLow32: low32(collidingSegment) === low32(routeSegment),
      sameBytes: collidingSegment === routeSegment,
    }).toEqual({ sameLength: true, sameLow32: true, sameBytes: false });

    using tree = routeDir("fsr-hash-collision", [`${routeSegment}/[id].tsx`]);
    const router = new FileSystemRouter({
      dir: tree.dir,
      style: "nextjs",
    });

    expect(matched(router.match(`/${routeSegment}/42`))).toEqual({
      filePath: `${tree.dir}/${routeSegment}/[id].tsx`,
      kind: "dynamic",
      name: `/${routeSegment}/[id]`,
      params: { id: "42" },
      pathname: `/${routeSegment}/42`,
      query: { id: "42" },
      src: `${routeSegment}/[id].tsx`,
    });
    expect(router.match(`/${collidingSegment}/42`)).toBeNull();
  });

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
    expect(JSON.parse(stdout)).toEqual({
      "?": null,
      "?foo=bar": null,
      "%PUBLIC_URL%": null,
      "%PUBLIC_URL%?x=1": null,
    });
    expect(exitCode).toBe(0);
  });

  it("match() returns null when the path string does not start with '/'", () => {
    using tree = routeDir("fsr-no-leading-slash", ["index.tsx", "top.tsx", "op.tsx", "sub/[id].tsx"]);
    const router = new FileSystemRouter({ dir: tree.dir, style: "nextjs" });
    const exact = (name: string, pathname: string, file: string) => ({
      filePath: `${tree.dir}/${file}`,
      kind: "exact",
      name,
      params: {},
      pathname,
      query: {},
      src: file,
    });

    // Control: '/'-prefixed inputs (and the empty string) resolve.
    expect(
      Object.fromEntries(
        ["/top", "/op", "/sub/x", "/", "/?q=1", ""].map(input => [input, matched(router.match(input))]),
      ),
    ).toEqual({
      "/top": exact("/top", "/top", "top.tsx"),
      "/op": exact("/op", "/op", "op.tsx"),
      "/sub/x": {
        filePath: `${tree.dir}/sub/[id].tsx`,
        kind: "dynamic",
        name: "/sub/[id]",
        params: { id: "x" },
        pathname: "/sub/x",
        query: { id: "x" },
        src: "sub/[id].tsx",
      },
      "/": exact("/", "/", "index.tsx"),
      "/?q=1": { ...exact("/", "/?q=1", "index.tsx"), query: { q: "1" } },
      "": exact("/", "/", "index.tsx"),
    });

    // URLPath::parse used to strip byte 0 unconditionally, so any single junk byte
    // in the '/' position produced a match against the rest of the string. The bare
    // name (no prefix at all) must not match either: previously "top" became "op"
    // and matched the /op route. Dynamic routes were affected the same way, and a
    // leading '?' has no path component and must not fall through to index.
    const rejected = [
      "Xtop",
      " top",
      "\ttop",
      "\\top",
      ".top",
      "%58top",
      "%2Ftop",
      "top",
      "ttop",
      "Xsub/x",
      "sub/x",
      "?anything",
    ];
    expect(Object.fromEntries(rejected.map(input => [input, router.match(input)]))).toEqual(
      Object.fromEntries(rejected.map(input => [input, null])),
    );
  });

  it("reload() while Bun.build() resolves the same directory", async () => {
    // The router's route-load loop and Bun.build's entry-point resolution (which
    // runs on the bundler thread) share the process-global directory-entry cache.
    // Run in a subprocess so a crash is observable as a signal instead of taking
    // down the test runner. The 80-file tree, 40 rounds and 50 reloads per round
    // are the shape that reproduced the use-after-free of #34271.
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
        const b = router.match("/b");
        console.log(JSON.stringify({
          routes: router.routes,
          b: b && { filePath: b.filePath, kind: b.kind, name: b.name, params: b.params, pathname: b.pathname, query: b.query, src: b.src },
        }));
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
    expect(normalizeBunSnapshot(stderr, String(dir))).toBe("");
    expect(JSON.parse(normalizeBunSnapshot(stdout, String(dir)))).toEqual({
      routes: {
        "/a": "<dir>/pages/a.tsx",
        "/b": "<dir>/pages/b.tsx",
        "/sub/c": "<dir>/pages/sub/c.tsx",
      },
      b: {
        filePath: "<dir>/pages/b.tsx",
        kind: "exact",
        name: "/b",
        params: {},
        pathname: "/b",
        query: {},
        src: "b.tsx",
      },
    });
    expect({ exitCode, signalCode: proc.signalCode }).toEqual({ exitCode: 0, signalCode: null });
  });

  it(".query drops a pair with a malformed percent escape without shifting later parameters", () => {
    using tree = routeDir("fsr-malformed-escape", ["posts.tsx", "shows/[id].tsx"]);

    const router = new FileSystemRouter({
      dir: tree.dir,
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
    for (const [current, expected] of [
      ["/posts/123?id=999", { id: "123" }],
      ["/posts/123?%2569d=999", { id: "123" }],
      ["/posts/123?%2569d=999&other=1", { id: "123", other: "1" }],
      ["/posts/123?other=1&%2569d=999", { id: "123", other: "1" }],
    ] as const) {
      expect({ input: current, query: shared.match(current)!.query }).toEqual({ input: current, query: expected });
    }
  });

  it("match() returns null when the URL has fewer segments than a dynamic route requires", () => {
    using tree = routeDir("fsr-fewer-segments", ["[org]/settings/[id].tsx", "[team]/[...rest].tsx"]);
    const router = new FileSystemRouter({
      dir: tree.dir,
      style: "nextjs",
    });

    expect(matched(router.match("/acme/settings/x"))).toEqual({
      filePath: `${tree.dir}/[org]/settings/[id].tsx`,
      kind: "dynamic",
      name: "/[org]/settings/[id]",
      params: { org: "acme", id: "x" },
      pathname: "/acme/settings/x",
      query: { org: "acme", id: "x" },
      src: "[org]/settings/[id].tsx",
    });
    expect(matched(router.match("/acme/a/b"))).toEqual({
      filePath: `${tree.dir}/[team]/[...rest].tsx`,
      kind: "catch-all",
      name: "/[team]/[...rest]",
      params: { team: "acme", rest: "a/b" },
      pathname: "/acme/a/b",
      query: { team: "acme", rest: "a/b" },
      src: "[team]/[...rest].tsx",
    });
    expect(router.match("/acme")).toBeNull();
  });

  it.skipIf(isWindows || isMacOS)(
    "src is computed for a route whose path is longer than the fast-path buffer",
    async () => {
      // Eleven 201-byte directories put the route's src past the 2048-byte stack
      // buffer that the public path join tries first (JOIN_STACK_BUF_LEN in
      // src/url/lib.rs), so the heap fallback is what is tested here.
      const seg = Buffer.alloc(200, "a").toString();
      const relDir = Array.from({ length: 11 }, (_, i) => seg + i).join("/");
      using dir = tempDir("fsr-long-route-src", {
        "pages/keep.tsx": "export default 1;\n",
        [`pages/${relDir}/leaf.tsx`]: "export default 1;\n",
      });

      const code = /* ts */ `
        const router = new Bun.FileSystemRouter({
          dir: ${JSON.stringify(path.join(String(dir), "pages"))},
          style: "nextjs",
          fileExtensions: [".tsx"],
          assetPrefix: "/_next/static/",
          origin: "https://example.com",
        });
        const m = router.match("/" + ${JSON.stringify(relDir)} + "/leaf");
        console.log(JSON.stringify(m && { filePath: m.filePath, kind: m.kind, name: m.name, params: m.params, pathname: m.pathname, query: m.query, src: m.src }));
      `;

      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", code],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        filePath: `${dir}/pages/${relDir}/leaf.tsx`,
        kind: "exact",
        name: `/${relDir}/leaf`,
        params: {},
        pathname: `/${relDir}/leaf`,
        query: {},
        src: `https://example.com/_next/static/${relDir}/leaf.tsx`,
      });
      expect(`https://example.com/_next/static/${relDir}/leaf.tsx`.length).toBe(2264);
      expect(exitCode).toBe(0);
    },
  );
});
