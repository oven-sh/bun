//#FILE: test-cluster-worker-handle-close.js
//#SHA1: 8aa4bcd8641fe9274b97853b80734ea6f18eafbb
//-----------------
"use strict";
const cluster = require("cluster");
const net = require("net");

if (cluster.isPrimary) {
  test("Primary process", () => {
    cluster.schedulingPolicy = cluster.SCHED_RR;
    expect(cluster.fork).not.toThrow();
  });
} else {
  let server;

  beforeAll(() => {
    server = net.createServer(jest.fn());
  });

  test("Worker process", done => {
    const serverListenSpy = jest.spyOn(server, "listen");
    const netConnectSpy = jest.spyOn(net, "connect");

    server.listen(0, () => {
      expect(serverListenSpy).toHaveBeenCalledTimes(1);
      expect(netConnectSpy).toHaveBeenCalledWith(server.address().port);
      done();
    });
  });

  test("Internal message handling", done => {
    const handleCloseSpy = jest.fn(callback => callback());
    const handle = { close: handleCloseSpy };

    const messageHandler = (message, messageHandle) => {
      if (message.act !== "newconn") {
        return;
      }

      server.close();
      messageHandle.close = jest.fn(() => {
        handleCloseSpy.call(messageHandle, () => {
          expect(handleCloseSpy).toHaveBeenCalledTimes(1);
          process.exit();
        });
      });

      expect(messageHandle.close).toHaveBeenCalledTimes(1);
      done();
    };

    process.prependListener("internalMessage", messageHandler);

    // Simulate an internal message
    process.emit("internalMessage", { act: "newconn" }, handle);
  });
}

//<#END_FILE: test-cluster-worker-handle-close.js
