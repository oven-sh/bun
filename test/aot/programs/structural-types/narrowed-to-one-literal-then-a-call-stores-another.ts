function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

class Switch {
  mode: "on" | "off" = "on";
  level: 0 | 1 | 2 = 0;
  armed: boolean = true;
  owner: null | "someone" = null;
  note: undefined | "noted" = undefined;
}

function flip(s: Switch): void {
  s.mode = "off";
  s.level = 2;
  s.armed = false;
  s.owner = "someone";
  s.note = "noted";
}

const costs = { on: 10, off: 20 };
const names = ["zero", "one", "two"];

const s = new Switch();
if (s.mode === "on" && s.level === 0 && s.armed === true && s.owner === null && s.note === undefined) {
  flip(s);
  say("mode", s.mode);
  say("mode is on", s.mode === "on");
  say("cost", costs[s.mode]);
  say("level", s.level);
  say("level plus one", s.level + 1);
  say("name", names[s.level]);
  say("armed", s.armed);
  say("armed picks", s.armed ? "yes" : "no");
  say("owner", s.owner);
  say("owner or nobody", s.owner ?? "nobody");
  say("note", s.note);
  say("note or nothing", s.note ?? "nothing");
  const mode: "on" = s.mode;
  const level: 0 = s.level;
  const armed: true = s.armed;
  const owner: null = s.owner;
  const note: undefined = s.note;
  say("kept", [mode, level, armed, owner, note].join());
}
