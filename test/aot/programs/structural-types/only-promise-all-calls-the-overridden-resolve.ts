const log: string[] = [];

class Tracked<T> extends Promise<T> {
  static resolve(): Promise<void>;
  static resolve<T>(value: T): Promise<Awaited<T>>;
  static resolve<T>(value?: T): Promise<Awaited<T> | void> {
    log.push("resolve " + String(value));
    return super.resolve(value);
  }
}

console.log((await Tracked.all([1, 2])).join() + " [" + log.join(", ") + "]");

export {};
