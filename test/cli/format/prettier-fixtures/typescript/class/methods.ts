class X {
    optionalMethod?() {}
}

interface Iterable<T> {
  [Symbol.iterator](): Iterator<T>;
}

export class Check {
  private static property = 'test';
}
