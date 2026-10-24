export class Request {
  url: unknown = "/";
  method: unknown = "GET";
  next: Request | null = null;
  describe(): string {
    return "Request " + this.url;
  }
}
export interface Point {
  x: number;
  y: number;
}
function decorate(object: any, value: unknown) {
  object.params = value;
  object.query = { of: value };
  object.route = [value];
}
export function make(value: number): Request {
  const request = new Request();
  decorate(request, value);
  return request;
}
export function work(rounds: number): string {
  const kept: any[] = [];
  let sum = 0;
  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < 500; i++) {
      const object: any = i % 2 ? make(i) : ({ x: i, y: round } as Point);
      if (!(i % 2)) decorate(object, i);
      sum += object.params + object.query.of + object.route[0];
      if (i % 125 === 3) kept.push(object);
    }
    if (round % 5 === 4) Bun.gc(round % 10 === 9);
  }
  for (const object of kept) sum += object.query.of + Object.keys(object).length;
  return kept.length + " " + sum;
}
