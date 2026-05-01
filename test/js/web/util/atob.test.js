import { expect, it } from "bun:test";

function expectInvalidCharacters(val) {
  expect(() => atob(val)).toThrow("The string contains invalid characters.");
}

it("atob", () => {
  expect(atob("YQ==")).toBe("a");
  expect(atob("YWI=")).toBe("ab");
  expect(atob("YWJj")).toBe("abc");
  expect(atob("YWJjZA==")).toBe("abcd");
  expect(atob("YWJjZGU=")).toBe("abcde");
  expect(atob("YWJjZGVm")).toBe("abcdef");
  expect(atob("zzzz")).toBe("Ï<ó");
  expect(atob("")).toBe("");
  expect(atob(null)).toBe("ée");
  expect(atob("6ek=")).toBe("éé");
  expect(atob("6ek")).toBe("éé");
  expect(atob("gIE=")).toBe("");
  expect(atob("zz")).toBe("Ï");
  expect(atob("zzz")).toBe("Ï<");
  expect(atob("zzz=")).toBe("Ï<");
  expect(atob(" YQ==")).toBe("a");
  expect(atob("YQ==\u000a")).toBe("a");

  try {
    atob();
  } catch (error) {
    expect(error.name).toBe("TypeError");
  }
  expectInvalidCharacters(undefined);
  expectInvalidCharacters(" abcd===");
  expectInvalidCharacters("abcd=== ");
  expectInvalidCharacters("abcd ===");
  expectInvalidCharacters("тест");
  expectInvalidCharacters("z");
  expectInvalidCharacters("zzz==");
  expectInvalidCharacters("zzz===");
  expectInvalidCharacters("zzz====");
  expectInvalidCharacters("zzz=====");
  expectInvalidCharacters("zzzzz");
  expectInvalidCharacters("z=zz");
  expectInvalidCharacters("=");
  expectInvalidCharacters("==");
  expectInvalidCharacters("===");
  expectInvalidCharacters("====");
  expectInvalidCharacters("=====");
});

it("btoa", () => {
  expect(btoa("a")).toBe("YQ==");
  expect(btoa("ab")).toBe("YWI=");
  expect(btoa("abc")).toBe("YWJj");
  expect(btoa("abcd")).toBe("YWJjZA==");
  expect(btoa("abcde")).toBe("YWJjZGU=");
  expect(btoa("abcdef")).toBe("YWJjZGVm");
  expect(typeof btoa).toBe("function");
  expect(() => btoa()).toThrow("btoa requires 1 argument (a string)");
  var window = "[object Window]";
  expect(btoa("")).toBe("");
  expect(btoa(null)).toBe("bnVsbA==");
  expect(btoa(undefined)).toBe("dW5kZWZpbmVk");
  expect(btoa(window)).toBe("W29iamVjdCBXaW5kb3dd");
  expect(btoa("éé")).toBe("6ek=");
  // check for utf16
  expect(btoa("🧐éé".substring("🧐".length))).toBe("6ek=");
  expect(btoa("\u0080\u0081")).toBe("gIE=");
  expect(btoa(Bun)).toBe(btoa("[object Bun]"));
});
