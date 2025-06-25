import { expect, it } from "bun:test";
import { nsExample1, nsExample2, nsExample3, nsExample4 } from "../../snippets/jsx-attributes.tsx";

it("parses namespaced attributes correctly", () => {
  expect(nsExample1.props).toEqual({ "ns:bar": "baz", "tag": true });
  expect(nsExample2.props).toEqual({ "ns:bar42": "baz", "tag": false });
  expect(nsExample3.props).toEqual({ "ns:bar42bar": "baz" });
  expect(nsExample4.props).toEqual({ "ns42:bar": "baz" });
});
