function show(title: string, run: () => unknown): void {
  let result: string;
  try {
    const value = run();
    result = typeof value + " " + (Object.is(value, -0) ? "-0" : String(value));
  } catch (error) {
    result = error instanceof TypeError ? "threw a TypeError" : error instanceof ReferenceError ? "threw a ReferenceError" : "threw something else";
  }
  console.log(title + ": " + result);
}

import { EventEmitter } from "node:events";

const log: string[] = [];

class Screen {
  taps: number = 0;
  name: string = "screen";
  onTap(): void {
    let seen: string;
    try {
      this.taps++;
      seen = "taps " + typeof this.taps + " " + this.taps + ", name " + typeof this.name;
    } catch (error) {
      seen = "no this";
    }
    log.push(seen);
  }
  who(): void {
    log.push(this === undefined ? "nothing" : this === screen ? "the screen" : Object.is(this, emitter) ? "the emitter" : Object.is(this, target) ? "the target" : "something else");
  }
  onTapArrow = (): void => {
    this.taps++;
    log.push("arrow: taps " + this.taps);
  };
  handleEvent(): void {
    this.who();
  }
}

const screen = new Screen();
const emitter = new EventEmitter();
const target = new EventTarget();

emitter.on("tap", screen.onTap);
emitter.on("tap", screen.who);
emitter.on("tap", screen.onTapArrow);
emitter.on("tap", screen.onTap.bind(screen));
emitter.once("tap", screen.who);
show("emit", () => emitter.emit("tap"));
show("what the listeners saw", () => log.splice(0).join(" | "));
show("emit again", () => emitter.emit("tap"));
show("what the listeners saw", () => log.splice(0).join(" | "));
show("the screen's taps", () => screen.taps);
show("the emitter got a member", () => "taps" in emitter);
show("its value", () => String(Reflect.get(emitter, "taps")));

target.addEventListener("tap", screen.onTap);
target.addEventListener("tap", screen.who);
target.addEventListener("tap", screen.onTapArrow);
target.addEventListener("tap", screen);
show("dispatch", () => target.dispatchEvent(new Event("tap")));
show("what the listeners saw", () => log.splice(0).join(" | "));
show("the screen's taps", () => screen.taps);
show("the target got a member", () => "taps" in target);

class Own {
  listeners: (() => void)[] = [];
  label: string = "own";
  on(listener: () => void): void {
    this.listeners.push(listener);
  }
  fireByIndex(): void {
    for (let i = 0; i < this.listeners.length; i++) this.listeners[i]();
  }
  fireByValue(): void {
    for (const listener of this.listeners) listener();
  }
  fireWithThis(): void {
    for (const listener of this.listeners) listener.call(this);
  }
}
const own = new Own();
own.on(screen.onTap);
own.on(screen.onTapArrow);
own.fireByIndex();
show("fired by index: the array is this", () => log.splice(0).join(" | "));
show("keys of the array", () => Object.keys(own.listeners).join());
own.fireByValue();
show("fired by value", () => log.splice(0).join(" | "));
own.fireWithThis();
show("fired with the emitter as this", () => log.splice(0).join(" | "));
show("keys of the emitter", () => Object.keys(own).join());
