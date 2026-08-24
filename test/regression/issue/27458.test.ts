import { cssInternals } from "bun:internal-for-testing";
import { expect, test } from "bun:test";

const { prefixTest } = cssInternals;

// https://github.com/oven-sh/bun/issues/27458
// Safari 14 does not support logical border-radius properties, so they are
// compiled to physical properties with LTR/RTL variants.
test("CSS bundler maps logical border-radius properties to correct physical properties", () => {
  const output = prefixTest(
    `.box {
  border-start-start-radius: var(--r, 20px);
  border-start-end-radius: var(--r, 20px);
  border-end-start-radius: var(--r, 20px);
  border-end-end-radius: var(--r, 20px);
}
`,
    "",
    { safari: 14 << 16 },
  );

  // Each logical property must map to its own distinct physical property.
  // The output contains LTR and RTL variants (with :lang() selectors), so
  // each physical property appears multiple times. The key check is that all
  // four distinct physical properties are present (not all mapped to one).
  expect(output).toContain("border-top-left-radius:");
  expect(output).toContain("border-top-right-radius:");
  expect(output).toContain("border-bottom-left-radius:");
  expect(output).toContain("border-bottom-right-radius:");

  // In the LTR block, verify each physical property appears exactly once.
  // Extract the first rule block (LTR) to check the mapping is correct.
  const firstBlock = output.split("}")[0];
  expect((firstBlock.match(/border-top-left-radius/g) || []).length).toBe(1);
  expect((firstBlock.match(/border-top-right-radius/g) || []).length).toBe(1);
  expect((firstBlock.match(/border-bottom-right-radius/g) || []).length).toBe(1);
  expect((firstBlock.match(/border-bottom-left-radius/g) || []).length).toBe(1);
});
