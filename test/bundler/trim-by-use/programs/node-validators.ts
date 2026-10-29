import { setMaxListeners, EventEmitter } from "node:events";
import { createServer } from "node:net";
try {
  setMaxListeners(-1, new EventEmitter());
} catch (error: any) {
  console.log(error.code);
}
try {
  createServer().listen(99999999);
} catch (error: any) {
  console.log(error.code);
}
try {
  Buffer.alloc(4).readInt8(9);
} catch (error: any) {
  console.log(error.code);
}
