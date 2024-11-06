import { test, expect } from "bun:test";
import { bunExe } from "harness";

for (const flags of [[], ["--watch"], ["--hot"]]) {
  test("bun " + flags.map(f => f + " ").join("") + "prints the error only once", async () => {
    const proc = Bun.spawn({
      cmd: [bunExe(), ...flags, import.meta.dirname + "/14791.fixture.ts"],
      env: {
        "NO_COLOR": "1",
      },
      stdout: "inherit",
      stdin: "inherit",
      stderr: "pipe",
    });
    await Bun.sleep(200);
    proc.kill();
    await proc.exited;
    let result = "";
    for await (const item of proc.stderr.pipeThrough(new TextDecoderStream())) {
      result += item;
    }
    expect(
      result
        .replaceAll(/at .+?14791\.fixture\.ts/g, "at 14791.fixture.ts")
        .replace(/Bun v.+? \(.+?\)/, "")
        .trim(),
    ).toBe(
      `
Program Launched.
1 | console.error("Program Launched.");
2 | // @ts-expect-error
3 | console.error(invalidvariablename);
                                     ^
ReferenceError: Can't find variable: invalidvariablename
      at 14791.fixture.ts:3:34
      at asyncFunctionResume (1:11)
      at promiseReactionJobWithoutPromiseUnwrapAsyncContext (1:11)
      at promiseReactionJob (1:11)
`.trim(),
    );
  });
}

declare let TextDecoderStream: any;
