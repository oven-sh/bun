// Temporary probe, not for merge. On windows 11 aarch64 `bun --hot` stops for more than 90 s when the program of
// hot.test.ts makes its rejected promises first. This runs that program and says where it stops.
import { spawn, spawnSync } from "bun";
import { writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

function powershell(script: string) {
  try {
    const result = spawnSync({
      cmd: ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
      stdout: "pipe",
      stderr: "pipe",
      timeout: 20_000,
    });
    return (result.stdout.toString() + " " + result.stderr.toString()).trim().replace(/\s*\r?\n\s*/g, " | ");
  } catch (error) {
    return "powershell did not run: " + error;
  }
}

/** The CPU time, and the state of the 12 threads that used the most of it. */
function describeProcess(pid: number) {
  return powershell(
    `try { $p = Get-Process -Id ${pid} -ErrorAction Stop; ` +
      `'cpu=' + [int]$p.TotalProcessorTime.TotalMilliseconds + 'ms handles=' + $p.HandleCount + ' threads=' + $p.Threads.Count; ` +
      `$p.Threads | Sort-Object { $_.TotalProcessorTime } -Descending | Select-Object -First 12 | ForEach-Object { ` +
      `try { $reason = if ($_.ThreadState -eq 'Wait') { $_.WaitReason } else { '-' }; ` +
      `'' + $_.Id + ':' + $_.ThreadState + ':' + $reason + ':' + [int]$_.TotalProcessorTime.TotalMilliseconds + 'ms' } catch { 'thread: ' + $_ } } ` +
      `} catch { 'error: ' + $_ }`,
  );
}

function describeDefender() {
  return powershell(
    `try { $s = Get-MpComputerStatus -ErrorAction Stop; ` +
      `'realtime=' + $s.RealTimeProtectionEnabled + ' behavior=' + $s.BehaviorMonitorEnabled + ' mode=' + $s.AMRunningMode + ' tamper=' + $s.IsTamperProtected ` +
      `} catch { 'error: ' + $_ }`,
  );
}

/** Runs the program. Returns nothing when all three loads came in time, and what it saw when one did not. */
export async function probeStall(label: string, env: Record<string, string> = {}): Promise<string[]> {
  const notes: string[] = [];
  const started = performance.now();
  const note = (what: string) => notes.push(`[${label}] ${Math.round(performance.now() - started)} ms: ${what}`);

  using dir = tempDir("hot-entry-promise-probe", { "main.js": `console.log("first load");` });
  const file = join(String(dir), "main.js");
  await using runner = spawn({
    cmd: [bunExe(), "--hot", "--no-clear-screen", "main.js"],
    env: { ...bunEnv, ...env },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const reader = runner.stdout.getReader();
  let stdout = "";
  let waitingFor = "first load";
  let saved = `console.log("first load");`;
  // The same wait as in hot.test.ts, so that the saves come at the same moments.
  const line = async (expected: string) => {
    waitingFor = expected;
    while (!stdout.split("\n").slice(0, -1).includes(expected)) {
      const { value, done } = await reader.read();
      if (done) break;
      stdout += Buffer.from(value).toString();
    }
    note(`the wait for ${JSON.stringify(expected)} ended`);
  };
  const save = (text: string) => {
    saved = text;
    writeFileSync(file, text);
  };

  let stopped: Promise<void> | undefined;
  const watchdog = setTimeout(() => {
    stopped = (async () => {
      const at = waitingFor;
      try {
        note(`STOPPED: no ${JSON.stringify(at)} after 15 s. stdout is ${JSON.stringify(stdout)}`);
        note(`process: ${describeProcess(runner.pid)}`);
        await Bun.sleep(1000);
        note(`process, 1 s later: ${describeProcess(runner.pid)}`);
        note(`defender: ${describeDefender()}`);
        if (waitingFor === at && at !== "exit") {
          writeFileSync(file, saved);
          note(`saved the same text again`);
          await Bun.sleep(5000);
          note(
            waitingFor === at
              ? `no ${JSON.stringify(at)} 5 s after the second save. stdout is ${JSON.stringify(stdout)}`
              : `the second save helped: the wait is now for ${JSON.stringify(waitingFor)}`,
          );
        }
        if (waitingFor === at) note(`process at the end: ${describeProcess(runner.pid)}`);
      } catch (error) {
        note(`the probe itself failed: ${error}`);
      } finally {
        if (waitingFor === at) runner.kill();
      }
    })();
  }, 15_000);

  await line("first load");
  const second = `
      globalThis.kept = [];
      require("fs").readFile(__filename, () => {
        Bun.gc(true);
        setImmediate(() => {
          Bun.gc(true);
          require("crypto").randomBytes(8, () => {
            Bun.gc(true);const rejected = Array(20000).fill(new Error("not the entry point's")).map(error => Promise.reject(error));
            for (let i = 0; i < 20000; i++) {
              const promise = rejected[i];
              promise.catch(() => {});
              kept.push(promise);
            }
            console.log("collected");
          });
        });
      });
    `;
  save(second);
  await line("collected");
  save(`console.log("third load"); process.exit(0);`.padEnd(second.length));
  await line("third load");
  waitingFor = "exit";
  const stderr = await runner.stderr.text();
  const exitCode = await runner.exited;
  clearTimeout(watchdog);
  await stopped;
  note(`exit code ${exitCode}, stderr is ${JSON.stringify(stderr.slice(0, 3000))}`);
  return stopped ? notes : [];
}
