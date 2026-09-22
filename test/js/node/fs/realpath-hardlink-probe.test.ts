// Measurement only, not a regression test. It records how fs.realpathSync (open + fcntl(F_GETPATH)
// on macOS) and libc realpath(3) name a hard link while other processes look the file up under its
// other name. It is expected to fail on macOS. The numbers decide the shape of the fix.
import { CString, dlopen, FFIType, ptr } from "bun:ffi";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS, libcPathForDlopen, tempDir } from "harness";
import { linkSync, realpathSync, statSync, symlinkSync } from "node:fs";
import { release } from "node:os";
import { join } from "node:path";

const libcRealpathSymbol = isMacOS ? "realpath$DARWIN_EXTSN" : "realpath";

test.skipIf(!isMacOS && !process.env.BUN_REALPATH_PROBE_ANY_OS)(
  `realpath of a hard link under concurrent lookups of its other name (${process.platform} ${release()} ${process.arch})`,
  async () => {
    using dir = tempDir("fs-realpath-hardlink-probe", {
      original: { "original.txt": "different name", "same.txt": "same name" },
      linked: {},
    });
    const root = realpathSync(String(dir));
    const originals = [join(root, "original", "original.txt"), join(root, "original", "same.txt")];
    const linkedDir = join(root, "linked");
    const differentName = join(linkedDir, "link.txt");
    const sameName = join(linkedDir, "same.txt");
    const symlink = join(linkedDir, "symlink.txt");
    linkSync(originals[0], differentName);
    linkSync(originals[1], sameName);
    symlinkSync(differentName, symlink);
    expect([statSync(differentName).nlink, statSync(sameName).nlink]).toEqual([2, 2]);

    const libc = dlopen(libcPathForDlopen(), {
      [libcRealpathSymbol]: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
    });
    const resolved = Buffer.alloc(4096);
    const libcRealpath = (path: string) => {
      const input = Buffer.from(path + "\0");
      const result = libc.symbols[libcRealpathSymbol](ptr(input), ptr(resolved));
      return result === null ? "<null>" : new CString(result).toString();
    };

    // Each child looks the files up under their original names until it is killed or its parent is gone.
    const lookupLoop = `
      const { statSync, writeSync } = require("node:fs");
      const paths = process.argv.slice(1);
      const parent = process.ppid;
      for (const path of paths) statSync(path);
      writeSync(1, "ready\\n");
      while (process.ppid === parent) for (let i = 0; i < 4096; i++) for (const path of paths) statSync(path);
    `;
    const spawnLookups = () =>
      Bun.spawn({ cmd: [bunExe(), "-e", lookupLoop, ...originals], env: bunEnv, stdout: "pipe", stderr: "inherit" });
    await using first = spawnLookups();
    await using second = spawnLookups();
    for (const child of [first, second]) {
      const reader = child.stdout.getReader();
      const { value } = await reader.read();
      reader.releaseLock();
      expect(new TextDecoder().decode(value)).toBe("ready\n");
    }

    const iterations = 2000;
    const tally = (resolve: () => string) => {
      const seen: Record<string, number> = {};
      for (let i = 0; i < iterations; i++) {
        const path = resolve().replace(root, "<root>");
        seen[path] = (seen[path] ?? 0) + 1;
      }
      return seen;
    };
    const measured = {
      "fs.realpathSync, link with a different name": tally(() => realpathSync(differentName)),
      "fs.realpathSync, link with the same name": tally(() => realpathSync(sameName)),
      "fs.realpathSync, symlink to the link": tally(() => realpathSync(symlink)),
      "fs.realpathSync, directory of the link": tally(() => realpathSync(linkedDir)),
      "libc realpath, link with a different name": tally(() => libcRealpath(differentName)),
      "libc realpath, link with the same name": tally(() => libcRealpath(sameName)),
      "libc realpath, symlink to the link": tally(() => libcRealpath(symlink)),
    };
    expect([first.exitCode, second.exitCode]).toEqual([null, null]);
    libc.close();

    expect(measured).toEqual({
      "fs.realpathSync, link with a different name": { "<root>/linked/link.txt": iterations },
      "fs.realpathSync, link with the same name": { "<root>/linked/same.txt": iterations },
      "fs.realpathSync, symlink to the link": { "<root>/linked/link.txt": iterations },
      "fs.realpathSync, directory of the link": { "<root>/linked": iterations },
      "libc realpath, link with a different name": { "<root>/linked/link.txt": iterations },
      "libc realpath, link with the same name": { "<root>/linked/same.txt": iterations },
      "libc realpath, symlink to the link": { "<root>/linked/link.txt": iterations },
    });
  },
);
