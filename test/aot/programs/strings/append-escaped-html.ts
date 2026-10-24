// Bun.escapeHTML called through a constant in the middle of a concatenation.
const escape = Bun.escapeHTML;
const log: string[] = [];
function show(label: string, text: string): void {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  console.log(label, text.length, hash, JSON.stringify(text.length <= 100 ? text : text.slice(0, 40) + ".." + text.slice(-40)));
}
const texts = [
  "", "a", "&", "<", ">", '"', "'", "a&b", "<b>bold</b>", `"quoted" & 'single'`, "plain text without anything to escape",
  "0123456789abcde", "0123456789abcdef", "0123456789abcdef0", "0123456789abcde&", "&123456789abcdef0123456789abcdef", "x".repeat(31) + "<", "x".repeat(64) + ">" + "y".repeat(64),
  "café & crème", "ÿ<ÿ", "日本語", "日<本>&語", "😀&", "\ud83d<", "<".repeat(500), "z".repeat(5000), ("w".repeat(99) + "&").repeat(40), "—&".repeat(200),
];
function link(href: string, label: string): string {
  return `<a href="${escape(href)}">${escape(label)}</a>`;
}
function list(items: string[]): string {
  let html = "<ul>";
  for (const item of items) html += "<li>" + escape(item) + "</li>";
  return html + "</ul>";
}
function mixed(text: string, n: number, missing: string | undefined): string {
  let html = "";
  html += escape(text.slice(1)) + `<i>${n}</i>`;
  html += escape(text) + escape(text + "&");
  return `${html}|${escape(missing as string)}|${escape(n as any)}|${escape("a<b")}`;
}
function page(items: string[]): string {
  return `<body>${list(items)}${items.length ? link(items[0]!, items[items.length - 1]!) : ""}</body>`;
}
for (const text of texts) {
  show("link", link(text, text));
  show("mixed", mixed(text, text.length, text.length % 2 ? undefined : text));
  show("same", String(link(text, "x") === '<a href="' + Bun.escapeHTML(text) + '">x</a>'));
}
const long = ("y".repeat(1000) + "&").repeat(2100);
show("long", link(long, "short"));
show("long", link("short", long));
show("long", mixed(long, 1, long));
function emitted(text: string): string {
  let html = "";
  let from = 0;
  const emit = (markup: string, end: number) => {
    html += escape(text.slice(from, end - 1)) + markup;
    from = end;
  };
  for (let at = 0; at < text.length; at++) {
    if (text[at] === "`") emit(`<code>${escape(text.slice(at, at + 2))}</code>`, at + 1);
    else if (text[at] === "[") emit(`<a href="${escape(text.slice(at + 1, at + 4))}" rel="x">${escape(text.slice(at + 2, at + 6))}</a>`, at + 1);
  }
  return html + escape(text.slice(from));
}
for (const text of texts) show("emitted", emitted(text + "`<&>` and [\"'x'\"] " + text));
show("emitted", emitted(long.slice(0, 1100000) + "`" + long));
show("list", list(texts));
show("page", page(texts));
show("page", page([]));

const talker = { toString() { log.push("toString"); return "<t>"; }, valueOf() { log.push("valueOf"); return "<v>"; } };
function loose(value: unknown): string {
  return `[${escape(value as any)}]` + escape(value as any) + "!";
}
show("loose", loose(talker));
show("loose", loose(12.5));
show("loose", loose(null));
show("loose", loose(true));
show("log", log.join(","));

const original = Bun.escapeHTML;
(Bun as any).escapeHTML = (text: string) => {
  log.push("replaced " + text);
  return talker;
};
show("still the original", link("<", ">"));
const replaced: (text: string) => any = Bun.escapeHTML;
function other(text: string): string {
  return `(${replaced(text)})` + replaced(text + "2") + ".";
}
log.length = 0;
show("replaced", other("<x>"));
show("log", log.join(","));
(Bun as any).escapeHTML = original;
show("restored", other("<y>") + link("&", "&"));
