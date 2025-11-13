process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const tls = require("tls");

const asyncLocalStorage = new AsyncLocalStorage();

asyncLocalStorage.run({ test: "tls.connect" }, () => {
  const socket = tls.connect(
    443,
    "example.com",
    {
      rejectUnauthorized: true,
    },
    () => {
      if (asyncLocalStorage.getStore()?.test !== "tls.connect") {
        console.error("FAIL: tls.connect callback lost context");
        socket.destroy();
        process.exit(1);
      }
      socket.destroy();
      process.exit(0);
    },
  );

  socket.on("error", () => {
    // Skip test if network is unavailable
    process.exit(0);
  });
});
