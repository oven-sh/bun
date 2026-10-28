// A Worker uses the members of a class for the first time while terminate() or the timeout of a node:vm script is pending. The Worker closes. The script times out, and both classes list all their members afterwards.
import vm from "node:vm";

class Shape {
  static unit = 1;
  static square(side: number): Shape {
    return new Shape(side);
  }
  static double(shape: Shape): Shape {
    return new Shape(shape.side * 2);
  }
  static get origin(): Shape {
    return new Shape(0);
  }
  constructor(public side: number) {}
  area(): number {
    return this.side * this.side;
  }
  edge(): number {
    return this.side * 4;
  }
  half(): number {
    return this.side / 2;
  }
  get twice(): number {
    return this.side * 2;
  }
  label(): string {
    return "shape " + this.side;
  }
}
class Box extends Shape {
  static cube(side: number): Box {
    return new Box(side);
  }
  static flat(): Box {
    return new Box(0);
  }
  volume(): number {
    return this.area() * this.side;
  }
  faces(): number {
    return 6;
  }
  label(): string {
    return "box " + this.side;
  }
}

// The request arrives during the sleep, so the statement after the sleep is the first to run with it pending.
const addElements = (box: any) => {
  box[0] = 1;
  box[1] = 2;
  box[2] = 3;
};
let sink: unknown;
const uses: Record<string, (box: any, members: any, statics: any) => void> = {
  "store a member": (box, members) => {
    Bun.sleepSync(40);
    members.added = 1;
  },
  "store under an index": (box, members) => {
    Bun.sleepSync(40);
    members[7] = 1;
  },
  "read a missing member": (box, members) => {
    Bun.sleepSync(40);
    sink = members.missing;
  },
  "test a missing member": (box, members) => {
    Bun.sleepSync(40);
    sink = "missing" in members;
  },
  "delete a missing member": (box, members) => {
    Bun.sleepSync(40);
    delete members.missing;
  },
  "list members": (box, members) => {
    Bun.sleepSync(40);
    sink = Object.getOwnPropertyNames(members);
  },
  "list keys": (box, members) => {
    Bun.sleepSync(40);
    sink = Reflect.ownKeys(members);
  },
  "describe a member": (box, members) => {
    Bun.sleepSync(40);
    sink = Object.getOwnPropertyDescriptor(members, "faces");
  },
  "define a member": (box, members) => {
    Bun.sleepSync(40);
    Object.defineProperty(members, "added", { value: 1 });
  },
  "prevent extensions": (box, members) => {
    Bun.sleepSync(40);
    Object.preventExtensions(members);
  },
  "set the same prototype": (box, members) => {
    Bun.sleepSync(40);
    Object.setPrototypeOf(members, Shape.prototype);
  },
  "inspect an instance": box => {
    Bun.sleepSync(40);
    sink = Bun.inspect(box);
  },
  "inspect an instance in a Map": box => {
    Bun.sleepSync(40);
    sink = Bun.inspect(new Map([[1, box]]));
  },
  "inspect the members": (box, members) => {
    Bun.sleepSync(40);
    sink = Bun.inspect(members);
  },
  "store a static": (box, members, statics) => {
    Bun.sleepSync(40);
    statics.added = 1;
  },
  "list statics": (box, members, statics) => {
    Bun.sleepSync(40);
    sink = Object.getOwnPropertyNames(statics);
  },
  "define a static": (box, members, statics) => {
    Bun.sleepSync(40);
    Object.defineProperty(statics, "added", { value: 1 });
  },
  "inspect the class": (box, members, statics) => {
    Bun.sleepSync(40);
    sink = Bun.inspect(statics);
  },
  "freeze an instance with elements": box => {
    addElements(box);
    Bun.sleepSync(40);
    Object.freeze(box);
  },
  "seal an instance with elements": box => {
    addElements(box);
    Bun.sleepSync(40);
    Object.seal(box);
  },
  "test a frozen instance with elements": box => {
    addElements(box);
    Object.freeze(box);
    Bun.sleepSync(40);
    sink = Object.isFrozen(box);
  },
  "assign an instance with elements": box => {
    addElements(box);
    Bun.sleepSync(40);
    Object.assign(new Box(2), box);
  },
};

const namesOf = (object: object) =>
  Object.getOwnPropertyNames(object)
    .filter(name => name !== "added" && name !== "7")
    .join();

if (Bun.isMainThread) {
  const jobs = Object.keys(uses).flatMap(use => ["terminate", "timeout"].map(mode => [use, mode]));
  const lines: string[] = [];
  const run = async (index: number) => {
    const worker = new Worker(new URL(import.meta.url));
    const isClosed = new Promise<void>(resolve => worker.addEventListener("close", () => resolve()));
    const answer = await new Promise<string>(resolve => {
      worker.onmessage = event => resolve(event.data);
      worker.postMessage(jobs[index]);
    });
    worker.terminate();
    await isClosed;
    lines[index] = `${jobs[index].join(", ")}: ${answer}`;
  };
  let next = 0;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (next < jobs.length) await run(next++);
    }),
  );
  console.log(lines.join("\n"));
} else {
  addEventListener("message", (event: MessageEvent<[string, string]>) => {
    const [use, mode] = event.data;
    const box = new Box(3);
    const call = () => uses[use](box, Object.getPrototypeOf(box), box.constructor);
    const spin = () => (sink = box.volume());
    if (mode === "terminate") {
      postMessage("closed");
      call();
      for (;;) spin();
    }
    let code = "no error";
    try {
      vm.runInNewContext("call(); for (;;) spin();", { call, spin }, { timeout: 5 });
    } catch (error) {
      code = (error as { code: string }).code;
    }
    const names = [Box.prototype, Shape.prototype, Box, Shape].map(namesOf).join(" | ");
    postMessage(
      `${code} | ${names} | ${box.volume()} ${box.label()} ${box.twice} ${Box.cube(2).faces()} ${Shape.origin.side}`,
    );
  });
}
