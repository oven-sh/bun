process.emitWarning("x".repeat(1_000_000));
process.emitWarning("second");
await new Promise(resolve => setTimeout(resolve, 50));
console.log("done");
