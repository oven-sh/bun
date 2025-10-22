import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("issue #23600 - ::view-transition-old() with class selector should work", async () => {
  using dir = tempDir("issue-23600", {
    "styles.css": `
@keyframes slide-out {
  from {
    opacity: 1;
    transform: translateX(0);
  }
  to {
    opacity: 0;
    transform: translateX(-100%);
  }
}

::view-transition-old(.slide-out) {
  animation-name: slide-out;
  animation-timing-function: ease-in-out;
}
`,
    "index.js": `import styles from "./styles.css";\nconsole.log("success");`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "index.js", "--outdir=dist"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("Unexpected token");
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);
});
