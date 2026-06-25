import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Accessing a lazily-initialized Bun.* property for the first time while the
// stack is nearly exhausted must surface a catchable JS error instead of
// crashing inside reifyStaticProperty.
for (const expr of ["Bun.postgres", "Bun.sql", "Bun.SQL", "Bun.$"]) {
  test(`lazy ${expr} access near stack exhaustion does not crash`, async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `function F(){try{new this.constructor()}catch(e){}void ${expr}}` +
          `try{new F()}catch(e){}console.log("OK")`,
      ],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toEqual({
      stdout: "OK\n",
      stderr: expect.any(String),
      exitCode: 0,
      signalCode: null,
    });
  });
}
