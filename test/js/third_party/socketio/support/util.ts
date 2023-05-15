import type { Server } from "socket.io";
import { io as ioc, ManagerOptions, Socket as ClientSocket, SocketOptions } from "socket.io-client";

export function createClient(
  io: Server,
  nsp: string = "/",
  opts?: Partial<ManagerOptions & SocketOptions>,
): ClientSocket {
  // @ts-ignore
  const port = io.httpServer.address().port;
  return ioc(`http://localhost:${port}${nsp}`, opts);
}

export function success(done: Function, io: Server, ...clients: ClientSocket[]) {
  io.close();
  clients.forEach(client => client.disconnect());
  done();
}

export function fail(done: Function, io: Server, err: any | unknown, ...clients: ClientSocket[]) {
  io.close();
  clients.forEach(client => client.disconnect());
  done(err);
}

export function getPort(io: Server): number {
  // @ts-ignore
  return io.httpServer.address().port;
}

export function createPartialDone(count: number, done: (err?: Error) => void) {
  let i = 0;
  return () => {
    if (++i === count) {
      done();
    } else if (i > count) {
      done(new Error(`partialDone() called too many times: ${i} > ${count}`));
    }
  };
}
