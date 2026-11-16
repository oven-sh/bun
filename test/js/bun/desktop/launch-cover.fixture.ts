import { app, Window } from "bun:desktop";

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
const window = new Window({
  x: 10,
  y: 20,
  width: step === "wider" ? 400 : 300,
  height: 200,
  autoHideMenuBar: true,
  launchCover: true,
});
const log: string[] = [String(window.isLaunchCoverShown())];
await window.loadHTML(
  `<input placeholder="Text" style="display:block;height:60px"><button style="width:100px;height:100px;background:${step === "changed" || step === "part" ? "red" : "blue"}"></button>`,
);
const field = window.document.querySelector("input")!;
window.document.querySelector("button")!.onclick = () => log.push("click");
if (step !== "unfocused") field.focus();
if (step === "type" || step === "unfocused" || step === "keep") type("b");
if (step === "click" || step === "changed") click(50, 120);
await new Promise(resolve => window.window.requestAnimationFrame(() => setImmediate(resolve)));
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
field.value = "";
if (step === "clear") Window.clearLaunchCover();
else if (step === "part") log.push(String(await window.saveLaunchCover({ x: 0, y: 70, width: 150, height: 130 })));
else if (step === "save")
  log.push(String(await window.saveLaunchCover(undefined, { bounds: field.getBoundingClientRect() })));
console.log(log.join(" "));
app.quit();
