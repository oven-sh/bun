console.log(
  Buffer.from("h\u00e9llo").length,
  Buffer.from([0xe2, 0x82, 0xac]).toString(),
  await new Blob(["\u20ac"]).text(),
  (await new Response("\u20ac").bytes()).length,
  btoa("x"),
  escape("\u00e9"),
);
