process.emitWarning("descriptor 2 takes this at once");
await new Promise(resolve => setTimeout(resolve, 20));
console.error("to stderr");
console.log("done");
