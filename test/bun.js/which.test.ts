import { test, expect } from "bun:test";

import { which } from "bun";

test("which", () => {
  writeFixture("/tmp/myscript.sh");

  // Our cwd is not /tmp
  expect(which("myscript.sh")).toBe(null);

  // "bun" is in our PATH
  expect(which("bun")?.length > 0).toBe(true);

  expect(
    // You can override PATH
    which("myscript.sh", {
      PATH: "/tmp",
    })
  ).toBe("/tmp/myscript.sh");

  expect(
    which("myscript.sh", {
      PATH: "/not-tmp",
    })
  ).toBe(null);

  expect(
    // PATH works like the $PATH environment variable, respecting colons
    which("myscript.sh", {
      PATH: "/not-tmp:/tmp",
    })
  ).toBe("/tmp/myscript.sh");

  expect(
    // cwd is checked first
    which("myscript.sh", {
      cwd: "/tmp",
    })
  ).toBe("/tmp/myscript.sh");
});

function writeFixture(path) {
  var fs = require("fs");
  try {
    fs.unlinkSync(path);
  } catch (e) {}

  var script_name = path;
  var script_content = "echo Hello world!";
  fs.writeFileSync(script_name, script_content);
  fs.chmodSync(script_name, "755");
}
