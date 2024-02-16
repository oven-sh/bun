import { $, ShellError, ShellPromise } from "bun";
import { beforeAll, describe, test, expect } from "bun:test";
import { runWithErrorPromise } from "harness";

describe("ShellOutput + ShellError", () => {
  test("output", async () => {
    let output = await $`echo hi`;
    expect(output.text()).toBe("hi\n");
    output = await $`echo '{"hello": 123}'`;
    expect(output.json()).toEqual({ hello: 123 });
    output = await $`echo hello`;
    expect(output.blob()).toEqual(new Blob([new TextEncoder().encode("hello")]));
  });

  test("error", async () => {
    $.throws(true);
    let output = await withErr($`echo hi; ls oogabooga`);
    expect(output.stderr.toString()).toEqual("ls: oogabooga: No such file or directory\n");
    expect(output.text()).toBe("hi\n");
    output = await withErr($`echo '{"hello": 123}'; ls oogabooga`);
    expect(output.stderr.toString()).toEqual("ls: oogabooga: No such file or directory\n");
    expect(output.json()).toEqual({ hello: 123 });
    output = await withErr($`echo hello; ls oogabooga`);
    expect(output.stderr.toString()).toEqual("ls: oogabooga: No such file or directory\n");
    expect(output.blob()).toEqual(new Blob([new TextEncoder().encode("hello")]));
  });
});

async function withErr(promise: ShellPromise): Promise<ShellError> {
  let err: ShellError | undefined;
  try {
    await promise;
  } catch (e) {
    err = e as ShellError;
  }
  expect(err).toBeDefined();
  return err as ShellError;
}
