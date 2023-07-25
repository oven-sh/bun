import * as Comlink from "comlink";
const obj = {
  counter: 0,
  inc() {
    this.counter++;
  },
};

Comlink.expose(obj);
