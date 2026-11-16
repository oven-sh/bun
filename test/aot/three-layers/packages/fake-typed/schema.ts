export type Result<T> = { ok: true; value: T } | { ok: false; issues: string[] };
export abstract class Schema<T> {
  protected checks: Array<(value: T) => string | undefined> = [];
  abstract readonly kind: string;
  protected abstract base(value: unknown, path: string): Result<T>;
  parse(value: unknown, path: string = "$"): Result<T> {
    const result = this.base(value, path);
    if (!result.ok) return result;
    const issues = this.checks.map(check => check(result.value)).filter((issue): issue is string => issue !== undefined);
    return issues.length ? { ok: false, issues: issues.map(issue => path + ": " + issue) } : result;
  }
  refine(test: (value: T) => boolean, message: string): this {
    const copy: this = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
    copy.checks = [...this.checks, value => (test(value) ? undefined : message)];
    return copy;
  }
  optional(): OptionalSchema<T> { return new OptionalSchema<T>(this); }
  array(): ArraySchema<T> { return new ArraySchema<T>(this); }
  transform<R>(f: (value: T) => R): TransformSchema<T, R> { return new TransformSchema<T, R>(this, f); }
}
export class StringSchema extends Schema<string> {
  readonly kind = "string";
  protected base(value: unknown, path: string): Result<string> { return typeof value === "string" ? { ok: true, value } : { ok: false, issues: [path + ": not a string"] }; }
  min(n: number): this { return this.refine(value => value.length >= n, "shorter than " + n); }
}
export class NumberSchema extends Schema<number> {
  readonly kind = "number";
  protected base(value: unknown, path: string): Result<number> { return typeof value === "number" && !Number.isNaN(value) ? { ok: true, value } : { ok: false, issues: [path + ": not a number"] }; }
  int(): this { return this.refine(Number.isInteger, "not an integer"); }
  positive(): this { return this.refine(value => value > 0, "not positive"); }
}
export class OptionalSchema<T> extends Schema<T | undefined> {
  readonly kind = "optional";
  constructor(private inner: Schema<T>) { super(); }
  protected base(value: unknown, path: string): Result<T | undefined> { return value === undefined ? { ok: true, value: undefined } : this.inner.parse(value, path); }
}
export class ArraySchema<T> extends Schema<T[]> {
  readonly kind = "array";
  constructor(private element: Schema<T>) { super(); }
  protected base(value: unknown, path: string): Result<T[]> {
    if (!Array.isArray(value)) return { ok: false, issues: [path + ": not an array"] };
    const out: T[] = [], issues: string[] = [];
    value.forEach((each, index) => { const result = this.element.parse(each, path + "[" + index + "]"); if (result.ok) out.push(result.value); else issues.push(...result.issues); });
    return issues.length ? { ok: false, issues } : { ok: true, value: out };
  }
}
export class TransformSchema<T, R> extends Schema<R> {
  readonly kind = "transform";
  constructor(private inner: Schema<T>, private f: (value: T) => R) { super(); }
  protected base(value: unknown, path: string): Result<R> { const result = this.inner.parse(value, path); return result.ok ? { ok: true, value: this.f(result.value) } : result; }
}
type Shape = Record<string, Schema<any>>;
export type Infer<S> = S extends Schema<infer T> ? T : never;
export class ObjectSchema<S extends Shape> extends Schema<{ [K in keyof S]: Infer<S[K]> }> {
  readonly kind = "object";
  constructor(readonly shape: S) { super(); }
  protected base(value: unknown, path: string): Result<{ [K in keyof S]: Infer<S[K]> }> {
    if (typeof value !== "object" || value === null) return { ok: false, issues: [path + ": not an object"] };
    const out: Record<string, unknown> = {}, issues: string[] = [];
    for (const key of Object.keys(this.shape)) {
      const result = this.shape[key]!.parse((value as Record<string, unknown>)[key], path + "." + key);
      if (result.ok) { if (result.value !== undefined) out[key] = result.value; } else issues.push(...result.issues);
    }
    return issues.length ? { ok: false, issues } : { ok: true, value: out as { [K in keyof S]: Infer<S[K]> } };
  }
  extend<E extends Shape>(more: E): ObjectSchema<S & E> { return new ObjectSchema<S & E>({ ...this.shape, ...more }); }
  keys(): string[] { return Object.keys(this.shape); }
}
export const s = {
  string: () => new StringSchema(),
  number: () => new NumberSchema(),
  object: <S extends Shape>(shape: S) => new ObjectSchema<S>(shape),
};
