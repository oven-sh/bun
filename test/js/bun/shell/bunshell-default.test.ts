import { bunEnv } from "harness";
import { bunExe, createTestBuilder } from "./test_builder";
const TestBuilder = createTestBuilder(import.meta.path);

test("default throw on command failure", async () => {
  // Run in a subproc because other tests may change the value of $.throws
  const code = /* ts */ `
  import { $ } from "bun";
  import { afterAll, beforeAll, describe, expect, test } from "bun:test";
  test('test', async () => {
    try {
      await $\`echo hi; ls oogabooga\`.quiet();
      expect.unreachable();
    } catch (e: any) {
      expect(e).toBeInstanceOf(Error);
      expect(e.exitCode).toBe(1);
      expect(e.message).toBe("Failed with exit code 1");
      expect(e.stdout.toString("utf-8")).toBe("hi\\n");
      expect(e.stderr.toString("utf-8")).toBe("ls: oogabooga: No such file or directory\\n");
    }
  })
  `;

  await TestBuilder.command`echo ${code} > index.test.ts; ${bunExe()} test index.test.ts`
    .ensureTempDir()
    .stdout(`bun test ${Bun.version_with_sha}\n`)
    .stderr(s => s.includes("1 pass"))
    .env(bunEnv)
    .run();
});

test("ShellError has .text()", async () => {
  // Run in a subproc because other tests may change the value of $.throws
  const code = /* ts */ `
  import { $ } from "bun";
  import { afterAll, beforeAll, describe, expect, test } from "bun:test";
  test('test', async () => {
    try {
      await $\`ls oogabooga\`.quiet();
      expect.unreachable();
    } catch (e: any) {
      expect(e).toBeInstanceOf(Error);
      expect(e.exitCode).toBe(1);
      expect(e.stderr.toString("utf-8")).toBe("ls: oogabooga: No such file or directory\\n");
    }
  })
  `;

  await TestBuilder.command`echo ${code} > index.test.ts; ${bunExe()} test index.test.ts`
    .ensureTempDir()
    .stdout(`bun test ${Bun.version_with_sha}\n`)
    .stderr(s => s.includes("1 pass"))
    .env(bunEnv)
    .run();
});
