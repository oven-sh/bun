import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("ReadableStream body consumption after Response.bytes() does not crash", async () => {
  // Repro from fuzzer: accessing body stream after Response is consumed
  // must not crash (was returning .zero without exception in ByteBlobLoader.toBufferedValue)
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const resp = new Response("test");
      const body = resp.body;
      resp.bytes();
      try { await body.json(); } catch (e) { console.log(e.code); }
      try { await body.text(); } catch (e) { console.log(e.code); }
      try { await body.bytes(); } catch (e) { console.log(e.code); }
      try { await body.blob(); } catch (e) { console.log(e.code); }
    `,
    ],
    env: bunEnv,
    stdout: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  // First consume method hits ByteBlobLoader with detached store → ERR_BODY_ALREADY_USED
  expect(stdout).toContain("ERR_BODY_ALREADY_USED");
  expect(exitCode).toBe(0);
});
