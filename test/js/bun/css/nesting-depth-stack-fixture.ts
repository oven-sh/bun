// Parses nested `@media` blocks on a Worker thread, which gets the same
// fixed-size stack as the bundler's pool threads, at increasing depths until
// the parser runs out of stack and starts rejecting the input (wherever this
// build's frame sizes put that point), then at every single depth around that
// point, so that the edge is hit at every alignment. Each stylesheet must
// either parse or be rejected with the nesting error; a stack overflow
// anywhere kills the whole process, which is what the test checks for.
import { cssInternals } from "bun:internal-for-testing";

declare const self: Worker;

const NESTING_ERROR = "Maximum CSS nesting depth exceeded";
// 511 `@media` blocks plus the style rule inside them is exactly the parser's
// 512-block depth cap, so the cap never triggers here: every rejection comes
// from the stack check.
const MAX_DEPTH = 511;
const COARSE_STEP = 16;
const DEPTHS_PAST_THE_EDGE = 4;
// Declarations whose values contain no functions: a function would get a
// stack check of its own, while these are parsed entirely below the check of
// the block that contains them, so they are what that check must leave room
// for. Shorthands like `mask` are the deepest such parses.
const leaves = ["color: red", "mask: url() center / contain no-repeat"];

function isRejected(depth: number): boolean {
  const open = "@media screen {".repeat(depth);
  const close = "}".repeat(depth);
  let rejected = false;
  for (const leaf of leaves) {
    try {
      cssInternals.minifyTest(`${open}.a{${leaf}}${close}`, "", undefined);
    } catch (error) {
      if (!String(error).includes(NESTING_ERROR)) throw error;
      rejected = true;
    }
  }
  return rejected;
}

if (Bun.isMainThread) {
  const worker = new Worker(import.meta.url);
  worker.onmessage = (event: MessageEvent) => {
    console.log(JSON.stringify(event.data));
    process.exit(0);
  };
  worker.onerror = (event: ErrorEvent) => {
    console.error(event.message);
    process.exit(1);
  };
} else {
  let firstRejectedDepth: number | null = null;
  for (let depth = COARSE_STEP; ; depth = Math.min(depth + COARSE_STEP, MAX_DEPTH)) {
    if (isRejected(depth)) {
      firstRejectedDepth = depth;
      break;
    }
    if (depth === MAX_DEPTH) break;
  }
  const rejectedDepths: number[] = [];
  let lastDepthTried = MAX_DEPTH;
  if (firstRejectedDepth !== null) {
    lastDepthTried = Math.min(firstRejectedDepth + DEPTHS_PAST_THE_EDGE, MAX_DEPTH);
    for (let depth = firstRejectedDepth - COARSE_STEP + 1; depth <= lastDepthTried; depth++) {
      if (isRejected(depth)) rejectedDepths.push(depth);
    }
  }
  self.postMessage({ firstRejectedDepth, rejectedDepths, lastDepthTried });
}
