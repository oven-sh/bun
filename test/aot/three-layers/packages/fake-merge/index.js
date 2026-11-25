// A package that lays what one object holds on another. The application and the tests hand it objects of every image, and it stores into them under keys that it does not know.
const isPlain = value => value !== null && typeof value === "object" && !Array.isArray(value);

export function set(object, key, value) {
  object[key] = value;
  return object;
}

export function assignAll(object, source) {
  for (const key of Object.keys(source)) if (key !== "__proto__") set(object, key, source[key]);
  return object;
}

function layOver(below, above, choose) {
  for (const key of Object.keys(above)) {
    if (key === "__proto__") continue;
    const old = below[key];
    const given = above[key];
    const chosen = choose === undefined ? undefined : choose(old, given, key, below, above);
    if (chosen !== undefined) set(below, key, chosen);
    else if (isPlain(given)) set(below, key, layOver(isPlain(old) ? old : {}, given, choose));
    else if (Array.isArray(given)) set(below, key, Array.isArray(old) ? given.concat(old.slice(given.length)) : given.slice());
    else if (given !== undefined) set(below, key, given);
    else if (!(key in below)) set(below, key, undefined);
  }
  return below;
}

export function mergeWith(object, ...sourcesAndCustomizer) {
  const last = sourcesAndCustomizer.at(-1);
  const choose = typeof last === "function" ? sourcesAndCustomizer.pop() : undefined;
  for (const source of sourcesAndCustomizer) if (source !== null && source !== undefined) layOver(object, source, choose);
  return object;
}

export function makeTheirs(i) {
  return i & 1 ? { a: i, b: "theirs", nested: { x: i } } : { a: i, nested: {} };
}

export class Theirs {
  constructor(i) {
    this.a = i;
    if (i & 2) this.b = "b" + i;
    this.nested = { x: i, list: [i] };
  }
}

const defaults = { a: 0, b: "default", nested: null, n: 1 };
export const copiers = {
  copy: object => ({ ...object }),
  overDefaults: object => ({ ...defaults, ...object }),
  underDefaults: object => ({ ...object, ...defaults }),
  assign: object => Object.assign({ n: 0 }, object),
  assignTwo: object => Object.assign({}, defaults, object),
  rest: object => {
    const { a, ...others } = object;
    return [a, others];
  },
  entries: object => Object.fromEntries(Object.entries(object)),
};

export const packageText = "text of the package";
export const packageTextReadAboveFirst = "text that a file above reads first";
export let packageMode = "one";
export function setPackageMode(mode) {
  packageMode = mode;
}

export const codeFromText = (parameters, body) => new Function(...parameters, body);
export const importByPath = path => import(path);
export const requireByPath = path => require(path);

export const payloadOfThePackage = value => ({ value, issues: [] });
export const readPayloadInThePackage = payload => [payload.value, payload.issues, payload.issues.length];

export class StaticsOfThePackage {
  static limit = 3;
  static label = "package";
  static twice() {
    return this.limit * 2;
  }
}
