import { expect, test } from "bun:test";
import { bunExe, isArm64, isLinux } from "harness";
import { readFileSync } from "node:fs";

// What the compilers generate signs with PACIASP, LLInt with PACIBSP. With +bti the compilers would begin every function that
// may be called by its address with BTI c. Without it, that is in LLInt and in what is written in assembly.
test.if(isLinux && isArm64)("the executable signs return addresses, and is compiled without +bti", () => {
  const bytes = readFileSync(bunExe());
  const words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 2);
  const counts = { paciasp: 0, autiasp: 0, pacibsp: 0, autibsp: 0, btiC: 0, btiJ: 0 };
  for (const word of words) {
    if (word === 0xd503233f) counts.paciasp++;
    else if (word === 0xd50323bf) counts.autiasp++;
    else if (word === 0xd503237f) counts.pacibsp++;
    else if (word === 0xd50323ff) counts.autibsp++;
    else if (word === 0xd503245f) counts.btiC++;
    else if (word === 0xd503249f) counts.btiJ++;
  }
  console.log("SIGNING", process.versions.webkit, JSON.stringify(counts));
  expect(counts.paciasp).toBeGreaterThan(50000);
  expect(counts.pacibsp).toBeGreaterThan(30);
  expect(counts.btiJ).toBeGreaterThan(1000);
  expect(counts.btiC).toBeGreaterThan(300);
  expect(counts.btiC).toBeLessThan(5000);
});
