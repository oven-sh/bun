import { FileSystemRouter } from "bun";
import { it, expect } from "bun:test";
import path, { dirname, resolve } from "path";
import fs, { realpathSync, rmSync } from "fs";
import { tmpdir } from "os";

function createTree(basedir, paths) {
  for (const end of paths) {
    const abs = path.join(basedir, end);
    try {
      const dir = dirname(abs);
      if (dir.length > 0 && dir !== "/") fs.mkdirSync(dir, { recursive: true });
    } catch (e) {}
    fs.writeFileSync(abs, "export default " + JSON.stringify(end) + ";\n");
  }
}

it("should find files", () => {
  const tempdir = realpathSync(tmpdir()) + "/";

  rmSync(tempdir + "fs-router-test-01", { recursive: true, force: true });

  createTree(tempdir + "fs-router-test-01", [
    "a.tsx",
    "b.tsx",
    "abc/[id].tsx",
    "abc/index.tsx",
    "abc/def/[id].tsx",
    "abc/def/index.tsx",
    "abc/def/ghi/[id].tsx",
    "abc/def/ghi/index.tsx",
    "abc/def/ghi/jkl/[id].tsx",
    "abc/def/ghi/jkl/index.tsx",
    "[id].tsx",
    "index.tsx",
    "foo/[id].tsx",
    "catch-all/[...id].tsx",
  ]);

  const router = new FileSystemRouter({
    dir: tempdir + "fs-router-test-01/",
    fileExtensions: [".tsx"],
    style: "nextjs",
  });

  const routes = router.routes;
  const fixture = {
    "/": `${tempdir}fs-router-test-01/index.tsx`,
    "/[id]": `${tempdir}fs-router-test-01/[id].tsx`,
    "/a": `${tempdir}fs-router-test-01/a.tsx`,
    "/abc": `${tempdir}fs-router-test-01/abc/index.tsx`,
    "/abc/[id]": `${tempdir}fs-router-test-01/abc/[id].tsx`,
    "/abc/def/[id]": `${tempdir}fs-router-test-01/abc/def/[id].tsx`,
    "/abc/def/ghi": `${tempdir}fs-router-test-01/abc/def/ghi/index.tsx`,
    "/abc/def/ghi/[id]": `${tempdir}fs-router-test-01/abc/def/ghi/[id].tsx`,
    "/abc/def/ghi/jkl": `${tempdir}fs-router-test-01/abc/def/ghi/jkl/index.tsx`,
    "/abc/def/ghi/jkl/[id]": `${tempdir}fs-router-test-01/abc/def/ghi/jkl/[id].tsx`,
    "/abc/def": `${tempdir}fs-router-test-01/abc/def/index.tsx`,
    "/b": `${tempdir}fs-router-test-01/b.tsx`,
    "/foo/[id]": `${tempdir}fs-router-test-01/foo/[id].tsx`,
    "/catch-all/[...id]": `${tempdir}fs-router-test-01/catch-all/[...id].tsx`,
  };
  for (const route in fixture) {
    if (!(route in routes)) {
      throw new Error(`Route ${route} not found`);
    }

    expect(routes[route]).toBe(fixture[route]);
  }

  expect(Object.keys(routes).length).toBe(Object.keys(fixture).length);

  expect(router.match("/never/gonna/give/you/up")).toBe(null);
  expect(
    router.match(
      "/catch-all/we-are-no-strangers-to-love/you/know/the/rules/and/so/do/i",
    ).params.id,
  ).toBe("we-are-no-strangers-to-love/you/know/the/rules/and/so/do/i");
  expect(router.match("/").name).toBe("/");
  expect(router.match("/index").name).toBe("/");
  expect(router.match("/index/").name).toBe("/");
  expect(router.match("/a").name).toBe("/a");
  expect(router.match("/b").name).toBe("/b");
  expect(router.match("/abc/123").params.id).toBe("123");
});

it("should support dynamic routes", () => {
  // set up the test
  const tempdir = realpathSync(tmpdir()) + "/";
  rmSync(tempdir + "fs-router-test-02", { recursive: true, force: true });
  createTree(tempdir + "fs-router-test-02", [
    "index.tsx",
    "posts/[id].tsx",
    "posts.tsx",
  ]);

  const router = new Bun.FileSystemRouter({
    dir: tempdir + "fs-router-test-02/",
    style: "nextjs",
  });

  const {
    name,
    params: { id },
    filePath,
  } = router.match("/posts/hello-world");

  expect(id).toBe("hello-world");
  expect(name).toBe("/posts/[id]");
  expect(filePath).toBe(`${tempdir}fs-router-test-02/posts/[id].tsx`);
});
