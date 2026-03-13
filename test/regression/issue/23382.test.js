test("correct snapshot formatting for object key with unicode", () => {
  expect({ "▶": "▹" }).toMatchInlineSnapshot(`
    {
      "▶": "▹",
    }
  `);
});
