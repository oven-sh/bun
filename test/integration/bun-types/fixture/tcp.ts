import * as Bun from "bun";
import type { X509Certificate } from "node:crypto";
import { expectType } from "./utilities";

await Bun.connect({
  data: { arg: "asdf" },
  socket: {
    data(socket) {
      socket.data.arg.toLocaleLowerCase();
    },
    open() {
      console.log("asdf");
    },
  },
  hostname: "adsf",
  port: 324,
});

await Bun.connect({
  data: { arg: "asdf" },
  socket: {
    data(socket) {
      socket.data.arg.toLowerCase();
    },
    open() {
      console.log("asdf");
    },
  },
  hostname: "adsf",
  port: 324,
});

await Bun.connect({
  data: { arg: "asdf" },
  socket: {
    data(socket) {
      socket.data.arg.toLowerCase();
    },
    open() {
      console.log("asdf");
    },
  },
  unix: "asdf",
});

await Bun.connect({
  data: { arg: "asdf" },
  socket: {
    data(socket) {
      socket.data.arg.toLowerCase();
    },
    open() {
      console.log("asdf");
    },
  },
  unix: "asdf",
});

Bun.listen({
  data: { arg: "asdf" },
  socket: {
    data(socket) {
      socket.data.arg.toLowerCase();
    },
    open() {
      console.log("asdf");
    },
  },
  hostname: "adsf",
  port: 324,
});

Bun.listen({
  data: { arg: "asdf" },
  socket: {
    data(socket) {
      socket.data.arg.toLowerCase();
    },
    open() {
      console.log("asdf");
    },
  },
  hostname: "adsf",
  port: 324,
  tls: {
    certFile: "asdf",
    keyFile: "adsf",
  },
});

Bun.listen({
  data: { arg: "asdf" },
  socket: {
    data(socket) {
      socket.data.arg.toLowerCase();
    },
    open() {
      console.log("asdf");
    },
  },
  hostname: "adsf",
  port: 324,
  tls: {
    cert: "asdf",
    key: Bun.file("adsf"),
    ca: Buffer.from("asdf"),
    crl: ["asdf", Buffer.from("asdf"), new Uint8Array(1), Bun.file("asdf")],
  },
});

Bun.listen({
  data: { arg: "asdf" },
  socket: {
    data(socket) {
      socket.data.arg.toLowerCase();
    },
    open() {
      console.log("asdf");
    },
  },
  unix: "asdf",
});

const listener = Bun.listen({
  data: { arg: "asdf" },
  socket: {
    data(socket) {
      socket.data.arg.toLowerCase();
    },
    open() {
      console.log("asdf");
    },
  },
  unix: "asdf",
});

listener.data.arg = "asdf";
// @ts-expect-error arg is string
listener.data.arg = 234;

// listener.reload({
//   data: {arg: 'asdf'},
// });

listener.reload({
  socket: {
    open() {},
    // ...listener.
  },
});

// Test Socket.reload() type signature (issue #26290)
// The socket instance's reload() method should also accept { socket: handler }
await Bun.connect({
  data: { arg: "asdf" },
  socket: {
    open(socket) {
      // Socket.reload() should accept { socket: handler }, not handler directly
      socket.reload({
        socket: {
          open() {},
          data() {},
        },
      });
    },
    data() {},
  },
  hostname: "localhost",
  port: 1,
});

// A Unix domain socket has no IP address, and a socket that is not connected has none to read.
// A socket without TLS has no TLS version, no server name and no peer certificate.
Bun.listen({
  socket: {
    open(socket) {
      expectType(socket.remoteFamily).is<"IPv4" | "IPv6" | undefined>();
      expectType(socket.remoteAddress).is<string | undefined>();
      expectType(socket.remotePort).is<number | undefined>();
      expectType(socket.localFamily).is<"IPv4" | "IPv6" | undefined>();
      expectType(socket.localAddress).is<string | undefined>();
      expectType(socket.localPort).is<number | undefined>();
      expectType(socket.getTLSVersion()).is<string | null>();
      expectType(socket.getServername()).is<string | undefined>();
      expectType(socket.getPeerX509Certificate()).is<X509Certificate | undefined>();
    },
    data() {},
  },
  unix: "asdf",
});
