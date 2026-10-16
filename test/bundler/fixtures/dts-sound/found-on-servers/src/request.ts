import type { Input, Result } from "./types";
export class Request<I extends Input = {}> {
  header(name: string): string | undefined;
  header(): Record<string, string>;
  header(name?: string): string | undefined | Record<string, string> {
    return name ? name : {};
  }
  static async make(): Promise<Request>;
  static async make(count: number): Promise<Request[]>;
  static async make(count?: number): Promise<Request | Request[]> {
    return count === undefined ? new Request() : [];
  }
  each(): Generator<number>;
  each(from: number): Generator<number>;
  *each(from = 0) {
    yield from;
  }
  async parse<T extends Input>(options?: T): Promise<Result<T>>;
  async parse(options?: Partial<Input>): Promise<Result<Input>>;
  async parse(options?: Partial<Input>): Promise<Result<Input>> {
    return { value: options ?? {}, input: {} };
  }
  #cached = 1;
  get cached(): number {
    return this.#cached;
  }
}
