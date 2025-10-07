interface Socket<T = any> {
  data: T;
  write(data: string | Buffer): void;
}

const enum FramerState {
  WaitingForLength,
  WaitingForMessage,
}

let socketFramerMessageLengthBuffer: Buffer;
export class SocketFramer {
  private state: FramerState = FramerState.WaitingForLength;
  private pendingLength: number = 0;
  private sizeBuffer: Buffer = Buffer.alloc(0);
  private sizeBufferIndex: number = 0;
  private bufferedData: Buffer = Buffer.alloc(0);

  constructor(private onMessage: (message: string) => void) {
    if (!socketFramerMessageLengthBuffer) {
      socketFramerMessageLengthBuffer = Buffer.alloc(4);
    }
    this.reset();
  }

  reset(): void {
    this.state = FramerState.WaitingForLength;
    this.bufferedData = Buffer.alloc(0);
    this.sizeBufferIndex = 0;
    this.sizeBuffer = Buffer.alloc(4);
  }

  send(socket: Socket, data: string): void {
    socketFramerMessageLengthBuffer.writeUInt32BE(Buffer.byteLength(data), 0);
    socket.write(socketFramerMessageLengthBuffer);
    socket.write(data);
  }

  onData(socket: Socket, data: Buffer): void {
    this.bufferedData = this.bufferedData.length > 0 ? Buffer.concat([this.bufferedData, data]) : data;

    let messagesToDeliver: string[] = [];

    while (this.bufferedData.length > 0) {
      if (this.state === FramerState.WaitingForLength) {
        if (this.sizeBufferIndex + this.bufferedData.length < 4) {
          const remainingBytes = Math.min(4 - this.sizeBufferIndex, this.bufferedData.length);
          this.bufferedData.copy(this.sizeBuffer, this.sizeBufferIndex, 0, remainingBytes);
          this.sizeBufferIndex += remainingBytes;
          this.bufferedData = this.bufferedData.slice(remainingBytes);
          break;
        }

        const remainingBytes = 4 - this.sizeBufferIndex;
        this.bufferedData.copy(this.sizeBuffer, this.sizeBufferIndex, 0, remainingBytes);
        this.pendingLength = this.sizeBuffer.readUInt32BE(0);

        this.state = FramerState.WaitingForMessage;
        this.sizeBufferIndex = 0;
        this.bufferedData = this.bufferedData.slice(remainingBytes);
      }

      if (this.bufferedData.length < this.pendingLength) {
        break;
      }

      const message = this.bufferedData.toString("utf-8", 0, this.pendingLength);
      this.bufferedData = this.bufferedData.slice(this.pendingLength);
      this.state = FramerState.WaitingForLength;
      this.pendingLength = 0;
      this.sizeBufferIndex = 0;
      messagesToDeliver.push(message);
    }

    for (const message of messagesToDeliver) {
      this.onMessage(message);
    }
  }
}
