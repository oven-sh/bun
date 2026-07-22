'use strict';
// Serves require('internal/*') for byte-identical node v26.3.0 lib/internal
// copies under ./nodeinternals/, evaluated with an emulated `primordials` and
// a scoped require mapping their dependencies onto bun's real machinery.

const fs = require('fs');
const path = require('path');
const util = require('util');

const VENDORED = new Set([
  'internal/webidl',
  'internal/socket_list',
  'internal/fs/utils',
  'internal/crypto/util',
  'internal/crypto/webidl',
  'internal/crypto/hashnames',
]);

// ---------------- primordials emulator ----------------
const globalsMap = {
  Array, ArrayBuffer, BigInt, Boolean, DataView, Date, Error, EvalError,
  FinalizationRegistry, Function, JSON, Map, Math, Number, Object, Promise,
  Proxy, RangeError, ReferenceError, Reflect, RegExp, Set, String, Symbol,
  SyntaxError, TypeError, URIError, WeakMap, WeakRef, WeakSet,
  BigInt64Array, BigUint64Array, Float32Array, Float64Array, Int8Array,
  Int16Array, Int32Array, Uint8Array, Uint16Array, Uint32Array,
  Uint8ClampedArray,
};
if (typeof SharedArrayBuffer !== 'undefined') globalsMap.SharedArrayBuffer = SharedArrayBuffer;
const TypedArray = Object.getPrototypeOf(Uint8Array);

const uncurryThis = fn => (thisArg, ...args) => Reflect.apply(fn, thisArg, args);

function lowerFirst(s) {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function resolveOnCtor(ctor, rest, name) {
  if (rest in ctor) {
    const v = ctor[rest];
    return typeof v === 'function' ? v.bind(ctor) : v;
  }
  const lowered = lowerFirst(rest);
  if (lowered in ctor) {
    const v = ctor[lowered];
    return typeof v === 'function' ? v.bind(ctor) : v;
  }
  if (ctor === Symbol) {
    const sym = Symbol[lowerFirst(rest)];
    if (sym !== undefined) return sym;
  }
  throw new Error(`nodeinternals primordials: cannot resolve ${name}`);
}

function findDesc(proto, key) {
  let p = proto;
  while (p) {
    const d = Object.getOwnPropertyDescriptor(p, key);
    if (d) return d;
    p = Object.getPrototypeOf(p);
  }
}

function resolveOnProto(proto, rest, name) {
  if (rest.startsWith('Get') && rest.length > 3) {
    const propName = rest.slice(3);
    const key = propName === 'SymbolToStringTag' ? Symbol.toStringTag : lowerFirst(propName);
    const desc = findDesc(proto, key);
    if (desc && desc.get) return uncurryThis(desc.get);
  }
  if (rest.startsWith('Symbol') && rest.length > 6) {
    const sym = Symbol[lowerFirst(rest.slice(6))];
    if (sym !== undefined && proto[sym]) return uncurryThis(proto[sym]);
  }
  const key = lowerFirst(rest);
  const desc = findDesc(proto, key);
  if (desc) {
    if (desc.get && !desc.value) return uncurryThis(desc.get);
    return uncurryThis(desc.value);
  }
  throw new Error(`nodeinternals primordials: cannot resolve ${name}`);
}

class SafeArrayIterator {
  #arr;
  constructor(arr) { this.#arr = arr; }
  [Symbol.iterator]() { return this.#arr[Symbol.iterator](); }
}

function computePrimordial(name) {
  if (name === 'uncurryThis') return uncurryThis;
  if (name === 'makeSafe') return (_unsafe, safe) => safe;
  if (name === 'globalThis') return globalThis;
  if (name === 'SafeArrayIterator') return SafeArrayIterator;
  if (name === 'SafeStringIterator') return SafeArrayIterator;
  if (name === 'SafeMap') return Map;
  if (name === 'SafeSet') return Set;
  if (name === 'SafeWeakMap') return WeakMap;
  if (name === 'SafeWeakSet') return WeakSet;
  if (name === 'SafeWeakRef') return WeakRef;
  if (name === 'SafeFinalizationRegistry') return FinalizationRegistry;
  if (name === 'SafePromiseAll') return (arr, mapFn) => Promise.all(mapFn ? arr.map(mapFn) : arr);
  if (name === 'SafePromiseAllReturnVoid') return (arr, mapFn) => Promise.all(mapFn ? arr.map(mapFn) : arr).then(() => {});
  if (name === 'SafePromiseAllSettled') return (arr, mapFn) => Promise.allSettled(mapFn ? arr.map(mapFn) : arr);
  if (name === 'SafePromisePrototypeFinally') return (p, fn) => p.finally(fn);
  if (name === 'SafeRegExp') return RegExp;
  if (name === 'PromiseResolve') return Promise.resolve.bind(Promise);
  if (name === 'PromiseReject') return Promise.reject.bind(Promise);
  if (name === 'PromiseWithResolvers') return Promise.withResolvers.bind(Promise);

  if (name === 'TypedArray') return TypedArray;
  if (name.startsWith('TypedArrayPrototype')) {
    return resolveOnProto(TypedArray.prototype, name.slice('TypedArrayPrototype'.length), name);
  }

  for (const g of Object.keys(globalsMap)) {
    if (name === g) return globalsMap[g];
    if (name.startsWith(g + 'Prototype')) {
      return resolveOnProto(globalsMap[g].prototype, name.slice(g.length + 'Prototype'.length), name);
    }
  }
  let best = null;
  for (const g of Object.keys(globalsMap)) {
    if (name.startsWith(g) && name.length > g.length && (!best || g.length > best.length)) best = g;
  }
  if (best) return resolveOnCtor(globalsMap[best], name.slice(best.length), name);
  throw new Error(`nodeinternals primordials: cannot resolve ${name}`);
}

const primCache = new Map();
const primordials = new Proxy({}, {
  get(_t, name) {
    if (typeof name !== 'string') return undefined;
    if (primCache.has(name)) return primCache.get(name);
    const v = computePrimordial(name);
    primCache.set(name, v);
    return v;
  },
  has() { return true; },
});

// ---------------- node-message-compatible error classes ----------------
// Formatters ported from node's lib/internal/errors.js so vendored internals
// throw byte-identical messages.
const classRegExp = /^[A-Z][a-zA-Z0-9]*$/;
const kTypes = ['string', 'function', 'number', 'object', 'Function', 'Object', 'boolean', 'bigint', 'symbol'];

function formatList(array, type = 'and') {
  switch (array.length) {
    case 0: return '';
    case 1: return `${array[0]}`;
    case 2: return `${array[0]} ${type} ${array[1]}`;
    case 3: return `${array[0]}, ${array[1]}, ${type} ${array[2]}`;
    default:
      return `${array.slice(0, -1).join(', ')}, ${type} ${array[array.length - 1]}`;
  }
}

function addNumericalSeparator(val) {
  let res = '';
  let i = val.length;
  const start = val[0] === '-' ? 1 : 0;
  for (; i >= start + 4; i -= 3) {
    res = `_${val.slice(i - 3, i)}${res}`;
  }
  return `${val.slice(0, i)}${res}`;
}

function determineSpecificType(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  const type = typeof value;
  switch (type) {
    case 'bigint':
      return `type bigint (${value}n)`;
    case 'number':
      if (value === 0) return 1 / value === -Infinity ? 'type number (-0)' : 'type number (0)';
      if (value !== value) return 'type number (NaN)';
      if (value === Infinity) return 'type number (Infinity)';
      if (value === -Infinity) return 'type number (-Infinity)';
      return `type number (${value})`;
    case 'boolean':
      return value ? 'type boolean (true)' : 'type boolean (false)';
    case 'symbol':
      return `type symbol (${String(value)})`;
    case 'function':
      return `function ${value.name}`;
    case 'object':
      if (value.constructor && 'name' in value.constructor) {
        return `an instance of ${value.constructor.name}`;
      }
      return `${util.inspect(value, { depth: -1 })}`;
    case 'string':
      if (value.length > 28) value = `${value.slice(0, 25)}...`;
      if (value.indexOf("'") === -1) return `type string ('${value}')`;
      return `type string (${JSON.stringify(value)})`;
    default: {
      let inspected = util.inspect(value, { colors: false });
      if (inspected.length > 28) inspected = `${inspected.slice(0, 25)}...`;
      return `type ${type} (${inspected})`;
    }
  }
}

function invalidArgTypeMsg(name, expected, actual) {
  if (!Array.isArray(expected)) expected = [expected];

  let msg = 'The ';
  if (name.endsWith(' argument')) {
    msg += `${name} `;
  } else {
    const type = name.includes('.') ? 'property' : 'argument';
    msg += `"${name}" ${type} `;
  }
  msg += 'must be ';

  const types = [];
  const instances = [];
  const other = [];
  for (const value of expected) {
    if (kTypes.includes(value)) {
      types.push(value.toLowerCase());
    } else if (classRegExp.test(value)) {
      instances.push(value);
    } else {
      other.push(value);
    }
  }
  if (instances.length > 0) {
    const pos = types.indexOf('object');
    if (pos !== -1) {
      types.splice(pos, 1);
      instances.push('Object');
    }
  }
  if (types.length > 0) {
    msg += `${types.length > 1 ? 'one of type' : 'of type'} ${formatList(types, 'or')}`;
    if (instances.length > 0 || other.length > 0) msg += ' or ';
  }
  if (instances.length > 0) {
    msg += `an instance of ${formatList(instances, 'or')}`;
    if (other.length > 0) msg += ' or ';
  }
  if (other.length > 0) {
    if (other.length > 1) {
      msg += `one of ${formatList(other, 'or')}`;
    } else {
      if (other[0].toLowerCase() !== other[0]) msg += 'an ';
      msg += `${other[0]}`;
    }
  }
  msg += `. Received ${determineSpecificType(actual)}`;
  return msg;
}

function outOfRangeMsg(str, range, input, replaceDefaultBoolean = false) {
  let msg = replaceDefaultBoolean ? str : `The value of "${str}" is out of range.`;
  let received;
  if (Number.isInteger(input) && Math.abs(input) > 2 ** 32) {
    received = addNumericalSeparator(String(input));
  } else if (typeof input === 'bigint') {
    received = String(input);
    if (input > 2n ** 32n || input < -(2n ** 32n)) {
      received = addNumericalSeparator(received);
    }
    received += 'n';
  } else {
    received = util.inspect(input);
  }
  msg += ` It must be ${range}. Received ${received}`;
  return msg;
}

// node's SystemError (context-object errors like ERR_FS_EISDIR).
function makeSystemErrorClass(code, prefix) {
  class NodeSystemError extends Error {
    constructor(context) {
      let message = `${prefix}: ${context.syscall} returned ${context.code} (${context.message})`;
      if (context.path !== undefined) message += ` ${context.path}`;
      if (context.dest !== undefined) message += ` => ${context.dest}`;
      super(message);
      this.code = code;
      Object.defineProperties(this, {
        name: { __proto__: null, value: 'SystemError', enumerable: false, writable: true, configurable: true },
        info: { __proto__: null, value: context, enumerable: true, configurable: true, writable: false },
        errno: {
          __proto__: null,
          get() { return context.errno; },
          set: (value) => { context.errno = value; },
          enumerable: true,
          configurable: true,
        },
        syscall: {
          __proto__: null,
          get() { return context.syscall; },
          set: (value) => { context.syscall = value; },
          enumerable: true,
          configurable: true,
        },
      });
      if (context.path !== undefined) this.path = context.path;
      if (context.dest !== undefined) this.dest = context.dest;
    }
    toString() {
      return `${this.name} [${this.code}]: ${this.message}`;
    }
  }
  Object.defineProperty(NodeSystemError, 'name', { value: code });
  NodeSystemError.HideStackFramesError = NodeSystemError;
  return NodeSystemError;
}

const errDefs = {
  ERR_CHILD_CLOSED_BEFORE_REPLY: [Error, () => 'Child closed before reply received'],
  ERR_INVALID_ARG_TYPE: [TypeError, invalidArgTypeMsg],
  ERR_INVALID_ARG_VALUE: [TypeError, (name, value, reason = 'is invalid') => {
    let inspected = util.inspect(value);
    if (inspected.length > 128) inspected = `${inspected.slice(0, 128)}...`;
    const type = name.includes('.') ? 'property' : 'argument';
    return `The ${type} '${name}' ${reason}. Received ${inspected}`;
  }],
  ERR_OUT_OF_RANGE: [RangeError, outOfRangeMsg],
  ERR_MISSING_ARGS: [TypeError, (...args) => {
    const names = args.map((a) => (Array.isArray(a) ? a.map((x) => `"${x}"`).join(' or ') : `"${a}"`));
    let msg = 'The ';
    switch (names.length) {
      case 1: msg += `${names[0]} argument`; break;
      case 2: msg += `${names[0]} and ${names[1]} arguments`; break;
      default: msg += `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]} arguments`;
    }
    return `${msg} must be specified`;
  }],
  ERR_MISSING_OPTION: [TypeError, (n) => `${n} is required`],
  ERR_INVALID_THIS: [TypeError, (t) => `Value of "this" must be of type ${t}`],
  ERR_INCOMPATIBLE_OPTION_PAIR: [TypeError, (a, b) => `Option "${a}" cannot be used in combination with option "${b}"`],
  ERR_NO_TEMPORAL: [Error, () => 'Temporal unavailable'],
  ERR_CRYPTO_CUSTOM_ENGINE_NOT_SUPPORTED: [Error, () => 'Custom engines not supported by this OpenSSL'],
  ERR_CRYPTO_ENGINE_UNKNOWN: [Error, (e) => `Engine "${e}" was not found`],
};

const systemErrDefs = {
  ERR_FS_EISDIR: 'Path is a directory',
};

const errClassCache = new Map();
function getErrClass(code) {
  if (errClassCache.has(code)) return errClassCache.get(code);
  let cls;
  if (Object.prototype.hasOwnProperty.call(systemErrDefs, code)) {
    cls = makeSystemErrorClass(code, systemErrDefs[code]);
  } else {
    const [Base, fmt] = errDefs[code] || [Error, (...a) => a.join(' ')];
    cls = class extends Base {
      constructor(...args) {
        super(typeof fmt === 'function' ? fmt(...args) : String(fmt));
        this.code = code;
      }
      toString() {
        return `${this.name} [${this.code}]: ${this.message}`;
      }
    };
    Object.defineProperty(cls, 'name', { value: code });
    cls.HideStackFramesError = cls;
  }
  errClassCache.set(code, cls);
  return cls;
}
const codes = new Proxy({}, { get: (_t, code) => (typeof code === 'string' ? getErrClass(code) : undefined) });

// node's UVException: composes `CODE: message, syscall 'path'` from a context
// object; the uv code/message pair comes from the real system error map.
class UVException extends Error {
  constructor(ctx) {
    const entry = util.getSystemErrorMap().get(ctx.errno);
    const code = entry ? entry[0] : 'UNKNOWN';
    const uvmsg = entry ? entry[1] : 'unknown error';
    let message = `${code}: ${ctx.message || uvmsg}, ${ctx.syscall}`;
    let path;
    let dest;
    if (ctx.path) {
      path = ctx.path.toString();
      message += ` '${path}'`;
    }
    if (ctx.dest) {
      dest = ctx.dest.toString();
      message += ` -> '${dest}'`;
    }
    super(message);
    for (const prop of Object.keys(ctx)) {
      if (prop === 'message' || prop === 'path' || prop === 'dest') continue;
      this[prop] = ctx[prop];
    }
    this.code = code;
    if (path) this.path = path;
    if (dest) this.dest = dest;
  }
  get ['constructor']() {
    return Error;
  }
}

function hideStackFrames(fn) {
  fn.withoutStackTrace = fn;
  return fn;
}

// ---------------- scoped require + internalBinding ----------------
let realInternalBinding;
function internalBinding(name) {
  if (name === 'crypto') {
    // Only what internal/crypto/util's module-level destructure touches.
    // BoringSSL has no OpenSSL security-level machinery: level 0 (= no
    // seclevel-based restrictions) is the honest answer.
    return new Proxy({
      getOpenSSLSecLevelCrypto: () => 0,
      getCachedAliases: () => ({ __proto__: null }),
      getCiphers: () => require('crypto').getCiphers(),
      getCurves: () => require('crypto').getCurves(),
      getHashes: () => require('crypto').getHashes(),
      timingSafeEqual: require('crypto').timingSafeEqual,
      secureHeapUsed: () => ({}),
    }, { get: (t, k) => (k in t ? t[k] : undefined), has: () => true });
  }
  realInternalBinding ??= require('internal/test/binding').internalBinding;
  return realInternalBinding(name);
}

let overrides;
function getOverrides() {
  if (overrides) return overrides;
  const X = require('bun:internal-for-testing').exposedInternals;
  const iu = X['internal/util'];

  function setOwnProperty(obj, key, value) {
    return Object.defineProperty(obj, key, {
      __proto__: null,
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }

  const iuExtended = {
    ...iu,
    setOwnProperty,
    once(callback, { preserveReturnValue = false } = {}) {
      let called = false;
      let returnValue;
      return function (...args) {
        if (called) return returnValue;
        called = true;
        const result = Reflect.apply(callback, this, args);
        returnValue = preserveReturnValue ? result : undefined;
        return result;
      };
    },
    isWindows: process.platform === 'win32',
    deprecate: util.deprecate,
    lazyDOMException: (message, name) => new DOMException(message, name),
    cachedResult(fn) {
      // node returns a fresh copy per call so callers cannot corrupt the cache.
      let result;
      return () => {
        if (result === undefined) result = fn();
        return result.slice();
      };
    },
    filterDuplicateStrings(items = [], low) {
      const map = new Map();
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const key = item.toLowerCase();
        if (low) map.set(key, key);
        else map.set(key, item);
      }
      return Array.from(map.values()).sort();
    },
    emitExperimentalWarning: () => {},
    getConstructorOf(obj) {
      while (obj) {
        const descriptor = Object.getOwnPropertyDescriptor(obj, 'constructor');
        if (descriptor !== undefined && typeof descriptor.value === 'function' && descriptor.value.name !== '') {
          return descriptor.value;
        }
        obj = Object.getPrototypeOf(obj);
      }
      return null;
    },
  };

  overrides = {
    'internal/errors': {
      ...(X['internal/errors'] || {}),
      codes,
      hideStackFrames,
      isErrorStackTraceLimitWritable: () => true,
      UVException,
    },
    'internal/util': iuExtended,
    'internal/util/types': require('util/types'),
    'internal/util/inspect': X['internal/util/inspect'],
    'internal/validators': X['internal/validators'],
    'internal/assert': Object.assign(
      (v, msg) => { if (!v) throw new Error(msg || 'internal assertion failed'); },
      { fail: (m) => { throw new Error(m); } },
    ),
    'internal/url': {
      toPathIfFileURL: (p) => (p instanceof URL ? require('url').fileURLToPath(p) : p),
    },
    'internal/options': { getOptionValue: () => undefined },
    'internal/v8/startup_snapshot': {
      namespace: { isBuildingSnapshot: () => false, addSerializeCallback: () => {} },
    },
    'internal/crypto/webcrypto': { CryptoKey: globalThis.CryptoKey },
    'internal/crypto/keys': {
      getCryptoKeyAlgorithm: (k) => k.algorithm,
      getCryptoKeyType: (k) => k.type,
    },
  };
  return overrides;
}

// ---------------- module evaluation ----------------
const cache = new Map();

function scopedRequire(id) {
  const ov = getOverrides();
  if (Object.prototype.hasOwnProperty.call(ov, id)) return ov[id];
  if (VENDORED.has(id)) return loadVendored(id);
  if (id.startsWith('internal/')) {
    throw new Error(`nodeinternals: vendored module requires unmapped '${id}'`);
  }
  return require(id);
}

function loadVendored(id) {
  if (cache.has(id)) return cache.get(id).exports;
  const file = path.join(__dirname, 'nodeinternals', id + '.js');
  const src = fs.readFileSync(file, 'utf8');
  const module = { exports: {} };
  cache.set(id, module);
  const fn = new Function('require', 'module', 'exports', 'primordials', 'internalBinding', 'process', src);
  try {
    fn(scopedRequire, module, module.exports, primordials, internalBinding, process);
  } catch (e) {
    cache.delete(id);
    throw e;
  }
  return module.exports;
}

// Entry point for the interceptor: returns the module or undefined for
// non-vendored ids.
function requireVendoredNodeInternal(id) {
  if (!VENDORED.has(id)) return undefined;
  return loadVendored(id);
}

module.exports = { requireVendoredNodeInternal };
