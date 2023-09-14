async function readInput() {
  let items = [];
  for await (const line of console) {
    if (line == "break") {
      break;
    }
    items.push(line);
  }
  return items;
}

const a = await readInput();
console.write(JSON.stringify(a));

const b = await readInput();
console.write(JSON.stringify(b));
