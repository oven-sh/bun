// The json and jsonc loaders of Bun.Transpiler parse into the immutable row AST
// and then materialize it into the classic AST. The materializer used to get a
// tape without recorded value locations, so for every array item it re-scanned
// the source up to the item's closing bracket to recover the location. A nested
// array therefore cost (depth x subtree size): 300 levels around a 4 MB string
// took 0.9 s in a release build and 6 s in a debug build, against 4 ms for the
// same bytes in a flat array.
//
// The fixture compares the nested document against a flat one of the same size
// in one process, so the bound does not depend on machine speed. The depth stays
// well below the debug build's stack limits (about 640 levels for transformSync).
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

const script = `
  const depth = 300;
  const item = '"' + Buffer.alloc(4 * 1024 * 1024, "x").toString() + '"';
  const nested = Buffer.alloc(depth, "[").toString() + item + Buffer.alloc(depth, "]").toString();
  const flat = "[" + item + "]";
  const transpiler = new Bun.Transpiler();

  function best(fn) {
    let min = Infinity;
    for (let i = 0; i < 3; i++) {
      const start = performance.now();
      fn();
      min = Math.min(min, performance.now() - start);
    }
    return min;
  }

  const ratios = {};
  for (const loader of ["json", "jsonc"]) {
    const result = transpiler.scan(nested, loader);
    if (result.imports.length !== 0 || result.exports.length !== 0) {
      throw new Error("unexpected scan result: " + JSON.stringify(result));
    }
    ratios["scan " + loader] =
      best(() => transpiler.scan(nested, loader)) / best(() => transpiler.scan(flat, loader));
  }
  if (transpiler.transformSync(nested, "json") !== "export default " + nested + ";\\n") {
    throw new Error("unexpected transformSync output");
  }
  ratios["transformSync json"] =
    best(() => transpiler.transformSync(nested, "json")) / best(() => transpiler.transformSync(flat, "json"));
  console.log(JSON.stringify(ratios));
`;

test("json loader: nesting depth does not multiply the cost of an array item", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode }).toMatchObject({
    stdout: expect.stringMatching(/^\{"scan json":/),
    stderr: "",
    exitCode: 0,
  });

  // Nested costs about 2x flat with recorded locations (the extra array nodes)
  // and 90x or more with the re-scan.
  const ratios = JSON.parse(stdout);
  expect(ratios).toEqual({
    "scan json": expect.any(Number),
    "scan jsonc": expect.any(Number),
    "transformSync json": expect.any(Number),
  });
  const slow = Object.entries(ratios).filter(([, ratio]) => !(ratio < 20));
  expect(slow).toEqual([]);
});
