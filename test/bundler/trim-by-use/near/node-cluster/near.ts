import { EventEmitter } from "node:events";
const emitter = new EventEmitter();
emitter.on("x", value => console.log(value));
emitter.emit("x", 1);
