function createOptions(type, message, closeOnDone) {
  let buffers = [];
  let report = function () {
    report = function () {};
    const data = new Uint8Array(
      buffers.reduce(function (sum, buffer) {
        return sum + buffer.length;
      }, 0),
    );
    buffers.reduce(function (offset, buffer) {
      data.set(buffer, offset);
      return offset + buffer.length;
    }, 0);
    console.log(type, "GOT", new TextDecoder().decode(data));
  };

  let done = closeOnDone
    ? function (socket, sent) {
        socket.data[sent ? "sent" : "received"] = true;
        if (socket.data.sent && socket.data.received) {
          done = function () {};
          closeOnDone(socket);
        }
      }
    : function () {};

  function drain(socket) {
    const message = socket.data.message;
    const written = socket.write(message);
    if (written < message.length) {
      socket.data.message = message.slice(written);
    } else {
      done(socket, true);
    }
  }

  return {
    // we don't use localhost here to ensure that only one connection is made
    // because we perform exact matching on the printed output
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      close() {
        report();
        console.log(type, "CLOSED");
      },
      data(socket, buffer) {
        buffers.push(buffer);
        done(socket);
      },
      drain: drain,
      // end() {
      //   report();
      //   console.log(type, "ENDED");
      // },
      error(socket, err) {
        console.log(type, "ERRED", err);
      },
      open(socket) {
        console.log(type, "OPENED");
        drain(socket);
      },
    },
    data: {
      sent: false,
      received: false,
      message: message,
    },
  };
}

const server = Bun.listen(
  createOptions("[Server]", "response", socket => {
    server.stop();
    socket.end();
  }),
);

const socket = await Bun.connect({
  ...createOptions("[Client]", "request"),
  port: server.port,
});
