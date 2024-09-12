// All ints are little endian unsigned 32 bit integers
// There are only uint32 integers and UTF-8 strings
// Each message starts with the byte length of the message
// Then, the message type, which is a 4 byte unsigned integer (as all ints are)
// Then, the message data
import { Socket } from "node:net";
export const enum MessageType {
  TestStart,
  TestEnd,
  ModuleStart,
  CoverageReport,
  CoverageFileReport,
}

export const enum TestStatus {
  pending,
  pass,
  fail,
  skip,
  todo,
  fail_because_todo_passed,
  fail_because_expected_has_assertions,
  fail_because_expected_assertion_count,
}

function readString(data: Buffer, offset: number) {
  const length = data.readUint32LE(offset);
  offset += 4;
  return data.toString("utf8", offset, offset + length);
}

export class ModuleStart {
  id: number;
  path: string;

  constructor(id: number, path: string) {
    this.id = id;
    this.path = path;
  }

  tag: MessageType.ModuleStart = MessageType.ModuleStart;

  static decode(data: Buffer, offset: number): ModuleStart {
    const id = data.readUint32LE(offset);
    offset += 4;
    const path = readString(data, offset);
    const result = new ModuleStart(id, path);
    return result;
  }
}

export class TestStart {
  id: number;
  parent_id: number;
  module_id: number;
  byteOffset: number;
  byteLength: number;
  label: string;

  constructor(id: number, parent_id: number, module_id: number, byteOffset: number, byteLength: number, label: string) {
    this.id = id;
    this.parent_id = parent_id;
    this.module_id = module_id;
    this.byteOffset = byteOffset;
    this.byteLength = byteLength;
    this.label = label;
  }

  tag: MessageType.TestStart = MessageType.TestStart;

  static decode(data: Buffer, offset: number) {
    const id = data.readUint32LE(offset);
    offset += 4;
    const parent_id = data.readUint32LE(offset);
    offset += 4;
    const module_id = data.readUint32LE(offset);
    offset += 4;
    const byteOffset = data.readUint32LE(offset);
    offset += 4;
    const byteLength = data.readUint32LE(offset);
    offset += 4;
    const label = readString(data, offset);
    return new TestStart(id, parent_id, module_id, byteOffset, byteLength, label);
  }
}

export class TestEnd {
  id: number;
  status: TestStatus;
  duration_ms: number;
  expectation_count: number;

  constructor(id: number, status: TestStatus, duration_ms: number, expectation_count: number) {
    this.id = id;
    this.status = status;
    this.duration_ms = duration_ms;
    this.expectation_count = expectation_count;
  }

  tag: MessageType.TestEnd = MessageType.TestEnd;

  static decode(data: Buffer, offset: number) {
    return new TestEnd(
      data.readUint32LE(0 + offset),
      data.readUint32LE(4 + offset),
      data.readUint32LE(8 + offset),
      data.readUint32LE(12 + offset),
    );
  }
}

export class Decoder {
  read(data: Buffer, offset: number, length: number): TestStart | TestEnd | ModuleStart | undefined {
    if (length < 4) {
      throw new Error("Not enough data to read. Must have at least 4 bytes.");
    }

    const tag = data.readUint32LE(offset);
    switch (tag) {
      case MessageType.TestStart:
        return TestStart.decode(data, offset + 4);
      case MessageType.TestEnd:
        return TestEnd.decode(data, offset + 4);
      case MessageType.ModuleStart:
        return ModuleStart.decode(data, offset + 4);
      default: {
        throw new Error(`Unknown message type: ${tag}`);
      }
    }
  }
}

export async function listenOnSocket(socket: Socket) {
  const decoder = new Decoder();
  let promise, resolve, reject;
  let buffer = Buffer.alloc(16 * 1024);
  let bufferLength = 0;
  let read = 0;

  promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const resumeFn = () => {
    drain();
    if (queue.length > 0) {
      resolve(queue);
    }
  };

  function onData(data: Buffer) {
    data.copy(buffer, bufferLength);
    bufferLength += data.length;
    resumeFn();
  }

  socket.on("data", onData);

  function onClose() {
    socket.off("data", onData);
    isClosed = true;
    resolve();
  }

  socket.once("close", onClose);
  socket.once("end", onClose);

  var queue: Message[] = [];
  var isClosed = false;

  function drainOne() {
    const readable = bufferLength - read;
    if (readable < 8) return;

    const messageLength = buffer.readUint32LE(read);
    const offset = read + 4;
    if (readable < messageLength) return;
    read += messageLength;
    if (read >= bufferLength) {
      buffer.copyWithin(0, read, bufferLength);
      read = 0;
      bufferLength = 0;
    }
    return decoder.read(buffer, offset, messageLength);
  }

  function drain() {
    while (!isClosed) {
      const message = drainOne();
      if (message) {
        queue.push(message);
      } else {
        break;
      }
    }
  }

  return async function* () {
    while (true) {
      await promise;
      promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });
      const messages = queue;
      queue = [];
      if (messages.length === 0) {
        return;
      }
      yield* messages;
    }
  };
}

export class CoverageReport {
  constructor(public data: Buffer) {}

  tag: MessageType.CoverageReport = MessageType.CoverageReport;
}

export class CoverageFileReport {
  constructor(public data: Buffer) {}

  tag: MessageType.CoverageFileReport = MessageType.CoverageFileReport;
}

export type Message = TestStart | TestEnd | ModuleStart | CoverageReport | CoverageFileReport;
