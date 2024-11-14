//#FILE: test-console-issue-43095.js
//#SHA1: 1c0c5cce62bcee4d50c6b716dd1430db2784c3f4
//-----------------
"use strict";

const { inspect } = require("node:util");

test("console output for revoked proxy", () => {
  const consoleSpy = {
    dir: jest.spyOn(console, "dir").mockImplementation(),
    log: jest.spyOn(console, "log").mockImplementation(),
  };

  const r = Proxy.revocable({}, {});
  r.revoke();

  console.dir(r);
  console.dir(r.proxy);
  console.log(r.proxy);
  console.log(inspect(r.proxy, { showProxy: true }));

  expect(consoleSpy.dir).toHaveBeenCalledTimes(2);
  expect(consoleSpy.log).toHaveBeenCalledTimes(2);

  // Check that console.dir was called with the revoked proxy object
  expect(consoleSpy.dir.mock.calls[0][0]).toBe(r);
  expect(consoleSpy.dir.mock.calls[1][0]).toBe(r.proxy);

  // Check that console.log was called with the revoked proxy
  expect(consoleSpy.log.mock.calls[0][0]).toBe(r.proxy);

  // Check that console.log was called with the inspected revoked proxy
  expect(consoleSpy.log.mock.calls[1][0]).toBe(inspect(r.proxy, { showProxy: true }));

  // Clean up
  consoleSpy.dir.mockRestore();
  consoleSpy.log.mockRestore();
});

//<#END_FILE: test-console-issue-43095.js
