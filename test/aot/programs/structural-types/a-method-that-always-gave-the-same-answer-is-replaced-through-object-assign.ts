class Door {
  ready(): boolean {
    return true;
  }
  kind(): "wood" | "steel" {
    return "wood";
  }
  owner(): string | undefined {
    return "ann";
  }
  lock(): { code: number } | null {
    return { code: 1 };
  }
  label(): string {
    return "door";
  }
  size(): number | string {
    return 2;
  }
}

function uses(d: Door): string {
  const parts: string[] = [];
  parts.push(d.ready() ? "ready" : "not ready");
  if (!d.ready()) parts.push("really not");
  switch (d.kind()) {
    case "wood":
      parts.push("wooden");
      break;
    case "steel":
      parts.push("of steel");
      break;
  }
  parts.push(d.owner()?.toUpperCase() ?? "nobody");
  const lock = d.lock();
  parts.push(lock === null ? "no lock" : "code " + lock.code);
  parts.push(d.label() === "door" ? "a door" : "called " + JSON.stringify(d.label()));
  parts.push(String(d.label().length));
  const size = d.size();
  parts.push(typeof size === "number" ? "number " + (size + 1) : "string " + size.length);
  return parts.join(", ");
}

const d = new Door();
const originals = { ready: d.ready, kind: d.kind, owner: d.owner, lock: d.lock, label: d.label, size: d.size };

let warm = 0;
for (let i = 0; i < 2000; i++) warm += uses(d).length;
console.log("2000 honest: " + warm);
console.log("the methods: " + uses(d));

Object.assign(Door.prototype, { ready: () => false });
console.log("ready: " + uses(d));
Object.assign(Door.prototype, { kind: () => "steel" });
console.log("kind: " + uses(d));
Object.assign(Door.prototype, { owner: () => undefined });
console.log("owner: " + uses(d));
Object.assign(Door.prototype, { lock: () => null });
console.log("lock: " + uses(d));
Object.assign(Door.prototype, { label: () => "" });
console.log("label: " + uses(d));
Object.assign(Door.prototype, { size: () => "large" });
console.log("size: " + uses(d));
console.log("a new door: " + uses(new Door()));

Object.assign(Door.prototype, { ready: originals.ready });
Object.assign(Door.prototype, { kind: originals.kind });
Object.assign(Door.prototype, { owner: originals.owner });
Object.assign(Door.prototype, { lock: originals.lock });
Object.assign(Door.prototype, { label: originals.label });
Object.assign(Door.prototype, { size: originals.size });
console.log("put back: " + uses(d));

export {};
