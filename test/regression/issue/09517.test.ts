// https://github.com/oven-sh/bun/issues/9517
// Repeated Bun.build calls with FileSystemRouter and absolute path imports
// would fail with "Unseekable reading file" due to stale cached file descriptors.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

test("Bun.build does not fail on repeated calls with FileSystemRouter present", async () => {
  using dir = tempDir("issue-9517", {
    "pages/index.js": `export default function Page() { return "Hello"; }`,
  });

  const dirPath = String(dir);
  const absPagePath = join(dirPath, "pages/index.js");

  // Create an entry file that imports from an absolute path
  await Bun.write(
    join(dirPath, "pages/_entry.js"),
    `import PageComponent from "${absPagePath}";\nconsole.log(PageComponent());\n`,
  );

  // Script that creates a FileSystemRouter (which populates the
  // resolver's FD cache) and then runs Bun.build multiple times.
  await Bun.write(
    join(dirPath, "runner.js"),
    `
const router = new Bun.FileSystemRouter({
  style: "nextjs",
  dir: "./pages",
});

const results = [];
for (let i = 0; i < 10; i++) {
  const result = await Bun.build({
    entrypoints: ['./pages/_entry.js'],
  });
  results.push({
    success: result.success,
    errors: result.success ? [] : result.logs.map(l => l.message),
  });
}
console.log(JSON.stringify(results));
`,
  );

  await using proc = Bun.spawn({
    cmd: [bunExe(), "runner.js"],
    env: bunEnv,
    cwd: dirPath,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  if (stdout.trim().length === 0) {
    throw new Error(`Subprocess produced no stdout. stderr: ${stderr}`);
  }

  const results = JSON.parse(stdout.trim());

  // All 10 builds should succeed
  for (let i = 0; i < results.length; i++) {
    if (!results[i].success) {
      throw new Error(`Build #${i} failed: ${JSON.stringify(results[i].errors)}`);
    }
    expect(results[i].success).toBe(true);
  }

  expect(exitCode).toBe(0);
});
