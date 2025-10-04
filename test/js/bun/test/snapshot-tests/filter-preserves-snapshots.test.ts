import { test, expect, describe } from "bun:test";
import { bunExe, bunEnv, tempDirWithFiles } from "harness";
import { join } from "path";

describe("snapshot filter preserves unfiltered snapshots", () => {
  test("using -t with -u should preserve other snapshots", async () => {
    const dir = tempDirWithFiles("snapshot-filter", {
      "test.test.ts": `
import { test, expect } from "bun:test";

test("snapshot A", () => {
  expect("value A").toMatchSnapshot();
});

test("snapshot B", () => {
  expect("value B").toMatchSnapshot();
});

test("snapshot C", () => {
  expect("value C").toMatchSnapshot();
});
      `,
    });

    // Create initial snapshots
    await Bun.spawn({
      cmd: [bunExe(), "test", "test.test.ts", "--update-snapshots"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    }).exited;

    const snapshotPath = join(dir, "__snapshots__", "test.test.ts.snap");
    const initialSnapshot = await Bun.file(snapshotPath).text();
    
    expect(initialSnapshot).toContain('exports[`snapshot A 1`]');
    expect(initialSnapshot).toContain('exports[`snapshot B 1`]');
    expect(initialSnapshot).toContain('exports[`snapshot C 1`]');

    // Update test B
    await Bun.write(join(dir, "test.test.ts"), `
import { test, expect } from "bun:test";

test("snapshot A", () => {
  expect("value A").toMatchSnapshot();
});

test("snapshot B", () => {
  expect("UPDATED value B").toMatchSnapshot();
});

test("snapshot C", () => {
  expect("value C").toMatchSnapshot();
});
    `);

    // Update only snapshot B using filter
    await Bun.spawn({
      cmd: [bunExe(), "test", "test.test.ts", "-t", "snapshot B", "--update-snapshots"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    }).exited;

    const updatedSnapshot = await Bun.file(snapshotPath).text();

    // All three snapshots should still exist
    expect(updatedSnapshot).toContain('exports[`snapshot A 1`] = `"value A"`');
    expect(updatedSnapshot).toContain('exports[`snapshot B 1`] = `"UPDATED value B"`');
    expect(updatedSnapshot).toContain('exports[`snapshot C 1`] = `"value C"`');
    
    // Verify snapshot A and C were NOT updated
    expect(updatedSnapshot).toContain('"value A"');
    expect(updatedSnapshot).toContain('"value C"');
  });
});
