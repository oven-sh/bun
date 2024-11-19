import { $ } from "bun";

// consider porting bash tests: https://github.com/bminor/bash/tree/f3b6bd19457e260b65d11f2712ec3da56cef463f/tests
// they're not too hard - add as .sh files, execute them with bun, and expect the results to be the same as the .right files

describe("bun shell", () => {
  it("does not segfault", async () => {
    await $`echo ${Array(1000000).fill("a")}`;
  });

  it("passes correct number of arguments", async () => {
    expect(await $`echo ${""} ${""} ${""}`.text()).toBe("  \n");
  });

  it("does not expand tilde in ${}", async () => {
    expect(await $`echo ${"~"}`.text()).toBe("~\n");
  });
  it("does not expand tilde when escaped", async () => {
    expect(await $`echo \~`.text()).toBe("~\n");
  });
  it("expands tilde in variable set", async () => {
    expect(await $`MYVAR=~/abc && echo $MYVAR`.text()).toBe(process.env.HOME + "/abc\n");
  });
  it("sets variable without '&&'", async () => {
    expect(await $`MYVAR=hello echo $MYVAR`.text()).toBe("hello\n");
  });

  it("fails for bad surrogate pairs", async () => {
    expect(() => $`echo ${"😊".substring(0, 1)}`.text()).toThrowError("Shell script string contains invalid UTF-16");
    expect(() => $`echo ${"😊".substring(1, 2)}`.text()).toThrowError("Shell script string contains invalid UTF-16");
    expect(await $`echo ${"😊".substring(0, 2)}`.text()).toBe("😊\n");
  });
});
