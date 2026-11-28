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

await Bun.udpSocket({
  socket: {
    error(error) {
      expectType(this).is<Bun.udp.Socket<"buffer">>();
      expectType(error).is<Bun.udp.SocketError>();
      expectType(error.code).is<string | undefined>();
      expectType(error.errno).is<number | undefined>();
      expectType(error.syscall).is<string | undefined>();
      expectType(error.path).is<string | undefined>();
      expectType(error.errqueue).is<boolean | undefined>();
      this.close();
    },
  },
});

await Bun.udpSocket({
  binaryType: "uint8array",
  socket: {
    error: error => {
      expectType(error).is<Bun.udp.SocketError>();
    },
  },
});

await Bun.udpSocket({
  connect: {
    hostname: "127.0.0.1",
    port: 9,
  },
  socket: {
    error(error) {
      expectType(this).is<Bun.udp.ConnectedSocket<"buffer">>();
      expectType(error).is<Bun.udp.SocketError>();
    },
  },
});

await Bun.udpSocket({
  socket: {
    // The failure is the only argument. A second parameter is not the error.
    // @ts-expect-error Target signature provides too few arguments. Expected 2 or more, but got 1.
    error(_socket, _err) {},
  },
});
