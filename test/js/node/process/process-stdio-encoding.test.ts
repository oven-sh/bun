import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// process.stdout/process.stderr take the fs.WriteStream fast path, which used to
// hand every string to the FileSink as UTF-8 and drop the encoding argument.
describe.concurrent("process stdio write(chunk, encoding)", () => {
  test("decodes the chunk with the requested encoding", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `process.stdout.write("48490a", "hex");
         process.stdout.write("QUJD", "base64");
         process.stdout.write("é", "latin1");
         process.stdout.setDefaultEncoding("hex");
         process.stdout.write("21");
         process.stderr.write("6f6b", "hex");`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.bytes(), proc.stderr.bytes(), proc.exited]);

    expect({
      stdout: Buffer.from(stdout).toString("hex"),
      stderr: Buffer.from(stderr).toString("hex"),
      exitCode,
    }).toEqual({ stdout: "48490a414243e921", stderr: "6f6b", exitCode: 0 });
  });

  test("throws on an unknown encoding", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const codes = [];
         for (const encoding of ["nope", "buffer"]) {
           try {
             process.stdout.write("x", encoding);
             codes.push("did not throw");
           } catch (e) {
             codes.push(e.code);
           }
         }
         process.stdout.write(codes.join(","));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "ERR_UNKNOWN_ENCODING,ERR_UNKNOWN_ENCODING",
      stderr: "",
      exitCode: 0,
    });
  });

  test("leaves write(chunk, callback) and Buffer chunks alone", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { promise, resolve } = Promise.withResolvers();
         process.stdout.write("utf8:é", resolve);
         await promise;
         process.stdout.write(Buffer.from("2162756621", "hex"), "hex");`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "utf8:é!buf!", stderr: "", exitCode: 0 });
  });
});
