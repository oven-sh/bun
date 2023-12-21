import { spawn } from "bun";
import { join } from "path"
import { bunExe, bunEnv } from "harness";
import { writeFile } from "fs/promises"
import { mkdirSync, rmSync, mkdtempSync } from "fs"
import { tmpdir } from "os"

it("should escape double quotes in package.json scripts", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "issue7667-"));
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });

    await writeFile(
        join(testDir, "package.json"),
        JSON.stringify({
            name: "testEscapeDoubleQuotes",
            version: "0.0.1",
            scripts: {
                "foo": "echo \"ONE\" TWO",
            }
        }),
    );

    const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "run", "foo"],
        env: bunEnv,
        cwd: testDir,
        stdout: "pipe",
        stderr: "pipe"
    });

    expect(stderr).toBeDefined();
    expect(await new Response(stderr).text()).toEqual("$ echo \"ONE\" TWO\n");
    expect(stdout).toBeDefined();
    expect(await new Response(stdout).text()).toEqual("ONE TWO\n");
    expect(await exited).toBe(0);
})

it("should escape double quotes with additional arguments in package.json scripts", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "issue7667-"));
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });

    await writeFile(
        join(testDir, "package.json"),
        JSON.stringify({
            name: "testEscapeDoubleQuotes",
            version: "0.0.1",
            scripts: {
                "foo": "echo \"ONE\" TWO",
            }
        }),
    );

    const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "run", "foo", "THREE"],
        env: bunEnv,
        cwd: testDir,
        stdout: "pipe",
        stderr: "pipe",
    });

    expect(stderr).toBeDefined();
    expect(await new Response(stderr).text()).toEqual("$ echo \"ONE\" TWO THREE\n");
    expect(stdout).toBeDefined();
    expect(await new Response(stdout).text()).toEqual("ONE TWO THREE\n");
    expect(await exited).toBe(0);
})
