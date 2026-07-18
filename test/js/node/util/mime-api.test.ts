import { describe, expect, test } from "bun:test";
import { bunExe } from "harness";
import { MIMEParams, MIMEType } from "util";

describe("MIME API", () => {
  // In Node.js, MIMEType and MIMEParams are plain JS classes (private fields for state,
  // no Symbol.toStringTag, non-enumerable prototype members). Match that shape here.
  describe("class shape matches Node.js", () => {
    test("no Symbol.toStringTag on prototypes", () => {
      const m = new MIMEType("a/b;x=1");
      expect(Object.prototype.toString.call(m)).toBe("[object Object]");
      expect(Object.prototype.toString.call(m.params)).toBe("[object Object]");
      expect(Symbol.toStringTag in MIMEType.prototype).toBe(false);
      expect(Symbol.toStringTag in MIMEParams.prototype).toBe(false);
    });

    test("prototype members are non-enumerable (for-in yields nothing)", () => {
      const m = new MIMEType("a/b;x=1");
      const keys: string[] = [];
      for (const k in m) keys.push(k);
      expect(keys).toEqual([]);

      const pkeys: string[] = [];
      for (const k in m.params) pkeys.push(k);
      expect(pkeys).toEqual([]);
    });

    test("prototype property descriptors match Node.js", () => {
      for (const name of ["type", "subtype", "essence", "params"]) {
        const d = Object.getOwnPropertyDescriptor(MIMEType.prototype, name)!;
        expect({ name, enumerable: d.enumerable, configurable: d.configurable }).toEqual({
          name,
          enumerable: false,
          configurable: true,
        });
      }
      for (const name of ["toString", "toJSON"]) {
        const d = Object.getOwnPropertyDescriptor(MIMEType.prototype, name)!;
        expect({ name, enumerable: d.enumerable, configurable: d.configurable, writable: d.writable }).toEqual({
          name,
          enumerable: false,
          configurable: true,
          writable: true,
        });
      }
      for (const name of ["get", "has", "set", "delete", "entries", "keys", "values", "toString", "toJSON"]) {
        const d = Object.getOwnPropertyDescriptor(MIMEParams.prototype, name)!;
        expect({ name, enumerable: d.enumerable, configurable: d.configurable, writable: d.writable }).toEqual({
          name,
          enumerable: false,
          configurable: true,
          writable: true,
        });
      }
    });

    test("brand-check throws plain TypeError with no .code", () => {
      for (const fn of [
        () => MIMEType.prototype.toString.call({}),
        () => MIMEType.prototype.toJSON.call({}),
        () => Reflect.get(MIMEType.prototype, "type", {}),
        () => Reflect.get(MIMEType.prototype, "subtype", {}),
        () => Reflect.get(MIMEType.prototype, "essence", {}),
        () => Reflect.get(MIMEType.prototype, "params", {}),
        () => Reflect.set(MIMEType.prototype, "type", "x", {}),
        () => Reflect.set(MIMEType.prototype, "subtype", "x", {}),
        () => MIMEParams.prototype.get.call({}, "x"),
        () => MIMEParams.prototype.has.call({}, "x"),
        () => MIMEParams.prototype.set.call({}, "x", "y"),
        () => MIMEParams.prototype.delete.call({}, "x"),
        () => MIMEParams.prototype.toString.call({}),
        () => MIMEParams.prototype.toJSON.call({}),
      ]) {
        let err: any;
        try {
          fn();
        } catch (e) {
          err = e;
        }
        expect(err).toBeInstanceOf(TypeError);
        expect(err.code).toBeUndefined();
      }
    });

    test("structuredClone serializes instances as plain empty objects", () => {
      const m = new MIMEType("a/b;x=1");
      const cloned = structuredClone(m);
      expect(Object.getPrototypeOf(cloned)).toBe(Object.prototype);
      expect(Object.getOwnPropertyNames(cloned)).toEqual([]);

      const p = m.params;
      const clonedParams = structuredClone(p);
      expect(Object.getPrototypeOf(clonedParams)).toBe(Object.prototype);
      expect(Object.getOwnPropertyNames(clonedParams)).toEqual([]);

      expect(structuredClone(MIMEType.prototype)).toEqual({});
      expect(structuredClone(MIMEParams.prototype)).toEqual({});
    });
  });

  const WHITESPACES = "\t\n\f\r ";
  const NOT_HTTP_TOKEN_CODE_POINT = ",";
  const NOT_HTTP_QUOTED_STRING_CODE_POINT = "\n";

  test("class instance integrity", () => {
    const mime = new MIMEType("application/ecmascript; ");
    const mime_descriptors = Object.getOwnPropertyDescriptors(mime);
    const mime_proto = Object.getPrototypeOf(mime);
    const mime_impersonator = { __proto__: mime_proto };

    for (const key of Object.keys(mime_descriptors)) {
      const descriptor = mime_descriptors[key];
      if (descriptor.get) {
        const getter = descriptor.get;
        expect(() => getter.call(mime_impersonator)).toThrow(/invalid receiver/i);
      }
      if (descriptor.set) {
        const setter = descriptor.set;
        expect(() => setter.call(mime_impersonator, "x")).toThrow(/invalid receiver/i);
      }
    }
  });

  test("basic properties and string conversion", () => {
    const mime = new MIMEType("application/ecmascript; ");

    expect(JSON.stringify(mime)).toBe(JSON.stringify("application/ecmascript"));
    expect(`${mime}`).toBe("application/ecmascript");
    expect(mime.essence).toBe("application/ecmascript");
    expect(mime.type).toBe("application");
    expect(mime.subtype).toBe("ecmascript");
    expect(mime.params).toBeDefined();
    expect([...mime.params]).toEqual([]);
    expect(mime.params.has("not found")).toBe(false);
    expect(mime.params.get("not found")).toBe(null);
    expect(mime.params.delete("not found")).toBe(undefined);
  });

  test("type property manipulation", () => {
    const mime = new MIMEType("application/ecmascript; ");

    mime.type = "text";
    expect(mime.type).toBe("text");
    expect(JSON.stringify(mime)).toBe(JSON.stringify("text/ecmascript"));
    expect(`${mime}`).toBe("text/ecmascript");
    expect(mime.essence).toBe("text/ecmascript");

    expect(() => {
      mime.type = `${WHITESPACES}text`;
    }).toThrow(/The MIME syntax for a type in/);

    expect(() => {
      mime.type = "";
    }).toThrow(/type/i);
    expect(() => {
      mime.type = "/";
    }).toThrow(/type/i);
    expect(() => {
      mime.type = "x/";
    }).toThrow(/type/i);
    expect(() => {
      mime.type = "/x";
    }).toThrow(/type/i);
    expect(() => {
      mime.type = NOT_HTTP_TOKEN_CODE_POINT;
    }).toThrow(/type/i);
    expect(() => {
      mime.type = `${NOT_HTTP_TOKEN_CODE_POINT}/`;
    }).toThrow(/type/i);
    expect(() => {
      mime.type = `/${NOT_HTTP_TOKEN_CODE_POINT}`;
    }).toThrow(/type/i);
  });

  test("subtype property manipulation", () => {
    const mime = new MIMEType("application/ecmascript; ");
    mime.type = "text";

    mime.subtype = "javascript";
    expect(mime.type).toBe("text");
    expect(JSON.stringify(mime)).toBe(JSON.stringify("text/javascript"));
    expect(`${mime}`).toBe("text/javascript");
    expect(mime.essence).toBe("text/javascript");
    expect(`${mime.params}`).toBe("");
    expect(`${new MIMEParams()}`).toBe("");
    // @ts-expect-error
    expect(`${new MIMEParams(mime.params)}`).toBe("");
    // @ts-expect-error
    expect(`${new MIMEParams(`${mime.params}`)}`).toBe("");

    expect(() => {
      mime.subtype = `javascript${WHITESPACES}`;
    }).toThrow(/The MIME syntax for a subtype in/);

    expect(() => {
      mime.subtype = "";
    }).toThrow(/subtype/i);
    expect(() => {
      mime.subtype = ";";
    }).toThrow(/subtype/i);
    expect(() => {
      mime.subtype = "x;";
    }).toThrow(/subtype/i);
    expect(() => {
      mime.subtype = ";x";
    }).toThrow(/subtype/i);
    expect(() => {
      mime.subtype = NOT_HTTP_TOKEN_CODE_POINT;
    }).toThrow(/subtype/i);
    expect(() => {
      mime.subtype = `${NOT_HTTP_TOKEN_CODE_POINT};`;
    }).toThrow(/subtype/i);
    expect(() => {
      mime.subtype = `;${NOT_HTTP_TOKEN_CODE_POINT}`;
    }).toThrow(/subtype/i);
  });

  test("parameters manipulation", () => {
    const mime = new MIMEType("application/ecmascript; ");
    mime.type = "text";
    mime.subtype = "javascript";

    const params = mime.params;

    // Setting parameters
    params.set("charset", "utf-8");
    expect(params.has("charset")).toBe(true);
    expect(params.get("charset")).toBe("utf-8");
    expect([...params]).toEqual([["charset", "utf-8"]]);
    expect(JSON.stringify(mime)).toBe(JSON.stringify("text/javascript;charset=utf-8"));
    expect(`${mime}`).toBe("text/javascript;charset=utf-8");
    expect(mime.essence).toBe("text/javascript");
    expect(`${mime.params}`).toBe("charset=utf-8");
    // @ts-expect-error
    expect(`${new MIMEParams(mime.params)}`).toBe("");
    // @ts-expect-error
    expect(`${new MIMEParams(`${mime.params}`)}`).toBe("");

    // Multiple parameters
    params.set("goal", "module");
    expect(params.has("goal")).toBe(true);
    expect(params.get("goal")).toBe("module");
    expect([...params]).toEqual([
      ["charset", "utf-8"],
      ["goal", "module"],
    ]);
    expect(JSON.stringify(mime)).toBe(JSON.stringify("text/javascript;charset=utf-8;goal=module"));
    expect(`${mime}`).toBe("text/javascript;charset=utf-8;goal=module");
    expect(mime.essence).toBe("text/javascript");
    expect(`${mime.params}`).toBe("charset=utf-8;goal=module");

    // Invalid parameter name
    expect(() => {
      params.set(`${WHITESPACES}goal`, "module");
    }).toThrow(/The MIME syntax for a parameter name in/);

    // Updating a parameter
    params.set("charset", "iso-8859-1");
    expect(params.has("charset")).toBe(true);
    expect(params.get("charset")).toBe("iso-8859-1");
    expect([...params]).toEqual([
      ["charset", "iso-8859-1"],
      ["goal", "module"],
    ]);
    expect(JSON.stringify(mime)).toBe(JSON.stringify("text/javascript;charset=iso-8859-1;goal=module"));
    expect(`${mime}`).toBe("text/javascript;charset=iso-8859-1;goal=module");
    expect(mime.essence).toBe("text/javascript");

    // Deleting a parameter
    params.delete("charset");
    expect(params.has("charset")).toBe(false);
    expect(params.get("charset")).toBe(null);
    expect([...params]).toEqual([["goal", "module"]]);
    expect(JSON.stringify(mime)).toBe(JSON.stringify("text/javascript;goal=module"));
    expect(`${mime}`).toBe("text/javascript;goal=module");
    expect(mime.essence).toBe("text/javascript");

    // Empty parameter value
    params.set("x", "");
    expect(params.has("x")).toBe(true);
    expect(params.get("x")).toBe("");
    expect([...params]).toEqual([
      ["goal", "module"],
      ["x", ""],
    ]);
    expect(JSON.stringify(mime)).toBe(JSON.stringify('text/javascript;goal=module;x=""'));
    expect(`${mime}`).toBe('text/javascript;goal=module;x=""');
    expect(mime.essence).toBe("text/javascript");
  });

  test("invalid parameter names", () => {
    const mime = new MIMEType("text/javascript");
    const params = mime.params;

    expect(() => params.set("", "x")).toThrow(/parameter name/i);
    expect(() => params.set("=", "x")).toThrow(/parameter name/i);
    expect(() => params.set("x=", "x")).toThrow(/parameter name/i);
    expect(() => params.set("=x", "x")).toThrow(/parameter name/i);
    expect(() => params.set(`${NOT_HTTP_TOKEN_CODE_POINT}=`, "x")).toThrow(/parameter name/i);
    expect(() => params.set(`${NOT_HTTP_TOKEN_CODE_POINT}x`, "x")).toThrow(/parameter name/i);
    expect(() => params.set(`x${NOT_HTTP_TOKEN_CODE_POINT}`, "x")).toThrow(/parameter name/i);
  });

  test("invalid parameter values", () => {
    const mime = new MIMEType("text/javascript");
    const params = mime.params;

    expect(() => params.set("x", `${NOT_HTTP_QUOTED_STRING_CODE_POINT};`)).toThrow(/parameter value/i);
    expect(() => params.set("x", `${NOT_HTTP_QUOTED_STRING_CODE_POINT}x`)).toThrow(/parameter value/i);
    expect(() => params.set("x", `x${NOT_HTTP_QUOTED_STRING_CODE_POINT}`)).toThrow(/parameter value/i);
  });
});

test("Exact match with node", () => {
  const result = Bun.spawnSync({
    cmd: [bunExe(), import.meta.dir + "/exact/mime-test.js"],
  });

  expect(result.stderr.toString("utf-8")).toBe("");
  expect(result.exitCode).toBe(0);
  // exact output on v23.4.0
  expect(result.stdout.toString("utf-8")).toMatchInlineSnapshot(`
    "=== BASIC PROPERTIES AND STRING CONVERSION ===
    mime1: application/ecmascript
    JSON.stringify: "application/ecmascript"
    essence: application/ecmascript
    type: application
    subtype: ecmascript
    params empty: true
    params.has("not found"): false
    params.get("not found"): true

    === TYPE PROPERTY MANIPULATION ===
    Original: application/javascript
    After type change: text/javascript
    essence: text/javascript
    Error on empty type as expected
    Error on invalid type as expected

    === SUBTYPE PROPERTY MANIPULATION ===
    Original: text/plain
    After subtype change: text/javascript
    Error on empty subtype as expected
    Error on invalid subtype as expected

    === PARAMETERS MANIPULATION ===
    params.has("charset"): true
    params.get("charset"): utf-8
    params entries length: 1
    mime with charset: text/javascript;charset=utf-8
    params.has("goal"): true
    params.get("goal"): module
    params entries length: 2
    mime with multiple params: text/javascript;charset=utf-8;goal=module
    updated charset: iso-8859-1
    mime with updated charset: text/javascript;charset=iso-8859-1;goal=module
    params.has("charset") after delete: false
    params.get("charset") after delete: true
    params entries length after delete: 1
    mime after param delete: text/javascript;goal=module
    params.has("x"): true
    params.get("x"): empty string
    mime with empty param: text/javascript;goal=module;x=""

    === PARAMETER CASE SENSITIVITY ===
    mime5: text/javascript;charset=UTF-8
    mime5.params.get("CHARSET"): true
    mime5.params.get("charset"): UTF-8
    mime5.params.has("CHARSET"): false
    mime5.params.has("charset"): true
    mime5.params.has("abc"): false
    mime5.params.has("def"): false
    mime5.params.get("CHARSET") after set: UTF-8
    mime5.params.has("CHARSET") after set: true

    === QUOTED PARAMETER VALUES ===
    mime6: text/plain;charset=utf-8
    mime6.params.get("charset"): utf-8
    mime with filename: text/javascript;goal=module;x="";filename="file with spaces.txt"

    === INVALID PARAMETERS ===
    Error on empty param name as expected
    Error on invalid param name as expected
    Error on invalid param value as expected

    === PARAMS ITERATION ===
    Iterating params.entries():
      charset: utf-8
      format: flowed
    Iterating params.keys():
      charset
      format
    Iterating params.values():
      utf-8
      flowed
    Iterating params directly:
      charset: utf-8
      format: flowed

    === PARSING EDGE CASES ===
    mime8: text/plain;charset=utf-8;goal=module
    Has empty param: false
    mime9: text/plain;charset=utf-8
    mime9 charset: utf-8

    === TO STRING AND TO JSON ===
    toString(): text/plain;charset=utf-8
    toJSON(): text/plain;charset=utf-8
    params toString(): charset=utf-8
    params toJSON(): charset=utf-8
    === BASIC MIMEPARAMS OPERATIONS ===
    New params empty: true
    params.has("charset"): true
    params.get("charset"): utf-8
    params entries length: 1
    params toString(): charset=utf-8

    === CASE SENSITIVITY ===
    params.has("CHARSET"): false
    params.get("CHARSET"): true
    After setting CHARSET, params.has("CHARSET"): true
    After setting CHARSET, params.get("CHARSET"): iso-8859-1
    params.has("charset"): true
    params.get("charset"): utf-8
    params entries length: 2
    params toString(): charset=utf-8;CHARSET=iso-8859-1

    === DELETE OPERATION ===
    After delete, params.has("charset"): false
    After delete, params.get("charset"): true
    params.has("CHARSET"): true
    params entries length: 1
    params toString(): CHARSET=iso-8859-1

    === MULTIPLE PARAMETERS ===
    params entries length: 3
    params toString(): CHARSET=iso-8859-1;format=flowed;delsp=yes

    === QUOTED VALUES ===
    params.get("filename"): file with spaces.txt
    params toString(): CHARSET=iso-8859-1;format=flowed;delsp=yes;filename="file with spaces.txt"

    === EMPTY VALUES ===
    params.has("empty"): true
    params.get("empty"): empty string
    params toString() with empty value: CHARSET=iso-8859-1;format=flowed;delsp=yes;filename="file with spaces.txt";empty=""

    === ESCAPE SEQUENCES IN QUOTED VALUES ===
    params.get("path"): C:\\Program Files\\App
    params toString() with backslashes: CHARSET=iso-8859-1;format=flowed;delsp=yes;filename="file with spaces.txt";empty="";path="C:\\\\Program Files\\\\App"

    === SPECIAL CHARACTERS ===
    params.get("test"): !#$%&'*+-.^_\`|~
    params toString() with special chars: CHARSET=iso-8859-1;format=flowed;delsp=yes;filename="file with spaces.txt";empty="";path="C:\\\\Program Files\\\\App";test=!#$%&'*+-.^_\`|~

    === ERROR CASES ===
    Empty name error: TypeError
    Invalid name error: TypeError
    Invalid value error: TypeError

    === ITERATION METHODS ===
    Keys:
      CHARSET
      format
      delsp
      filename
      empty
      path
      test
    Values:
      iso-8859-1
      flowed
      yes
      file with spaces.txt
      
      C:\\Program Files\\App
      !#$%&'*+-.^_\`|~
    Entries:
      CHARSET: iso-8859-1
      format: flowed
      delsp: yes
      filename: file with spaces.txt
      empty: 
      path: C:\\Program Files\\App
      test: !#$%&'*+-.^_\`|~
    Direct iteration:
      CHARSET: iso-8859-1
      format: flowed
      delsp: yes
      filename: file with spaces.txt
      empty: 
      path: C:\\Program Files\\App
      test: !#$%&'*+-.^_\`|~

    === JSON SERIALIZATION ===
    params.toJSON(): CHARSET=iso-8859-1;format=flowed;delsp=yes;filename="file with spaces.txt";empty="";path="C:\\\\Program Files\\\\App";test=!#$%&'*+-.^_\`|~
    JSON.stringify(params): "CHARSET=iso-8859-1;format=flowed;delsp=yes;filename=\\"file with spaces.txt\\";empty=\\"\\";path=\\"C:\\\\\\\\Program Files\\\\\\\\App\\";test=!#$%&'*+-.^_\`|~"

    === CLONE AND MODIFY ===
    Original params: charset=utf-8;boundary=boundary
    Cloned params: charset=iso-8859-1;boundary=boundary
    "
  `);
});
