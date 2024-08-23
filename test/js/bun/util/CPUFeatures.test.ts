import { getCPUFeatures, type X86CPUFeature, type AArch64CPUFeature } from "bun:internal-for-testing";

import { test, expect } from "bun:test";

test("CPUFeatures", () => {
  const features = getCPUFeatures();
  console.log({ features });

  if (process.arch === "x64") {
    const x86 = features as X86CPUFeature;
    expect(x86, "CI must have AVX enabled").toHaveProperty("avx", true);
    expect(x86, "CI must have AVX2 enabled").toHaveProperty("avx2", true);
    // sanity check:
    expect(x86.sse42).toBeTrue();
  } else if (process.arch === "arm64") {
    const arm64 = features as AArch64CPUFeature;
    expect(arm64, "CI must have NEON enabled").toHaveProperty("neon", true);
  } else {
    throw new Error("TODO: Add support for other architectures");
  }
});
