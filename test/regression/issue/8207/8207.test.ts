import { test, expect } from "bun:test";

test("issue #8207 - regex source string replacement with UTF-16 character", () => {
  // This tests the case where parsel-js does string replacement on a regex source
  // The ¶ character (U+00B6) should be replaceable in the regex source string
  const regex = /:(?<name>[-\w\P{ASCII}]+)(?:\((?<argument>¶*)\))?/gu;
  
  // Get the source and try to replace ¶ with .*
  const source = regex.source;
  const replaced = source.replace('(?<argument>¶*)', '(?<argument>.*)');
  
  // The replacement should work - the ¶ character should be found and replaced
  expect(replaced).not.toBe(source);
  expect(replaced).toContain('(?<argument>.*)');
  expect(replaced).not.toContain('(?<argument>¶*)');
  
  // Verify the new regex can be created successfully
  const newRegex = new RegExp(replaced, 'gu');
  expect(newRegex).toBeInstanceOf(RegExp);
});

test("issue #8207 - regex with UTF-16 character in source", () => {
  // Additional test to ensure the regex itself works correctly
  const regex = /:(?<name>[-\w\P{ASCII}]+)(?:\((?<argument>¶*)\))?/gu;
  
  // Test matching with the original regex
  const match1 = ":test(¶¶¶)".match(regex);
  expect(match1).toBeTruthy();
  expect(match1[0]).toBe(":test(¶¶¶)");
  
  const match2 = ":name".match(regex);
  expect(match2).toBeTruthy();
  expect(match2[0]).toBe(":name");
});