import { describe, expect, test } from "bun:test";
import { tempDirWithFiles } from "harness";

describe("Bun.build modules option", () => {
  test("should accept modules option with string", async () => {
    using tmp = tempDirWithFiles("bundler-modules-basic", {
      "entry.js": `
        import { msg } from "virtual:msg";
        console.log(msg);
      `,
    });

    const result = await Bun.build({
      entrypoints: [tmp.join("entry.js")],
      modules: {
        "virtual:msg": "export const msg = 'Hello from virtual!';",
      },
    });

    expect(result.success).toBe(true);
    expect(result.outputs).toHaveLength(1);

    const code = await result.outputs[0].text();
    expect(code).toContain("Hello from virtual");
  });

  test("should accept modules option with Blob", async () => {
    using tmp = tempDirWithFiles("bundler-modules-blob", {
      "entry.js": `
        import data from "virtual:data";
        console.log(data);
      `,
    });

    const blob = new Blob(["export default { key: 'value' };"]);

    const result = await Bun.build({
      entrypoints: [tmp.join("entry.js")],
      modules: {
        "virtual:data": blob,
      },
    });

    expect(result.success).toBe(true);
    const code = await result.outputs[0].text();
    expect(code).toContain("key");
  });

  test("should accept modules option with Uint8Array", async () => {
    using tmp = tempDirWithFiles("bundler-modules-uint8", {
      "entry.js": `
        import data from "virtual:data";
        console.log(data);
      `,
    });

    const encoder = new TextEncoder();
    const arr = encoder.encode("export default 42;");

    const result = await Bun.build({
      entrypoints: [tmp.join("entry.js")],
      modules: {
        "virtual:data": arr,
      },
    });

    expect(result.success).toBe(true);
    const code = await result.outputs[0].text();
    expect(code).toContain("42");
  });

  test("should reject invalid module value", async () => {
    using tmp = tempDirWithFiles("bundler-modules-invalid", {
      "entry.js": `console.log("hi");`,
    });

    await expect(async () => {
      await Bun.build({
        entrypoints: [tmp.join("entry.js")],
        modules: {
          "bad": 123 as any,
        },
      });
    }).toThrow(/must be a string, Blob, or TypedArray/);
  });
});
