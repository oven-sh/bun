import * as internalForTesting from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";

// The HTML dev server "o" shortcut (`bun index.html`, then press `o`) opens the
// served URL in the system browser. On Windows `start` is a cmd.exe builtin, not
// an executable on PATH, so spawning it directly throws
// `Executable not found in $PATH: "start"`.
// https://github.com/oven-sh/bun/issues/26231
//
// Read off the namespace rather than a named import so the file still loads when
// the export is absent, surfacing a missing fix as a failing assertion.
const { getBrowserOpenCommand } = internalForTesting;

describe("getBrowserOpenCommand", () => {
  const url = "http://localhost:3000/";

  test("Windows invokes `start` through cmd.exe", () => {
    // The empty "" is start's window-title argument; without it `start` would
    // treat the URL as the title instead of opening it.
    expect(getBrowserOpenCommand("win32", url)).toEqual(["cmd.exe", "/c", "start", "", url]);
  });

  test("macOS uses `open`", () => {
    expect(getBrowserOpenCommand("darwin", url)).toEqual(["open", url]);
  });

  test("Android uses the activity manager", () => {
    expect(getBrowserOpenCommand("android", url)).toEqual([
      "/system/bin/am",
      "start",
      "-a",
      "android.intent.action.VIEW",
      "-d",
      url,
    ]);
  });

  test("other platforms use `xdg-open`", () => {
    expect(getBrowserOpenCommand("linux", url)).toEqual(["xdg-open", url]);
  });
});
