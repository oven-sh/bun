export function useStep(step: number = 1, scale: number = 2): string {
  return <i>{step * scale}</i>;
}

export function useRange(start: number = 0, end: number): string {
  return <i>{start + ".." + end}</i>;
}

const call = (f: Function) => (f.length === 2 ? f(null, "value") : f("value"));

export function Card({ n }: { n: number }) {
  const add = (x: number, y = n) => x + y;
  const later = (x: number, y: number = n) => () => x + y;
  function declared(x: number, y: number = 1, ...rest: number[]) {
    return x + y + rest.length;
  }
  const methods = {
    scaled(x: number, by = n) {
      return x * by;
    },
  };
  const lengths = [add.length, later.length, declared.length, methods.scaled.length];
  const results = [add(1), add(1, 3), later(1)(), later(1, 3)(), declared(1), declared(1, 2, 3), methods.scaled(2), methods.scaled(2, 3)];
  return (
    <b>
      {lengths.join()} {results.join()} {call((value: string, more = n) => value)}
    </b>
  );
}
