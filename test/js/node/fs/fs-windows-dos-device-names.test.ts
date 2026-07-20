// Win32 redirects reserved DOS device names (NUL, CON, PRN, AUX, COM1-9,
// LPT1-9) to the corresponding device regardless of directory prefix, and
// strips trailing dots/spaces from the final path component. Bun's NtCreateFile
// open path must do the same so `fs.writeFileSync("nul", ...)` does not create
// a literal `nul` file that Explorer and cmd cannot delete.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

const entriesAfter = `
  const fs = require("fs");
  const path = require("path");
  function entriesAfter(name, f) {
    try { f(); } catch (e) { return "ERR:" + (e.code || e.message); }
    const list = fs.readdirSync(".");
    for (const e of list) {
      try { fs.unlinkSync("\\\\\\\\?\\\\" + path.join(process.cwd(), e)); } catch {}
    }
    return JSON.stringify(list.sort());
  }
`;

async function runInTempDir(body: string) {
  using dir = tempDir("dos-device", {});
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", entriesAfter + body],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test
  .skipIf(!isWindows)
  .concurrent("fs.writeFileSync to a reserved DOS device name does not create a file", async () => {
    const { stdout, stderr, exitCode } = await runInTempDir(`
      // CON/PRN/COM*/LPT* may not be openable for write on every CI host, so
      // an error is acceptable for them; the point is no file is created.
      for (const n of ["nul", "NUL", "Nul", "nUl", "nul.", "nul ", "nul. "]) {
        console.log(n, entriesAfter(n, () => fs.writeFileSync(n, "x")));
      }
      for (const n of ["con", "CoN", "aux", "prn", "com1", "Com9", "lpt1", "LpT9"]) {
        const got = entriesAfter(n, () => fs.writeFileSync(n, "x"));
        console.log(n, got.startsWith("ERR:") ? "[]" : got);
      }
      // A reserved name as the last component of a relative path.
      fs.mkdirSync("sub");
      fs.writeFileSync("sub\\\\nul", "x");
      console.log("sub\\\\nul", JSON.stringify(fs.readdirSync("sub")));
      fs.rmdirSync("sub");
      // Near-misses are ordinary files.
      for (const n of ["nul.txt", "null", "com0", "com10"]) {
        console.log(n, entriesAfter(n, () => fs.writeFileSync(n, "x")));
      }
    `);
    expect({ stdout, stderr }).toEqual({
      stdout: [
        "nul []",
        "NUL []",
        "Nul []",
        "nUl []",
        "nul. []",
        "nul  []",
        "nul.  []",
        "con []",
        "CoN []",
        "aux []",
        "prn []",
        "com1 []",
        "Com9 []",
        "lpt1 []",
        "LpT9 []",
        "sub\\nul []",
        'nul.txt ["nul.txt"]',
        'null ["null"]',
        'com0 ["com0"]',
        'com10 ["com10"]',
        "",
      ].join("\n"),
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

test.skipIf(!isWindows).concurrent("fs.readFileSync from a bare reserved name reads the device", async () => {
  const { stdout, stderr, exitCode } = await runInTempDir(`
    for (const n of ["nul", "NUL", "Nul"]) {
      console.log(n, JSON.stringify(fs.readFileSync(n, "utf8")));
    }
    const st = fs.statSync("nul");
    // The NUL device is a character device, not a regular file.
    console.log("isCharacterDevice", st.isCharacterDevice());
    console.log("isFile", st.isFile());
  `);
  expect({ stdout, stderr }).toEqual({
    stdout: ['nul ""', 'NUL ""', 'Nul ""', "isCharacterDevice true", "isFile false", ""].join("\n"),
    stderr: "",
  });
  expect(exitCode).toBe(0);
});

test.skipIf(!isWindows).concurrent("trailing dots and spaces on the final component are stripped", async () => {
  const { stdout, stderr, exitCode } = await runInTempDir(`
      for (const n of ["foo.", "foo ", "foo. ", "foo..", "foo.bar.", ".foo."]) {
        console.log(JSON.stringify(n), entriesAfter(n, () => fs.writeFileSync(n, "x")));
      }
      // The stripped name round-trips: write with a trailing dot, read without.
      fs.writeFileSync("roundtrip.", "hello");
      console.log("roundtrip", fs.readFileSync("roundtrip", "utf8"));
      fs.unlinkSync("roundtrip");
    `);
  expect({ stdout, stderr }).toEqual({
    stdout: [
      '"foo." ["foo"]',
      '"foo " ["foo"]',
      '"foo. " ["foo"]',
      '"foo.." ["foo"]',
      '"foo.bar." ["foo.bar"]',
      '".foo." [".foo"]',
      "roundtrip hello",
      "",
    ].join("\n"),
    stderr: "",
  });
  expect(exitCode).toBe(0);
});

test.skipIf(!isWindows).concurrent("fs.writeFileSync to os.devNull writes to the null device", async () => {
  // os.devNull on Windows is `\\.\nul`; it must open `\??\nul` via
  // NtCreateFile rather than be passed through as a Win32 path NT rejects.
  const { stdout, stderr, exitCode } = await runInTempDir(`
    const os = require("os");
    fs.writeFileSync(os.devNull, "discard");
    fs.writeFileSync("\\\\\\\\.\\\\NUL", "discard");
    console.log(JSON.stringify(fs.readdirSync(".")));
    console.log(JSON.stringify(fs.readFileSync(os.devNull, "utf8")));
  `);
  expect({ stdout, stderr }).toEqual({ stdout: '[]\n""\n', stderr: "" });
  expect(exitCode).toBe(0);
});

test.skipIf(!isWindows).concurrent("Bun.write to a bare reserved name writes to the device", async () => {
  const { stdout, stderr, exitCode } = await runInTempDir(`
    for (const n of ["nul", "Nul", "nul "]) {
      await Bun.write(n, "hello");
    }
    console.log(JSON.stringify(fs.readdirSync(".")));
  `);
  expect({ stdout, stderr }).toEqual({ stdout: "[]\n", stderr: "" });
  expect(exitCode).toBe(0);
});
