interface Line {
  count: number;
}
const line = JSON.parse<Line>('{"count":2.5}');
console.log(0 + line.count);
