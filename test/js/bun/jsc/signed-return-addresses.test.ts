import { expect, test } from "bun:test";
import { bunExe, isArm64, isLinux } from "harness";
import { readFileSync } from "node:fs";

// So that a run says by itself which of the lanes it is. What the compilers generate signs with PACIASP, LLInt with PACIBSP.
test.if(isLinux && isArm64)("the executable signs return addresses where its WebKit does", () => {
  const bytes = readFileSync(bunExe());
  const words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 2);
  const counts = { paciasp: 0, autiasp: 0, pacibsp: 0, autibsp: 0 };
  for (const word of words) {
    if (word === 0xd503233f) counts.paciasp++;
    else if (word === 0xd50323bf) counts.autiasp++;
    else if (word === 0xd503237f) counts.pacibsp++;
    else if (word === 0xd50323ff) counts.autibsp++;
  }
  const hasPointerAuthentication = /\bpaca\b/.test(readFileSync("/proc/cpuinfo", "utf8"));
  console.log("SIGNING", process.versions.webkit, JSON.stringify({ ...counts, hasPointerAuthentication }));
  if (process.versions.webkit.includes("pr-968-")) {
    expect(counts.paciasp).toBeGreaterThan(10000);
    expect(counts.pacibsp).toBeGreaterThan(100);
  }
});
