import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "path";

// https://github.com/oven-sh/bun/issues/10004
describe("BuildArtifact.stream()", () => {
  test("streams the artifact's own contents", async () => {
    using dir = tempDir("issue-10004", {
      "entry.ts": "export const hello = 'BuildArtifact.stream() regression test';\n",
    });
    const x = await Bun.build({ entrypoints: [join(String(dir), "entry.ts")] });
    expect(x.success).toBe(true);
    const artifact = x.outputs[0];
    const stream = artifact.stream();
    expect(stream).toBeInstanceOf(ReadableStream);
    expect(await new Response(stream).text()).toBe(await artifact.text());
  });

  test("is unaffected by reading cached getters like .kind first", async () => {
    using dir = tempDir("issue-10004-kind", {
      "entry.ts": "export const hello = 'BuildArtifact.stream() regression test';\n",
    });
    const x = await Bun.build({ entrypoints: [join(String(dir), "entry.ts")] });
    expect(x.success).toBe(true);
    const artifact = x.outputs[0];
    expect(artifact.kind).toBe("entry-point");
    const stream = artifact.stream();
    expect(stream).toBeInstanceOf(ReadableStream);
    expect(await new Response(stream).text()).toBe(await artifact.text());
    expect(artifact.kind).toBe("entry-point");
  });
});
