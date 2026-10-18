import { Glob } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("bun build --minify keeps both adjacent :where() rules that hold only custom properties", async () => {
  using dir = tempDir("issue-44704", {
    "t.css": ":where(.x){--a:1}:where(.x){--b:2}",
    "index.html": `<link rel="stylesheet" href="./t.css"><p>x</p>`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "./index.html", "--outdir", "out", "--minify"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stderr, exitCode, built: stdout.includes("Bundled") }).toEqual({ stderr: "", exitCode: 0, built: true });

  const files = [...new Glob("out/*.css").scanSync(String(dir))];
  const css = await Promise.all(files.map(file => Bun.file(`${dir}/${file}`).text()));

  // The two rules can stay apart or merge. Both declarations must survive.
  expect(css.map(text => text.match(/--\w+:\d+/g))).toEqual([["--a:1", "--b:2"]]);
});
