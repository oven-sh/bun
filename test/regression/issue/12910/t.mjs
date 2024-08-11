// Test should fail if thrown exception is not caught
process.exitCode = 1;

try {
  import("./t3.mjs");
  require("./t3.mjs");
} catch (e) {
  console.log(e);
  process.exitCode = 0;
}
