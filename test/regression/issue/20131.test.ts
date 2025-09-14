import { expect, test } from "bun:test";
import { tempDirWithFiles } from "harness";

test("CSS file has correct MIME type in Bun.build result", async () => {
  const dir = tempDirWithFiles("css-mime-type-test", {
    "styles.css": `.test { color: red; }`,
  });

  const result = await Bun.build({
    entrypoints: [`${dir}/styles.css`],
    outdir: `${dir}/out`,
  });

  expect(result.outputs).toHaveLength(1);
  expect(result.outputs[0].type).toBe("text/css;charset=utf-8");
  expect(result.outputs[0].kind).toBe("asset");
});

test("CSS file has correct MIME type in Bun.build result (in-memory)", async () => {
  const dir = tempDirWithFiles("css-mime-type-test-memory", {
    "styles.css": `.test { color: blue; }`,
  });

  const result = await Bun.build({
    entrypoints: [`${dir}/styles.css`],
    // No outdir = in-memory build
  });

  expect(result.outputs).toHaveLength(1);
  expect(result.outputs[0].type).toBe("text/css;charset=utf-8");
  expect(result.outputs[0].kind).toBe("asset");
});
