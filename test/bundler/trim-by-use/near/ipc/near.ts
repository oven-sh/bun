process.emitWarning === undefined;
console.log(typeof process.pid, typeof process.env.NODE_CHANNEL_FD, typeof process.exit, typeof process.nextTick);
setTimeout(() => console.log("done"), 1);
