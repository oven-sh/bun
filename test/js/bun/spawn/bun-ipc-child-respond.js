process.on("message", message => {
  process.send("pong:" + message);
});
