import { $ } from "bun";

// consider porting bash tests: https://github.com/bminor/bash/tree/f3b6bd19457e260b65d11f2712ec3da56cef463f/tests
// they're not too hard - add as .sh files, execute them with bun, and expect the results to be the same as the .right files

describe("bun shell", () => {
  it.todo("does not segfault 1", async () => {
    await $`echo ${Array(1000000).fill("a")}`;
  });
  it.todo("does not segfault 2", async () => {
    await $({ raw: ["echo" + " a".repeat(1000000)] } as any);
  });
  it.skip("does not segfault 3", async () => {
    // slow
    expect(await $({ raw: ["echo " + 'a"a"'.repeat(1000000)] } as any).text()).toBe("aa".repeat(1000000) + "\n");
  });
  it("passes correct number of arguments with empty string substitutions", async () => {
    expect(await $`echo ${"1"} ${""} ${"2"}`.text()).toBe("1  2\n");
  });
  it("passes correct number of arguments with empty string quotes", async () => {
    expect(await $`echo "1" "" "2"`.text()).toBe("1  2\n");
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
  it("does not expand tilde in ${}", async () => {
    expect(await $`echo ${"~"}`.text()).toBe("~\n");
  });
  it("does not expand tilde when escaped", async () => {
    expect(await $`echo \~`.text()).toBe("~\n");
  });
  it("does not expand tilde when the slash is quoted", async () => {
    expect(await $`echo ~"/"`.text()).toBe("~/\n");
  });
  it("does not expand tilde when there's an empty string between", async () => {
    expect(await $`echo ~""/`.text()).toBe("~/\n");
  });
  it("expands tilde", async () => {
    expect(await $`echo ~`.text()).toBe(process.env.HOME + "\n");
  });
  it("expands with slash", async () => {
    expect(await $`echo ~/`.text()).toBe(process.env.HOME + "/\n");
  });
  it("does not expand after escaped space", async () => {
    expect(await $`echo \ ~`.text()).toBe(" ~\n");
  });
  it("expands tilde as middle argument", async () => {
    expect(await $`echo a ~ b`.text()).toBe("a " + process.env.HOME + " b\n");
  });
  it.todo("expands tilde as middle argument 2", async () => {
    expect(
      await $`echo a ~\
 b`.text(),
    ).toBe("a " + process.env.HOME + " b\n");
  });
  it("expands as first argument", async () => {
    expect((await $`~`.nothrow()).exitCode).not.toBe(0);
  });
  it("does not expand tilde with a non-slash after", async () => {
    expect(await $`echo ~~`.text()).toBe("~~\n");
  });
  it("allow tilde expansion with backslash", async () => {
    expect(await $`echo ~\\a`.text()).toBe(process.env.HOME + "\\a\n");
  });
  it("does not allow tilde expansion with non-backslash backslash", async () => {
    expect(await $`echo ~\"a`.text()).toBe('~"a\n');
  });
  it("does not expand tilde with a non-slash after", async () => {
    expect(await $`echo ~{a,b}`.text()).toBe("~a ~b\n");
  });
  it("does not expand tilde when the tilde is quoted", async () => {
    expect(await $`echo "~"`.text()).toBe("~\n");
  });
  it("does not expand tilde after equals", async () => {
    // expect(await $`echo --home=~`.text()).toBe("--home=" + process.env.HOME + "\n"); // bash feature, not in sh, zsh, csh, or fish
    expect(await $`echo --home=~`.text()).toBe("--home=~\n"); // bash feature, not in sh
  });
  it("does not expand tilde after colon", async () => {
    expect(await $`echo a:~`.text()).toBe("a:~\n");
  });
  it.todo("expands tilde in variable set", async () => {
    expect(await $`MYVAR=~/abc && echo $MYVAR`.text()).toBe(process.env.HOME + "/abc\n");
  });
  it.todo("expands tilde in variable set list", async () => {
    expect(await $`MYVAR=a:~:b && echo $MYVAR`.text()).toBe("a:" + process.env.HOME + ":b\n");
  });
  it("does not expand tilde in variable set list with non-split char", async () => {
    expect(await $`MYVAR=a:~c:b && echo $MYVAR`.text()).toBe("a:~c:b\n");
  });
  it("does not expand tilde in variable set list with quotes", async () => {
    expect(await $`MYVAR=a:"~":b && echo $MYVAR`.text()).toBe("a:~:b\n");
  });
  it("does not expand tilde second", async () => {
    expect(await $`echo "a"~`.text()).toBe("a~\n");
  });
  // TODO: handle username (`~user` -> getpwnam(user) eg /home/user if the accont exists. but only if all unquoted, ie `~user"a"` <- not allowed)

  it("fails for bad surrogate pairs", async () => {
    expect(() => $`echo ${"😊".substring(0, 1)}`.text()).toThrowError("Shell script string contains invalid UTF-16");
    expect(() => $`echo ${"😊".substring(1, 2)}`.text()).toThrowError("Shell script string contains invalid UTF-16");
    expect(await $`echo ${"😊".substring(0, 2)}`.text()).toBe("😊\n");
  });
});
