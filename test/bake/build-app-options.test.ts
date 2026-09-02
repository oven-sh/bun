import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { disabledSpecifierCases, frameworkFiles } from "./disabled-specifier-cases";

// The `bun build --app` side of the cases in app-options.test.ts. This file is
// listed in test/no-validate-exceptions.txt and test/no-validate-leaksan.txt:
// the production config loader trips both validations before the framework
// resolves, see the notes there.
for (const c of disabledSpecifierCases) {
  test.concurrent(`bun build --app reports a disabled ${c.name}`, async () => {
    using dir = tempDir("bake-build-app-disabled", {
      ...frameworkFiles,
      "package.json": c.packageJson,
      "bun.app.ts": `
        const fsr = { root: "routes", style: "nextjs-pages", serverEntryPoint: "./server.ts" };
        export default { app: { framework: ${c.framework} } };
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--app", "./bun.app.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain(`\n${c.error}\nerror: Failed to resolve all imports required by the framework\n`);
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  });
}
