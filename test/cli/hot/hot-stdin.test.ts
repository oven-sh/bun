import { spawn } from "bun";
import { expect, it } from "bun:test";
import { readFileSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isDebug, isWindows, tempDir } from "harness";
import { join } from "path";

const timeout = isDebug ? Infinity : 10_000;

const fixtureSource = /* js */ `
import readline from "node:readline";

// Survives reloads (--hot keeps the global object).
globalThis.__reloadCount ??= 0;
globalThis.__reloadCount++;
const myLoad = globalThis.__reloadCount;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// readline attaches one data/error/end listener, and getStdinStream keeps
// one internal 'end' listener of its own, so the expected counts are
// data=1 error=1 end=2 resize=0. If old listeners leaked across the reload
// these would climb on subsequent loads.
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
//
// The Windows file watcher can fire multiple events for a single
// writeFileSync, so a single "reload trigger" below may advance the load
// counter by more than one. The assertions therefore don't pin exact load
// numbers — they verify that (a) every LISTENERS line reports the same
// fixed listener counts, and (b) each input line produces exactly one ECHO
// from the current load (never from a previous one).
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
          const line = buf.slice(0, nl).replace(/\r$/, "");
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

    // Wait until a LISTENERS line with a load count strictly greater than
    // `afterLoad` appears, then return the highest load number seen.
    const waitForLoadAfter = async (afterLoad: number): Promise<number> => {
      let newest = afterLoad;
      await waitForLine(l => {
        const m = /^LISTENERS (\d+) (\d+) (\d+) (\d+) (\d+)$/.exec(l);
        if (!m) return false;
        const load = Number(m[1]);
        if (load > newest) newest = load;
        return load > afterLoad;
      });
      return newest;
    };

    try {
      // First load: readline attaches one data/error/end listener to stdin.
      let load = await waitForLoadAfter(0);
      expect(load).toBeGreaterThanOrEqual(1);

      runner.stdin.write("hello\n");
      runner.stdin.flush();
      const echo1 = await waitForLine(l => l.startsWith("ECHO ") && l.endsWith(" hello"));
      expect(echo1).toMatch(/^ECHO \d+ hello$/);

      for (let i = 0; i < 2; i++) {
        // Trigger a reload (may cause 1+ reloads on Windows).
        const prev = load;
        writeFileSync(fixture, readFileSync(fixture, "utf-8"));
        load = await waitForLoadAfter(prev);
        expect(load).toBeGreaterThan(prev);

        // Send one line; exactly one ECHO from the current load, and none
        // from any previous load's leaked handler.
        const tag = `round${i}`;
        runner.stdin.write(`${tag}\n`);
        runner.stdin.flush();
        const echo = await waitForLine(l => l.startsWith("ECHO ") && l.endsWith(` ${tag}`));
        const echoLoad = Number(/^ECHO (\d+) /.exec(echo)![1]);
        // The echo must come from the current (or a newer, if another reload
        // raced in) load — never from a load that existed before the reset.
        expect(echoLoad).toBeGreaterThan(prev);
        // Exactly one handler saw the input.
        expect(lines.filter(l => l.startsWith("ECHO ") && l.endsWith(` ${tag}`))).toHaveLength(1);
      }

      // Every LISTENERS line observed over the whole run must show the same
      // fixed counts (data=1 error=1 end=2 resize=0; see the fixture comment)
      // — i.e. listeners never accumulated across reloads.
      const listenerLines = lines.filter(l => l.startsWith("LISTENERS "));
      expect(listenerLines.length).toBeGreaterThanOrEqual(3);
      for (const l of listenerLines) {
        expect(l).toMatch(/^LISTENERS \d+ 1 1 2 0$/);
      }
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

// Terminal-mode variant of the same regression, run inside a PTY so readline
// takes the emitKeypressEvents/raw-mode path from the original #15027 report.
// node:readline is not re-evaluated on reload, so the keypress-decoder marker
// it leaves on process.stdin survives; unless the reset clears it, the fresh
// interface never re-installs its data -> keypress bridge. Before the fix every
// line is echoed once per leaked interface (READY shows keypress=2); with the
// listeners stripped but the marker kept, readline goes silent (data=0).
it.skipIf(isWindows)(
  "should keep terminal readline working across --hot reloads without duplicating input",
  async () => {
    using dir = tempDir("hot-stdin-pty", {
      "index.js": /* js */ `
        import readline from "node:readline";

        globalThis.__reloadCount ??= 0;
        globalThis.__reloadCount++;
        const myLoad = globalThis.__reloadCount;

        const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
        rl.on("line", line => {
          console.log(\`ECHO \${myLoad} \${line}\`);
        });

        console.log(\`READY \${myLoad} data=\${process.stdin.listenerCount("data")} keypress=\${process.stdin.listenerCount("keypress")} resize=\${process.stdout.listenerCount("resize")}\`);
      `,
    });
    const fixture = join(String(dir), "index.js");

    // The PTY echoes our keystrokes back mixed with program output; keep only
    // the fixture's own READY/ECHO lines.
    let output = "";
    const lines: string[] = [];
    const waiters: Array<{ test: (line: string) => boolean; resolve: (line: string) => void }> = [];
    const decoder = new TextDecoder();
    await using terminal = new Bun.Terminal({
      data(_terminal, chunk) {
        output += decoder.decode(chunk, { stream: true });
        let nl: number;
        while ((nl = output.indexOf("\n")) !== -1) {
          const line = Bun.stripANSI(output.slice(0, nl)).trim();
          output = output.slice(nl + 1);
          if (!line.startsWith("READY ") && !line.startsWith("ECHO ")) continue;
          lines.push(line);
          for (let i = waiters.length - 1; i >= 0; i--) {
            if (waiters[i].test(line)) waiters.splice(i, 1)[0].resolve(line);
          }
        }
      },
    });

    await using proc = spawn({
      cmd: [bunExe(), "--hot", "run", fixture],
      env: bunEnv,
      cwd: String(dir),
      terminal,
    });

    // A child that dies must fail the pending wait instead of hanging it.
    const exited = proc.exited.then(code => {
      throw new Error(`bun --hot exited early with code ${code}; lines so far: ${JSON.stringify(lines)}`);
    });
    exited.catch(() => {});
    const waitForLine = (test: (line: string) => boolean): Promise<string> => {
      const already = lines.find(test);
      if (already !== undefined) return Promise.resolve(already);
      return Promise.race([new Promise<string>(resolve => waiters.push({ test, resolve })), exited]);
    };

    try {
      expect(await waitForLine(l => l.startsWith("READY 1 "))).toBe("READY 1 data=1 keypress=1 resize=1");
      terminal.write("hello\r");
      expect(await waitForLine(l => /^ECHO \d+ hello$/.test(l))).toBe("ECHO 1 hello");

      // Trigger a reload (the watcher may report one write as more than one).
      writeFileSync(fixture, readFileSync(fixture, "utf-8"));
      const ready = await waitForLine(l => /^READY ([2-9]|\d{2,}) /.test(l));
      // The new interface must have exactly the listeners of a first load:
      // nothing leaked from the old one and nothing missing.
      expect(ready).toMatch(/^READY \d+ data=1 keypress=1 resize=1$/);

      terminal.write("world\r");
      const world = await waitForLine(l => /^ECHO \d+ world$/.test(l));
      expect(Number(/^ECHO (\d+) /.exec(world)![1])).toBeGreaterThan(1);
      // A leaked interface would have echoed "world" in the same dispatch as the
      // line above. Typing another line and waiting for its echo flushes that out.
      terminal.write("done\r");
      await waitForLine(l => /^ECHO \d+ done$/.test(l));

      expect(lines.filter(l => /^ECHO \d+ world$/.test(l))).toEqual([world]);
      for (const l of lines.filter(l => l.startsWith("READY "))) {
        expect(l).toMatch(/^READY \d+ data=1 keypress=1 resize=1$/);
      }
    } catch (e) {
      console.error("pty lines:", lines);
      throw e;
    } finally {
      proc.kill();
    }
  },
  timeout,
);
