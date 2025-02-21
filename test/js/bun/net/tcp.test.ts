import { SocketHandler } from "bun";
import type { Mock } from "bun:test";
import { jest, describe, test, expect } from "bun:test";

class MockSocket<Data = void> implements SocketHandler<Data> {
  open = jest.fn();
  handshake = jest.fn();
  close = jest.fn();
  error = jest.fn();
  end = jest.fn();
  data = jest.fn();
  drain = jest.fn();

  events: string[];

  constructor() {
    this.events = [];
    for (const method of Object.keys(this)) {
      if (this[method]._isMockFunction) {
        (this[method] as Mock<any>).mockImplementation(() => {
          this.events.push(method);
        });
      }
    }
  }

  public mockClear() {
    for (const method of Object.keys(this)) {
      if ("mockClear" in this[method]) {
        (this[method] as Mock<any>).mockClear();
      }
    }
  }
}

const nextEventLoopCycle = () => new Promise(resolve => setTimeout(resolve, 0));
const nextTick = () => new Promise(resolve => process.nextTick(resolve));

test("open() event timing", async () => {
  const socket = { server: new MockSocket(), client: new MockSocket() };

  using server = Bun.listen({
    port: 1234,
    hostname: "localhost",
    socket: socket.server,
  });

  // just starting a server doesn't trigger any events
  await nextEventLoopCycle();
  expect(socket.server.events).toBeEmpty();
  expect(socket.client.events).toBeEmpty();

  const clientPromise = Bun.connect({
    port: 1234,
    hostname: "localhost",
    socket: socket.client,
  });
  expect(socket.client.open).not.toHaveBeenCalled();
  await nextTick();
  expect(socket.client.open).not.toHaveBeenCalled();

  // Promise resolves when client connects. Server's open only fires when
  // event loop polls for events again and finds a connection event on the
  // server socket
  using client = await clientPromise;
  expect(socket.client.open).toHaveBeenCalled();
  expect(socket.server.open).not.toHaveBeenCalled();

  // next tick loop gets drained before event loop polls again. This check makes
  // sure that open(), indeed, only fires in the next event loop cycle
  await nextTick();
  expect(socket.server.open).not.toHaveBeenCalled();

  await nextEventLoopCycle();
  expect(socket.server.open).toHaveBeenCalled();
  expect(socket.client.open).toHaveBeenCalled();
});
