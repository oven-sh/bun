type HasLength = { length: number };

const values: HasLength[] = [{ length: 1 }, "a"];

function maker(item: HasLength): string {
  return item.constructor.name;
}

for (const value of values) console.log("made by", maker(value));
