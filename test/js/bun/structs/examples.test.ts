import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

// Bundles each browser example for the browser: the struct syntax must be lowered and the runtime
// helper shipped in the bundle, so no browser support is needed.
const root = join(import.meta.dir, "..", "..", "..", "..", "examples", "structs");

const examples = [
  { name: "vanilla-js", entry: "src/main.js" },
  { name: "vanilla-ts", entry: "src/main.ts" },
  { name: "react", entry: "src/main.tsx", needsInstall: true },
  { name: "angular", entry: "src/main.ts", needsInstall: true },
];

describe("browser examples", () => {
  for (const { name, entry, needsInstall } of examples) {
    const dir = join(root, name);
    const installed = !needsInstall || existsSync(join(dir, "node_modules"));
    test.skipIf(!installed)(`${name} bundles for the browser`, async () => {
      const result = await Bun.build({ entrypoints: [join(dir, entry)], target: "browser", minify: false });
      expect(result.logs.filter(log => log.level === "error")).toEqual([]);
      expect(result.success).toBe(true);
      const code = await result.outputs[0].text();
      expect(code).toContain("__structBase");
      expect(code).not.toMatch(/^\s*(shared\s+)?struct\s+\w+/m);
    });
  }
});
