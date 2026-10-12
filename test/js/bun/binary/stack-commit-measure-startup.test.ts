// TEMPORARY: see stack-commit-measure.ts.
import { expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import {
  commitPerThreadScript,
  headerPair,
  json,
  median,
  round,
  runCaptured,
  stackGeometryScript,
  step,
  workersScript,
} from "./stack-commit-measure.ts";

test.skipIf(!isWindows)(
  "MEASURE Windows stack commit: threads and startup",
  async () => {
    using dir = tempDir("stack-commit-measure", {
      "empty.js": "",
      "worker.js": "postMessage(1);",
      "workers.js": workersScript,
    });
    const cwd = String(dir);
    const { exe4k, exe2m, exe2mCopy, both, header } = headerPair(cwd);
    await step("header", async () => ({ ...header, cores: navigator.hardwareConcurrency }));
    await step("commitPerThread", () =>
      both(async exe => json(await runCaptured(exe, ["-e", commitPerThreadScript], cwd))),
    );
    await step("stackKB[reserve,commit]", () =>
      both(async exe => json(await runCaptured(exe, ["-e", stackGeometryScript], cwd))),
    );

    // Startup: wall time and page faults of a child, from CreateProcessW to its exit. The three executables take
    // turns, and "2m-copy" against "2m" is the noise floor.
    const { dlopen, ptr } = require("bun:ffi");
    const { symbols: kernel32 } = dlopen("kernel32.dll", {
      CreateProcessW: {
        args: ["ptr", "ptr", "ptr", "ptr", "i32", "u32", "ptr", "ptr", "ptr", "ptr"],
        returns: "i32",
      },
      WaitForSingleObject: { args: ["u64", "u32"], returns: "u32" },
      GetExitCodeProcess: { args: ["u64", "ptr"], returns: "i32" },
      K32GetProcessMemoryInfo: { args: ["u64", "ptr", "u32"], returns: "i32" },
      CloseHandle: { args: ["u64"], returns: "i32" },
      GetLastError: { args: [], returns: "u32" },
    });
    const wide = (s: string) => Buffer.from(s + "\0", "utf16le");
    const cwdW = wide(cwd);
    const launch = (cmdline: string) => {
      const si = Buffer.alloc(104); // STARTUPINFOW
      si.writeUInt32LE(104, 0);
      const pi = Buffer.alloc(24); // PROCESS_INFORMATION
      const cmd = wide(cmdline);
      const start = performance.now();
      const CREATE_NO_WINDOW = 0x08000000;
      if (!kernel32.CreateProcessW(null, ptr(cmd), null, null, 0, CREATE_NO_WINDOW, null, ptr(cwdW), ptr(si), ptr(pi)))
        throw new Error(`CreateProcessW gle=${kernel32.GetLastError()}`);
      const child = pi.readBigUInt64LE(0);
      kernel32.WaitForSingleObject(child, 60000);
      const ms = performance.now() - start;
      const counters = Buffer.alloc(80); // PROCESS_MEMORY_COUNTERS_EX
      kernel32.K32GetProcessMemoryInfo(child, ptr(counters), 80);
      const code = Buffer.alloc(4);
      kernel32.GetExitCodeProcess(child, ptr(code));
      kernel32.CloseHandle(pi.readBigUInt64LE(8));
      kernel32.CloseHandle(child);
      return {
        ms,
        exit: code.readUInt32LE(0),
        faults: counters.readUInt32LE(4),
        peakWorkingSetKB: Number(counters.readBigUInt64LE(8)) / 1024,
        peakCommitKB: Number(counters.readBigUInt64LE(64)) / 1024,
      };
    };
    const exes = { "2m": exe2m, "4k": exe4k, "2m-copy": exe2mCopy };
    const order = Object.keys(exes) as (keyof typeof exes)[];
    for (const [name, args, rounds] of [
      ["--version", "--version", 20],
      ["-e 0", "-e 0", 30],
      ["empty.js", "empty.js", 40],
      ["16 workers", "workers.js", 8],
    ] as const) {
      await step(`startup ${name}`, async () => {
        const samples: Record<string, ReturnType<typeof launch>[]> = { "2m": [], "4k": [], "2m-copy": [] };
        for (let i = -2; i < rounds; i++) {
          for (let k = 0; k < order.length; k++) {
            const which = order[(k + Math.max(i, 0)) % order.length]!;
            const sample = launch(`"${exes[which]}" ${args}`);
            if (i >= 0) samples[which]!.push(sample);
          }
        }
        const row: Record<string, unknown> = { rounds };
        for (const which of order) {
          const s = samples[which]!;
          row[which] = {
            ms: round(median(s.map(x => x.ms))),
            minMs: round(Math.min(...s.map(x => x.ms))),
            faults: median(s.map(x => x.faults)),
            peakWsKB: Math.round(median(s.map(x => x.peakWorkingSetKB))),
            peakCommitKB: Math.round(median(s.map(x => x.peakCommitKB))),
            exits: [...new Set(s.map(x => x.exit))],
          };
        }
        return row;
      });
    }
    expect("done").toBe("measurements only: see the MEASURE lines");
  },
  170 * 1000,
);
