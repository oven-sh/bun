// Found by a fuzzer: five programs in one executable, of which the first runs. It takes node:querystring from process.getBuiltinModule by apply, under a name put together at run time, and calls `stringify` under a computed key.
// Another of the five takes node:os from require by apply, in the same way, and calls what it finds without an operand. The compiler saw only that second call reach `stringify`, typed its parameter by it, and the first program got "" for "a=4294967296".
const programs = {
  0: () => import("./p0.js"),
  1: () => import("./p1.js"),
  2: () => import("./p2.js"),
  3: () => import("./p3.js"),
  4: () => import("./p4.js"),
};
await programs[process.argv[2] ?? 0]();
