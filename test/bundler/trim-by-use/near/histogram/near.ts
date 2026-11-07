console.log(typeof performance.now(), performance.timeOrigin > 0);
const started = process.hrtime.bigint();
console.log(typeof started, process.hrtime().length);
