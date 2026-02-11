// https://github.com/oven-sh/bun/issues/25658
import { cc } from "bun:ffi";
import { expect, test } from "bun:test";
import { isASAN, isWindows, tempDir } from "harness";
import path from "path";

test.skipIf(isWindows || isASAN)("structuredClone supports napi_value objects returned from cc()", () => {
  using dir = tempDir("issue-25658", {
    "x.c": `
typedef struct NapiEnv* napi_env;
typedef long long napi_value;
typedef int napi_status;

extern napi_status napi_create_object(napi_env env, napi_value* result);

napi_value hello(napi_env env) {
  napi_value result;
  napi_create_object(env, &result);
  return result;
}
`,
  });

  const lib = cc({
    source: path.join(String(dir), "x.c"),
    symbols: {
      hello: {
        args: ["napi_env"],
        returns: "napi_value",
      },
    },
  });

  try {
    const result = lib.symbols.hello();
    expect(typeof result).toBe("object");
    expect(result).not.toBeNull();

    const cloned = structuredClone(result);
    expect(cloned).toEqual({});
  } finally {
    lib.close();
  }
});
