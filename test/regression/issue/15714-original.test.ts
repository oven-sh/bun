import { it, expect } from 'bun:test'
import { spawn } from "bun";

const isWindows = process.platform === 'win32';

it("shell: piping assignments into command causes crash", async () => {

    const proc = spawn({
        cmd: [process.execPath, "exec", "FOO=bar BAR=baz | echo hi"],
        stdout: "pipe",
        stderr: "pipe",
        stdin: "pipe",

        cwd: import.meta.dir,
        env: { ...process.env, FORCE_COLOR: "0" }
    });

    const timeoutPromise = new Promise((resolve) =>
        setTimeout(() => resolve("timed out"), 1000)
    );

    const result = await Promise.race([proc.exited, timeoutPromise]);

    expect(result).toBeOneOf({
        "win32": [3, 143, 134, 'timed out'],
        "darwin": [133, 'timed out'],
        "linux": [132, 'timed out'],
    }[process.platform as string] || [3])

    // windows still bugged for reading stderr
    if (!isWindows && result !== 'timed out') {
        // Capture the output
        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();

        // expect(stdout).toInclude("hi")
        expect(stderr).toInclude("panic(main thread): Invalid tag\noh no: Bun has crashed. This indicates a bug in Bun, not your code.\n\nTo send a redacted crash report to Bun's team,\nplease file a GitHub issue using the link below:\n\n https://bun.report/")
    }
    proc.kill()
}, { timeout: 10000 });
