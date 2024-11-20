import { $ } from "bun";

// consider porting bash tests: https://github.com/bminor/bash/tree/f3b6bd19457e260b65d11f2712ec3da56cef463f/tests
// they're not too hard - add as .sh files, execute them with bun, and expect the results to be the same as the .right files

describe("bun shell", () => {
  it.todo("does not segfault", async () => {
    await $`echo ${Array(1000000).fill("a")}`;
  });
  it.todo("passes correct number of arguments with empties", async () => {
    expect(await $`echo ${"1"} ${""} ${"2"}`.text()).toBe("1  2\n");
  });
  it("doesn't cause invalid js string ref error with a number after a string ref", async () => {
    expect(await $`echo ${'"'}1`.text()).toBe('"1\n');
  });
  it("does not crash with an invalid string ref 1", async () => {
    expect(() => $`echo __bunstr_123.`.text()).toThrowError("Invalid JS string ref (out of bounds)");
  });
  it("does not crash with an invalid string ref 2", async () => {
    expect(() => $`echo __bunstr_123`.text()).toThrowError("Invalid JS string ref (missing '.' at end)");
  });
  it("does not crash with an invalid string ref 3", async () => {
    expect(() => $`echo __bunstr_123456789012345678901234567890.`.text()).toThrowError(
      "Invalid JS string ref (out of bounds)",
    );
  });
  it("does not crash with an invalid string ref 4", async () => {
    expect(() => $`echo __bunstr_123456789012345678901234567890123.`.text()).toThrowError(
      "Invalid JS string ref (number too high)",
    );
  });
  it("does not crash with an invalid string ref 5", async () => {
    expect(() => $`echo __bunstr_123a`.text()).toThrowError("Invalid JS string ref (missing '.' at end)");
  });
  it("does not crash with an invalid string ref 6", async () => {
    expect(await $`echo ${'"'} __bunstr_0.`.text()).toBe('" "\n');
  });
  it("doesn't parse string refs inside substitution", async () => {
    expect(await $`echo ${"\x08__bunstr_123."}`.text()).toBe("\x08__bunstr_123.\n");
  });
  it.todo("does not expand tilde in ${}", async () => {
    expect(await $`echo ${"~"}`.text()).toBe("~\n");
  });
  it.todo("does not expand tilde when escaped", async () => {
    expect(await $`echo \~`.text()).toBe("~\n");
  });
  it.todo("does not expand tilde when the slash is quoted", async () => {
    expect(await $`echo ~"/"`.text()).toBe("~/\n");
  });
  it.todo("expands tilde after equals", async () => {
    expect(await $`echo a=~`.text()).toBe("a=" + process.env.HOME + "\n");
  });
  it.todo("expands tilde in variable set", async () => {
    expect(await $`MYVAR=~/abc && echo $MYVAR`.text()).toBe(process.env.HOME + "/abc\n");
  });

  it("fails for bad surrogate pairs", async () => {
    expect(() => $`echo ${"😊".substring(0, 1)}`.text()).toThrowError("Shell script string contains invalid UTF-16");
    expect(() => $`echo ${"😊".substring(1, 2)}`.text()).toThrowError("Shell script string contains invalid UTF-16");
    expect(await $`echo ${"😊".substring(0, 2)}`.text()).toBe("😊\n");
  });
});
