test("string inline snapshots", () => {
  expect("inline").toMatchInlineSnapshot(`"inline"`);
  expect("multi\nline").toMatchInlineSnapshot(`
    "multi
    line"
  `);
  expect({ key: "inline" }).toMatchInlineSnapshot(`
    {
      "key": "inline",
    }
  `);
  expect({ key: "multi\nline", value: "inline" }).toMatchInlineSnapshot(`
    {
      "key": 
    "multi
    line"
    ,
      "value": "inline",
    }
  `);
});

test("bun inspect strings", () => {
  expect(Bun.inspect("inline")).toMatchInlineSnapshot(`""inline""`);
  expect(Bun.inspect("multi\nline")).toMatchInlineSnapshot(`""multi\\nline""`);
  expect(Bun.inspect({ key: "inline" })).toMatchInlineSnapshot(`
    "{
      key: "inline",
    }"
  `);
  expect(Bun.inspect({ key: "multi\nline", value: "inline" })).toMatchInlineSnapshot(`
    "{
      key: "multi\\nline",
      value: "inline",
    }"
  `);
});
