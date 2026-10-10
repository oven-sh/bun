import { XML } from "bun";
import doc from "./data.xml";
import { expectType } from "./utilities";

expectType(doc).is<XML.Document>();
expectType(Bun.XML.parse("<a/>")).is<XML.Document>();
expectType(XML.parse(new Uint8Array())).is<XML.Document>();
expectType(XML.parse("<a/>", { compact: true })).is<XML.Document>();
expectType(XML.parse("<a/>", { compact: false })).is<XML.Node>();
expectType(XML.parse("<a/>", { compact: false }).children).is<
  Array<string | XML.Node | XML.Comment | XML.ProcessingInstruction>
>();
expectType(XML.parse("<a/>", {} as XML.ParseOptions)).is<XML.Document | XML.Node>();

// The compact value space is closed: narrowing needs no casts.
{
  const root: XML.Value | undefined = XML.parse("<a/>").a;
  if (typeof root === "object") {
    const child = root.item;
    expectType(child).is<XML.Value | XML.Value[] | undefined>();
    for (const item of Array.isArray(child) ? child : [child]) {
      if (typeof item === "object") expectType(item["@id"]).is<XML.Value | XML.Value[] | undefined>();
      else expectType(item).is<string | undefined>();
    }
  }
}
// Tree children discriminate by key.
for (const c of XML.parse("<a/>", { compact: false }).children) {
  if (typeof c === "string") expectType(c).is<string>();
  else if ("name" in c) expectType(c).is<XML.Node>();
  else if ("comment" in c) expectType(c).is<XML.Comment>();
  else expectType(c).is<XML.ProcessingInstruction>();
}

// @ts-expect-error
XML.parse({});
// @ts-expect-error
XML.parse("<a/>", { compact: "no" });
// @ts-expect-error - reserved for a reviver, not accepted yet
XML.parse("<a/>", (key: string, value: unknown) => value);

expectType(XML.stringify({ a: { "@id": "1", b: ["x"] } })).is<string>();
expectType(XML.stringify({ name: "a", attributes: {}, children: ["x"] } satisfies XML.Node, null, 2)).is<string>();
expectType(
  XML.stringify({ name: "a", children: ["x", 1, null, { comment: "c" }, { target: "p", data: "" }, { name: "b" }] }),
).is<string>();
expectType(XML.stringify(XML.parse("<a/>", { compact: false }))).is<string>();
// `undefined` when the input is `undefined`, a function, or a symbol.
expectType(XML.stringify(undefined)).is<string | undefined>();
expectType(XML.stringify(Symbol() as unknown)).is<string | undefined>();
// @ts-expect-error
XML.stringify({ a: "1" }, (key: string, value: unknown) => value);
// @ts-expect-error
XML.stringify({ a: "1" }, null, 123n);
