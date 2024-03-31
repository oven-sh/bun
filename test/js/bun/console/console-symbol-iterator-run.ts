async function readInputUsingForOf() {
  const items = [];
  for await (const line of console) {
    items.push(`FIRST${line}`);
    break;
  }
  for await (const line of console) {
    if (line == "break") {
      break;
    }
    items.push(line);
  }
  return items;
}

async function readInputUsingSymbolAsyncIterator() {
  const items = [];
  const firstLine = (await console[Symbol.asyncIterator]().next()).value;
  items.push(`FIRST${firstLine}`);
  for await (const line of console) {
    if (line == "break") {
      break;
    }
    items.push(line);
  }
  return items;
}

const a = await readInputUsingForOf();
console.write(JSON.stringify(a));

const b = await readInputUsingSymbolAsyncIterator();
console.write(JSON.stringify(b));
