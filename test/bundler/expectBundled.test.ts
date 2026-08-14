import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "node:path";

// Each test writes a small bundler test file into a temp directory and runs `bun test` on it, so
// what is asserted is what a contributor sees when a test file registers an itBundled() id twice.

const fixturePrelude = /* ts */ `
  import { describe } from "bun:test";
  import { itBundled } from ${JSON.stringify(path.join(import.meta.dir, "expectBundled.ts"))};
  const files = { "/entry.js": 'console.log("hi");' };
`;

async function runFixture(body: string, ...args: string[]) {
  using dir = tempDir("expect-bundled-ids", { "ids.test.ts": fixturePrelude + body });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "ids.test.ts", ...args],
    cwd: String(dir),
    env: {
      ...bunEnv,
      BUN_BUNDLER_TEST_FILTER: undefined,
      BUN_BUNDLER_TEST_USE_ESBUILD: undefined,
      BUN_BUNDLER_TEST_DEBUG: undefined,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { output: stdout + stderr, exitCode };
}

const registeredTwice = (id: string) => `itBundled("${id}", ...) was registered twice`;

describe("itBundled ids must be unique within a test file", () => {
  test.concurrent("the same id twice in one describe block fails the file", async () => {
    const { output, exitCode } = await runFixture(/* ts */ `
      describe("bundler", () => {
        itBundled("harness/CopyPasted", { files });
        itBundled("harness/CopyPasted", { files });
      });
    `);
    expect(output).toContain(registeredTwice("harness/CopyPasted"));
    expect(exitCode).toBe(1);
  });

  test.concurrent("the same id from two describe blocks fails the file", async () => {
    const { output, exitCode } = await runFixture(/* ts */ `
      for (const backend of ["api", "cli"] as const) {
        describe(\`bundler/\${backend}\`, () => {
          itBundled("harness/NotParameterized", { files, backend });
        });
      }
    `);
    expect(output).toContain(registeredTwice("harness/NotParameterized"));
    expect(exitCode).toBe(1);
  });

  test.concurrent("the same id registered through a helper fails the file", async () => {
    const { output, exitCode } = await runFixture(/* ts */ `
      const add = (n: number) => itBundled(\`harness/Case\${n}\`, { files });
      describe("bundler", () => {
        add(1);
        add(2);
        add(2);
      });
    `);
    expect(output).toContain(registeredTwice("harness/Case2"));
    expect(exitCode).toBe(1);
  });

  test.concurrent("itBundled.skip takes part in the check", async () => {
    const { output, exitCode } = await runFixture(/* ts */ `
      describe("bundler", () => {
        itBundled.skip("harness/Skipped", { files });
        itBundled("harness/Skipped", { files });
      });
    `);
    expect(output).toContain(registeredTwice("harness/Skipped"));
    expect(exitCode).toBe(1);
  });

  test.concurrent("itBundled.only takes part in the check", async () => {
    const { output, exitCode } = await runFixture(/* ts */ `
      describe("bundler", () => {
        itBundled("harness/Focused", { files });
        itBundled.only("harness/Focused", { files });
      });
    `);
    expect(output).toContain(registeredTwice("harness/Focused"));
    expect(exitCode).toBe(1);
  });

  test.concurrent("--rerun-each re-registers the same ids without tripping the check", async () => {
    const { output, exitCode } = await runFixture(
      /* ts */ `
        describe("bundler", () => {
          itBundled("harness/First", { files });
          itBundled.skip("harness/Second", { files });
          console.log("collected ids");
        });
      `,
      "--rerun-each",
      "3",
    );
    expect(output).not.toContain("was registered twice");
    expect(output.split("collected ids").length - 1).toBe(3);
    expect(exitCode).toBe(0);
  });
});
