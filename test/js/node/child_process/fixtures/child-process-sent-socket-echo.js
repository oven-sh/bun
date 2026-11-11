process.on("message", (message, socket) => process.send(message, socket));
