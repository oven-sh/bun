type Outcome<T, E> = Success<T, E> | Failure<T, E>;

class Success<T, E> {
  constructor(readonly value: T) {}
  isSuccess(): this is Success<T, E> {
    return true;
  }
  map<A>(f: (value: T) => A): Outcome<A, E> {
    return new Success<A, E>(f(this.value));
  }
  mapError<F>(_f: (error: E) => F): Outcome<T, F> {
    return new Success<T, F>(this.value);
  }
  then<U, F>(f: (value: T) => Outcome<U, F>): Outcome<U, E | F> {
    return f(this.value);
  }
  recover<U, F>(_f: (error: E) => Outcome<U, F>): Outcome<T | U, F> {
    return new Success<T | U, F>(this.value);
  }
  unwrapOr<A>(_fallback: A): T | A {
    return this.value;
  }
  match<A, B = A>(onSuccess: (value: T) => A, _onFailure: (error: E) => B): A | B {
    return onSuccess(this.value);
  }
}

class Failure<T, E> {
  constructor(readonly error: E) {}
  isSuccess(): this is Success<T, E> {
    return false;
  }
  map<A>(_f: (value: T) => A): Outcome<A, E> {
    return new Failure<A, E>(this.error);
  }
  mapError<F>(f: (error: E) => F): Outcome<T, F> {
    return new Failure<T, F>(f(this.error));
  }
  then<U, F>(_f: (value: T) => Outcome<U, F>): Outcome<U, E | F> {
    return new Failure<U, E | F>(this.error);
  }
  recover<U, F>(f: (error: E) => Outcome<U, F>): Outcome<T | U, F> {
    return f(this.error);
  }
  unwrapOr<A>(fallback: A): T | A {
    return fallback;
  }
  match<A, B = A>(_onSuccess: (value: T) => A, onFailure: (error: E) => B): A | B {
    return onFailure(this.error);
  }
}

interface Point {
  x: number;
  y: number;
}
class ParseError {
  constructor(
    readonly text: string,
    readonly position: number,
  ) {}
}
class RangeProblem {
  constructor(readonly limit: number) {}
}

function parseNumber(text: string): Outcome<number, ParseError> {
  const parsed = Number(text);
  return Number.isNaN(parsed) ? new Failure<number, ParseError>(new ParseError(text, 0)) : new Success<number, ParseError>(parsed);
}
function within(limit: number): (value: number) => Outcome<number, RangeProblem> {
  return value => (value > limit ? new Failure<number, RangeProblem>(new RangeProblem(limit)) : new Success<number, RangeProblem>(value));
}
function parsePoint(x: string, y: string): Outcome<Point, ParseError | RangeProblem> {
  return parseNumber(x)
    .then(within(100))
    .then(first => parseNumber(y).map(second => ({ x: first, y: second })));
}
function describe(outcome: Outcome<Point, ParseError | RangeProblem>): string {
  return outcome.match(
    point => `point ${point.x},${point.y}`,
    problem => (problem instanceof ParseError ? `cannot parse ${JSON.stringify(problem.text)} at ${problem.position}` : `over ${problem.limit}`),
  );
}

for (const [x, y] of [
  ["1", "2"],
  ["one", "2"],
  ["1", "two"],
  ["101", "2"],
]) {
  const outcome = parsePoint(x, y);
  console.log(describe(outcome), outcome.isSuccess(), outcome.map(point => point.x + point.y).unwrapOr("none"));
  console.log(
    outcome
      .mapError(problem => (problem instanceof RangeProblem ? problem.limit : problem.text.length))
      .recover(code => (code > 50 ? new Success<string, never>(`recovered from ${code}`) : new Failure<string, number>(code * 2)))
      .match<string | number>(
        value => (typeof value === "string" ? value : value.x * 10 + value.y),
        code => -code,
      ),
  );
}

const outcomes: Outcome<number, string>[] = [new Success<number, string>(1), new Failure<number, string>("no"), new Success<number, string>(3)];
const mappers = outcomes.map(outcome => outcome.map);
console.log(outcomes.map((outcome, index) => mappers[index].call(outcome, (value: number) => value * 2).unwrapOr(-1)).join());
let chained: Outcome<number, string> = new Success<number, string>(0);
for (let i = 0; i < 20; i++) chained = chained.then(value => (value < 15 ? new Success<number, string>(value + 1) : new Failure<number, string>(`stopped at ${value}`)));
console.log(chained.match(String, error => error));
export {};
