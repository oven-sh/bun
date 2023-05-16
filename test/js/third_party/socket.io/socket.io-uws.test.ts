
// import { App, us_socket_local_port, us_listen_socket_close } from "uWebSockets.js";
// uWS throws an error when trying to import it
import { Server } from "socket.io";
import { io as ioc, Socket as ClientSocket } from "socket.io-client";
import request from "supertest";
import { describe, it, expect, beforeEach, afterEach } from "bun:test";

const createPartialDone = (done: (err?: Error) => void, count: number) => {
  let i = 0;
  return () => {
    if (++i === count) {
      done();
    } else if (i > count) {
      done(new Error(`partialDone() called too many times: ${i} > ${count}`));
    }
  };
};

const shouldNotHappen = done => () => done(new Error("should not happen"));

describe("socket.io with uWebSocket.js-based engine", () => {
  let io: Server,
    uwsSocket: any,
    port: number,
    client: ClientSocket,
    clientWSOnly: ClientSocket,
    clientPollingOnly: ClientSocket,
    clientCustomNamespace: ClientSocket;

  beforeEach(done => {
    const app = App();
    io = new Server();
    io.attachApp(app);

    io.of("/custom");

    app.listen(0, listenSocket => {
      uwsSocket = listenSocket;
      port = us_socket_local_port(listenSocket);

      client = ioc(`http://localhost:${port}`);
      clientWSOnly = ioc(`http://localhost:${port}`, {
        transports: ["websocket"],
      });
      clientPollingOnly = ioc(`http://localhost:${port}`, {
        transports: ["polling"],
      });
      clientCustomNamespace = ioc(`http://localhost:${port}/custom`);
    });

    const partialDone = createPartialDone(done, 4);
    client.on("connect", partialDone);
    clientWSOnly.once("connect", partialDone);
    clientPollingOnly.on("connect", partialDone);
    clientCustomNamespace.on("connect", partialDone);
  });

  afterEach(() => {
    io.close();
    us_listen_socket_close(uwsSocket);

    client.disconnect();
    clientWSOnly.disconnect();
    clientPollingOnly.disconnect();
    clientCustomNamespace.disconnect();
  });

  it.skip("should broadcast", done => {
    const partialDone = createPartialDone(done, 3);

    client.on("hello", partialDone);
    clientWSOnly.on("hello", partialDone);
    clientPollingOnly.on("hello", partialDone);
    clientCustomNamespace.on("hello", shouldNotHappen(done));

    io.emit("hello");
  });

  it.skip("should broadcast in a namespace", done => {
    client.on("hello", shouldNotHappen(done));
    clientWSOnly.on("hello", shouldNotHappen(done));
    clientPollingOnly.on("hello", shouldNotHappen(done));
    clientCustomNamespace.on("hello", done);

    io.of("/custom").emit("hello");
  });

  it.skip("should broadcast in a dynamic namespace", done => {
    const dynamicNamespace = io.of(/\/dynamic-\d+/);
    const dynamicClient = clientWSOnly.io.socket("/dynamic-101");

    dynamicClient.on("connect", () => {
      dynamicNamespace.emit("hello");
    });

    dynamicClient.on("hello", () => {
      dynamicClient.disconnect();
      done();
    });
  });

  it.skip("should broadcast binary content", done => {
    const partialDone = createPartialDone(done, 3);

    client.on("hello", partialDone);
    clientWSOnly.on("hello", partialDone);
    clientPollingOnly.on("hello", partialDone);
    clientCustomNamespace.on("hello", shouldNotHappen(done));

    io.emit("hello", Buffer.from([1, 2, 3]));
  });

  it.skip("should broadcast volatile packet with binary content", done => {
    const partialDone = createPartialDone(done, 3);

    client.on("hello", partialDone);
    clientWSOnly.on("hello", partialDone);
    clientPollingOnly.on("hello", partialDone);
    clientCustomNamespace.on("hello", shouldNotHappen(done));

    // wait to make sure there are no packets being sent for opening the connection
    setTimeout(() => {
      io.volatile.emit("hello", Buffer.from([1, 2, 3]));
    }, 20);
  });

  it.skip("should broadcast in a room", done => {
    const partialDone = createPartialDone(done, 2);

    client.on("hello", shouldNotHappen(done));
    clientWSOnly.on("hello", partialDone);
    clientPollingOnly.on("hello", partialDone);
    clientCustomNamespace.on("hello", shouldNotHappen(done));

    io.of("/").sockets.get(clientWSOnly.id)!.join("room1");
    io.of("/").sockets.get(clientPollingOnly.id)!.join("room1");

    io.to("room1").emit("hello");
  });

  it.skip("should broadcast in multiple rooms", done => {
    const partialDone = createPartialDone(done, 2);

    client.on("hello", shouldNotHappen(done));
    clientWSOnly.on("hello", partialDone);
    clientPollingOnly.on("hello", partialDone);
    clientCustomNamespace.on("hello", shouldNotHappen(done));

    io.of("/").sockets.get(clientWSOnly.id)!.join("room1");
    io.of("/").sockets.get(clientPollingOnly.id)!.join("room2");

    io.to(["room1", "room2"]).emit("hello");
  });

  it.skip("should broadcast in all but a given room", done => {
    const partialDone = createPartialDone(done, 2);

    client.on("hello", partialDone);
    clientWSOnly.on("hello", partialDone);
    clientPollingOnly.on("hello", shouldNotHappen(done));
    clientCustomNamespace.on("hello", shouldNotHappen(done));

    io.of("/").sockets.get(clientWSOnly.id)!.join("room1");
    io.of("/").sockets.get(clientPollingOnly.id)!.join("room2");

    io.except("room2").emit("hello");
  });

  it.skip("should work even after leaving room", done => {
    const partialDone = createPartialDone(done, 2);

    client.on("hello", partialDone);
    clientWSOnly.on("hello", shouldNotHappen(done));
    clientPollingOnly.on("hello", partialDone);
    clientCustomNamespace.on("hello", shouldNotHappen(done));

    io.of("/").sockets.get(client.id)!.join("room1");
    io.of("/").sockets.get(clientPollingOnly.id)!.join("room1");

    io.of("/").sockets.get(clientWSOnly.id)!.join("room1");
    io.of("/").sockets.get(clientWSOnly.id)!.leave("room1");

    io.to("room1").emit("hello");
  });

  it.skip("should not crash when socket is disconnected before the upgrade", done => {
    client.on("disconnect", () => done());

    io.of("/").sockets.get(client.id)!.disconnect();
  });

  it.skip("should serve static files", done => {
    const clientVersion = require("socket.io-client/package.json").version;

    request(`http://localhost:${port}`)
      .get("/socket.io/socket.io.js")
      .buffer(true)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.headers["content-type"]).toBe("application/javascript; charset=utf-8");
        expect(res.headers.etag).toBe('"' + clientVersion + '"');
        expect(res.headers["x-sourcemap"]).toBe(undefined);
        expect(res.text).toMatch(/engine\.io/);
        expect(res.status).toBe(200);
        done();
      });
  });
});
