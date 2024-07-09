import { crash_handler } from "bun:internal-for-testing";
import { test, expect, describe } from "bun:test";
import { bunExe, bunEnv, tempDirWithFiles, mergeWindowEnvs } from "harness";
import { existsSync } from "node:fs";
import path from "path";
const { getMachOImageZeroOffset } = crash_handler;

test.if(process.platform === "darwin")("macOS has the assumed image offset", () => {
  // If this fails, then https://bun.report will be incorrect and the stack
  // trace remappings will stop working.
  expect(getMachOImageZeroOffset()).toBe(0x100000000);
});

describe("automatic crash reporter", () => {
  const has_reporting = process.platform !== "linux";

  for (const should_report of has_reporting ? [true, false] : [false]) {
    for (const approach of ["panic", "segfault"]) {
      // TODO: this dependency injection no worky. fix later
      test.todo(`${approach} ${should_report ? "should" : "should not"} report`, async () => {
        const temp = tempDirWithFiles("crash-handler-path", {
          "curl": ({ root }) => `#!/usr/bin/env bash
echo $@ > ${root}/request.out
`,
          "powershell.cmd": ({ root }) => `echo true > ${root}\\request.out
`,
        });

        const env: any = mergeWindowEnvs([
          {
            ...bunEnv,
            GITHUB_ACTIONS: undefined,
            CI: undefined,
          },
          {
            PATH: temp + path.delimiter + process.env.PATH,
          },
        ]);

        if (!should_report) {
          env.DO_NOT_TRACK = "1";
        }

        const result = Bun.spawnSync(
          [
            bunExe(),
            path.join(import.meta.dir, "fixture-crash.js"),
            approach,
            "--debug-crash-handler-use-trace-string",
          ],
          { env },
        );

        console.log(result.stderr.toString("utf-8"));
        try {
          expect(result.stderr.toString("utf-8")).toInclude("https://bun.report/");
        } catch (e) {
          throw e;
        }

        await Bun.sleep(1000);

        const did_report = existsSync(path.join(temp, "request.out"));
        expect(did_report).toBe(should_report);
      });
    }
  }
});
