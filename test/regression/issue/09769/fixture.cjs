// The shape here mirrors TypeScript's `createProgram`: a regular function whose
// body contains an arrow with an object-literal shorthand, and which returns
// closures over locals. The bug caused `arguments` to be stored in the returned
// closure's scope, so `arguments[0]` (the options object, which holds
// `oldProgram`) was retained as long as the returned program lived.
//
// This is a .cjs file so the code runs in sloppy mode, matching how TypeScript's
// typescript.js is loaded in practice (the bug reproduces in strict mode too,
// but sloppy mode is the real-world path).

// `new Function` keeps the exact source away from the transpiler: the
// transpiler may otherwise rewrite `({ x })` in ways that hide or change the
// pattern we are testing JSC's parser against.
const createProgram = new Function(
  "opts",
  `
  const host = {};
  let { oldProgram } = opts;
  oldProgram = void 0;

  const worker = (resolvedTypeReferenceDirective) => ({ resolvedTypeReferenceDirective });

  const program = {
    worker,
    isSourceOfProjectReferenceRedirect,
  };
  return program;

  function isSourceOfProjectReferenceRedirect(f) {
    return host && f;
  }
`,
);

const refs = [];
let prog = createProgram({ oldProgram: undefined, payload: null });

for (let i = 0; i < 64; i++) {
  const opts = {
    oldProgram: prog,
    // Each options object carries a 1 MB payload so retention is unambiguous.
    payload: new Uint8Array(1024 * 1024),
  };
  refs.push(new WeakRef(opts));
  prog = createProgram(opts);
}

Bun.gc(true);
Bun.gc(true);

let alive = 0;
for (const r of refs) if (r.deref()) alive++;

// Before the fix every `opts` object is reachable via the closure's captured
// `arguments`, so `alive` is 64. After the fix only the most recent one or two
// can still be live.
if (alive > 4) {
  console.error(
    `FAIL: ${alive}/64 options objects still alive after GC (closure is retaining \`arguments\`)`,
  );
  process.exit(1);
}

console.log("PASS");
