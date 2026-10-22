function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    if (list.length > 40) return "array of " + list.length + " with keys " + Object.keys(list).join();
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  for (const [key, member] of Object.entries(value)) parts.push(key + ": " + show(member));
  return "{" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

class Settings {
  volume = 5;
  speed = 1.5;
  theme = "dark";
  loud(): boolean {
    return this.volume > 7;
  }
  faster(): number {
    return this.speed * 2;
  }
  banner(): string {
    return this.theme.toUpperCase();
  }
}

function patch<T, K extends keyof T>(target: T, part: Pick<T, K>): void {
  for (const key in part) target[key] = part[key];
}

function report(title: string, s: Settings): void {
  console.log(title + ": " + typeof s.volume + " " + show(s.volume) + ", " + typeof s.speed + " " + show(s.speed) + ", " + typeof s.theme + " " + show(s.theme) + ", keys " + Object.keys(s).join() + ", " + JSON.stringify(s));
  attempt("  loud", () => s.loud());
  attempt("  faster", () => s.faster());
  attempt("  banner", () => s.banner());
}

const s = new Settings();
let total = 0;
for (let i = 0; i < 2000; i++) {
  patch(s, { volume: i % 11 });
  patch(s, { speed: i / 8, theme: "t" + (i % 3) });
  total += (s.loud() ? 1 : 0) + s.faster() + s.banner().length;
}
console.log("2000 honest patches: " + total);
report("honest", s);

const form = { volume: 9, speed: "fast", theme: 3 };
const volumeOnly: { volume: number } = form;
patch(s, volumeOnly);
report("a patch of the volume brings a speed and a theme along", s);

const t = new Settings();
const withAMethod = { theme: "light", loud: "very", banner: 12 };
const themeOnly: { theme: string } = withAMethod;
patch(t, themeOnly);
report("a patch of the theme brings own members over two methods", t);

const u = new Settings();
const unknownMember = { speed: 2, depth: 4 };
const speedOnly: { speed: number } = unknownMember;
patch(u, speedOnly);
report("a patch of the speed brings a member the class never had", u);
report("a fresh instance", new Settings());

export {};
