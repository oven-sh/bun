// Tests for the `fileSystemRouterTypes[n]` options of a custom framework
// (`Bun.serve({ app: { framework } })`).
import { Bake } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { devTest, minimalFramework } from "../bake-harness";

function frameworkWithRouterOptions(options: Partial<Bake.FrameworkFileSystemRouterType>): Bake.Framework {
  return {
    ...minimalFramework,
    fileSystemRouterTypes: [{ ...minimalFramework.fileSystemRouterTypes[0], ...options }],
  };
}

const page = (text: string) => `export default () => new Response(${JSON.stringify(text)});`;

devTest("ignoreDirs skips directories whose name is listed", {
  framework: frameworkWithRouterOptions({ ignoreDirs: ["hidden", "also-hidden"] }),
  files: {
    "routes/index.ts": page("index"),
    "routes/hidden/index.ts": page("hidden"),
    "routes/also-hidden/index.ts": page("also-hidden"),
    "routes/visible/index.ts": page("visible"),
    "routes/visible/hidden/index.ts": page("visible/hidden"),
    "routes/hidden-suffix/index.ts": page("hidden-suffix"),
  },
  async test(dev) {
    await dev.fetch("/").equals("index");
    await dev.fetch("/visible").equals("visible");
    await dev.fetch("/hidden").expect404();
    await dev.fetch("/also-hidden").expect404();
    // Matched at any depth, not only directly under the root.
    await dev.fetch("/visible/hidden").expect404();
    // Compared against the whole directory name, not as a prefix.
    await dev.fetch("/hidden-suffix").equals("hidden-suffix");
  },
});

devTest("ignoreDirs defaults to node_modules and .git", {
  framework: minimalFramework,
  files: {
    "routes/index.ts": page("index"),
    "routes/other/index.ts": page("other"),
    "routes/node_modules/index.ts": page("node_modules"),
    "routes/.git/index.ts": page(".git"),
  },
  async test(dev) {
    await dev.fetch("/").equals("index");
    await dev.fetch("/other").equals("other");
    await dev.fetch("/node_modules").expect404();
    await dev.fetch("/.git").expect404();
  },
});

test("ignoreDirs must be an array", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        try {
          Bun.serve({
            port: 0,
            development: true,
            app: {
              framework: {
                fileSystemRouterTypes: [
                  { root: "routes", style: "nextjs-pages", serverEntryPoint: "./server.ts", ignoreDirs: "hidden" },
                ],
              },
            },
          });
          console.log("did not throw");
        } catch (e) {
          console.log(e.message);
        }
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("'ignoreDirs' must be an array of strings\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
