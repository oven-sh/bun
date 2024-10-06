import { test, expect } from "bun:test";
import { bunEnv, bunExe, isPosix } from "harness";
import { tmpdir } from "os";
import { join } from "path";

test.if(isPosix)(
  "10080 - ensure blocking stdio is treated as such in FileReader",
  async () => {
    const expected = "foobar\n";
    const filename = join(tmpdir(), "bun.test.stream." + Date.now() + ".js");
    const contents = "for await (const line of console) {console.log(`foo${line}`)}";
    await Bun.write(filename, contents);
    const shellCommand = `exec &> >(${bunExe()} ${filename}); echo "bar"; while read -r line; do echo $line; done`;

    const proc = Bun.spawn(["bash", "-c", shellCommand], {
      stdin: "inherit",
      stdout: "pipe",
      stderr: "inherit",
      env: bunEnv,
    });
    const { value } = await proc.stdout.getReader().read();
    const output = new TextDecoder().decode(value);
    if (output !== expected) {
      expect(output).toEqual(expected);
      throw new Error("Output didn't match!\n");
    }

    proc.kill(9);
    await proc.exited;
    expect(proc.killed).toBeTrue();
  },
  1000,
);
