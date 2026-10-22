// Another realm can't import a module that was compiled into the executable: untyped-code/program-required-by-other-realm. A file that isn't in the executable, here one that is written at run time, loads there as in plain Bun. Only a build with --compile-inspector or --external loads code that isn't in the executable, so this one has --compile-inspector.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const folder = mkdtempSync(join(tmpdir(), "other-realm-loads-file-"));
try {
  const path = join(folder, "outside.mjs");
  writeFileSync(path, `export const value = "loaded in the other realm";\n`);
  const realm = new ShadowRealm();
  console.log(await realm.importValue(path, "value"));
  console.log(realm.evaluate("[1, 2, 3].map(n => n * 2).join()"));
} finally {
  rmSync(folder, { recursive: true, force: true });
}
