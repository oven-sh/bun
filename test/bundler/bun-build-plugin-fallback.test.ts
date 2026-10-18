import { describe, expect, test } from "bun:test";
import { tempDirWithFiles } from "harness";
import { join } from "path";

describe("Bun.build plugins", () => {
  test("onLoad can fall back to bundling .node files", async () => {
    const dir = tempDirWithFiles("bun-build-onload-node-fallback", {
      "index.js": `import addon from "./addon.node"; export default addon;`,
      "addon.node": "native addon placeholder",
    });

    const result = await Bun.build({
      entrypoints: [join(dir, "index.js")],
      outdir: join(dir, "out"),
      target: "bun",
      plugins: [
        {
          name: "fallthrough",
          setup(build) {
            build.onLoad({ filter: /\.node$/ }, () => undefined);
          },
        },
      ],
    });

    expect(result.logs).toBeEmpty();
    expect(result.success).toBeTrue();
    expect(result.outputs.some(output => output.kind === "asset")).toBeTrue();
  });
});
