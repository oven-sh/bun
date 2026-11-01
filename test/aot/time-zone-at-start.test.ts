import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { describe, test } from "./supported";

const program = `console.log(process.env.TZ, new Date(0).getHours(), new Date(0).getTimezoneOffset(), Intl.DateTimeFormat().resolvedOptions().timeZone);\n`;
const withoutZone = { ...bunEnv, TZ: undefined };

describe.concurrent("an executable starts in the time zone that bun run starts in", () => {
  for (const [name, files, env, zone] of [
    ["TZ in the environment", {}, { ...bunEnv, TZ: "Asia/Tokyo" }, "Asia/Tokyo 9 -540 Asia/Tokyo\n"],
    ["TZ in a .env file", { ".env": "TZ=Asia/Tokyo\n" }, withoutZone, "Asia/Tokyo 9 -540 Asia/Tokyo\n"],
    [
      "TZ in both",
      { ".env": "TZ=Asia/Tokyo\n" },
      { ...bunEnv, TZ: "America/New_York" },
      "America/New_York 19 300 America/New_York\n",
    ],
  ] as const) {
    test(
      name,
      async () => {
        using dir = tempDir("aot-time-zone", { "main.mjs": program, ...files });
        const cwd = String(dir);
        const executable = join(cwd, isWindows ? "main.exe" : "main");
        const expected = { stdout: zone, stderr: "", exitCode: 0 };
        expect(await run([bunExe(), "run", "main.mjs"], cwd, env)).toEqual(expected);
        const built = await run(
          [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable],
          cwd,
          bunEnv,
        );
        expect(built.exitCode).toBe(0);
        expect(await run([executable], cwd, env)).toEqual(expected);
      },
      120_000,
    );
  }
});
