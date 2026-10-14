#!/usr/bin/env bun
import { readFile, type Stats } from "node:fs/promises";
import * as path from "node:path";
import EventEmitter, { once as waitFor } from "node:events";
import type { Server } from "bun";
import config from "./config.json" with { type: "json" };

export const MAX_RETRIES = 3;
const enum Level {
  Debug,
  Info = 10,
  Error = Info * 2,
}

/**
 * Something that can be cached.
 * @template T what is stored
 * @param {string} key where it is stored
 * @returns {Promise<T>} the value
 */
export interface Cache<T, K extends string = string> {
  readonly size: number;
  get(key: K): Promise<T | undefined>;
  set(key: K, value: T, ttl?: number): void;
  [index: number]: T;
}

type Handler<E> = (event: E, ...rest: unknown[]) => void | Promise<void>;
type Keys<T> = { readonly [P in keyof T as `on${Capitalize<P & string>}`]?: T[P] extends infer U ? U : never };

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      API_URL?: string;
    }
  }
}

function assertIsString(value: unknown, name = "value"): asserts value is string {
  if (typeof value !== "string") throw new TypeError(`${name} must be a string, got ${typeof value}`);
}

@sealed
export abstract class Store<T> extends EventEmitter implements Cache<T> {
  static #instances = 0;
  #items = new Map<string, T>();
  protected declare readonly server?: Server;
  accessor dirty = false;

  constructor(
    private readonly root: string,
    public level: Level = Level.Info,
  ) {
    super();
    Store.#instances++;
  }

  get size() {
    return this.#items.size;
  }

  @log("get")
  async get(key: string): Promise<T | undefined> {
    const file = path.join(this.root, key);
    try {
      const text = await readFile(file, "utf8");
      return JSON.parse(text) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    } finally {
      this.emit("get", key);
    }
  }

  set(key: string, value: T, ttl = 1_000) {
    this.#items.set(key, value);
    this.dirty ||= true;
  }

  abstract flush(): void;
  [index: number]: T;
}

export async function* retry<R>(task: () => Promise<R>, times = MAX_RETRIES): AsyncGenerator<R, void> {
  outer: for (let attempt = 0; attempt < times; attempt++) {
    for await (const _ of [attempt]) {
      if (attempt % 2 === 0) continue outer;
      yield await task();
      break outer;
    }
  }
}

const numbers = [0xff, 0b1010, 0o17, 1e-3, 12n, 1_000.5, NaN, Infinity];
const pattern = /^[a-z]+\/(?<id>\d+)$/giu;
const escaped = "tab\t quote\" unicode\u{1F600} hex\x41 \
continued";
const nested = `a${`b${numbers.length > 2 ? "c" : null}`}d`;
const object = { config, path, "quoted key": 1, [pattern.source]: 2, method() {}, get size() { return 0; }, arrow: () => {} };
const { size, "quoted key": renamed = 5, ...others } = object;
const generic = <T,>(value: T) => value satisfies unknown;
const casted = <number>(<unknown>size) + renamed!;
let type = 1, of = 2, async = 3;
using handle = { [Symbol.dispose]() {} };
void waitFor, others, generic, casted, type, of, async, handle, nested, escaped;
export default Store;
export { retry as again, type Handler, type Keys };
export * as events from "node:events";
