import { XML } from "bun";
import doc from "./data.xml";
import { expectType } from "./utilities";

expectType(doc).is<any>();
expectType(Bun.XML.parse("<a/>")).is<Record<string, unknown>>();
expectType(XML.parse(new Uint8Array())).is<Record<string, unknown>>();
expectType(XML.parse("<a/>", { compact: true })).is<Record<string, unknown>>();
expectType(XML.parse("<a/>", { compact: false })).is<XML.Node>();
expectType(XML.parse("<a/>", { compact: false }).children).is<Array<XML.Node | string>>();
expectType(XML.parse("<a/>", {} as XML.ParseOptions)).is<Record<string, unknown> | XML.Node>();
// @ts-expect-error
XML.parse({});
// @ts-expect-error
XML.parse("<a/>", { compact: "no" });
// `undefined` when the input is `undefined`, a function, or a symbol.
expectType(XML.stringify({ a: { "@id": "1", b: ["x"] } })).is<string | undefined>();
expectType(XML.stringify({ name: "a", attributes: {}, children: ["x"] } satisfies XML.Node, null, 2)).is<
  string | undefined
>();
// @ts-expect-error
XML.stringify({ a: "1" }, (key: string, value: unknown) => value);
// @ts-expect-error
XML.stringify({ a: "1" }, null, 123n);
