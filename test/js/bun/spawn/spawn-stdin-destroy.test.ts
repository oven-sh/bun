import { bunEnv, bunExe } from "harness";
import path from "path";

test("stdin destroy after exit crash", async () => {
  let before;
  await (async () => {
    const child = Bun.spawn({
      cmd: [bunExe(), path.join(import.meta.dir, "bad-fixture.js")],
      env: bunEnv,
      stdout: "pipe",
      stdin: "pipe",
    });

    await Bun.sleep(80);
    // The child throws on startup, so by the time we write the stdin pipe is
    // already closed; write() now throws ERR_STREAM_WRITE_AFTER_END instead of
    // silently dropping the data. The assertion below is that child.exited
    // resolves (the original bug rejected it with code "TODO") and nothing
    // crashes under GC.
    try {
      await child.stdin.write("dylan\n");
      await child.stdin.write("999\n");
      await child.stdin.flush();
    } catch (e: any) {
      expect(e.code).toBe("ERR_STREAM_WRITE_AFTER_END");
    }
    await child.stdin.end();

    async function read() {
      var out = "";
      for await (const chunk of child.stdout) {
        out += new TextDecoder().decode(chunk);
      }
      return out;
    }

    // This bug manifested as child.exited rejecting with an error code of "TODO"
    const [out, exited] = await Promise.all([read(), child.exited]);

    expect(out).toBe("");
    expect(exited).toBe(1);

    Bun.gc(true);
    await Bun.sleep(50);
  })();
  Bun.gc(true);
});
