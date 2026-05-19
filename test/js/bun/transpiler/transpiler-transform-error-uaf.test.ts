import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("async transform() rejecting with parse errors does not read freed memory", async () => {
  const script = `
    const transpiler = new Bun.Transpiler();
    const bad = Buffer.alloc(1000, "const a = 1;\\n").toString() + "const x = ;";
    const results = await Promise.all(
      Array.from({ length: 20 }, () => transpiler.transform(bad).then(() => null, e => e)),
    );
    for (const e of results) {
      if (!(e instanceof Error)) throw new Error("expected Error, got " + e);
      const text = e.errors ? e.errors.map(String).join("\\n") : String(e);
      if (!/already been declared|Unexpected/.test(text)) throw new Error("bad message: " + text);
    }
    console.log("ok");
  `;

  const { exitCode, stdout, stderr, signalCode } = Bun.spawnSync({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const out = stdout.toString();
  const err = stderr.toString();
  expect({ exitCode, signalCode, out, err }).toEqual({ exitCode: 0, signalCode: undefined, out: "ok\n", err: "" });
});
