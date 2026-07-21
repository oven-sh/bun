// Shared between jsc-stress.test.ts and scripts/verify-baseline.ts so both
// spawn fixtures with the same JSC options.

import fs from "fs";

/**
 * Parse JSC option flags from //@ directives at the top of a test file.
 * Converts --flag=value to BUN_JSC_flag=value environment variables.
 *
 * Supported directives:
 *   //@ runDefault("--flag=value", ...)
 *   //@ runFTLNoCJIT("--flag=value", ...)
 *   //@ runDefaultWasm("--flag=value", ...)
 */
export function parseJSCFlags(filePath: string): Record<string, string> {
  const content = fs.readFileSync(filePath, "utf-8");
  const env: Record<string, string> = {};

  for (const line of content.split("\n")) {
    if (line === "// @bun" || line.trim() === "") continue;
    if (!line.startsWith("//@")) break;

    const match = line.match(/^\/\/@ (runDefault|runFTLNoCJIT|runDefaultWasm)\((.*)\)/);
    if (!match) continue;

    const [, mode, argsStr] = match;

    // runFTLNoCJIT implies these flags (from WebKit's run-jsc-stress-tests)
    if (mode === "runFTLNoCJIT") {
      env["BUN_JSC_useFTLJIT"] = "true";
      env["BUN_JSC_useConcurrentJIT"] = "false";
    }

    // Parse explicit flags: "--key=value"
    const flagPattern = /"--(\w+)=([^"]+)"/g;
    let flagMatch;
    while ((flagMatch = flagPattern.exec(argsStr)) !== null) {
      env[`BUN_JSC_${flagMatch[1]}`] = flagMatch[2];
    }
  }

  return env;
}

/**
 * Wasm fixtures whose modules declare v128 (0x7B) types. JSC force-disables
 * `useWasmSIMD` on x86_64 without AVX (Options.cpp: `isX86_64() && !isX86_64_AVX()`),
 * so under Nehalem emulation these fail to parse with
 * `CompileError: WebAssembly.Module doesn't parse ... can't get ... Type`.
 * verify-baseline.ts skips them on x64 since a real Nehalem CPU could never
 * run the wasm-SIMD JIT path anyway.
 */
export const wasmSIMDFixtures = new Set(["bbq-osr-with-exceptions.js", "omg-tail-call-clobber-scratch-register.js"]);
