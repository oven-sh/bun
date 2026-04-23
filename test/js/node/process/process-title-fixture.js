
const title = "modified-" + (process.argv[2] || "bun-process-title-test");
process.title = title;
console.log("READY");
setInterval(() => {}, 100000); // Keep alive
