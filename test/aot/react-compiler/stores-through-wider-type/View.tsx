import * as state from "./state";

function open(s: state.Idle | state.Busy): void {
  s.open = true;
}
function openByAString(s: state.Idle | state.Busy): void {
  s["open"] = true;
}
function openByAPattern(s: state.Idle | state.Busy): void {
  ({ open: s.open } = { open: true });
}
function openKept(s: { open: boolean }): void {
  s.open = true;
}
function arm(s: { timer: number | null }): void {
  s.timer = 5;
}
function show(s: { shown: boolean }): void {
  s.shown = true;
}
function beVerbose(s: state.Settings): void {
  s.verbose = true;
}
function pin(p: { pinned: boolean }): void {
  p.pinned = true;
}
function turnOn(s: state.OnlyNarrowed): void {
  if (s.kind === "b") s.on = true;
}

function rows(): string[] {
  const out: string[] = [];
  const a = state.idle();
  open(a);
  out.push("through a union: " + state.describe(a));
  const b = state.idle();
  openByAString(b);
  out.push("by a string: " + state.describe(b));
  const c = state.idle();
  openByAPattern(c);
  out.push("by a pattern: " + state.describe(c));
  openKept(state.kept);
  out.push("then read by its own type: " + state.readByItsOwnType(state.kept));
  const t = state.unarmed();
  arm(t);
  out.push("null alone: " + state.describeTimer(t));
  const h = state.holder();
  h.state.done = true;
  out.push("a member of a member: " + h.state.tag + " " + h.state.done);
  show(state.constant);
  out.push("a constant: " + state.constant.shown + " " + state.constant.n);
  beVerbose(state.defined);
  out.push("inferred under a bound: " + state.describeSettings(state.defined));
  const copy = state.copyOfFrozen();
  beVerbose(copy);
  out.push("a copy of a frozen literal: " + state.describeSettings(copy) + " " + state.frozen.verbose);
  const panel = new state.Panel();
  pin(panel);
  out.push("a readonly field of a class: " + panel.describe() + " " + panel.pinned);
  const [na, nb] = [state.narrowedA(), state.narrowedB()];
  turnOn(na);
  turnOn(nb);
  out.push("only where it is narrowed: " + na.on + " " + nb.on);
  return out;
}

export function View(props: { title: string }) {
  const lines = [props.title, ...rows()];
  return <p>{lines.join("\n")}</p>;
}
