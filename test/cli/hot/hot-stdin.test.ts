import { spawn } from "bun";
import { expect, it } from "bun:test";
import { readFileSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";
import { join } from "path";

const timeout = isDebug ? Infinity : 10_000;

const fixtureSource = /* js */ `
import readline from "node:readline";

// Survives reloads (--hot keeps the global object).
globalThis.__reloadCount ??= 0;
globalThis.__reloadCount++;
const myLoad = globalThis.__reloadCount;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// One listener each after createInterface; if old listeners leaked across
// the reload these would be 2, 3, ... on subsequent loads.
console.log(
  "LISTENERS",
  myLoad,
  process.stdin.listenerCount("data"),
  process.stdin.listenerCount("error"),
  process.stdin.listenerCount("end"),
  process.stdout.listenerCount("resize"),
);

rl.on("line", line => {
  // Capture myLoad so a leaked handler from a previous load is visible
  // as "ECHO <old> ..." in the output.
  console.log("ECHO", myLoad, line);
});
`;

// https://github.com/oven-sh/bun/issues/15027
// process.stdin/stdout/stderr survive --hot reloads; listeners attached by
// the previous evaluation (e.g. node:readline) must be dropped so the fresh
// one doesn't stack a second set of handlers on the same stream, causing
// every keystroke / line to be processed twice.
it(
  "should not leak process.stdin listeners across --hot reloads",
  async () => {
    using dir = tempDir("hot-stdin", {
      "index.js": fixtureSource,
    });
    const fixture = join(String(dir), "index.js");

    await using runner = spawn({
      cmd: [bunExe(), "--hot", "run", fixture],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      stdin: "pipe",
    });

    const lines: string[] = [];
    const waiters: Array<{ test: (line: string) => boolean; resolve: (line: string) => void }> = [];
    let buf = "";
    (async () => {
      for await (const chunk of runner.stdout) {
        buf += new TextDecoder().decode(chunk);
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          lines.push(line);
          for (let i = waiters.length - 1; i >= 0; i--) {
            if (waiters[i].test(line)) {
              waiters.splice(i, 1)[0].resolve(line);
            }
          }
        }
      }
    })().catch(() => {});
    let stderrText = "";
    (async () => {
      for await (const chunk of runner.stderr) stderrText += new TextDecoder().decode(chunk);
    })().catch(() => {});
    runner.exited.then(() => {
      for (const w of waiters.splice(0)) w.resolve("<process exited>");
    });

    const waitForLine = (test: (line: string) => boolean): Promise<string> => {
      const already = lines.find(test);
      if (already !== undefined) return Promise.resolve(already);
      return new Promise(resolve => waiters.push({ test, resolve }));
    };

    try {
      // First load: readline attaches one data/error/end listener to stdin.
      const first = await waitForLine(l => l.startsWith("LISTENERS 1 "));
      expect(first).toBe("LISTENERS 1 1 1 1 0");

      runner.stdin.write("hello\n");
      runner.stdin.flush();
      const echo1 = await waitForLine(l => l.startsWith("ECHO "));
      expect(echo1).toBe("ECHO 1 hello");

      // Trigger a reload.
      writeFileSync(fixture, readFileSync(fixture, "utf-8"));

      // After reload the previous listeners must have been cleared, so the
      // new readline interface sees a clean stdin and counts stay at 1.
      const second = await waitForLine(l => l.startsWith("LISTENERS 2 "));
      expect(second).toBe("LISTENERS 2 1 1 1 0");

      // Send one more line; exactly one ECHO from the current load, and no
      // ECHO from the previous load's leaked handler.
      lines.length = 0;
      runner.stdin.write("world\n");
      runner.stdin.flush();
      const echo2 = await waitForLine(l => l.startsWith("ECHO ") && l.endsWith(" world"));
      expect(echo2).toBe("ECHO 2 world");
      expect(lines.filter(l => l.startsWith("ECHO "))).toEqual(["ECHO 2 world"]);

      // Trigger another reload.
      writeFileSync(fixture, readFileSync(fixture, "utf-8"));

      const third = await waitForLine(l => l.startsWith("LISTENERS 3 "));
      expect(third).toBe("LISTENERS 3 1 1 1 0");

      lines.length = 0;
      runner.stdin.write("again\n");
      runner.stdin.flush();
      const echo3 = await waitForLine(l => l.startsWith("ECHO ") && l.endsWith(" again"));
      expect(echo3).toBe("ECHO 3 again");
      expect(lines.filter(l => l.startsWith("ECHO "))).toEqual(["ECHO 3 again"]);
    } catch (e) {
      console.error("stdout lines so far:", lines, "buf:", buf);
      console.error("stderr:", stderrText);
      throw e;
    } finally {
      runner.stdin.end();
      runner.kill();
    }
  },
  timeout,
);
