type HasLength = { length: number };

const values: HasLength[] = [{ length: 1 }, "a"];

function tag(item: HasLength): string {
  return Object.prototype.toString.call(item);
}

for (const value of values) console.log("tag", tag(value));
