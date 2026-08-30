/**
 * scripts/runner.node.mjs spawns every `bun test` with GITHUB_ACTIONS=true so that the
 * failures come out as `::error` workflow commands it can parse. createLiveOutputFilter()
 * in scripts/utils.mjs removes those lines from the output it streams to the CI log,
 * even when a pipe read ends in the middle of one.
 */
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { createLiveOutputFilter } from "../../scripts/utils.mjs";

const annotation =
  '::error file=test/a.test.ts,line=4,col=34,title=error: expect(received).toMatchObject(expected)::  {%0A-   "a": 2,%0A+   "a": 1,%0A  }%0A%0A      at <anonymous> (/repo/test/a.test.ts:4:34)\n';

const filterAll = (chunks: string[], options?: { github?: boolean; buildkite?: boolean }) => {
  const filter = createLiveOutputFilter(options);
  return chunks.map(filter).join("");
};

describe("createLiveOutputFilter", () => {
  test("drops the workflow commands bun test prints and keeps the rest", () => {
    const output = `\x1b[0m\n::group::test/a.test.ts:\nerror: boom\n\n${annotation}✗ c [0.25ms]\n.\n\x1b[0m\n::endgroup::\n\n3 pass\n`;
    expect(filterAll([output])).toBe("\x1b[0m\nerror: boom\n\n✗ c [0.25ms]\n.\n\x1b[0m\n\n3 pass\n");
  });

  test("drops an annotation that arrives in several chunks", () => {
    // bun writes the annotation in many small writes, so this is the usual case.
    const [first, rest] = [annotation.slice(0, 50), annotation.slice(50)];
    const [middle, last] = [rest.slice(0, 60), rest.slice(60)];
    expect(
      filterAll([`      at <anonymous> (/repo/test/a.test.ts:4:34)\n\n${first}`, middle, `${last}✗ c [0.25ms]\n`]),
    ).toBe("      at <anonymous> (/repo/test/a.test.ts:4:34)\n\n✗ c [0.25ms]\n");
  });

  test("passes an incomplete line through unless it could be a workflow command", () => {
    const filter = createLiveOutputFilter();
    // The dots reporter prints progress without a line end. It is shown at once.
    expect(filter("..")).toBe("..");
    expect(filter("\n\n::group::test/a.test.ts:\n1 | test")).toBe("\n\n1 | test");
    expect(filter('("c", () => {});\n')).toBe('("c", () => {});\n');
    // The start of a command is held back until the rest of the line arrives.
    expect(filter("::endgroup")).toBe("");
    expect(filter("::\n\n3 pass\n")).toBe("\n3 pass\n");
  });

  test("only treats :: at the start of a line as a command", () => {
    expect(filterAll(["error: std", "::bad_alloc\n::endgroup::\n"])).toBe("error: std::bad_alloc\n");
    expect(filterAll(["a::b\nc\n"])).toBe("a::b\nc\n");
  });

  test("keeps the error annotations for GitHub Actions and drops only the groups", () => {
    const output = `\x1b[0m\n::group::test/a.test.ts:\n${annotation}✗ c [0.25ms]\n::endgroup::\n`;
    expect(filterAll([output], { github: true })).toBe(`\x1b[0m\n${annotation}✗ c [0.25ms]\n`);
    expect(filterAll([annotation.slice(0, 30), annotation.slice(30)], { github: true })).toBe(annotation);
  });

  test("defuses the group markers of Buildkite at the start of a line", () => {
    expect(filterAll(["--- a\n+++ b\n~~~ c\n^^^ d\nx --- y\n"], { buildkite: true })).toBe(" a\n b\n c\n d\nx --- y\n");
    expect(filterAll(["::group::t:\n--- a\n"], { buildkite: true })).toBe(" a\n");
    // Not when the line continues one that was already written.
    expect(filterAll(["x ", "--- y\n"], { buildkite: true })).toBe("x --- y\n");
  });

  test("holds back the start of a marker until it is complete or ruled out", () => {
    expect(filterAll(["--", "- a\n"], { buildkite: true })).toBe(" a\n");
    expect(filterAll(["x\n-", "-", "- b\n"], { buildkite: true })).toBe("x\n b\n");
    expect(filterAll(["---", "x\n"], { buildkite: true })).toBe("---x\n");
    expect(filterAll(["--- a", "b\n"], { buildkite: true })).toBe(" ab\n");
    expect(filterAll([":", ":endgroup::\n"])).toBe("");
    expect(filterAll(["-", "- c\n"])).toBe("-- c\n");
  });
});

test("createLiveOutputFilter removes the annotations from the output of bun test, as it arrives", async () => {
  using dir = tempDir("runner-live-output", {
    "test/a.test.ts": `
      import { expect, test } from "bun:test";
      test("passes", () => expect(1).toBe(1));
      test("fails", () => expect({ a: 1 }).toMatchObject({ a: 2, name: "x" }));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--reporter=dots", "test/a.test.ts"],
    cwd: String(dir),
    env: { ...bunEnv, GITHUB_ACTIONS: "true" },
    stdout: "ignore",
    stderr: "pipe",
  });

  const filter = createLiveOutputFilter();
  let raw = "";
  let filtered = "";
  for await (const chunk of proc.stderr.pipeThrough(new TextDecoderStream())) {
    raw += chunk;
    filtered += filter(chunk);
  }

  expect(raw).toContain("\n::group::test/a.test.ts:\n");
  expect(raw).toContain("\n::error ");
  expect(raw).toContain("\n::endgroup::\n");
  expect(filtered).not.toContain("::");
  expect(filtered).toMatch(/^(✗|\(fail\)) fails/m);
  expect(filtered).toContain("error: expect(received).toMatchObject(expected)");
  expect(filtered).toContain("1 fail");
  expect(await proc.exited).toBe(1);
});
