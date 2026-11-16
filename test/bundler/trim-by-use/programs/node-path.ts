// node:path
import path from "node:path";
console.log(
  path.join("/a", "..", "b", "./c.txt"),
  path.resolve("/x", "y", "../z"),
  path.relative("/a/b/c", "/a/d"),
  path.basename("/a/b.tar.gz", ".gz"),
  path.dirname("/a/b/c"),
  path.extname("x.test.ts"),
  path.normalize("/a//b/../c/"),
  path.isAbsolute("a"),
  JSON.stringify(path.parse("/home/u/f.txt")),
  path.format({ dir: "/d", name: "n", ext: ".e" }),
  path.win32.join("C:\\a", "..", "b"),
  path.win32.relative("C:\\a\\b", "C:\\a\\c"),
  path.toNamespacedPath("/a"),
);
