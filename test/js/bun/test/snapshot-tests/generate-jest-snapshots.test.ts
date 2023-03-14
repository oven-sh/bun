import { bunExe } from "harness";
import { tmpdir } from "os";
import { mkdirSync, copyFileSync, writeFileSync } from "node:fs";

test("generate jest snapshot output", () => {
  // generate jest snapshots and let bun test runner test against them
  const tempDir = tmpdir() + "/generate-jest-snapshots";
  console.log("making dir:", tempDir);
  mkdirSync(tempDir + "/snapshots/more-snapshots", { recursive: true });
  copyFileSync(import.meta.dir + "/snapshots/snapshot.test.ts", tempDir + "/snapshots/snapshot.test.ts");
  copyFileSync(import.meta.dir + "/snapshots/more.test.ts", tempDir + "/snapshots/more.test.ts");
  copyFileSync(import.meta.dir + "/snapshots/moremore.test.ts", tempDir + "/snapshots/moremore.test.ts");
  copyFileSync(
    import.meta.dir + "/snapshots/more-snapshots/different-directory.test.ts",
    tempDir + "/snapshots/more-snapshots/different-directory.test.ts",
  );
  writeFileSync(tempDir + "/jest.config.js", "");

  const { exitCode, stderr } = Bun.spawnSync({
    cmd: [bunExe(), "x", "jest", tempDir + "/snapshots/", "--updateSnapshot"],
    cwd: tempDir,
  });

  console.log(stderr?.toString());
  expect(exitCode).toBe(0);

  // ensure snapshot directories exist
  mkdirSync(import.meta.dir + "/snapshots/__snapshots__", { recursive: true });
  mkdirSync(import.meta.dir + "/snapshots/more-snapshots/__snapshots__", { recursive: true });

  copyFileSync(
    tempDir + "/snapshots/__snapshots__/snapshot.test.ts.snap",
    import.meta.dir + "/snapshots/__snapshots__/snapshot.test.ts.snap",
  );
  copyFileSync(
    tempDir + "/snapshots/__snapshots__/more.test.ts.snap",
    import.meta.dir + "/snapshots/__snapshots__/more.test.ts.snap",
  );
  copyFileSync(
    tempDir + "/snapshots/__snapshots__/moremore.test.ts.snap",
    import.meta.dir + "/snapshots/__snapshots__/moremore.test.ts.snap",
  );
  copyFileSync(
    tempDir + "/snapshots/more-snapshots/__snapshots__/different-directory.test.ts.snap",
    import.meta.dir + "/snapshots/more-snapshots/__snapshots__/different-directory.test.ts.snap",
  );
});
