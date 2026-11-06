const source =
  "# Title\n\nSome *emphasis*, `code`, a [link](https://example.com) &amp; a table:\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n";
console.log(Bun.markdown.html(source));
console.log(
  JSON.stringify(
    Bun.markdown.render(source, {
      heading: (children: string) => `<<${children}>>`,
      paragraph: (children: string) => children,
    }),
  ),
);
