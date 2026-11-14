import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Each program loads an element of arrays of two kinds twice. One use truncates the element, the other
// needs all of it, some of them only behind an OSR exit.
const programs: Record<string, [source: string, output: string]> = {
  "a catch block": [
    `const arrays = [[1.5, 2.5], new Uint8Array([1, 2])];
     function f(a, i, max) {
       let x;
       try { const y = a[i] | 0; x = a[i]; if (y > max) throw 0; return y; } catch { return x; }
     }
     let wrong = 0;
     for (let k = 1; k <= 200000; k++) {
       if (k % 100) f(arrays[k & 1], k & 1, 9);
       else if (f(arrays[0], 0, 0) !== 1.5) wrong++;
     }
     console.log(f(arrays[0], 0, 0), wrong);`,
    "1.5 0",
  ],
  "a line that never ran": [
    `const arrays = [[1.5, 2.5], new Uint8Array([1, 2])];
     function f(a, i, max) {
       const y = a[i] | 0, x = a[i];
       if (y > max) throw new RangeError("value too big: " + x);
       return y;
     }
     for (let k = 0; k < 200000; k++) f(arrays[k & 1], k & 1, 9);
     try { f(arrays[0], 0, 0); } catch (e) { console.log(e.message); }`,
    "value too big: 1.5",
  ],
  "negative zero": [
    `const arrays = [[4294967297, 8589934592], new Uint32Array([1, 4294967295])];
     function f(a, i, j) { const p = a[i], q = a[i], e = q % a[j], d = a[j] % p; return [1 / e, d]; }
     for (let k = 0; k < 200000; k++) f(arrays[k & 1], (k >> 1) & 1, (k >> 2) & 1);
     console.log(f([-0, 1], 0, 1)[0]);`,
    "-Infinity",
  ],
};

for (const [name, [source, output]] of Object.entries(programs)) {
  test.concurrent(name, async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", source],
      env: { ...bunEnv, BUN_JSC_useConcurrentJIT: "0" },
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout).toBe(output + "\n");
    expect(exitCode).toBe(0);
  });
}
