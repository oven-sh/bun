// Test should fail if thrown exception is not caught
process.exitCode = 1;

try {
  // Under the new C++ module loader the dynamic import correctly rejects
  // (instead of staying pending forever) once the require below evaluates the
  // module and it throws. The original #12910 segfault was about the
  // import()+require() race crashing; we still exercise that race, but now
  // handle the spec-compliant rejection so it doesn't surface as an unhandled
  // promise rejection.
  import("./t3.mjs").catch(() => {});
  require("./t3.mjs");
} catch (e) {
  console.log(e);
  process.exitCode = 0;
}
