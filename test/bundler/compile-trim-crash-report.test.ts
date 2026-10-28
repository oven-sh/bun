import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "../aot/harness/run";
import { canTrim } from "./compile-trim-features";

const program = `
  import { read } from "bun:ffi";
  console.log("before");
  read.u8(8, 0);
`;

// Trimming doesn't move code, so the same symbols resolve both reports.
test.skipIf(isWindows || isASAN || !canTrim)(
  "a trimmed executable reports the same crash addresses as a whole one",
  async () => {
    using dir = tempDir("compile-trim-crash-report", { "program.ts": program });
    const reports: string[] = [];
    for (const [outfile, flags] of [
      ["whole", []],
      ["trimmed", ["--trim"]],
    ] as const) {
      const built = await run(
        [bunExe(), "build", "--compile", ...flags, "program.ts", "--outfile", outfile],
        String(dir),
      );
      expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({
        stderr: expect.not.stringContaining("error:"),
        exitCode: 0,
      });
      // It crashes on purpose, and leaves no core file.
      const crashed = await run(
        ["/bin/sh", "-c", 'ulimit -c 0 && exec "$@"', "--", join(String(dir), outfile)],
        String(dir),
        {
          ...bunEnv,
          BUN_CRASH_REPORT_URL: "",
          BUN_ENABLE_CRASH_REPORTING: "0",
        },
      );
      expect(crashed.stdout).toBe("before\n");
      expect(crashed.stderr).toContain("Segmentation fault at address 0x8");
      reports.push(crashed.stderr.match(/^ (\/\S+)$/m)![1]);
    }
    expect(reports[1]).toBe(reports[0]);
  },
);
