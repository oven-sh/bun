import { itBundled } from "./expectBundled";
import { describe } from "bun:test";

const reflectMetadata = `
var Reflect2;
(function(Reflect3) {
  (function(factory) {
    var root = typeof global === "object" ? global : typeof self === "object" ? self : typeof this === "object" ? this : Function("return this;")();
    var exporter = makeExporter(Reflect3);
    if (typeof root.Reflect === "undefined") {
      root.Reflect = Reflect3;
    } else {
      exporter = makeExporter(root.Reflect, exporter);
    }
    factory(exporter);
    function makeExporter(target, previous) {
      return function(key, value) {
        if (typeof target[key] !== "function") {
          Object.defineProperty(target, key, { configurable: true, writable: true, value });
        }
        if (previous)
          previous(key, value);
      };
    }
  })(function(exporter) {
    var hasOwn = Object.prototype.hasOwnProperty;
    var supportsSymbol = typeof Symbol === "function";
    var toPrimitiveSymbol = supportsSymbol && typeof Symbol.toPrimitive !== "undefined" ? Symbol.toPrimitive : "@@toPrimitive";
    var iteratorSymbol = supportsSymbol && typeof Symbol.iterator !== "undefined" ? Symbol.iterator : "@@iterator";
    var supportsCreate = typeof Object.create === "function";
    var supportsProto = { __proto__: [] } instanceof Array;
    var downLevel = !supportsCreate && !supportsProto;
    var HashMap = {
      create: supportsCreate ? function() {
        return MakeDictionary(Object.create(null));
      } : supportsProto ? function() {
        return MakeDictionary({ __proto__: null });
      } : function() {
        return MakeDictionary({});
      },
      has: downLevel ? function(map, key) {
        return hasOwn.call(map, key);
      } : function(map, key) {
        return key in map;
      },
      get: downLevel ? function(map, key) {
        return hasOwn.call(map, key) ? map[key] : undefined;
      } : function(map, key) {
        return map[key];
      }
    };
    var functionPrototype = Object.getPrototypeOf(Function);
    var usePolyfill = typeof process === "object" && process.env && process.env["REFLECT_METADATA_USE_MAP_POLYFILL"] === "true";
    var _Map = !usePolyfill && typeof Map === "function" && typeof Map.prototype.entries === "function" ? Map : CreateMapPolyfill();
    var _Set = !usePolyfill && typeof Set === "function" && typeof Set.prototype.entries === "function" ? Set : CreateSetPolyfill();
    var _WeakMap = !usePolyfill && typeof WeakMap === "function" ? WeakMap : CreateWeakMapPolyfill();
    var Metadata = new _WeakMap;
    function decorate(decorators, target, propertyKey, attributes) {
      if (!IsUndefined(propertyKey)) {
        if (!IsArray(decorators))
          throw new TypeError;
        if (!IsObject(target))
          throw new TypeError;
        if (!IsObject(attributes) && !IsUndefined(attributes) && !IsNull(attributes))
          throw new TypeError;
        if (IsNull(attributes))
          attributes = undefined;
        propertyKey = ToPropertyKey(propertyKey);
        return DecorateProperty(decorators, target, propertyKey, attributes);
      } else {
        if (!IsArray(decorators))
          throw new TypeError;
        if (!IsConstructor(target))
          throw new TypeError;
        return DecorateConstructor(decorators, target);
      }
    }
    exporter("decorate", decorate);
    function metadata(metadataKey, metadataValue) {
      function decorator(target, propertyKey) {
        if (!IsObject(target))
          throw new TypeError;
        if (!IsUndefined(propertyKey) && !IsPropertyKey(propertyKey))
          throw new TypeError;
        OrdinaryDefineOwnMetadata(metadataKey, metadataValue, target, propertyKey);
      }
      return decorator;
    }
    exporter("metadata", metadata);
    function defineMetadata(metadataKey, metadataValue, target, propertyKey) {
      if (!IsObject(target))
        throw new TypeError;
      if (!IsUndefined(propertyKey))
        propertyKey = ToPropertyKey(propertyKey);
      return OrdinaryDefineOwnMetadata(metadataKey, metadataValue, target, propertyKey);
    }
    exporter("defineMetadata", defineMetadata);
    function hasMetadata(metadataKey, target, propertyKey) {
      if (!IsObject(target))
        throw new TypeError;
      if (!IsUndefined(propertyKey))
        propertyKey = ToPropertyKey(propertyKey);
      return OrdinaryHasMetadata(metadataKey, target, propertyKey);
    }
    exporter("hasMetadata", hasMetadata);
    function hasOwnMetadata(metadataKey, target, propertyKey) {
      if (!IsObject(target))
        throw new TypeError;
      if (!IsUndefined(propertyKey))
        propertyKey = ToPropertyKey(propertyKey);
      return OrdinaryHasOwnMetadata(metadataKey, target, propertyKey);
    }
    exporter("hasOwnMetadata", hasOwnMetadata);
    function getMetadata(metadataKey, target, propertyKey) {
      if (!IsObject(target))
        throw new TypeError;
      if (!IsUndefined(propertyKey))
        propertyKey = ToPropertyKey(propertyKey);
      return OrdinaryGetMetadata(metadataKey, target, propertyKey);
    }
    exporter("getMetadata", getMetadata);
    function getOwnMetadata(metadataKey, target, propertyKey) {
      if (!IsObject(target))
        throw new TypeError;
      if (!IsUndefined(propertyKey))
        propertyKey = ToPropertyKey(propertyKey);
      return OrdinaryGetOwnMetadata(metadataKey, target, propertyKey);
    }
    exporter("getOwnMetadata", getOwnMetadata);
    function getMetadataKeys(target, propertyKey) {
      if (!IsObject(target))
        throw new TypeError;
      if (!IsUndefined(propertyKey))
        propertyKey = ToPropertyKey(propertyKey);
      return OrdinaryMetadataKeys(target, propertyKey);
    }
    exporter("getMetadataKeys", getMetadataKeys);
    function getOwnMetadataKeys(target, propertyKey) {
      if (!IsObject(target))
        throw new TypeError;
      if (!IsUndefined(propertyKey))
        propertyKey = ToPropertyKey(propertyKey);
      return OrdinaryOwnMetadataKeys(target, propertyKey);
    }
    exporter("getOwnMetadataKeys", getOwnMetadataKeys);
    function deleteMetadata(metadataKey, target, propertyKey) {
      if (!IsObject(target))
        throw new TypeError;
      if (!IsUndefined(propertyKey))
        propertyKey = ToPropertyKey(propertyKey);
      var metadataMap = GetOrCreateMetadataMap(target, propertyKey, false);
      if (IsUndefined(metadataMap))
        return false;
      if (!metadataMap.delete(metadataKey))
        return false;
      if (metadataMap.size > 0)
        return true;
      var targetMetadata = Metadata.get(target);
      targetMetadata.delete(propertyKey);
      if (targetMetadata.size > 0)
        return true;
      Metadata.delete(target);
      return true;
    }
    exporter("deleteMetadata", deleteMetadata);
    function DecorateConstructor(decorators, target) {
      for (var i = decorators.length - 1;i >= 0; --i) {
        var decorator = decorators[i];
        var decorated = decorator(target);
        if (!IsUndefined(decorated) && !IsNull(decorated)) {
          if (!IsConstructor(decorated))
            throw new TypeError;
          target = decorated;
        }
      }
      return target;
    }
    function DecorateProperty(decorators, target, propertyKey, descriptor) {
      for (var i = decorators.length - 1;i >= 0; --i) {
        var decorator = decorators[i];
        var decorated = decorator(target, propertyKey, descriptor);
        if (!IsUndefined(decorated) && !IsNull(decorated)) {
          if (!IsObject(decorated))
            throw new TypeError;
          descriptor = decorated;
        }
      }
      return descriptor;
    }
    function GetOrCreateMetadataMap(O, P, Create) {
      var targetMetadata = Metadata.get(O);
      if (IsUndefined(targetMetadata)) {
        if (!Create)
          return;
        targetMetadata = new _Map;
        Metadata.set(O, targetMetadata);
      }
      var metadataMap = targetMetadata.get(P);
      if (IsUndefined(metadataMap)) {
        if (!Create)
          return;
        metadataMap = new _Map;
        targetMetadata.set(P, metadataMap);
      }
      return metadataMap;
    }
    function OrdinaryHasMetadata(MetadataKey, O, P) {
      var hasOwn2 = OrdinaryHasOwnMetadata(MetadataKey, O, P);
      if (hasOwn2)
        return true;
      var parent = OrdinaryGetPrototypeOf(O);
      if (!IsNull(parent))
        return OrdinaryHasMetadata(MetadataKey, parent, P);
      return false;
    }
    function OrdinaryHasOwnMetadata(MetadataKey, O, P) {
      var metadataMap = GetOrCreateMetadataMap(O, P, false);
      if (IsUndefined(metadataMap))
        return false;
      return ToBoolean(metadataMap.has(MetadataKey));
    }
    function OrdinaryGetMetadata(MetadataKey, O, P) {
      var hasOwn2 = OrdinaryHasOwnMetadata(MetadataKey, O, P);
      if (hasOwn2)
        return OrdinaryGetOwnMetadata(MetadataKey, O, P);
      var parent = OrdinaryGetPrototypeOf(O);
      if (!IsNull(parent))
        return OrdinaryGetMetadata(MetadataKey, parent, P);
      return;
    }
    function OrdinaryGetOwnMetadata(MetadataKey, O, P) {
      var metadataMap = GetOrCreateMetadataMap(O, P, false);
      if (IsUndefined(metadataMap))
        return;
      return metadataMap.get(MetadataKey);
    }
    function OrdinaryDefineOwnMetadata(MetadataKey, MetadataValue, O, P) {
      var metadataMap = GetOrCreateMetadataMap(O, P, true);
      metadataMap.set(MetadataKey, MetadataValue);
    }
    function OrdinaryMetadataKeys(O, P) {
      var ownKeys = OrdinaryOwnMetadataKeys(O, P);
      var parent = OrdinaryGetPrototypeOf(O);
      if (parent === null)
        return ownKeys;
      var parentKeys = OrdinaryMetadataKeys(parent, P);
      if (parentKeys.length <= 0)
        return ownKeys;
      if (ownKeys.length <= 0)
        return parentKeys;
      var set = new _Set;
      var keys = [];
      for (var _i = 0, ownKeys_1 = ownKeys;_i < ownKeys_1.length; _i++) {
        var key = ownKeys_1[_i];
        var hasKey = set.has(key);
        if (!hasKey) {
          set.add(key);
          keys.push(key);
        }
      }
      for (var _a = 0, parentKeys_1 = parentKeys;_a < parentKeys_1.length; _a++) {
        var key = parentKeys_1[_a];
        var hasKey = set.has(key);
        if (!hasKey) {
          set.add(key);
          keys.push(key);
        }
      }
      return keys;
    }
    function OrdinaryOwnMetadataKeys(O, P) {
      var keys = [];
      var metadataMap = GetOrCreateMetadataMap(O, P, false);
      if (IsUndefined(metadataMap))
        return keys;
      var keysObj = metadataMap.keys();
      var iterator = GetIterator(keysObj);
      var k = 0;
      while (true) {
        var next = IteratorStep(iterator);
        if (!next) {
          keys.length = k;
          return keys;
        }
        var nextValue = IteratorValue(next);
        try {
          keys[k] = nextValue;
        } catch (e) {
          try {
            IteratorClose(iterator);
          } finally {
            throw e;
          }
        }
        k++;
      }
    }
    function Type(x) {
      if (x === null)
        return 1;
      switch (typeof x) {
        case "undefined":
          return 0;
        case "boolean":
          return 2;
        case "string":
          return 3;
        case "symbol":
          return 4;
        case "number":
          return 5;
        case "object":
          return x === null ? 1 : 6;
        default:
          return 6;
      }
    }
    function IsUndefined(x) {
      return x === undefined;
    }
    function IsNull(x) {
      return x === null;
    }
    function IsSymbol(x) {
      return typeof x === "symbol";
    }
    function IsObject(x) {
      return typeof x === "object" ? x !== null : typeof x === "function";
    }
    function ToPrimitive(input, PreferredType) {
      switch (Type(input)) {
        case 0:
          return input;
        case 1:
          return input;
        case 2:
          return input;
        case 3:
          return input;
        case 4:
          return input;
        case 5:
          return input;
      }
      var hint = PreferredType === 3 ? "string" : PreferredType === 5 ? "number" : "default";
      var exoticToPrim = GetMethod(input, toPrimitiveSymbol);
      if (exoticToPrim !== undefined) {
        var result = exoticToPrim.call(input, hint);
        if (IsObject(result))
          throw new TypeError;
        return result;
      }
      return OrdinaryToPrimitive(input, hint === "default" ? "number" : hint);
    }
    function OrdinaryToPrimitive(O, hint) {
      if (hint === "string") {
        var toString_1 = O.toString;
        if (IsCallable(toString_1)) {
          var result = toString_1.call(O);
          if (!IsObject(result))
            return result;
        }
        var valueOf = O.valueOf;
        if (IsCallable(valueOf)) {
          var result = valueOf.call(O);
          if (!IsObject(result))
            return result;
        }
      } else {
        var valueOf = O.valueOf;
        if (IsCallable(valueOf)) {
          var result = valueOf.call(O);
          if (!IsObject(result))
            return result;
        }
        var toString_2 = O.toString;
        if (IsCallable(toString_2)) {
          var result = toString_2.call(O);
          if (!IsObject(result))
            return result;
        }
      }
      throw new TypeError;
    }
    function ToBoolean(argument) {
      return !!argument;
    }
    function ToString(argument) {
      return "" + argument;
    }
    function ToPropertyKey(argument) {
      var key = ToPrimitive(argument, 3);
      if (IsSymbol(key))
        return key;
      return ToString(key);
    }
    function IsArray(argument) {
      return Array.isArray ? Array.isArray(argument) : argument instanceof Object ? argument instanceof Array : Object.prototype.toString.call(argument) === "[object Array]";
    }
    function IsCallable(argument) {
      return typeof argument === "function";
    }
    function IsConstructor(argument) {
      return typeof argument === "function";
    }
    function IsPropertyKey(argument) {
      switch (Type(argument)) {
        case 3:
          return true;
        case 4:
          return true;
        default:
          return false;
      }
    }
    function GetMethod(V, P) {
      var func = V[P];
      if (func === undefined || func === null)
        return;
      if (!IsCallable(func))
        throw new TypeError;
      return func;
    }
    function GetIterator(obj) {
      var method = GetMethod(obj, iteratorSymbol);
      if (!IsCallable(method))
        throw new TypeError;
      var iterator = method.call(obj);
      if (!IsObject(iterator))
        throw new TypeError;
      return iterator;
    }
    function IteratorValue(iterResult) {
      return iterResult.value;
    }
    function IteratorStep(iterator) {
      var result = iterator.next();
      return result.done ? false : result;
    }
    function IteratorClose(iterator) {
      var f = iterator["return"];
      if (f)
        f.call(iterator);
    }
    function OrdinaryGetPrototypeOf(O) {
      var proto = Object.getPrototypeOf(O);
      if (typeof O !== "function" || O === functionPrototype)
        return proto;
      if (proto !== functionPrototype)
        return proto;
      var prototype = O.prototype;
      var prototypeProto = prototype && Object.getPrototypeOf(prototype);
      if (prototypeProto == null || prototypeProto === Object.prototype)
        return proto;
      var constructor = prototypeProto.constructor;
      if (typeof constructor !== "function")
        return proto;
      if (constructor === O)
        return proto;
      return constructor;
    }
    function CreateMapPolyfill() {
      var cacheSentinel = {};
      var arraySentinel = [];
      var MapIterator = function() {
        function MapIterator2(keys, values, selector) {
          this._index = 0;
          this._keys = keys;
          this._values = values;
          this._selector = selector;
        }
        MapIterator2.prototype["@@iterator"] = function() {
          return this;
        };
        MapIterator2.prototype[iteratorSymbol] = function() {
          return this;
        };
        MapIterator2.prototype.next = function() {
          var index = this._index;
          if (index >= 0 && index < this._keys.length) {
            var result = this._selector(this._keys[index], this._values[index]);
            if (index + 1 >= this._keys.length) {
              this._index = -1;
              this._keys = arraySentinel;
              this._values = arraySentinel;
            } else {
              this._index++;
            }
            return { value: result, done: false };
          }
          return { value: undefined, done: true };
        };
        MapIterator2.prototype.throw = function(error) {
          if (this._index >= 0) {
            this._index = -1;
            this._keys = arraySentinel;
            this._values = arraySentinel;
          }
          throw error;
        };
        MapIterator2.prototype.return = function(value) {
          if (this._index >= 0) {
            this._index = -1;
            this._keys = arraySentinel;
            this._values = arraySentinel;
          }
          return { value, done: true };
        };
        return MapIterator2;
      }();
      return function() {
        function Map2() {
          this._keys = [];
          this._values = [];
          this._cacheKey = cacheSentinel;
          this._cacheIndex = -2;
        }
        Object.defineProperty(Map2.prototype, "size", {
          get: function() {
            return this._keys.length;
          },
          enumerable: true,
          configurable: true
        });
        Map2.prototype.has = function(key) {
          return this._find(key, false) >= 0;
        };
        Map2.prototype.get = function(key) {
          var index = this._find(key, false);
          return index >= 0 ? this._values[index] : undefined;
        };
        Map2.prototype.set = function(key, value) {
          var index = this._find(key, true);
          this._values[index] = value;
          return this;
        };
        Map2.prototype.delete = function(key) {
          var index = this._find(key, false);
          if (index >= 0) {
            var size = this._keys.length;
            for (var i = index + 1;i < size; i++) {
              this._keys[i - 1] = this._keys[i];
              this._values[i - 1] = this._values[i];
            }
            this._keys.length--;
            this._values.length--;
            if (key === this._cacheKey) {
              this._cacheKey = cacheSentinel;
              this._cacheIndex = -2;
            }
            return true;
          }
          return false;
        };
        Map2.prototype.clear = function() {
          this._keys.length = 0;
          this._values.length = 0;
          this._cacheKey = cacheSentinel;
          this._cacheIndex = -2;
        };
        Map2.prototype.keys = function() {
          return new MapIterator(this._keys, this._values, getKey);
        };
        Map2.prototype.values = function() {
          return new MapIterator(this._keys, this._values, getValue);
        };
        Map2.prototype.entries = function() {
          return new MapIterator(this._keys, this._values, getEntry);
        };
        Map2.prototype["@@iterator"] = function() {
          return this.entries();
        };
        Map2.prototype[iteratorSymbol] = function() {
          return this.entries();
        };
        Map2.prototype._find = function(key, insert) {
          if (this._cacheKey !== key) {
            this._cacheIndex = this._keys.indexOf(this._cacheKey = key);
          }
          if (this._cacheIndex < 0 && insert) {
            this._cacheIndex = this._keys.length;
            this._keys.push(key);
            this._values.push(undefined);
          }
          return this._cacheIndex;
        };
        return Map2;
      }();
      function getKey(key, _) {
        return key;
      }
      function getValue(_, value) {
        return value;
      }
      function getEntry(key, value) {
        return [key, value];
      }
    }
    function CreateSetPolyfill() {
      return function() {
        function Set2() {
          this._map = new _Map;
        }
        Object.defineProperty(Set2.prototype, "size", {
          get: function() {
            return this._map.size;
          },
          enumerable: true,
          configurable: true
        });
        Set2.prototype.has = function(value) {
          return this._map.has(value);
        };
        Set2.prototype.add = function(value) {
          return this._map.set(value, value), this;
        };
        Set2.prototype.delete = function(value) {
          return this._map.delete(value);
        };
        Set2.prototype.clear = function() {
          this._map.clear();
        };
        Set2.prototype.keys = function() {
          return this._map.keys();
        };
        Set2.prototype.values = function() {
          return this._map.values();
        };
        Set2.prototype.entries = function() {
          return this._map.entries();
        };
        Set2.prototype["@@iterator"] = function() {
          return this.keys();
        };
        Set2.prototype[iteratorSymbol] = function() {
          return this.keys();
        };
        return Set2;
      }();
    }
    function CreateWeakMapPolyfill() {
      var UUID_SIZE = 16;
      var keys = HashMap.create();
      var rootKey = CreateUniqueKey();
      return function() {
        function WeakMap2() {
          this._key = CreateUniqueKey();
        }
        WeakMap2.prototype.has = function(target) {
          var table = GetOrCreateWeakMapTable(target, false);
          return table !== undefined ? HashMap.has(table, this._key) : false;
        };
        WeakMap2.prototype.get = function(target) {
          var table = GetOrCreateWeakMapTable(target, false);
          return table !== undefined ? HashMap.get(table, this._key) : undefined;
        };
        WeakMap2.prototype.set = function(target, value) {
          var table = GetOrCreateWeakMapTable(target, true);
          table[this._key] = value;
          return this;
        };
        WeakMap2.prototype.delete = function(target) {
          var table = GetOrCreateWeakMapTable(target, false);
          return table !== undefined ? delete table[this._key] : false;
        };
        WeakMap2.prototype.clear = function() {
          this._key = CreateUniqueKey();
        };
        return WeakMap2;
      }();
      function CreateUniqueKey() {
        var key;
        do
          key = "@@WeakMap@@" + CreateUUID();
        while (HashMap.has(keys, key));
        keys[key] = true;
        return key;
      }
      function GetOrCreateWeakMapTable(target, create) {
        if (!hasOwn.call(target, rootKey)) {
          if (!create)
            return;
          Object.defineProperty(target, rootKey, { value: HashMap.create() });
        }
        return target[rootKey];
      }
      function FillRandomBytes(buffer, size) {
        for (var i = 0;i < size; ++i)
          buffer[i] = Math.random() * 255 | 0;
        return buffer;
      }
      function GenRandomBytes(size) {
        if (typeof Uint8Array === "function") {
          if (typeof crypto !== "undefined")
            return crypto.getRandomValues(new Uint8Array(size));
          if (typeof msCrypto !== "undefined")
            return msCrypto.getRandomValues(new Uint8Array(size));
          return FillRandomBytes(new Uint8Array(size), size);
        }
        return FillRandomBytes(new Array(size), size);
      }
      function CreateUUID() {
        var data = GenRandomBytes(UUID_SIZE);
        data[6] = data[6] & 79 | 64;
        data[8] = data[8] & 191 | 128;
        var result = "";
        for (var offset = 0;offset < UUID_SIZE; ++offset) {
          var byte = data[offset];
          if (offset === 4 || offset === 6 || offset === 8)
            result += "-";
          if (byte < 16)
            result += "0";
          result += byte.toString(16).toLowerCase();
        }
        return result;
      }
    }
    function MakeDictionary(obj) {
      obj.__ = undefined;
      delete obj.__;
      return obj;
    }
  });
})(Reflect2 || (Reflect2 = {}));
`;

describe("bundler", () => {
  itBundled("decorator_metadata/TypeSerialization", {
    files: {
      "/entry.ts": /* ts */ `

            ${reflectMetadata}

            function d1() {}
            class Known {}
            class Swag {}
            class A_1 {}
    
            // @ts-ignore
            @d1
            class Yolo {
                constructor(
                    p0: any,
                    p1: unknown,
                    p2: never,
                    p3: void,
                    p4: null,
                    p5: undefined,
                    p6: number,
                    p7: string,
                    p8: boolean,
                    p9: symbol,
                    p10: bigint,
                    p11: object,
                    p12: () => {},
                    p13: [],
                    p14: {},
                    p15: 123,
                    p16: 123n,
                    p17: "123",
                    p18: \`123\`,
                    p19: true,
                    p20: false,
                    // @ts-ignore
                    p21: Map,
                    // @ts-ignore
                    p22: Set,
                    p23: Known,
                    // @ts-ignore
                    p24: Unknown,
                    p25: never & string,
                    p26: string & never,
                    p27: null & string,
                    p28: string & null,
                    p29: undefined & string,
                    p30: string & undefined,
                    p31: void & string,
                    p32: string & void,
                    p33: unknown & string,
                    p34: string & unknown,
                    p35: any & string,
                    p36: string & any,
                    p37: never | string,
                    p38: string | never,
                    p39: null | string,
                    p40: string | null,
                    p41: undefined | string,
                    p42: string | undefined,
                    p43: void | string,
                    p44: string | void,
                    p45: unknown | string,
                    p46: string | unknown,
                    p47: any | string,
                    p48: string | any,
                    p49: string | string,
                    p50: string & string,
                    p51: Known | Swag,
                    p52: Swag | Known,
                    p53: Known & Swag,
                    p54: Swag & Known,
                    p55: never | Swag,
                    p56: Swag | never,
                    p57: null | Swag,
                    p58: Swag | null,
                    p59: undefined | Swag,
                    p60: Swag | undefined,
                    p61: void | Swag,
                    p62: Swag | void,
                    p63: unknown | Swag,
                    p64: Swag | unknown,
                    p65: any | Swag,
                    p66: Swag | any,
                    p67: never & Swag,
                    p68: Swag & never,
                    p69: null & Swag,
                    p70: Swag & null,
                    p71: undefined & Swag,
                    p72: Swag & undefined,
                    p73: void & Swag,
                    p74: Swag & void,
                    p75: unknown & Swag,
                    p76: Swag & unknown,
                    p77: any & Swag,
                    p78: Swag & any,
                    p79: Swag | Swag,
                    p80: Swag & Swag,
                    // @ts-ignore
                    p81: Unknown | Known,
                    // @ts-ignore
                    p82: Known | Unknown,
                    // @ts-ignore
                    p83: Unknown & Known,
                    // @ts-ignore
                    p84: Known & Unknown,
                    // @ts-ignore
                    p85: Unknown | Unknown,
                    // @ts-ignore
                    p86: Unknown & Unknown,
                    p87: never | never,
                    p88: never & never,
                    p89: null | null,
                    p90: null & null,
                    p91: undefined | undefined,
                    p92: undefined & undefined,
                    p93: void | void,
                    p94: void & void,
                    p95: unknown | unknown,
                    p96: unknown & unknown,
                    p97: any | any,
                    p98: any & any,
                    p99: never | void,
                    p100: void | never,
                    p101: null | void,
                    p102: void | null,
                    p103: undefined | void,
                    p104: void | undefined,
                    p105: void | void,
                    p106: void & void,
                    p107: unknown | void,
                    p108: void | unknown,
                    p109: any | void,
                    p110: void | any,
                    p111: never | unknown,
                    p112: unknown | never,
                    p113: null | unknown,
                    p114: unknown | null,
                    p115: undefined | unknown,
                    p116: unknown | undefined,
                    p117: void | unknown,
                    p118: unknown | void,
                    p119: unknown | unknown,
                    p120: unknown & unknown,
                    p121: any | unknown,
                    p122: unknown | any,
                    p123: never | any,
                    p124: any | never,
                    p125: null | any,
                    p126: any | null,
                    p127: undefined | any,
                    p128: any | undefined,
                    p129: void | any,
                    p130: any | void,
                    p131: unknown | any,
                    p132: any | unknown,
                    p133: any | any,
                    p134: never & void,
                    p135: void & never,
                    p136: null & void,
                    p137: void & null,
                    p138: undefined & void,
                    p139: void & undefined,
                    p140: void & void,
                    p141: void | void,
                    p142: unknown & void,
                    p143: void & unknown,
                    p144: any & void,
                    p145: void & any,
                    p146: never & unknown,
                    p147: unknown & never,
                    p148: null & unknown,
                    p149: unknown & null,
                    p150: undefined & unknown,
                    p151: unknown & undefined,
                    p152: void & unknown,
                    p153: unknown & void,
                    p154: unknown & unknown,
                    p155: unknown | unknown,
                    p156: any & unknown,
                    p157: unknown & any,
                    p158: never & any,
                    p159: any & never,
                    p160: null & any,
                    p161: any & null,
                    p162: undefined & any,
                    p163: any & undefined,
                    p164: void & any,
                    p165: any & void,
                    p166: unknown & any,
                    p167: any & unknown,
                    p168: any & any,
                    p169: string & number & boolean & never & symbol,
                    p170: "foo" | A_1,
                    p171: true | boolean,
                    p172: "foo" | boolean,
                    p173: A_1 | "foo",
                ){}
            }
    
            const received = Reflect.getMetadata("design:paramtypes", Yolo);
            console.log(received.length === 174);
            console.log(received[0] === Object);
            console.log(received[1] === Object);
            console.log(received[2] === void 0);
            console.log(received[3] === void 0);
            console.log(received[4] === void 0);
            console.log(received[5] === void 0);
            console.log(received[6] === Number);
            console.log(received[7] === String);
            console.log(received[8] === Boolean);
            console.log(received[9] === (typeof Symbol === "function" ? Symbol : Object));
            console.log(received[10] === (typeof BigInt === "function" ? BigInt : Object));
            console.log(received[11] === Object);
            console.log(received[12] === Function);
            console.log(received[13] === Array);
            console.log(received[14] === Object);
            console.log(received[15] === Number);
            console.log(received[16] === (typeof BigInt === "function" ? BigInt : Object));
            console.log(received[17] === String);
            console.log(received[18] === String);
            console.log(received[19] === Boolean);
            console.log(received[20] === Boolean);
            console.log(received[21] === Map);
            console.log(received[22] === Set);
            console.log(received[23] === Known);
            console.log(received[24] === Object);
            console.log(received[25] === void 0);
            console.log(received[26] === void 0);
            console.log(received[27] === String);
            console.log(received[28] === String);
            console.log(received[29] === String);
            console.log(received[30] === String);
            console.log(received[31] === Object);
            console.log(received[32] === Object);
            console.log(received[33] === String);
            console.log(received[34] === String);
            console.log(received[35] === Object);
            console.log(received[36] === Object);
            console.log(received[37] === String);
            console.log(received[38] === String);
            console.log(received[39] === String);
            console.log(received[40] === String);
            console.log(received[41] === String);
            console.log(received[42] === String);
            console.log(received[43] === Object);
            console.log(received[44] === Object);
            console.log(received[45] === Object);
            console.log(received[46] === Object);
            console.log(received[47] === Object);
            console.log(received[48] === Object);
            console.log(received[49] === String);
            console.log(received[50] === String);
            console.log(received[51] === Object);
            console.log(received[52] === Object);
            console.log(received[53] === Object);
            console.log(received[54] === Object);
            console.log(received[55] === Swag);
            console.log(received[56] === Swag);
            console.log(received[57] === Swag);
            console.log(received[58] === Swag);
            console.log(received[59] === Swag);
            console.log(received[60] === Swag);
            console.log(received[61] === Object);
            console.log(received[62] === Object);
            console.log(received[63] === Object);
            console.log(received[64] === Object);
            console.log(received[65] === Object);
            console.log(received[66] === Object);
            console.log(received[67] === void 0);
            console.log(received[68] === void 0);
            console.log(received[69] === Swag);
            console.log(received[70] === Swag);
            console.log(received[71] === Swag);
            console.log(received[72] === Swag);
            console.log(received[73] === Object);
            console.log(received[74] === Object);
            console.log(received[75] === Swag);
            console.log(received[76] === Swag);
            console.log(received[77] === Object);
            console.log(received[78] === Object);
            console.log(received[79] === Swag);
            console.log(received[80] === Swag);
            console.log(received[81] === Object);
            console.log(received[82] === Object);
            console.log(received[83] === Object);
            console.log(received[84] === Object);
            console.log(received[85] === Object);
            console.log(received[86] === Object);
            console.log(received[87] === void 0);
            console.log(received[88] === void 0);
            console.log(received[89] === void 0);
            console.log(received[90] === void 0);
            console.log(received[91] === void 0);
            console.log(received[92] === void 0);
            console.log(received[93] === void 0);
            console.log(received[94] === void 0);
            console.log(received[95] === Object);
            console.log(received[96] === void 0);
            console.log(received[97] === Object);
            console.log(received[98] === Object);
            console.log(received[99] === void 0);
            console.log(received[100] === void 0);
            console.log(received[101] === void 0);
            console.log(received[102] === void 0);
            console.log(received[103] === void 0);
            console.log(received[104] === void 0);
            console.log(received[105] === void 0);
            console.log(received[106] === void 0);
            console.log(received[107] === Object);
            console.log(received[108] === Object);
            console.log(received[109] === Object);
            console.log(received[110] === Object);
            console.log(received[111] === Object);
            console.log(received[112] === Object);
            console.log(received[113] === Object);
            console.log(received[114] === Object);
            console.log(received[115] === Object);
            console.log(received[116] === Object);
            console.log(received[117] === Object);
            console.log(received[118] === Object);
            console.log(received[119] === Object);
            console.log(received[120] === void 0);
            console.log(received[121] === Object);
            console.log(received[122] === Object);
            console.log(received[123] === Object);
            console.log(received[124] === Object);
            console.log(received[125] === Object);
            console.log(received[126] === Object);
            console.log(received[127] === Object);
            console.log(received[128] === Object);
            console.log(received[129] === Object);
            console.log(received[130] === Object);
            console.log(received[131] === Object);
            console.log(received[132] === Object);
            console.log(received[133] === Object);
            console.log(received[134] === void 0);
            console.log(received[135] === void 0);
            console.log(received[136] === void 0);
            console.log(received[137] === void 0);
            console.log(received[138] === void 0);
            console.log(received[139] === void 0);
            console.log(received[140] === void 0);
            console.log(received[141] === void 0);
            console.log(received[142] === void 0);
            console.log(received[143] === void 0);
            console.log(received[144] === Object);
            console.log(received[145] === Object);
            console.log(received[146] === void 0);
            console.log(received[147] === void 0);
            console.log(received[148] === void 0);
            console.log(received[149] === void 0);
            console.log(received[150] === void 0);
            console.log(received[151] === void 0);
            console.log(received[152] === void 0);
            console.log(received[153] === void 0);
            console.log(received[154] === void 0);
            console.log(received[155] === Object);
            console.log(received[156] === Object);
            console.log(received[157] === Object);
            console.log(received[158] === void 0);
            console.log(received[159] === Object);
            console.log(received[160] === Object);
            console.log(received[161] === Object);
            console.log(received[162] === Object);
            console.log(received[163] === Object);
            console.log(received[164] === Object);
            console.log(received[165] === Object);
            console.log(received[166] === Object);
            console.log(received[167] === Object);
            console.log(received[168] === Object);
            console.log(received[169] === Object);
            console.log(received[170] === Object);
            console.log(received[171] === Boolean);
            console.log(received[172] === Object);
            console.log(received[173] === Object);
    
            // @ts-ignore
            @d1
            class A {
                // @ts-ignore
                constructor(@d1 arg1: string) {}
                // @ts-ignore
                @d1
                // @ts-ignore
                method1(@d1 arg1: number): boolean {
                    return true;
                }
                // @ts-ignore
                @d1
                prop1: () => {};
                // @ts-ignore
                @d1
                prop2: "foo" = "foo";
                // @ts-ignore
                @d1
                prop3: symbol;
            }
    
            console.log(Reflect.getMetadata("design:type", A) === undefined);
            console.log(Reflect.getMetadata("design:paramtypes", A)[0] === String);
            console.log(Reflect.getMetadata("design:returntype", A) === undefined);
    
            console.log(Reflect.getMetadata("design:type", A.prototype) === undefined);
            console.log(Reflect.getMetadata("design:paramtypes", A.prototype) === undefined);
            console.log(Reflect.getMetadata("design:returntype", A.prototype) === undefined);
    
            console.log(Reflect.getMetadata("design:type", A.prototype.method1) === undefined);
            console.log(Reflect.getMetadata("design:paramtypes", A.prototype.method1) === undefined);
            console.log(Reflect.getMetadata("design:returntype", A.prototype.method1) === undefined);
    
            console.log(Reflect.getMetadata("design:type", A.prototype, "method1") === Function);
            console.log(Reflect.getMetadata("design:paramtypes", A.prototype, "method1")[0] === Number);
            console.log(Reflect.getMetadata("design:returntype", A.prototype, "method1") === Boolean);
    
            console.log(Reflect.getMetadata("design:type", A.prototype, "prop1") === Function);
            console.log(Reflect.getMetadata("design:paramtypes", A.prototype, "prop1") === undefined);
            console.log(Reflect.getMetadata("design:returntype", A.prototype, "prop1") === undefined);
    
            console.log(Reflect.getMetadata("design:type", A.prototype, "prop2") === String);
            console.log(Reflect.getMetadata("design:paramtypes", A.prototype, "prop2") === undefined);
            console.log(Reflect.getMetadata("design:returntype", A.prototype, "prop2") === undefined);
    
            console.log(Reflect.getMetadata("design:type", A.prototype, "prop3") === Symbol);
            console.log(Reflect.getMetadata("design:paramtypes", A.prototype, "prop3") === undefined);
            console.log(Reflect.getMetadata("design:returntype", A.prototype, "prop3") === undefined);
    
            class HelloWorld {
                // @ts-ignore
                constructor(@d1 arg1: string) {}
            }
    
            console.log(Reflect.getMetadata("design:type", HelloWorld) === undefined);
            console.log(Reflect.getMetadata("design:paramtypes", HelloWorld)[0] === String);
            console.log(Reflect.getMetadata("design:returntype", HelloWorld) === undefined);
    
            type B = "hello" | "world";
            const b = 2;
            const c = ["hello", "world"] as const;
            type Loser = \`hello \${B}\`; // "hello hello" | "hello world"
            function d1() {}
    
            class AClass {
                constructor(
                    // @ts-ignore
                    @d1 p0: \`hello \${B}\`,
                    // @ts-ignore
                    p1: keyof Something,
                    p2: typeof b,
                    p3: readonly ["hello", "world"],
                    p4: typeof c,
                    p5: readonly [number, string],
                    // biome-ignore: format
                    p6: (string | string),
                    // biome-ignore: format
                    p7: (string & string),
                    p8: boolean extends true ? "a" : "b",
                    // @ts-ignore
                    p9: Loser extends Loser ? string : Foo,
                    p10: { [keyof in string]: number },
                    // @ts-ignore
                    p11: blah extends blahblah ? number : void,
                ) {}
    
                // @ts-ignore
                @d1
                async method1() {
                    return true;
                }
            }
    
            const paramtypes = Reflect.getMetadata("design:paramtypes", AClass);
            console.log(paramtypes[0] === String);
            console.log(paramtypes[1] === Object);
            console.log(paramtypes[2] === Object);
            console.log(paramtypes[3] === Array);
            console.log(paramtypes[4] === Object);
            console.log(paramtypes[5] === Array);
            console.log(paramtypes[6] === String);
            console.log(paramtypes[7] === String);
            console.log(paramtypes[8] === String);
            console.log(paramtypes[9] === Object);
            console.log(paramtypes[10] === Object);
            console.log(paramtypes[11] === Object);
    
            console.log(Reflect.getMetadata("design:returntype", AClass.prototype, "method1") === Promise);
        `,
      "/tsconfig.json": /* json */ `
            {
                "compilerOptions": {
                    "experimentalDecorators": true,
                    "emitDecoratorMetadata": true,
                }
            }
        `,
    },
    bundling: true,
    run: {
      stdout: "true\n".repeat(212),
    },
  });

  itBundled("decorator_metadata/ImportIdentifiers", {
    files: {
      "/entry.ts": /* ts */ `
            ${reflectMetadata}
            
            import { Foo } from "./foo.js";
    
            function d1() {}
    
            @d1
            class Bar {
                constructor(foo: Foo) {}
            }
    
            console.log(Reflect.getMetadata("design:paramtypes", Bar)[0] === Foo);
        `,
      "/foo.js": /* js */ `
            const f = () => "Foo";
            module.exports[f()] = class Foo {};
        `,
      "/tsconfig.json": /* json */ `
            {
                "compilerOptions": {
                    "experimentalDecorators": true,
                    "emitDecoratorMetadata": true,
                }
            }
        `,
    },
    run: {
      stdout: "true\n",
    },
  });
});
