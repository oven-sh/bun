// Reads lines from `console` up to "break", twice. With "await" the entry module awaits the reads;
// without, only the loop over `console` keeps the process alive.
async function readInput() {
  const items: string[] = [];
  for await (const line of console) {
    if (line == "break") break;
    items.push(line);
  }
  return items;
}

async function main() {
  console.write(JSON.stringify(await readInput()));
  console.write(JSON.stringify(await readInput()));
}

if (process.argv[2] === "await") await main();
else main();
