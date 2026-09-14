import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Constant folding previously treated E::BigInt::value as decimal, so `${0x10n}`
// produced "0x10" and `!0x0n` produced false. Folds now bail out on a radix prefix.
test("radix BigInt literals are not constant-folded using their source text", async () => {
  const src = `
    const out = [];
    out.push(\`\${0x10n}\`);
    out.push(\`\${0o10n}\`);
    out.push(\`\${0b10n}\`);
    out.push(\`\${0b1_0n}\`);
    out.push(\`\${0xFF_FFn}\`);
    out.push(\`\${0x0n}\`);
    out.push(\`\${0X00n}\`);
    out.push(\`\${0xffffffffffffffffffffffffffffffffn}\`);
    out.push(String(!0x0n));
    out.push(String(!0o0n));
    out.push(String(!0b0n));
    out.push(String(!0x1n));
    out.push(0x0n ? "taken" : "not-taken");
    out.push(0x1n ? "taken" : "not-taken");
    out.push(String("" + 0x10n));
    console.log(JSON.stringify(out));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ out: JSON.parse(stdout.trim()), stderr, exitCode }).toEqual({
    out: [
      "16",
      "8",
      "2",
      "2",
      "65535",
      "0",
      "0",
      "340282366920938463463374607431768211455",
      "true",
      "true",
      "true",
      "false",
      "not-taken",
      "taken",
      "16",
    ],
    stderr: "",
    exitCode: 0,
  });
});

test("radix BigInt literals round-trip through the printer", () => {
  const t = new Bun.Transpiler({ loader: "js" });
  // The literal is printed as written (underscores stripped); the folds bail
  // out for radix BigInt literals instead of producing a wrong constant.
  expect(t.transformSync("var x = 0x10n;").trim()).toBe("var x = 0x10n;");
  expect(t.transformSync("var x = 0b1_0n;").trim()).toBe("var x = 0b10n;");
  expect(t.transformSync("var x = 0xFF_FFn;").trim()).toBe("var x = 0xFFFFn;");
  expect(t.transformSync("var x = `${0x10n}`;").trim()).toBe("var x = `${0x10n}`;");
});
