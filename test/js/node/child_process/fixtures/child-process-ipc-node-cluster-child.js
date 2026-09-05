process.send({ cmd: "NODE_CLUSTER", x: 1 });
process.send({ cmd: "OTHER", y: 2 });
setInterval(() => {}, 1 << 30);
