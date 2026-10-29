// An operation that compiled code calls publishes the address of its own frame record, and walks of the stack begin there.
// An operation with a short road that needs no walk hands the address to a function that does the rest. If the C++
// compiler ends the operation with a jump to that function, the frame is gone while its address is in use, so such a
// function is declared NEVER_INLINE NOT_TAIL_CALLED. Goes by the text of the engine's sources.
import { expect, test } from "bun:test";
import { filesOfCompiler, lineOf, sayWhenSkipped, sources } from "./harness/engine-text";

sayWhenSkipped("test/aot/the-frame-of-an-operation-outlives-whoever-is-handed-its-address.test.ts");

// The macros themselves.
const definitions = "runtime/AOTOperationScope.h";
// An object with a destructor, which runs in the frame behind every call.
const keepTheFrame = new Set(["tracer"]);

/** The name in front of the innermost bracket that is open at `position`, or nothing. */
function calleeAround(text: string, position: number): string | undefined {
  let depth = 0;
  for (let i = position - 1; i >= 0 && text[i] !== ";" && text[i] !== "{" && text[i] !== "}"; i--) {
    if (text[i] === ")") depth++;
    else if (text[i] === "(" && depth-- === 0) return /([A-Za-z_]\w*)\s*(?:<[^()]*>)?\s*$/.exec(text.slice(0, i))?.[1];
  }
}

test.skipIf(!sources)("a function that is handed the frame record of an operation is called, never jumped to", () => {
  const begun: string[] = [];
  const handed: string[] = [];
  const wrong: string[] = [];
  for (const { name, text } of filesOfCompiler()) {
    if (name === definitions) continue;
    const called = new Set(
      [...text.matchAll(/\bNEVER_INLINE\s+NOT_TAIL_CALLED\b[^;{()]*?\b([A-Za-z_]\w*)\s*\(/g)].map(found => found[1]),
    );
    for (const { index } of text.matchAll(/\bAOT_OPERATION_BEGIN_IN_FRAME\s*\(/g)) {
      const header = /([A-Za-z_]\w*)\s*\([^{};]*\)\s*\{\s*$/.exec(text.slice(0, index))?.[1];
      begun.push(`${name}: ${header}`);
      if (!header || !called.has(header))
        wrong.push(`${name}:${lineOf(text, index)}: ${header} begins an operation in the frame of its caller`);
    }
    for (const { index, 0: found } of text.matchAll(/\bAOT_OPERATION_FRAME_RECORD\s*\(\s*\)/g)) {
      // A word of the record is read on the spot.
      if (/^\s*->/.test(text.slice(index + found.length))) continue;
      const callee = calleeAround(text, index);
      if (callee === undefined || keepTheFrame.has(callee)) continue;
      handed.push(`${name}: ${callee}`);
      if (!called.has(callee))
        wrong.push(`${name}:${lineOf(text, index)}: ${callee} is handed the frame record of an operation`);
    }
  }
  expect(wrong).toEqual([]);
  // The check has found what it is about.
  expect(begun.length).toBeGreaterThanOrEqual(3);
  expect(new Set(handed)).toEqual(new Set(begun));
});
