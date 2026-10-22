// emitDecoratorMetadata turns the types of a decorated constructor's parameters, of a property and of a method into values. Engine, Wheel (imported), Radio and Horn are written only as types; the container constructs them from the metadata.
import { Wheel } from "./wheel";

declare global {
  namespace Reflect {
    function metadata(key: string, value: unknown): (target: any, member?: string | symbol) => void;
  }
}

const recorded = new Map<string, any>();
Reflect.metadata = (key, value) => (target, member) => {
  recorded.set(key + " " + String(member ?? "class"), value);
};

function noted(...parts: unknown[]): void {}

class Engine {
  start(): string {
    return "engine started";
  }
}

class Radio {
  play(): string {
    return "radio plays";
  }
}

class Horn {
  sound(): string {
    return "horn sounds";
  }
}

@noted
class Car {
  @noted radio!: Radio;
  constructor(engine: Engine, wheel: Wheel) {}
  @noted honk(): Horn {
    return undefined as any;
  }
}

const [engine, wheel] = recorded.get("design:paramtypes class");
console.log(new engine().start());
console.log(new wheel().turn());
console.log(new (recorded.get("design:type radio"))().play());
console.log(new (recorded.get("design:returntype honk"))().sound());
