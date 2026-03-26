import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("recursive new with stack overflow does not crash", async () => {
    await using proc = Bun.spawn({
        cmd: [
            bunExe(),
            "-e",
            `
            function F(a) {
                if (!new.target) throw 'must be called with new';
                try { new a(a); } catch(e) {}
            }
            new F(F);
            console.log("done");
            `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
        proc.stdout.text(),
        proc.stderr.text(),
        proc.exited,
    ]);

    expect(stdout).toBe("done\n");
    expect(exitCode).toBe(0);
});
