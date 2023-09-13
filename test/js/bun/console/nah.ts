const stream = Bun.stdin.stream();
const reader1 = stream.getReader();
console.log("reader1", await reader1.read());
reader1.releaseLock();

const reader2 = stream.getReader();
console.log("reader2", await reader2.read());
reader2.releaseLock();
