const log: string[] = [];

abstract class Sensor {
  abstract value: number;
  abstract readonly unit: string;
  describe(): string {
    return this.value + " " + this.unit;
  }
  reset(): number {
    this.value = 0;
    return this.value;
  }
}

class Stored extends Sensor {
  value = 1;
  unit = "stored";
}

class Computed extends Sensor {
  reads = 0;
  get value(): number {
    log.push("get");
    return ++this.reads * 100;
  }
  set value(next: number) {
    log.push("set " + next);
  }
  get unit(): string {
    log.push("unit");
    return "computed";
  }
}

class Late extends Sensor {
  value: number;
  unit: string;
  constructor() {
    super();
    this.unit = "late";
    this.value = 3;
  }
}

class Holder {
  constructor(public sensor: Sensor) {}
  ask(): number {
    return this.sensor.value;
  }
}

function read(s: Sensor): number {
  return s.value;
}

function write(s: Sensor, next: number): number {
  s.value = next;
  return s.value;
}

function line(label: string, value: unknown): void {
  console.log(label + ": " + String(value) + " [" + log.join(", ") + "]");
  log.length = 0;
}

const sensors: Sensor[] = [new Stored(), new Computed(), new Late()];
for (const s of sensors) {
  const name = s.constructor.name;
  line(name + ", read", read(s));
  line(name + ", a field of a holder", new Holder(s).ask());
  line(name + ", described by the base", s.describe());
  line(name + ", stored", write(s, 9));
  line(name + ", reset by the base", s.reset());
  line(name + ", own", Object.hasOwn(s, "value") + " " + Object.hasOwn(s, "unit") + " keys " + Object.keys(s).join());
}

const stored = new Stored();
let warm = 0;
for (let i = 0; i < 2000; i++) warm += read(stored) + write(stored, i) + stored.describe().length;
line("2000 with the field", warm);
const computed = new Computed();
line("then the accessor at the same sites", read(computed) + " " + write(computed, 5) + " " + computed.describe());
line("then the field again", read(stored) + " " + write(stored, 5) + " " + stored.describe());

let mixed = 0;
for (let i = 0; i < 2000; i++) mixed += read(sensors[i % 3]);
log.length = 0;
line("2000 mixed reads", mixed);

export {};
