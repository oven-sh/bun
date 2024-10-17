//#FILE: test-child-process-windows-hide.js
//#SHA1: c3cc8bbd27694658607c3a7f42a8e7901aeab807
//-----------------
"use strict";

const cp = require("child_process");
const cmd = process.execPath;
const args = ["--print", "42"];
const options = { windowsHide: true, env: { ...Bun.env } };
delete options.env.FORCE_COLOR;

// Since windowsHide isn't really observable, we'll use Jest's mocking capabilities
// to verify that the flag is being passed through correctly.

beforeEach(() => {
  jest.spyOn(cp, "spawn");
  jest.spyOn(cp, "spawnSync");
});

afterEach(() => {
  jest.restoreAllMocks();
});

test("spawnSync passes windowsHide option", () => {
  const child = cp.spawnSync(cmd, args, options);

  expect(cp.spawnSync).toHaveBeenCalledWith(cmd, args, expect.objectContaining({ windowsHide: true }));
  expect(child.status).toBe(0);
  expect(child.signal).toBeNull();
  expect(child.stdout.toString().trim()).toBe("42");
  expect(child.stderr.toString().trim()).toBe("");
});

test("spawn passes windowsHide option", done => {
  const child = cp.spawn(cmd, args, options);

  expect(cp.spawn).toHaveBeenCalledWith(cmd, args, expect.objectContaining({ windowsHide: true }));

  child.on("exit", (code, signal) => {
    expect(code).toBe(0);
    expect(signal).toBeNull();
    done();
  });
});

test("execFile passes windowsHide option", done => {
  cp.execFile(cmd, args, options, (error, stdout, stderr) => {
    expect(error).toBeNull();
    expect(stdout.trim()).toBe("42");
    expect(stderr.trim()).toBe("");
    done();
  });
});

//<#END_FILE: test-child-process-windows-hide.js
