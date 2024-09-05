// @ts-nocheck
import type { Server } from "socket.io";
import request from "supertest";

import { Socket as ClientSocket, io as ioc, ManagerOptions, SocketOptions } from "socket.io-client";

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

// TODO: update superagent as latest release now supports promises
export function eioHandshake(httpServer): Promise<string> {
  return new Promise(resolve => {
    request(httpServer)
      .get("/socket.io/")
      .query({ transport: "polling", EIO: 4 })
      .end((err, res) => {
        const sid = JSON.parse(res.text.substring(1)).sid;
        resolve(sid);
      });
  });
}

export function eioPush(httpServer, sid: string, body: string): Promise<void> {
  return new Promise(resolve => {
    request(httpServer)
      .post("/socket.io/")
      .send(body)
      .query({ transport: "polling", EIO: 4, sid })
      .expect(200)
      .end(() => {
        resolve();
      });
  });
}

export function eioPoll(httpServer, sid): Promise<string> {
  return new Promise(resolve => {
    request(httpServer)
      .get("/socket.io/")
      .query({ transport: "polling", EIO: 4, sid })
      .expect(200)
      .end((err, res) => {
        resolve(res.text);
      });
  });
}

export function waitFor<T = unknown>(emitter, event) {
  return new Promise<T>(resolve => {
    emitter.once(event, resolve);
  });
}
