// The `jsc` shell puts these functions on its global object. The table of built-ins that the compiler goes by is Bun's, which has none of them, and a global that the table does not list
// and the program does not add is not there: `typeof aotOperationCount` is "undefined" when the program is built. quick.py compiles this file beside a program, as an entry point that
// never starts. It adds the names, and what it stores under them comes from where the compiler does not follow it: whether there is a function, `f ?? g` and what `f()` answers are left to the run.
const unknown = JSON.parse("{}", function () {
  return this;
});
globalThis.aotOperationCount = unknown.aotOperationCount;
globalThis.aotRuntimeCounters = unknown.aotRuntimeCounters;
globalThis.aotBuiltinEntries = unknown.aotBuiltinEntries;
globalThis.memoryUsageStatistics = unknown.memoryUsageStatistics;
globalThis.$262 = unknown.$262;
