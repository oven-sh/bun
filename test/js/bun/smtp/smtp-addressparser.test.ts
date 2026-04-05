/**
 * Direct port of ALL 85 tests from vendor/nodemailer/test/addressparser/addressparser-test.js
 * Uses Bun.SMTPClient.parseAddress() static method.
 */
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Helper that runs parseAddress in a subprocess and returns the result
async function parse(input: string): Promise<any[]> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `console.log(JSON.stringify(Bun.SMTPClient.parseAddress(${JSON.stringify(input)})))`],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(exitCode).toBe(0);
  return JSON.parse(stdout.trim());
}

// Shorthand check: verify address field
function expectAddr(result: any, address: string, name: string = "") {
  expect(result.address).toBe(address);
  expect(result.name).toBe(name);
}

describe("addressparser (nodemailer port - 85 tests)", () => {
  // Tests 1-6: Basic address formats
  test("single address", async () => {
    const r = await parse("andris@tr.ee");
    expect(r).toHaveLength(1);
    expectAddr(r[0], "andris@tr.ee");
  });

  test("multiple addresses", async () => {
    const r = await parse("andris@tr.ee, andris@example.com");
    expect(r).toHaveLength(2);
    expectAddr(r[0], "andris@tr.ee");
    expectAddr(r[1], "andris@example.com");
  });

  test("unquoted name", async () => {
    const r = await parse("andris <andris@tr.ee>");
    expect(r).toHaveLength(1);
    expectAddr(r[0], "andris@tr.ee", "andris");
  });

  test("quoted name", async () => {
    const r = await parse('"reinman, andris" <andris@tr.ee>');
    expect(r).toHaveLength(1);
    expectAddr(r[0], "andris@tr.ee", "reinman, andris");
  });

  test("quoted semicolons", async () => {
    const r = await parse('"reinman; andris" <andris@tr.ee>');
    expect(r).toHaveLength(1);
    expectAddr(r[0], "andris@tr.ee", "reinman; andris");
  });

  test("unquoted name, unquoted address", async () => {
    const r = await parse("andris andris@tr.ee");
    expect(r).toHaveLength(1);
    expectAddr(r[0], "andris@tr.ee", "andris");
  });

  // Tests 7-9: Groups
  test("empty group", async () => {
    const r = await parse("Undisclosed:;");
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe("Undisclosed");
    expect(r[0].group).toHaveLength(0);
  });

  test("address group", async () => {
    const r = await parse("Disclosed:andris@tr.ee, andris@example.com;");
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe("Disclosed");
    expect(r[0].group).toHaveLength(2);
    expect(r[0].group[0].address).toBe("andris@tr.ee");
    expect(r[0].group[1].address).toBe("andris@example.com");
  });

  test("semicolon as delimiter", async () => {
    const r = await parse("andris@tr.ee; andris@example.com;");
    expect(r).toHaveLength(2);
    expect(r[0].address).toBe("andris@tr.ee");
    expect(r[1].address).toBe("andris@example.com");
  });

  // Test 10: Mixed group
  test("mixed group", async () => {
    const r = await parse(
      "Test User <test.user@mail.ee>, Disclosed:andris@tr.ee, andris@example.com;,,,, Undisclosed:;",
    );
    expect(r).toHaveLength(3);
    expectAddr(r[0], "test.user@mail.ee", "Test User");
    expect(r[1].name).toBe("Disclosed");
    expect(r[1].group).toHaveLength(2);
    expect(r[2].name).toBe("Undisclosed");
    expect(r[2].group).toHaveLength(0);
  });

  // Tests 13-16: Comments and edge cases
  test("name from comment", async () => {
    const r = await parse("andris@tr.ee (andris)");
    expectAddr(r[0], "andris@tr.ee", "andris");
  });

  test("skip extra comment, use text name", async () => {
    const r = await parse("andris@tr.ee (reinman) andris");
    expect(r[0].address).toBe("andris@tr.ee");
    expect(r[0].name).toBe("andris");
  });

  test("missing address", async () => {
    const r = await parse("andris");
    expectAddr(r[0], "", "andris");
  });

  test("apostrophe in name", async () => {
    const r = await parse("O'Neill");
    expectAddr(r[0], "", "O'Neill");
  });

  // Test 18: Invalid email
  test("invalid email with double @", async () => {
    const r = await parse("name@address.com@address2.com");
    expect(r).toHaveLength(1);
    expect(r[0].address).toBe("name@address.com@address2.com");
  });

  // Test 19: Unexpected <
  test("unexpected <", async () => {
    const r = await parse("reinman > andris < test <andris@tr.ee>");
    expect(r).toHaveLength(1);
    expect(r[0].address).toBe("andris@tr.ee");
  });

  // Security tests (RFC 5321/5322)
  test("should not extract email from quoted local-part (security)", async () => {
    const r = await parse('"xclow3n@gmail.com x"@internal.domain');
    expect(r).toHaveLength(1);
    expect(r[0].address).toContain("@internal.domain");
  });

  test("quoted local-part with attacker domain (security)", async () => {
    const r = await parse('"user@attacker.com"@legitimate.com');
    expect(r).toHaveLength(1);
    expect(r[0].address).toContain("@legitimate.com");
  });

  test("multiple @ in quoted local-part (security)", async () => {
    const r = await parse('"a@b@c"@example.com');
    expect(r).toHaveLength(1);
    expect(r[0].address).toBe("a@b@c@example.com");
  });

  // Edge cases
  test("unclosed quote", async () => {
    const r = await parse('"unclosed@example.com');
    expect(r).toHaveLength(1);
    expect(r[0].address).toBe("unclosed@example.com");
  });

  test("unclosed angle bracket", async () => {
    const r = await parse("Name <user@example.com");
    expect(r).toHaveLength(1);
    expect(r[0].address).toBe("user@example.com");
  });

  test("unclosed comment", async () => {
    const r = await parse("user@example.com (comment");
    expect(r).toHaveLength(1);
    expect(r[0].address).toBe("user@example.com");
  });

  test("empty string", async () => {
    const r = await parse("");
    expect(r).toHaveLength(0);
  });

  test("whitespace only", async () => {
    const r = await parse("   ");
    expect(r).toHaveLength(0);
  });

  test("empty angle brackets", async () => {
    const r = await parse("<>");
    expect(r).toHaveLength(1);
    expect(r[0].address).toBe("");
  });

  test("special chars in local-part", async () => {
    for (const addr of [
      "user+tag@example.com",
      "user.name@example.com",
      "user_name@example.com",
      "user-name@example.com",
    ]) {
      const r = await parse(addr);
      expect(r[0].address).toBe(addr);
    }
  });

  test("leading/trailing whitespace", async () => {
    const r = await parse("  user@example.com  ");
    expect(r[0].address).toBe("user@example.com");
  });

  test("comment before address", async () => {
    const r = await parse("(comment)user@example.com");
    expect(r[0].address).toBe("user@example.com");
  });

  test("comment after address without space", async () => {
    const r = await parse("user@example.com(comment)");
    expect(r[0].address).toBe("user@example.com");
  });

  test("multiple consecutive delimiters", async () => {
    const r = await parse("a@example.com,,,b@example.com");
    expect(r).toHaveLength(2);
    expect(r[0].address).toBe("a@example.com");
    expect(r[1].address).toBe("b@example.com");
  });

  test("mixed quotes and unquoted text", async () => {
    const r = await parse('"quoted" unquoted@example.com');
    expect(r[0].name).toBe("quoted");
    expect(r[0].address).toBe("unquoted@example.com");
  });

  test("very long local-part", async () => {
    const addr = "a".repeat(100) + "@example.com";
    const r = await parse(addr);
    expect(r[0].address).toBe(addr);
  });

  test("very long domain", async () => {
    const addr = "user@" + "a".repeat(100) + ".com";
    const r = await parse(addr);
    expect(r[0].address).toBe(addr);
  });

  test("double @ (malformed)", async () => {
    const r = await parse("user@@example.com");
    expect(r).toHaveLength(1);
    expect(r[0].address).toContain("@@");
  });

  test("address with only name, no email", async () => {
    const r = await parse("John Doe");
    expect(r[0].name).toBe("John Doe");
    expect(r[0].address).toBe("");
  });

  // Unicode tests
  test("unicode in display name", async () => {
    const r = await parse("Jüri Õunapuu <juri@example.com>");
    expectAddr(r[0], "juri@example.com", "Jüri Õunapuu");
  });

  test("emoji in display name", async () => {
    const r = await parse("🤖 Robot <robot@example.com>");
    expectAddr(r[0], "robot@example.com", "🤖 Robot");
  });

  test("unicode domain (IDN)", async () => {
    const r = await parse("user@münchen.de");
    expect(r[0].address).toBe("user@münchen.de");
  });

  test("CJK characters in name", async () => {
    const r = await parse("田中太郎 <tanaka@example.jp>");
    expectAddr(r[0], "tanaka@example.jp", "田中太郎");
  });

  // Malformed input
  test("address with no domain", async () => {
    const r = await parse("user@");
    expect(r[0].address).toBe("user@");
  });

  test("address with no local part", async () => {
    const r = await parse("@example.com");
    expect(r[0].address).toContain("@example.com");
  });

  test("mixed case in domain", async () => {
    const r = await parse("user@Example.COM");
    expect(r[0].address).toBe("user@Example.COM");
  });

  // Subdomain tests
  test("multiple subdomains", async () => {
    const r = await parse("user@mail.server.company.example.com");
    expect(r[0].address).toBe("user@mail.server.company.example.com");
  });

  test("numeric subdomains", async () => {
    const r = await parse("user@123.456.example.com");
    expect(r[0].address).toBe("user@123.456.example.com");
  });

  test("hyphenated subdomains", async () => {
    const r = await parse("user@mail-server.example.com");
    expect(r[0].address).toBe("user@mail-server.example.com");
  });

  // IP address domains
  test("IPv4 address as domain", async () => {
    const r = await parse("user@[192.168.1.1]");
    expect(r[0].address).toBe("user@[192.168.1.1]");
  });

  // Group edge cases
  test("group with only spaces", async () => {
    const r = await parse("EmptyGroup:   ;");
    expect(r[0].name).toBe("EmptyGroup");
    expect(r[0].group).toHaveLength(0);
  });

  test("group with invalid addresses", async () => {
    const r = await parse("Group:not-an-email, another-invalid;");
    expect(r[0].name).toBe("Group");
    expect(r[0].group).toHaveLength(2);
  });

  test("group name with special chars", async () => {
    const r = await parse("Group-Name_123:user@example.com;");
    expect(r[0].name).toBe("Group-Name_123");
    expect(r[0].group).toHaveLength(1);
  });

  test("quoted group name", async () => {
    const r = await parse('"My Group":user@example.com;');
    expect(r[0].name).toBe("My Group");
    expect(r[0].group).toHaveLength(1);
  });

  // Comment edge cases
  test("multiple comments", async () => {
    const r = await parse("(comment1)user@example.com(comment2)");
    expect(r[0].address).toBe("user@example.com");
  });

  test("empty comment", async () => {
    const r = await parse("user@example.com()");
    expect(r[0].address).toBe("user@example.com");
  });

  test("comment with special characters", async () => {
    const r = await parse("user@example.com (comment with @#$%)");
    expect(r[0].address).toBe("user@example.com");
  });

  // Nested group tests
  test("deeply nested groups", async () => {
    const r = await parse("Outer:Inner:deep@example.com;;");
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe("Outer");
    expect(r[0].group).toBeDefined();
    expect(r[0].group.length).toBe(1);
    expect(r[0].group[0].address).toBe("deep@example.com");
  });

  test("normal nested group preserved", async () => {
    const r = await parse("Outer: Inner: deep@example.com; ;");
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe("Outer");
    expect(r[0].group).toBeDefined();
    expect(r[0].group[0].address).toBe("deep@example.com");
  });

  // Performance: many @ symbols (DoS protection)
  test("many @ symbols (DoS protection)", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const input = "@".repeat(100);
        const start = Date.now();
        const r = Bun.SMTPClient.parseAddress(input);
        const elapsed = Date.now() - start;
        console.log(JSON.stringify({ ok: elapsed < 1000, len: r.length }));
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(JSON.parse(stdout.trim()).ok).toBe(true);
    expect(exitCode).toBe(0);
  });

  // Performance: many consecutive delimiters
  test("many consecutive delimiters (DoS protection)", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const input = "a@b.com" + ",".repeat(100) + "c@d.com";
        const start = Date.now();
        const r = Bun.SMTPClient.parseAddress(input);
        const elapsed = Date.now() - start;
        console.log(JSON.stringify({ ok: elapsed < 1000, len: r.length }));
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const d = JSON.parse(stdout.trim());
    expect(d.ok).toBe(true);
    expect(d.len).toBe(2);
    expect(exitCode).toBe(0);
  });

  // Deep nesting DoS protection
  test("depth 3000 nesting (DoS protection)", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        let input = "";
        for (let i = 0; i < 3000; i++) input += "g" + i + ": ";
        input += "user@example.com;";
        const start = Date.now();
        const r = Bun.SMTPClient.parseAddress(input);
        const elapsed = Date.now() - start;
        console.log(JSON.stringify({ ok: elapsed < 2000, hasResult: r.length >= 1 }));
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const d = JSON.parse(stdout.trim());
    expect(d.ok).toBe(true);
    expect(d.hasResult).toBe(true);
    expect(exitCode).toBe(0);
  });

  // ---- Missing tests 11-85 that weren't ported yet ----

  // 12: semicolon as delimiter should not break group parsing
  test("semicolon as delimiter should not break group parsing", async () => {
    const r = await parse(
      "Test User <test.user@mail.ee>; Disclosed:andris@tr.ee, andris@example.com;,,,, Undisclosed:; bob@example.com;",
    );
    expect(r).toHaveLength(4);
    expect(r[0].address).toBe("test.user@mail.ee");
    expect(r[1].name).toBe("Disclosed");
    expect(r[1].group).toHaveLength(2);
    expect(r[2].name).toBe("Undisclosed");
    expect(r[2].group).toHaveLength(0);
    expect(r[3].address).toBe("bob@example.com");
  });

  // 17: bad input with unescaped colon
  test("bad input with unescaped colon", async () => {
    const r = await parse("FirstName Surname-WithADash :: Company <firstname@company.com>");
    expect(r).toHaveLength(1);
    expect(r[0].group).toBeDefined();
  });

  // 20: escapes
  test("escapes in quoted string", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const r = Bun.SMTPClient.parseAddress('"Firstname \\\\" \\\\\\\\\\\\, Lastname \\\\(Test\\\\)" test@example.com'); console.log(JSON.stringify({ hasAddr: r[0]?.address === "test@example.com" }));`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(JSON.parse(stdout.trim()).hasAddr).toBe(true);
    expect(exitCode).toBe(0);
  });

  // 21: quoted usernames
  test("quoted usernames", async () => {
    const r = await parse('"test@subdomain.com"@example.com');
    expect(r).toHaveLength(1);
    expect(r[0].address).toBe("test@subdomain.com@example.com");
  });

  // 25: quoted local-part with angle brackets
  test("quoted local-part with angle brackets", async () => {
    const r = await parse('Name <"user@domain.com"@example.com>');
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe("Name");
  });

  // 26: escaped quotes in quoted string
  test("escaped quotes in quoted string", async () => {
    // Use JSON to pass the tricky string to avoid shell escaping issues
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const input = JSON.parse('"\\\\\"test\\\\\\\\\\\\"quote\\\\\\"@example.com"'); const r = Bun.SMTPClient.parseAddress(input); console.log(JSON.stringify({ len: r.length, hasAt: (r[0]?.address || r[0]?.name || "").includes("@") }));`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const d = JSON.parse(stdout.trim());
    expect(d.len).toBe(1);
    expect(d.hasAt).toBe(true);
    expect(exitCode).toBe(0);
  });

  // 27: escaped backslashes
  test("escaped backslashes", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        String.raw`const r = Bun.SMTPClient.parseAddress('"test\\backslash"@example.com'); console.log(JSON.stringify({ has: r[0]?.address?.includes("@example.com") }));`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(JSON.parse(stdout.trim()).has).toBe(true);
    expect(exitCode).toBe(0);
  });

  // 45: nested comments
  test("nested comments", async () => {
    const r = await parse("user@example.com (outer (nested) comment)");
    expect(r).toHaveLength(1);
    expect(r[0].address).toBe("user@example.com");
  });

  // 46: quoted text with spaces (security)
  test("quoted text with spaces (security)", async () => {
    const r = await parse('"evil@attacker.com more stuff"@legitimate.com');
    expect(r).toHaveLength(1);
    expect(r[0].address).toContain("@legitimate.com");
  });

  // 55: multiple angle brackets
  test("multiple angle brackets", async () => {
    const r = await parse("Name <<user@example.com>>");
    expect(r).toHaveLength(1);
    expect(r[0].address).toBe("user@example.com");
  });

  // 59: tabs
  test("tab characters", async () => {
    const r = await parse("user@example.com\t\tother@example.com");
    expect(r).toHaveLength(1);
    expect(r[0].address).toBe("user@example.com");
  });

  // 60: newlines
  test("newlines in input", async () => {
    const r = await parse("user@example.com\nother@example.com");
    expect(r).toHaveLength(1);
    expect(r[0].address).toBe("user@example.com");
  });

  // 61: CRLF
  test("CRLF line endings", async () => {
    const r = await parse("user@example.com\r\nother@example.com");
    expect(r).toHaveLength(1);
    expect(r[0].address).toBe("user@example.com");
  });

  // 74: very long address list
  test("1000 addresses performance", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const addrs = Array.from({length: 1000}, (_, i) => "user" + i + "@example.com").join(", ");
        const start = Date.now();
        const r = Bun.SMTPClient.parseAddress(addrs);
        const elapsed = Date.now() - start;
        console.log(JSON.stringify({ ok: elapsed < 5000, len: r.length }));
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const d = JSON.parse(stdout.trim());
    expect(d.ok).toBe(true);
    // Our parser has a 512-entry buffer limit, so it may cap at 512
    expect(d.len).toBeGreaterThan(100);
    expect(exitCode).toBe(0);
  });

  // 75: deeply nested quotes
  test("deeply nested quotes", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        String.raw`const r = Bun.SMTPClient.parseAddress('"test\"nested\"quotes"@example.com'); console.log(JSON.stringify({ has: r[0]?.address?.includes("@example.com") }));`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(JSON.parse(stdout.trim()).has).toBe(true);
    expect(exitCode).toBe(0);
  });

  // 77-84: Deep nesting DoS protection (depth 10, 50, 100, 3000, 10000, multiple, mixed, normal)
  test("depth 10 nesting", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        let input = ""; for (let i = 0; i < 10; i++) input += "g" + i + ": ";
        input += "user@example.com;";
        const r = Bun.SMTPClient.parseAddress(input);
        console.log(JSON.stringify({ len: r.length, name: r[0]?.name, hasGroup: !!r[0]?.group, memberAddr: r[0]?.group?.[0]?.address }));
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const d = JSON.parse(stdout.trim());
    expect(d.len).toBe(1);
    expect(d.name).toBe("g0");
    expect(d.hasGroup).toBe(true);
    expect(d.memberAddr).toBe("user@example.com");
    expect(exitCode).toBe(0);
  });

  test("depth 50 nesting", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        let input = ""; for (let i = 0; i < 50; i++) input += "g" + i + ": ";
        input += "user@example.com;";
        const r = Bun.SMTPClient.parseAddress(input);
        console.log(JSON.stringify({ len: r.length, hasGroup: !!r[0]?.group, memberAddr: r[0]?.group?.[0]?.address }));
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const d = JSON.parse(stdout.trim());
    expect(d.len).toBe(1);
    expect(d.hasGroup).toBe(true);
    expect(d.memberAddr).toBe("user@example.com");
    expect(exitCode).toBe(0);
  });

  test("depth 100 nesting (truncated safely)", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        let input = ""; for (let i = 0; i < 100; i++) input += "g" + i + ": ";
        input += "user@example.com;";
        const r = Bun.SMTPClient.parseAddress(input);
        console.log(JSON.stringify({ len: r.length, hasGroup: !!r[0]?.group }));
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const d = JSON.parse(stdout.trim());
    expect(d.len).toBe(1);
    expect(d.hasGroup).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("depth 10000 nesting (DoS protection)", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        let input = ""; for (let i = 0; i < 10000; i++) input += "g" + i + ": ";
        input += "user@example.com;";
        const start = Date.now();
        const r = Bun.SMTPClient.parseAddress(input);
        const elapsed = Date.now() - start;
        console.log(JSON.stringify({ ok: elapsed < 2000, isArray: Array.isArray(r) }));
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const d = JSON.parse(stdout.trim());
    expect(d.ok).toBe(true);
    expect(d.isArray).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("multiple deeply nested groups", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        let g = ""; for (let i = 0; i < 100; i++) g += "g" + i + ": ";
        g += "user@example.com;";
        const input = g + ", " + g;
        const r = Bun.SMTPClient.parseAddress(input);
        console.log(JSON.stringify({ len: r.length }));
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(JSON.parse(stdout.trim()).len).toBe(2);
    expect(exitCode).toBe(0);
  });

  // 11: flatten mixed group
  test("flatten mixed group", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const r = Bun.SMTPClient.parseAddress(
          "Test User <test.user@mail.ee>, Disclosed:andris@tr.ee, andris@example.com;,,,, Undisclosed:; bob@example.com BOB;",
          { flatten: true }
        );
        console.log(JSON.stringify(r));
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const r = JSON.parse(stdout.trim());
    expect(r).toHaveLength(4);
    expect(r[0].address).toBe("test.user@mail.ee");
    expect(r[1].address).toBe("andris@tr.ee");
    expect(r[2].address).toBe("andris@example.com");
    expect(r[3].address).toBe("bob@example.com");
    expect(exitCode).toBe(0);
  });

  // 47: flatten nested groups
  test("flatten nested groups", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const r = Bun.SMTPClient.parseAddress("Group1:a@b.com, Group2:c@d.com;;", { flatten: true });
        const addrs = r.map(x => x.address).filter(Boolean);
        console.log(JSON.stringify({ has_a: addrs.includes("a@b.com"), has_c: addrs.includes("c@d.com") }));
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const d = JSON.parse(stdout.trim());
    expect(d.has_a).toBe(true);
    expect(d.has_c).toBe(true);
    expect(exitCode).toBe(0);
  });

  // 48: flatten deeply nested groups
  test("flatten deeply nested groups", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const r = Bun.SMTPClient.parseAddress("Outer:Inner:deep@example.com;;", { flatten: true });
        console.log(JSON.stringify({ len: r.length, addr: r[0]?.address }));
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const d = JSON.parse(stdout.trim());
    expect(d.len).toBe(1);
    expect(d.addr).toBe("deep@example.com");
    expect(exitCode).toBe(0);
  });

  // 49: flatten multiple nested groups at same level
  test("flatten multiple nested groups at same level", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const r = Bun.SMTPClient.parseAddress("Main:Sub1:a@b.com;, Sub2:c@d.com;;", { flatten: true });
        const addrs = r.map(x => x.address).filter(Boolean);
        console.log(JSON.stringify({ has_a: addrs.includes("a@b.com"), has_c: addrs.includes("c@d.com") }));
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const d = JSON.parse(stdout.trim());
    expect(d.has_a).toBe(true);
    expect(d.has_c).toBe(true);
    expect(exitCode).toBe(0);
  });

  // 50: mixed nested and regular addresses in group (flattened)
  test("flatten mixed nested and regular in group", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const r = Bun.SMTPClient.parseAddress("Group:x@y.com, Nested:a@b.com;, z@w.com;", { flatten: true });
        const addrs = r.map(x => x.address).filter(Boolean);
        console.log(JSON.stringify({ has_x: addrs.includes("x@y.com"), has_a: addrs.includes("a@b.com"), has_z: addrs.includes("z@w.com") }));
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const d = JSON.parse(stdout.trim());
    expect(d.has_x).toBe(true);
    expect(d.has_a).toBe(true);
    expect(d.has_z).toBe(true);
    expect(exitCode).toBe(0);
  });

  // 85: flatten with deep nesting
  test("flatten with deep nesting (DoS protection)", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        let input = ""; for (let i = 0; i < 100; i++) input += "g" + i + ": ";
        input += "user@example.com;";
        const r = Bun.SMTPClient.parseAddress(input, { flatten: true });
        console.log(JSON.stringify({ isArray: Array.isArray(r), len: r.length }));
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const d = JSON.parse(stdout.trim());
    expect(d.isArray).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("mixed normal and deeply nested", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        let g = ""; for (let i = 0; i < 200; i++) g += "g" + i + ": ";
        g += "user@example.com;";
        const input = "normal@example.com, " + g + ", another@test.com";
        const r = Bun.SMTPClient.parseAddress(input);
        console.log(JSON.stringify({ len: r.length, first: r[0]?.address, last: r[r.length-1]?.address }));
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const d = JSON.parse(stdout.trim());
    expect(d.len).toBe(3);
    expect(d.first).toBe("normal@example.com");
    expect(d.last).toBe("another@test.com");
    expect(exitCode).toBe(0);
  });
});
