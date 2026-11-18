import * as desktop from "bun:desktop";
import { readSync } from "node:fs";

const seen: string[] = [];
Object.assign(globalThis, desktop, {
  seen,
  open(html: string, options: desktop.WindowOptions) {
    const win = new desktop.Window({ title: "One", width: 200, height: 100, ...options });
    win.document.body.innerHTML =
      "<style>body { margin: 0 } body > :not(style) { display: block; width: 100px; height: 20px }</style>" + html;
    return win;
  },
  /** Notes `describe(event)` for each of these events. */
  watch(target: EventTarget, types: string, describe = (_: any) => "") {
    for (const type of types.split(" "))
      target.addEventListener(type, event => seen.push(`${type} ${describe(event)}`.trim()));
  },
  block: () => readSync(0, Buffer.alloc(1)),
});

process.on("message", async (code: string) => {
  try {
    process.send!({ value: await (0, eval)(code) });
  } catch (error) {
    process.send!({ error: String(error) });
  }
});
process.send!({});
