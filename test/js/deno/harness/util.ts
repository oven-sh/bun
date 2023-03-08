import { concatArrayBuffers } from "bun";

export function concat(...buffers: Uint8Array[]): Uint8Array {
  return new Uint8Array(concatArrayBuffers(buffers));
}
