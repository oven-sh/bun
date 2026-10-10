import { expect, test } from "bun:test";
import { symlinkSync } from "fs";
import { join } from "path";
import { bunRun, tmpdirSync } from "../../harness";

if (process.env.IS_SUBPROCESS) {
  console.log(process.argv[1]);
  console.log(Bun.main);
  console.log(import.meta.main);
  console.log(import.meta.dir);
  console.log(import.meta.file);
  console.log(import.meta.path);
  process.exit(0);
}

test.concurrent("absolute path to a file that is symlinked has import.meta.main", async () => {
  const root = tmpdirSync();
  const link = join(root, "main.js");
  try {
    symlinkSync(process.argv[1], link);
  } catch (e) {
    if (process.platform == "win32") {
      console.log("symlinkSync failed on Windows, skipping test");
      return;
    }
    throw e;
  }

  const result = await bunRun(link, {
    IS_SUBPROCESS: "1",
  });
  expect(result).toSpawn();
  expect(result.stdout).toBe(
    [
      // process.argv[1] is the symlink path (Node compat, #2900)
      link,
      // Bun.main and import.meta.* are the resolved real path
      import.meta.path,
      "true",
      import.meta.dir,
      import.meta.file,
      import.meta.path,
    ].join("\n"),
  );
});
