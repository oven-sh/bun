import { expect, test } from "bun:test";
import { symlinkSync } from "fs";
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

test("absolute path to a file that is symlinked has import.meta.main", () => {
  const root = tmpdirSync();
  try {
    symlinkSync(process.argv[1], root + "/main.js");
  } catch (e) {
    if (process.platform == "win32") {
      console.log("symlinkSync failed on Windows, skipping test");
      return;
    }
    throw e;
  }

  const result = bunRun(root + "/main.js", {
    IS_SUBPROCESS: "1",
  });
  expect(result.stdout.trim()).toBe(
    [
      //
      import.meta.path,
      import.meta.path,
      "true",
      import.meta.dir,
      import.meta.file,
      import.meta.path,
    ].join("\n"),
  );
});
