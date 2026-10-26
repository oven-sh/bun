// The `jsc` shell puts these functions on its global object. The table of built-ins that the compiler goes by is Bun's, which has none of them, and a global that the table does not list
// and the program does not add is not there: `typeof aotOperationCount` is "undefined" when the program is built. quick.py compiles this file beside a program, as an entry point that
// never starts. It adds the names, so the compiler leaves the question to the run.
globalThis.aotOperationCount = globalThis.aotOperationCount;
globalThis.aotRuntimeCounters = globalThis.aotRuntimeCounters;
globalThis.aotBuiltinEntries = globalThis.aotBuiltinEntries;
globalThis.memoryUsageStatistics = globalThis.memoryUsageStatistics;
globalThis.$262 = globalThis.$262;
