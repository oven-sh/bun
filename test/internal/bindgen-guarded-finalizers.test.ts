import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { serializeBuiltinUses } from "../../scripts/build/trim/builtin-uses.ts";

const repositoryRoot = resolve(import.meta.dir, "../..");
const schema = `import * as b from ${JSON.stringify(join(repositoryRoot, "src/codegen/bindgen-lib.ts"))};
export const Toy = b.class({ rustPath: "crate::toy::Toy", construct: {} });
export const Counted = b.class({ rustPath: "crate::toy::Counted", refCounted: true, construct: {} });
`;
const usesOfToy = serializeBuiltinUses({
  entries: ["Toy", "Counted"].map((name, id) => ({
    id,
    path: `%${name}%`,
    kind: "Constructor",
    uses: [{ feature: "Glob", isConditional: false }],
    nativeSymbols: [],
    hasHiddenRoot: true,
  })),
});

async function generate(withFeatures: boolean) {
  using dir = tempDir("bindgen-guarded-finalizers", { "toy.bind.ts": schema, "builtin-uses.json": usesOfToy });
  const root = String(dir);
  mkdirSync(join(root, "out"));
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      join(repositoryRoot, "src/codegen/bindgen.ts"),
      `--sources=bun_runtime=${join(root, "toy.bind.ts")}`,
      "--types-only=",
      `--codegen-path=${join(root, "out")}`,
      `--types-path=${join(root, "out")}`,
      ...(withFeatures ? [`--builtin-uses=${join(root, "builtin-uses.json")}`] : []),
    ],
    cwd: repositoryRoot,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  return {
    rust: readFileSync(join(root, "out", "generated_bindgen_bun_runtime.rs"), "utf8"),
    cpp: readFileSync(join(root, "out", "GeneratedToy.cpp"), "utf8"),
  };
}

const attributesOf = (rust: string, symbol: string) =>
  rust
    .slice(0, rust.indexOf(`fn ${symbol}(`))
    .split("\n")
    .slice(-3, -1)
    .map(line => line.trim());

// ThinLTO removes the call of a function that it sees do nothing, and the link of a trimmable build refuses a guard whose function has left the image.
test("the finalizer of a class with a feature is not imported into its caller", async () => {
  const { rust, cpp } = await generate(true);
  expect(cpp).toContain("JSC::RemovedFeatureStub::Abort, Bun__Bindgen__ToyClass__finalize>(");
  expect(attributesOf(rust, "Bun__Bindgen__ToyClass__finalize")).toEqual(["#[unsafe(no_mangle)]", "#[inline(never)]"]);
});

test("without features the finalizer is called as it is", async () => {
  const { rust, cpp } = await generate(false);
  expect(cpp).not.toContain("RemovedFeatureStub");
  expect(attributesOf(rust, "Bun__Bindgen__ToyClass__finalize")).not.toContain("#[inline(never)]");
});
