// #22546: an unhandled promise rejection while the entry module is suspended
// in top-level await must stop evaluation (node/deno parity).
const sleep = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => void Promise.reject(new Error("rejected-during-tla")), 1);
for (let i = 0; i < 50; i++) await sleep(5);
console.log("UNREACHABLE-AFTER-FATAL");
