const log: string[] = [];

class Listener {
  name = "listener";
  handleEvent(event: Event): void {
    log.push(this.name + " got " + event.type);
  }
}

const target = new EventTarget();
target.addEventListener("ping", new Listener());
console.log(target.dispatchEvent(new Event("ping")) + " [" + log.join(", ") + "]");

export {};
