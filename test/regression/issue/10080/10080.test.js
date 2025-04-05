import { $ } from "bun";
import { bunExe, isWindows } from "harness";

const expected_output = `got data "line 1\\n"
✓ read at least 25ms apart
got data "setTimeout tick"
✓ read at least 25ms apart
got data "line 2\\n"
✓ read at least 25ms apart
got data "setTimeout tick"
✓ read at least 25ms apart
got data "line 3\\n"
✓ read at least 25ms apart
got data "setTimeout tick"
✓ read at least 25ms apart
got data "line 4\\n"
✓ read at least 25ms apart
got data "setTimeout tick"
✓ read at least 25ms apart
got data "line 5\\n"
✓ read at least 25ms apart
got data "setTimeout tick"
`;

test.skipIf(isWindows)("stdin data should be emitted as stdin is read", async () => {
  const result = Bun.spawnSync({
    cmd: ["sh", "-c", `${bunExe()} ${import.meta.dirname}/writer | ${bunExe()} ${import.meta.dirname}/reader`],
    stdio: ["pipe", "pipe", "pipe"],
  });
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString("utf-8")).toBe(expected_output);
  expect(result.stderr.toString("utf-8")).toMatchInlineSnapshot(`""`);
});

test("[bun shell] stdin data should be emitted as stdin is read", async () => {
  const txt = await $`${bunExe()} ${import.meta.dirname}/writer | ${bunExe()} ${import.meta.dirname}/reader`.text();
  expect(txt).toBe(expected_output);
});
