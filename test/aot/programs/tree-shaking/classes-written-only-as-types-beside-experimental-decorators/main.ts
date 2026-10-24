// experimentalDecorators with emitDecoratorMetadata: the types of decorated members become values. Each of these classes and constants could be left out, were it not for the metadata, a decorator's argument, or a parameter decorator.
declare global { namespace Reflect { function metadata(key: string, value: unknown): (target: any, member?: string | symbol) => void; } }
const recorded = new Map<string, any>();
Reflect.metadata = (key, value) => (target, member) => { recorded.set(key + " " + String(member ?? "class"), value); };
const noted = (...parts: unknown[]): void => {};
const inject = (token: { name: string }) => (target: object, member: string | undefined, index: number) => { recorded.set("token " + index, token); };
const token = { name: "a constant that a parameter decorator names" };

class Engine { start() { return "engine"; } }
class Wheel { turn() { return "wheel"; } }
class Radio { play() { return "radio"; } }
const Horn = class { sound() { return "horn"; } };
type Horn = InstanceType<typeof Horn>;
class NotInMetadata { never() { return "never"; } }
enum Fuel { Petrol, Diesel }

@noted
class Car {
  @noted radio!: Radio;
  @noted fuel!: Fuel;
  @noted horn!: Horn;
  plain!: NotInMetadata;
  constructor(engine: Engine, @inject(token) wheel: Wheel) {}
}

const [engine, wheel] = recorded.get("design:paramtypes class");
console.log(new engine().start(), new wheel().turn(), new (recorded.get("design:type radio"))().play());
console.log(recorded.get("design:type fuel").name, recorded.get("design:type horn").name, recorded.get("token 1").name);
