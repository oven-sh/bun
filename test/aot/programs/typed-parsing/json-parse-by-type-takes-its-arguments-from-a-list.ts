interface Point {
  x: number;
  y: number;
}

function outcome(run: () => Point): string {
  try {
    const p = run();
    return "value " + (p.x + p.y);
  } catch (error) {
    return error instanceof Error ? error.constructor.name : typeof error;
  }
}

const texts = ['{"x":1,"y":2}', '{"x":1}', '{"x":1,"y":"2"}', "null"];
function textAt(i: number): string {
  return texts[i];
}

for (let i = 0; i < texts.length; i++) {
  console.log(texts[i], "as an argument:", outcome(() => JSON.parse(textAt(i)) as Point));
  console.log(texts[i], "in a list:", outcome(() => JSON.parse(...([textAt(i)] as [string])) as Point));
  console.log(texts[i], "in a list with a reviver:", outcome(() => JSON.parse(...([textAt(i), (_key: string, value: unknown) => value] as [string, (key: string, value: unknown) => unknown])) as Point));
}
