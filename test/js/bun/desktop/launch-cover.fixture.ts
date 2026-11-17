import { app, Window } from "bun:desktop";
import { desktopInternals } from "bun:internal-for-testing";

const step = process.env.STEP;
const type = (keyCode: string) => {
  for (const type of ["keyDown", "keyUp"] as const) window.sendInputEvent({ type, keyCode });
};
const click = (x: number, y: number) => {
  for (const type of ["mouseDown", "mouseUp"] as const)
    window.sendInputEvent({ type, x, y, button: "left", clickCount: 1 });
};

await app.whenReady();
if (step === "crash") process.kill(process.pid, "SIGKILL");
if (step === "early" || step === "discarded") {
  // Before the app has made the window, whose id is 1.
  new Window({ show: false });
  for (const type of ["keyDown", "keyUp"]) desktopInternals.sendInputEvent(1, { type, keyCode: "s" });
  await new Promise(setImmediate);
  if (step === "discarded") new Window({ show: false, launchCover: false });
}
const window = new Window({
  x: 100,
  y: 100,
  width: step === "wider" ? 400 : 300,
  height: 200,
  autoHideMenuBar: true,
  launchCover: true,
});
const log: string[] = [String(window.isLaunchCoverShown())];
if (process.env.SCREEN && window.isLaunchCoverShown() && step === "click") {
  const { x, y } = window.getContentBounds();
  for (let isBlue = false; !isBlue; await Bun.sleep(1)) {
    const all = Buffer.from(await Bun.file(process.env.SCREEN).arrayBuffer());
    const at = all.readUInt32BE(0) + all.readUInt32BE(76) * 12 + (y + 120) * all.readUInt32BE(48) + (x + 50) * 4;
    isBlue = (all.readUInt32LE(at) & 0xffffff) === 0xff;
  }
}
await window.loadHTML(
  `<input placeholder="Text" style="display:block;height:60px"><button style="width:100px;height:100px;background:${step === "changed" || step === "part" ? "red" : "blue"}"></button>`,
);
const field = window.document.querySelector("input")!;
window.document.querySelector("button")!.onclick = () => log.push("click");
if (step === "uncovered") {
  for (const key of ["b", "Enter", "c"]) type(key);
  await new Promise(resolve => window.window.requestAnimationFrame(() => setImmediate(resolve)));
  field.onkeydown = event => log.push(event.key);
}
if (step !== "unfocused") field.focus();
if (step === "type" || step === "unfocused" || step === "keep") type("b");
if (step === "click" || step === "changed") click(50, 120);
await new Promise(resolve => window.window.requestAnimationFrame(() => setImmediate(resolve)));
if (step === "type" || step === "uncovered") {
  for (let i = 0; i < 60 && !window.isLaunchCoverShown() && field.value.length < (step === "type" ? 1 : 2); i++)
    await new Promise(resolve => window.window.requestAnimationFrame(resolve));
}
log.push(`[${field.value}]`);
if (window.hasLaunchCoverInput()) log.push("waits");
if (step === "keep") {
  window.endLaunchCover({ keep: [{ x: 0, y: 70, width: 150, height: 130 }] });
  while (!field.value) await new Promise(setImmediate);
  type("c");
  while (field.value.length < 2) await new Promise(setImmediate);
  click(50, 120);
  await window.whenLaunchCoverInput();
  log.push(`[${field.value}]`, String(window.isLaunchCoverShown()));
}
window.endLaunchCover();
while (window.isLaunchCoverShown()) await new Promise(setImmediate);
log.push(`[${field.value}]`);
if (step === "second") {
  const second = new Window({ show: false });
  log.push(`${window.id} ${second.id}`);
  second.destroy();
  log.push(String(window.isDestroyed()), String(Window.getAllWindows().length));
}
field.value = "";
if (step === "clear") Window.clearLaunchCover();
else if (step === "part") log.push(String(await window.saveLaunchCover({ x: 0, y: 70, width: 150, height: 130 })));
else if (step === "save")
  log.push(String(await window.saveLaunchCover(undefined, { bounds: field.getBoundingClientRect() })));
console.log(log.join(" "));
app.quit();
