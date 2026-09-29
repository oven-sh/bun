import * as Bun from "bun";
import { expectType } from "./utilities";

const socket = await Bun.udpSocket({
  port: 0,
});

expectType(socket.hostname).is<string>();
expectType(socket.port).is<number>();
expectType(socket.address).is<Bun.SocketAddress>();
expectType(socket.binaryType).is<Bun.BinaryType>();
expectType(socket.closed).is<boolean>();

expectType(socket.send("Hello", 41234, "127.0.0.1")).is<boolean>();
expectType(socket.send(new Uint8Array([1, 2, 3]), 41234, "127.0.0.1")).is<boolean>();
expectType(socket.sendMany(["Hello", 41234, "127.0.0.1", "World", 41235, "127.0.0.2"])).is<number>();

expectType(socket.setBroadcast(true)).is<boolean>();
expectType(socket.setTTL(64)).is<number>();
expectType(socket.setMulticastTTL(2)).is<number>();
expectType(socket.setMulticastLoopback(true)).is<boolean>();
expectType(socket.setMulticastInterface("192.168.1.100")).is<boolean>();

expectType(socket.addMembership("224.0.0.1")).is<boolean>();
expectType(socket.addMembership("224.0.0.1", "192.168.1.100")).is<boolean>();
expectType(socket.dropMembership("224.0.0.1")).is<boolean>();
expectType(socket.dropMembership("224.0.0.1", "192.168.1.100")).is<boolean>();

expectType(socket.addSourceSpecificMembership("10.0.0.1", "232.0.0.1")).is<boolean>();
expectType(socket.addSourceSpecificMembership("10.0.0.1", "232.0.0.1", "192.168.1.100")).is<boolean>();
expectType(socket.dropSourceSpecificMembership("10.0.0.1", "232.0.0.1")).is<boolean>();
expectType(socket.dropSourceSpecificMembership("10.0.0.1", "232.0.0.1", "192.168.1.100")).is<boolean>();

expectType(socket.ref()).is<void>();
expectType(socket.unref()).is<void>();

expectType(socket.close()).is<void>();

const connectedSocket = await Bun.udpSocket({
  port: 0,
  connect: {
    hostname: "127.0.0.1",
    port: 41234,
  },
});

expectType(connectedSocket.remoteAddress).is<Bun.SocketAddress>();

expectType(connectedSocket.send("Hello")).is<boolean>();
expectType(connectedSocket.send(new Uint8Array([1, 2, 3]))).is<boolean>();
expectType(connectedSocket.sendMany(["Hello", "World"])).is<number>();

expectType(connectedSocket.setBroadcast(false)).is<boolean>();
expectType(connectedSocket.setTTL(128)).is<number>();
expectType(connectedSocket.setMulticastTTL(1)).is<number>();
expectType(connectedSocket.setMulticastLoopback(false)).is<boolean>();

connectedSocket.close();

const socketWithHandlers = await Bun.udpSocket({
  port: 0,
  socket: {
    data(socket, data, port, address, flags) {
      expectType(socket).is<Bun.udp.Socket<"buffer">>();
      expectType(data).is<Buffer>();
      expectType(port).is<number>();
      expectType(address).is<string>();
      expectType(flags).is<Bun.udp.ReceiveFlags>();
    },
    drain(socket) {
      expectType(socket).is<Bun.udp.Socket<"buffer">>();
    },
    error(socket, error) {
      expectType(socket).is<Bun.udp.Socket<"buffer">>();
      expectType(error).is<Error>();
    },
  },
});

expectType(socketWithHandlers).is<Bun.udp.Socket<"buffer">>();

const connectedSocketHandlers: Bun.udp.ConnectedSocketHandler<"buffer"> = {
  data(socket, data, port, address, flags) {
    expectType(socket).is<Bun.udp.ConnectedSocket<"buffer">>();
    expectType(data).is<Buffer>();
    expectType(port).is<number>();
    expectType(address).is<string>();
    expectType(flags).is<Bun.udp.ReceiveFlags>();
  },
  drain(socket) {
    expectType(socket).is<Bun.udp.ConnectedSocket<"buffer">>();
  },
  error(socket, error) {
    expectType(socket).is<Bun.udp.ConnectedSocket<"buffer">>();
    expectType(error).is<Error>();
  },
};

const connectedSocketWithHandlers = await Bun.udpSocket({
  port: 0,
  connect: {
    hostname: "127.0.0.1",
    port: 41234,
  },
  socket: connectedSocketHandlers,
});

expectType(connectedSocketWithHandlers).is<Bun.udp.ConnectedSocket<"buffer">>();

// The example in docs/runtime/networking/udp.mdx: handlers written inline on a connected socket.
await Bun.udpSocket({
  connect: {
    hostname: "127.0.0.1",
    port: 41234,
  },
  socket: {
    error(socket, error: Bun.SystemError) {
      expectType(error.code).is<string | undefined>();
      // @ts-expect-error `socket` has the type of an unconnected socket here: https://github.com/oven-sh/bun/issues/44272
      socket.send("Hello");
    },
  },
});

const errorFirstHandlers: Bun.udp.SocketHandler<"buffer"> = {
  // @ts-expect-error The socket is the first argument. The error is the second.
  error(error: Error) {},
};
