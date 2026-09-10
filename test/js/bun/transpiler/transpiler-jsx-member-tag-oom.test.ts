// bun-fuzz: a JSX member-expression tag `<a.b.b.b…/>` built its dotted name by
// re-allocating and copying the whole accumulated prefix into the AST arena
// once per member, so a tag with n members cost ~n^2 bytes that were only
// released when the arena was reset: a 92 KB source left the process at
// 2.1 GB RSS and 131 KB was OOM-killed. The name is now joined once.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("JSX member-expression tag names are joined correctly", () => {
  const tx = new Bun.Transpiler({ loader: "tsx" });
  expect(tx.transformSync("x = <a.b.c>hi</a.b.c>;")).toContain("(a.b.c, {");
  // Whitespace between the members does not matter, only the names do.
  expect(tx.transformSync("x = <a.b.c></a . b . c>;")).toContain("(a.b.c, {");
  expect(() => tx.transformSync("x = <a.b.c></a.b.d>;")).toThrow(
    'Expected closing JSX tag to match opening tag "<a.b.c>"',
  );
  expect(() => tx.transformSync("x = <a.b.c></a.b>;")).toThrow(
    'Expected closing JSX tag to match opening tag "<a.b.c>"',
  );
});

test("long JSX member-expression tags parse in linear memory", async () => {
  // `scanImports` runs the same JSX tag parser as `transformSync` but does not
  // print, so the member chain can be deep without hitting the printer's
  // recursion limit in debug builds.
  const fixture = /* js */ `
    const depth = 8000;
    const tags = 16;
    const src = Array.from({ length: tags }, (_, i) => "x" + i + " = <a" + ".b".repeat(depth) + " />;").join("\\n");
    const tx = new Bun.Transpiler({ loader: "tsx" });
    const before = process.memoryUsage.rss();
    const imports = tx.scanImports(src);
    const after = process.memoryUsage.rss();
    if (!imports.some(i => i.path === "react/jsx-dev-runtime")) throw new Error("unexpected imports: " + JSON.stringify(imports));
    console.log(JSON.stringify({ delta_mb: (after - before) / 1024 / 1024 }));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
    stdout: expect.stringMatching(/^\{"delta_mb":/),
    stderr: "",
    exitCode: 0,
  });
  const { delta_mb } = JSON.parse(stdout);
  // Before the fix: 16 tags x 8000 members copied ~1 GB into the arena (1.2 GB
  // RSS growth under ASAN). After: under 10 MB.
  expect(delta_mb).toBeLessThan(150);
}, 60_000);
