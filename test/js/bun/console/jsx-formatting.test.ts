import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

test("JSX attributes with null and other non-string values should be wrapped in braces", async () => {
  using dir = tempDir("jsx-test", {
    "jsx-test.js": `
const React = {
  createElement: (tag, props, ...children) => {
    return {
      $$typeof: Symbol.for('react.element'),
      type: tag,
      props: { ...props, children },
      key: null,
      ref: null
    };
  }
};

const Component = () => {};

// Test various value types
const element = React.createElement(Component, {
  nullProp: null,
  undefinedProp: undefined,
  boolTrue: true,
  boolFalse: false,
  number: 42,
  negNumber: -3.14,
  string: "hello",
  emptyString: "",
  zero: 0
});

console.log(element);
`,
  });

  const proc = Bun.spawn({
    cmd: [bunExe(), join(dir, "jsx-test.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stderr).toBe("");

  // Check that non-string values are wrapped in braces
  expect(stdout).toContain("nullProp={null}");
  expect(stdout).toContain("undefinedProp={undefined}");
  expect(stdout).toContain("boolTrue={true}");
  expect(stdout).toContain("boolFalse={false}");
  expect(stdout).toContain("number={42}");
  expect(stdout).toContain("negNumber={-3.14}");
  expect(stdout).toContain("zero={0}");

  // Check that string values are quoted without braces
  expect(stdout).toContain('string="hello"');
  expect(stdout).toContain('emptyString=""');

  // Ensure invalid syntax is NOT present
  expect(stdout).not.toContain("nullProp=null");
  expect(stdout).not.toContain("boolTrue=true");
  expect(stdout).not.toContain("number=42");
});

test("JSX elements with empty children arrays should render self-closing tags", async () => {
  using dir = tempDir("jsx-empty-children", {
    "jsx-empty-children.js": `
const React = {
  createElement: (tag, props, ...children) => {
    return {
      $$typeof: Symbol.for('react.element'),
      type: tag,
      props: { ...props, children },
      key: null,
      ref: null
    };
  }
};

const Component = () => {};

// Element with empty children array
const element = {
  $$typeof: Symbol.for('react.element'),
  type: Component,
  props: { foo: null, children: [] },
  key: null,
  ref: null
};

console.log(element);
`,
  });

  const proc = Bun.spawn({
    cmd: [bunExe(), join(dir, "jsx-empty-children.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stderr).toBe("");

  // Should have self-closing tag
  expect(stdout).toContain("/>");

  // Should have the attribute with braces
  expect(stdout).toContain("foo={null}");

  // Should NOT be truncated (was the bug)
  expect(stdout).not.toMatch(/<NoName foo={null}$/m);
});

test("JSX formatting for complex nested elements", async () => {
  using dir = tempDir("jsx-complex", {
    "jsx-complex.js": `
const React = {
  createElement: (tag, props, ...children) => {
    return {
      $$typeof: Symbol.for('react.element'),
      type: tag,
      props: { ...props, children },
      key: null,
      ref: null
    };
  }
};

const Component = () => {};

// Complex nested element
const element = React.createElement('div',
  { className: "container", id: "main", data: null },
  React.createElement('span', { count: 0 }, "Hello"),
  React.createElement(Component, {
    flag: false,
    value: undefined,
    handler: () => {}
  })
);

console.log(element);
`,
  });

  const proc = Bun.spawn({
    cmd: [bunExe(), join(dir, "jsx-complex.js"), "--console-depth=10"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stderr).toBe("");

  // Parent element attributes
  expect(stdout).toContain('className="container"');
  expect(stdout).toContain('id="main"');
  expect(stdout).toContain("data={null}");

  // Nested elements
  expect(stdout).toContain("<span");
  expect(stdout).toContain("count={0}");
  expect(stdout).toContain("<NoName");
  expect(stdout).toContain("flag={false}");
  expect(stdout).toContain("value={undefined}");
  expect(stdout).toContain("handler={[Function: handler]}");
});
