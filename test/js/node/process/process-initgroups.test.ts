import { test, expect } from "bun:test";

test("process.initgroups exists", () => {
  if (process.platform === "win32") {
    expect(process.initgroups).toBeUndefined();
    return;
  }
  expect(typeof process.initgroups).toBe("function");
  expect(process.initgroups.length).toBe(2);
});

test("process.initgroups argument validation", () => {
  if (process.platform === "win32") return;

  expect(() => {
    // @ts-ignore
    process.initgroups();
  }).toThrow(TypeError);

  expect(() => {
    // @ts-ignore
    process.initgroups({}, "staff");
  }).toThrow(TypeError);

  expect(() => {
    // @ts-ignore
    process.initgroups("root", {});
  }).toThrow(TypeError);
});

test("process.initgroups system error or EPERM", () => {
  if (process.platform === "win32") return;

  const existingGroup = process.getgroups ? (process.getgroups()[0] ?? process.getgid?.() ?? 0) : 0;

  if (process.getuid && process.getuid() !== 0) {
    expect(() => {
      process.initgroups("root", 0);
    }).toThrow(/EPERM/);
    
    expect(() => {
      process.initgroups(0, existingGroup);
    }).toThrow(/EPERM/);
  } else {
    const { exitCode, stderr } = Bun.spawnSync({
      cmd: [process.execPath, "-e", "process.initgroups('root', 0);"],
    });
    expect(stderr.toString()).toBe("");
    expect(exitCode).toBe(0);
  }
});

test("process.initgroups unknown credential", () => {
  if (process.platform === "win32") return;

  expect(() => {
    process.initgroups("does-not-exist-user-123456", 0);
  }).toThrow(/does not exist/);

  expect(() => {
    process.initgroups(999999, 0);
  }).toThrow(/does not exist/);

  expect(() => {
    process.initgroups("root", "does-not-exist-group-123456");
  }).toThrow(/does not exist/);
});
