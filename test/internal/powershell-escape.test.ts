import { escapePowershell } from "bun:internal-for-testing";

it("powershell escaping rules", () => {
  // This formatter does not include quotes around the string intentionally
  expect(escapePowershell("foo")).toBe("foo");
  expect(escapePowershell("foo bar")).toBe("foo bar");
  expect(escapePowershell('foo" bar')).toBe('foo`" bar');
  expect(escapePowershell('foo" `bar')).toBe('foo`" ``bar');
  expect(escapePowershell('foo" ``"bar')).toBe('foo`" `````"bar');
});
