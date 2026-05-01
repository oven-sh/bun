import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunExe } from "harness";

test("spawn stress", async () => {
  for (let i = 0; i < 100; i++) {
    try {
      console.log("=== Begin Iteration " + i, "===");
      const withoutCache = spawn({
        cmd: [bunExe(), "--version"],
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      });
      var err = await new Response(withoutCache.stderr).text();
      var out = await new Response(withoutCache.stdout).text();
      console.log("=== End Iteration " + i, "===");
      out = out.trim();
      err = err.trim();

      expect(out).not.toBe("");
      await Bun.sleep(1);
    } catch (e) {
      console.log("Failed in Iteration " + i + "\n");
      console.log(out);
      console.log(err);
      throw e;
    }
  }
}, 99999999);
