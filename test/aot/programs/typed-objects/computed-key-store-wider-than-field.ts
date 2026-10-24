// A store under a key that is a union of names is accepted by TypeScript for any value when one of the named properties is `any`. The store does not throw. A read of the field by its name through the written type finds a value of another kind and throws a TypeError.
type Body = { json: any; text: string; bytes: Uint8Array };
interface Raw {
  json(): Promise<any>;
  text(): Promise<string>;
  bytes(): Promise<Uint8Array>;
}

class CachingRequest {
  raw: Raw;
  bodyCache: Partial<Body> = {};
  constructor(raw: Raw) {
    this.raw = raw;
  }
  #cachedBody = (key: keyof Body) => {
    const { bodyCache, raw } = this;
    const cached = bodyCache[key];
    if (cached) return cached;
    return (bodyCache[key] = raw[key]());
  };
  text(): Promise<string> {
    return this.#cachedBody("text");
  }
  json<T = any>(): Promise<T> {
    return this.#cachedBody("text").then((text: string) => JSON.parse(text));
  }
  bytes(): Promise<Uint8Array> {
    return this.#cachedBody("bytes");
  }
}

let reads = 0;
const raw: Raw = {
  json: async () => ({ a: ++reads }),
  text: async () => `{"a":${++reads}}`,
  bytes: async () => new Uint8Array([++reads]),
};

const request = new CachingRequest(raw);
console.log(JSON.stringify(await request.json()), await request.text(), (await request.bytes())[0], reads);
console.log(Object.keys(request.bodyCache).join(), (request.bodyCache as any).text instanceof Promise, typeof request.bodyCache.json);

interface Settings {
  extra: any;
  name: string;
  size: number;
}
function set(settings: Settings, key: "extra" | "name", value: number[]) {
  settings[key] = value;
}
const settings: Settings = { extra: 1, name: "a", size: 2 };
set(settings, "name", [1, 2]);
try { console.log(JSON.stringify(settings), Array.isArray(settings.name), settings.size + 1); } catch (e) { console.log("a read of settings.name:", (e as Error).constructor.name); }
set(settings, "extra", [3]);
console.log(JSON.stringify(settings));
