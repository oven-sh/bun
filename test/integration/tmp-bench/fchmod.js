// Usage: bun fchmod.js <old> <new>   In which state of a file does fchmod work, and through which descriptor.
const fs = require("fs"),
  path = require("path");
if (process.argv[2] !== "--run")
  for (const [i, exe] of process.argv.slice(2, 4).entries()) {
    const it = Bun.spawnSync([exe, __filename, "--run"], { timeout: 100000 });
    console.log(`cond fchmod ${i ? "new" : "old"}:\n${it.stdout}${it.stderr}`);
  }
else {
  const k = require("bun:ffi").dlopen("kernel32.dll", {
    CreateFileW: { args: ["ptr", "u32", "u32", "ptr", "u32", "u32", "ptr"], returns: "u64" },
    SetFileInformationByHandle: { args: ["u64", "i32", "ptr", "u32"], returns: "i32" },
    CloseHandle: { args: ["u64"], returns: "i32" },
  }).symbols;
  const attempt = f => {
      try {
        return f() ?? "ok";
      } catch (e) {
        return e.code;
      }
    },
    local = fs.realpathSync.native(fs.mkdtempSync(require("os").tmpdir() + "\\fchmod-"));
  const states = {
    "as it is": () => {},
    "delete pending": f => {
      const h = k.CreateFileW(Buffer.from(f + "\0", "utf16le"), 0x10000, 7, null, 3, 0, null);
      k.SetFileInformationByHandle(h, 4, Buffer.from([1, 0, 0, 0]), 4);
      return () => k.CloseHandle(h);
    },
    "unlinked": f => fs.unlinkSync(f),
    "unlinked with its directory": f => fs.rmSync(path.dirname(f), { recursive: true }),
    "renamed": f => fs.renameSync(f, f + "2"),
    "replaced": f => {
      fs.writeFileSync(f + "2", "");
      fs.renameSync(f + "2", f);
    },
    "one of two links unlinked": f => {
      fs.linkSync(f, f + "2");
      fs.unlinkSync(f);
    },
  };
  let n = 0;
  for (const root of [local, `\\\\localhost\\${local[0]}$${local.slice(2)}`])
    for (const [state, enter] of Object.entries(states))
      for (const [how, name, more] of [
        ["", "f", 0],
        [", a stream", "f:s", 0],
        [", not shared", "f", 0x10000000],
        [", temporary", "f", 0x40],
      ]) {
        if ((how && state !== "as it is" && state !== "unlinked") || (root !== local && state.endsWith("directory")))
          continue;
        const row = [
          ["r+", 2],
          ["a", 9],
          ["r", 0],
        ].map(([text, flags]) =>
          attempt(() => {
            const dir = path.join(root, "" + n++),
              file = path.join(dir, "f");
            (fs.mkdirSync(dir), fs.writeFileSync(file, "abc"), fs.writeFileSync(path.join(dir, name), "abc"));
            const fd = fs.openSync(path.join(dir, name), flags | more),
              leave = attempt(() => enter(file));
            Bun.sleepSync(20);
            const before = attempt(() => fs.fstatSync(fd).ctimeMs),
              seen = [0o444, 0o666].map(mode =>
                attempt(() => (fs.fchmodSync(fd, mode), (fs.fstatSync(fd).mode & 0o777).toString(8))),
              ),
              moved = attempt(() => fs.fstatSync(fd).ctimeMs) !== before;
            (fs.closeSync(fd), typeof leave === "function" && leave());
            return `${text} ${seen.join(" ")}${moved ? " ctime" : ""}${typeof leave === "string" && leave !== "ok" ? ` (${leave} before)` : ""}`;
          }),
        );
        console.log(`cond   ${root === local ? "local" : "share"} ${state}${how}: ${row.join(" | ")}`);
      }
  attempt(() => fs.rmSync(local, { recursive: true, force: true }));
}
