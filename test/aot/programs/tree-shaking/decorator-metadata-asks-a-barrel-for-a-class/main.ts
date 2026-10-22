// The classes come through the barrel of a pure package written in TypeScript, and this file writes them only as types: of a decorated constructor's parameters, of a decorated property, through a namespace import. With emitDecoratorMetadata those types are values, so the barrel is asked for them. One class is written as a type where no decorator stands, and one is asked for by nobody.
import { Engine, Wheel, OnlyAType } from "car-parts";
import * as parts from "car-parts";

declare global { namespace Reflect { function metadata(key: string, value: unknown): (target: any, member?: string | symbol) => void; } }
const recorded = new Map<string, any>();
Reflect.metadata = (key, value) => (target, member) => { recorded.set(key + " " + String(member ?? "class"), value); };
function noted(...anything: unknown[]): void {}

@noted
class Car {
  @noted radio!: parts.Radio;
  plain: OnlyAType | undefined;
  constructor(engine: Engine, wheel: Wheel) {}
}

const [engine, wheel] = recorded.get("design:paramtypes class");
console.log(new engine().start(), new wheel().turn(), new (recorded.get("design:type radio"))().play());
