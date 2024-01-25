import { spawn } from "bun";
import { test, expect } from "bun:test";
import { join } from "path";
import { bunExe } from "harness";

test("args exclude run", async () => {
  const arg0 = process.argv[0];
  const arg1 = join(import.meta.dir, "/print-process-args.js");
  const exe = bunExe();
  const { stdout: s1 } = spawn([exe, "print-process-args.js"], {
    cwd: import.meta.dir,
    env: { BUN_DEBUG_QUIET_LOGS: "1" },
  });
  const t1 = JSON.parse(await new Response(s1).text());
  expect(t1[0]).toBe(arg0);
  expect(t1[1]).toBe(arg1);
  const { stdout: s2 } = spawn([exe, "print-process-args.js", "arg1"], {
    cwd: import.meta.dir,
    env: { BUN_DEBUG_QUIET_LOGS: "1" },
  });
  const t2 = JSON.parse(await new Response(s2).text());
  expect(t2[0]).toBe(arg0);
  expect(t2[1]).toBe(arg1);
  expect(t2[2]).toBe("arg1");
  const { stdout: s3 } = spawn([exe, "run", "print-process-args.js"], {
    cwd: import.meta.dir,
    env: { BUN_DEBUG_QUIET_LOGS: "1" },
  });
  const t3 = JSON.parse(await new Response(s3).text());
  expect(t3[0]).toBe(arg0);
  expect(t3[1]).toBe(arg1);
  const { stdout: s4 } = spawn([exe, "run", "print-process-args.js", "arg1", "arg2"], {
    cwd: import.meta.dir,
    env: { BUN_DEBUG_QUIET_LOGS: "1" },
  });
  const t4 = JSON.parse(await new Response(s4).text());
  expect(t4[0]).toBe(arg0);
  expect(t4[1]).toBe(arg1);
  expect(t4[2]).toBe("arg1");
  expect(t4[3]).toBe("arg2");
});
