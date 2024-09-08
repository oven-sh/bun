//#FILE: test-http-client-read-in-error.js
//#SHA1: a7bd75283f46ff8f1246208c72bf0773a27f0fb0
//-----------------
"use strict";

const net = require("net");
const http = require("http");

class Agent extends http.Agent {
  createConnection() {
    const socket = new net.Socket();

    socket.on("error", function () {
      socket.push("HTTP/1.1 200\r\n\r\n");
    });

    let onNewListener;
    socket.on(
      "newListener",
      (onNewListener = name => {
        if (name !== "error") return;
        socket.removeListener("newListener", onNewListener);

        // Let other listeners to be set up too
        process.nextTick(() => {
          this.breakSocket(socket);
        });
      }),
    );

    return socket;
  }

  breakSocket(socket) {
    socket.emit("error", new Error("Intentional error"));
  }
}

test("http client read in error", () => {
  const agent = new Agent();
  const dataHandler = jest.fn();

  const request = http.request({ agent });

  request.once("error", function () {
    console.log("ignore");
    this.on("data", dataHandler);
  });

  return new Promise(resolve => {
    // Give some time for the 'data' event to potentially be called
    setTimeout(() => {
      expect(dataHandler).not.toHaveBeenCalled();
      resolve();
    }, 100);
  });
});

//<#END_FILE: test-http-client-read-in-error.js
