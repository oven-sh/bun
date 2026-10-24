function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? text(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

class Packet {
  declare kind: "data";
  declare version: 2;
  declare final: true;
  declare empty: null;
  declare level: "low" | "high";
  size: number = 1;
  isData(): boolean {
    return this.kind === "data";
  }
  nextVersion(): number {
    return this.version + 1;
  }
  ending(): string {
    return this.final ? "final" : "not final";
  }
  levelNumber(): number {
    switch (this.level) {
      case "low":
        return 1;
      case "high":
        return 2;
    }
  }
}

function kindOf(packet: Packet): "data" {
  return packet.kind;
}

const packet = new Packet();
show("the text", () => [packet.kind, kindOf(packet), packet.kind === "data", packet.isData()]);
show("the length of the text", () => packet.kind.length);
show("the number", () => [packet.version, packet.version === 2, packet.version + 1, packet.nextVersion()]);
show("true", () => [packet.final, packet.final === true, packet.ending()]);
show("null", () => [packet.empty, packet.empty === null, packet.empty ?? "default"]);
show("one of two", () => [packet.level, packet.levelNumber()]);
show("one of two, plus one", () => packet.levelNumber() + 1);
show("keys", () => Object.keys(packet));

packet.kind = "data";
packet.version = 2;
packet.final = true;
packet.empty = null;
packet.level = "high";
show("after honest stores", () => [packet.isData(), packet.nextVersion(), packet.ending(), packet.empty, packet.levelNumber()]);
show("keys", () => Object.keys(packet));
show("another instance", () => [new Packet().isData(), new Packet().nextVersion(), new Packet().ending(), new Packet().levelNumber()]);
