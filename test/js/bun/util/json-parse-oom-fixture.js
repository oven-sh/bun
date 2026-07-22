// Force JSON.parse to hit allocator failure for its string-value copy.
// Prepare a quoted JSON input of N bytes, then fill remaining address
// space with buffers >= N/4 so an N-byte allocation cannot succeed while
// smaller allocations (thread stacks, GC bookkeeping) still can.
//
// Outcomes, written to stdout:
//   SETUP-FAIL  the address-space limit was too tight to build the input
//   INPUT-OK    input built; JSON.parse is about to run
//   PARSED      JSON.parse succeeded (enough memory for the copy)
//   CAUGHT:<name>:<message>   JSON.parse threw
const N = Number(process.argv[2]);
let buf;
try {
  buf = Buffer.alloc(N + 2, 0x78);
} catch {
  process.stdout.write("SETUP-FAIL\n");
  process.exit(2);
}
buf[0] = 0x22;
buf[N + 1] = 0x22;
let input;
try {
  input = buf.toString("latin1");
} catch {
  process.stdout.write("SETUP-FAIL\n");
  process.exit(2);
}
buf = null;

const filler = [];
let chunk = N;
const floor = N >> 2;
while (chunk >= floor) {
  try {
    filler.push(Buffer.alloc(chunk));
  } catch {
    chunk = chunk >> 1;
  }
}
process.stdout.write("INPUT-OK\n");

try {
  JSON.parse(input);
  process.stdout.write("PARSED\n");
  process.exit(1);
} catch (e) {
  process.stdout.write("CAUGHT:" + e.name + ":" + e.message + "\n");
  process.exit(0);
}
