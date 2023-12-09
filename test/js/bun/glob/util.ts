import { mkdtempSync, symlinkSync } from "fs";
import path from "path";
import os from "os";

export function createTempDirectoryWithBrokenSymlinks() {
  // Create a temporary directory
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "fixtures_symlink_"));

  // Define broken symlink targets (non-existent paths)
  const brokenTargets = ["non_existent_file.txt", "non_existent_dir"];

  // Create broken symlinks in the temporary directory
  for (const target of brokenTargets) {
    const symlinkPath = path.join(tempDir, `broken_link_to_${target}`);
    symlinkSync(target, symlinkPath);
  }

  console.log(`Temporary directory with broken symlinks created at: ${tempDir}`);
  return tempDir;
}

export function tempFixturesDir() {
  const files: Record<string, string | Record<string, string>> = {
    ".directory": {
      "file.md": "",
    },
    first: {
      "nested/directory/file.json": "",
      "nested/directory/file.md": "",
      "nested/file.md": "",
      "file.md": "",
    },
    second: {
      "nested/directory/file.md": "",
      "nested/file.md": "",
      "file.md": "",
    },
    third: {
      "library/a/book.md": "",
      "library/b/book.md": "",
    },
    ".file": "",
    "file.md": "",
  };

  var fs = require("fs");
  var path = require("path");

  function impl(dir: string, files: Record<string, string | Record<string, string>>) {
    for (const [name, contents] of Object.entries(files)) {
      if (typeof contents === "object") {
        for (const [_name, _contents] of Object.entries(contents)) {
          fs.mkdirSync(path.dirname(path.join(dir, name, _name)), { recursive: true });
          fs.writeFileSync(path.join(dir, name, _name), _contents);
        }
        continue;
      }
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      fs.writeFileSync(path.join(dir, name), contents);
    }
    return dir;
  }

  const dir = path.join(import.meta.dir, "fixtures");
  fs.mkdirSync(dir, { recursive: true });

  impl(dir, files);

  return dir;
}
