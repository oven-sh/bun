import { transform, transformSync } from "esbuild";
import { describe, it, expect } from "bun:test";

describe("child_process.spawn - esbuild", () => {
  // it("should transform successfully", async () => {
  //   const result = await transform("console.log('hello world')", {
  //     loader: "js",
  //     target: "node12",
  //   });
  //   expect(result.code).toBe('console.log("hello world");\n');
  // });

  it("works for input exceeding the pipe capacity", async () => {
    const hugeString = `console.log(${JSON.stringify("a".repeat(1000000))});`;

    for (let i = 0; i < 2; i++) {
      const result = await transform(hugeString, {
        loader: "js",
        target: "node12",
      });
      expect(result.code).toBe(hugeString + "\n");
    }
  });
});

describe("child_process.spawnSync - esbuild", () => {
  it("should transform successfully", () => {
    const result = transformSync("console.log('hello world')", {
      loader: "js",
      target: "node12",
    });
    expect(result.code).toBe('console.log("hello world");\n');
  });

  // This test is failing with the following error:
  // error: Error
  // path: "/Users/jarred/Code/bun/test/bun.js/node_modules/esbuild-darwin-arm64/bin/esbuild"
  // code: "13"
  // syscall: "spawnSync"
  // errno: -1
  it("works for input exceeding the pipe capacity", () => {
    const hugeString = `console.log(${JSON.stringify("a".repeat(100000))});`;
    const result = transformSync(hugeString, {
      loader: "js",
      target: "node12",
    });
    expect(result.code).toBe(hugeString + "\n");
  });
});
