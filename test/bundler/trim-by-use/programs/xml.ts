const value = Bun.XML.parse(
  `<?xml version="1.0"?><feed kind="short"><entry id="1">one &amp; only</entry><entry id="2"><![CDATA[<two>]]></entry><empty/></feed>`,
);
console.log(JSON.stringify(value));
console.log(Bun.XML.stringify(value));
