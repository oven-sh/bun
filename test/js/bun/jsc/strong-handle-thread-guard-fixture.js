import { jscInternals } from "bun:internal-for-testing";

// Violates the strong-handle thread-affinity contract on purpose; in a debug
// build the assertion must abort the process inside this call.
jscInternals.crossThreadStrongHandleMutation(process.argv[2]);

console.log("survived");
