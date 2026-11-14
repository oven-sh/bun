// On Windows a path of 260 characters is not found. A checkout puts about 40 in front of the root of the repository, and `bun build --compile` writes a temporary file
// whose name takes 37 into the working directory, which may be the folder of a program.
import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";

const root = join(import.meta.dir, "..", "..");
const walked = ["test/aot/parallel", "test/aot/ir", "test/aot/engine-tests"];
const longest = { path: 260 - 40, folder: 260 - 40 - 1 - 37 };

test("programs and text tests have paths that are short enough on Windows", () => {
  const paths = walked.flatMap(folder =>
    readdirSync(join(root, folder), { recursive: true, encoding: "utf8" }).map(
      path => `${folder}/${path.replaceAll("\\", "/")}`,
    ),
  );
  expect(paths.length).toBeGreaterThan(5000);
  expect({
    paths: paths.filter(path => path.length > longest.path),
    folders: [...new Set(paths.map(path => dirname(path)))].filter(folder => folder.length > longest.folder),
  }).toEqual({ paths: [], folders: [] });
});
