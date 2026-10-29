console.log(
  Bun.escapeHTML(`<a href="x">Tom & 'Jerry'</a>`),
  Bun.escapeHTML(12),
  Bun.escapeHTML("plain"),
  Bun.escapeHTML("é<" + "x".repeat(40) + ">"),
);
