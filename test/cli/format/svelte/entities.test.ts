// Tests for how `bun fmt --debug-check` reads the entities in the text of a Svelte component.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { endChildren, spawn } from "../../children";

afterAll(endChildren);

// `bun fmt --debug-check-svelte` is compiled into debug and canary builds only.
const hasRunner = isDebug || Bun.spawnSync({ cmd: [bunExe(), "--revision"], env: bunEnv }).stdout.includes("canary");
/** Returns `fill` repeated `count` times. */
const repeated = (fill: string, count: number) => Buffer.alloc(count * Buffer.byteLength(fill), fill).toString();

describe.concurrent("Svelte entities in --debug-check", () => {
  // The printer writes a character that's whitespace in JavaScript as `&nbsp;` or `&#x..;` where it would be lost
  // otherwise. So the check reads these two as the character. Each row is a text, and that text with the character.
  const same = [
    ["a&nbsp;b", "a\u00A0b"],
    ["a&#xA0;b", "a\u00A0b"],
    ["a&#xa0;b", "a\u00A0b"],
    ["a&#x00000000A0;b", "a\u00A0b"],
    ["a&#x2028;b", "a\u2028b"],
    // No entity to Svelte. Rust's `u32::from_str_radix` reads the number, and takes a `+` before it.
    ["a&#x+A0;b", "a\u00A0b"],
    ["a&nbsp;&nbsp;b", "a\u00A0\u00A0b"],
    ["a&nbsp;;b", "a\u00A0;b"],
    // An `&` that starts no entity, before one that does.
    ["a& &nbsp;b", "a& \u00A0b"],
    ["a&&nbsp;b", "a&\u00A0b"],
    ["a&#x&nbsp;b", "a&#x\u00A0b"],
    ["a&;&#xA0;b", "a&;\u00A0b"],
    // And after one.
    ["a&nbsp;b&nbsp", "a\u00A0b&nbsp"],
    ["a&#xA0;b&#xA0", "a\u00A0b&#xA0"],
  ];
  // Each row is a text, and what it would be if the check read more than that.
  const different = [
    // The `;` isn't right after the name or the digits.
    ["a&nbsp", "a\u00A0"],
    ["a&#xA0", "a\u00A0"],
    ["a&nbsp b;", "a\u00A0 b;"],
    ["a&#xA0 b;", "a\u00A0 b;"],
    // Not a hexadecimal number that fits.
    ["a&#x A0;b", "a\u00A0b"],
    ["a&#x-A0;b", "a\u00A0b"],
    ["a&#xA+0;b", "a\u00A0b"],
    ["a&#x1000000A0;b", "a\u00A0b"],
    // Another spelling.
    ["a&#160;b", "a\u00A0b"],
    ["a&#XA0;b", "a\u00A0b"],
    ["a&NBSP;b", "a\u00A0b"],
    // Not whitespace.
    ["a&#x41;b", "aAb"],
  ];
  test.skipIf(!hasRunner)("reads `&nbsp;` and `&#x..;` as the whitespace that they stand for", async () => {
    const rows = [...same, ...different];
    using dir = tempDir(
      "bun-format-svelte",
      Object.fromEntries(
        rows.flatMap((it, index) => it.map((text, which) => [`${index}.${which}`, `<p>${text}</p>\n`])),
      ),
    );
    await using proc = spawn({
      cmd: [bunExe(), "fmt", "--debug-check-svelte", ...rows.flatMap((_, index) => [`${index}.0`, `${index}.1`])],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const verdicts = stdout.trimEnd().split("\n");
    expect(rows.map((it, index) => [...it, verdicts[index]])).toEqual([
      ...same.map(it => [...it, "same"]),
      ...different.map(it => [...it, "different"]),
    ]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  });

  // Anything quadratic in this takes seconds.
  const size = isDebug || isASAN ? 60_000 : 600_000;
  test.each([
    // The check once looked for the `;` of each `&` in all of the text after it,
    ["`&` without a `;`", repeated("&", size)],
    // and read all of the text up to that `;` as the digits of each `&#x`.
    ["`&#x` before a far `;`", `${repeated("&#x", size / 3)};`],
  ])("takes linear time: %s", async (_, text) => {
    using dir = tempDir("bun-format-svelte", { "a.svelte": `<p   >${text}</p>\n` });
    const run = async (flag: string) => {
      await using proc = spawn({
        cmd: [bunExe(), "fmt", flag, "--threads=1", "a.svelte"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode, seconds: Number(proc.resourceUsage()!.cpuTime.user) / 1e6 };
    };
    // `--debug-check` compares nothing for a file that formatting leaves as it is. The start tag is what changes here.
    expect(await run("--check")).toMatchObject({ stdout: "a.svelte\n", exitCode: 1 });
    const checked = await run("--debug-check");
    expect(checked).toMatchObject({ stdout: "a.svelte\n", stderr: "", exitCode: 0 });
    // 0.01 s in a release build and 0.1 s in a debug build. With the search for `;`, each shape took more than 2 s.
    expect(checked.seconds).toBeLessThan(1);
  });
});
