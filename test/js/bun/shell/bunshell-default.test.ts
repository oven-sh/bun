import { $ } from "bun";

test("default throw on command failure", async () => {
  try {
    await $`echo hi; ls oogabooga`.quiet();
    expect.unreachable();
  } catch (e: any) {
    expect(e).toBeInstanceOf(Error);
    expect(e.exitCode).toBe(1);
    expect(e.message).toBe("Failed with exit code 1");
    expect(e.stdout.toString("utf-8")).toBe("hi\n");
    expect(e.stderr.toString("utf-8")).toBe("ls: oogabooga: No such file or directory\n");
  }
});

test("ShellError has .text()", async () => {
  try {
    await $`ls oogabooga`.quiet();
    expect.unreachable();
  } catch (e: any) {
    expect(e).toBeInstanceOf(Error);
    expect(e.exitCode).toBe(1);
    expect(e.stderr.toString("utf-8")).toBe("ls: oogabooga: No such file or directory\n");
  }
});
