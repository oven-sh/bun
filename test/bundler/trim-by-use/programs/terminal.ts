// Bun.Terminal alone, and as the terminal of a child
let seen = "";
const terminal = new Bun.Terminal({
  cols: 40,
  rows: 10,
  data(_terminal: any, data: Uint8Array) {
    seen += new TextDecoder().decode(data);
  },
});
console.log(terminal.closed, typeof terminal.write, typeof terminal.inputFlags);
terminal.resize(80, 24);
const child = Bun.spawn(["sh", "-c", "stty size; echo done"], { terminal });
console.log(await child.exited);
while (!seen.includes("done")) await Bun.sleep(5);
console.log(JSON.stringify(seen.replaceAll("\r", "")));
terminal.close();
console.log(terminal.closed);
