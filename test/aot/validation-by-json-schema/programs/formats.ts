import { JSON, type Schema } from "bun";
import { validate } from "bun:bundle";
import { accepts, finish, refuses, withMethods } from "./check";

// Any character may stand in these, or at the end of them.
const takesSpace = ["regex", "json-pointer", "relative-json-pointer", "url"];

function table(format: string, byValue: (value: unknown) => unknown, byText: (text: string) => unknown, valid: string[], invalid: string[]) {
  for (const text of valid) {
    accepts(format + " | validate | " + globalThis.JSON.stringify(text), () => byValue(text));
    accepts(format + " | parse | " + globalThis.JSON.stringify(text), () => byText(globalThis.JSON.stringify(text)));
    if (takesSpace.includes(format)) continue;
    refuses(format + " | a line feed after | " + globalThis.JSON.stringify(text), () => byValue(text + "\n"));
    refuses(format + " | a space before | " + globalThis.JSON.stringify(text), () => byValue(" " + text));
    refuses(format + " | NUL after | " + globalThis.JSON.stringify(text), () => byValue(text + "\0"));
    refuses(format + " | NUL after, by text | " + globalThis.JSON.stringify(text), () => byText(globalThis.JSON.stringify(text + "\0")));
    refuses(format + " | NUL before | " + globalThis.JSON.stringify(text), () => byValue("\0" + text));
  }
  for (const text of invalid) {
    refuses(format + " | validate | " + globalThis.JSON.stringify(text), () => byValue(text));
    refuses(format + " | parse | " + globalThis.JSON.stringify(text), () => byText(globalThis.JSON.stringify(text)));
  }
  refuses(format + " | a number", () => byValue(1));
  refuses(format + " | an object that converts to a string", () => byValue(withMethods()));
  refuses(format + " | a String object", () => byValue(new String(valid[0])));
}

table("email", value => validate<string & Schema.Format<"email">>(value), text => JSON.parse<string & Schema.Format<"email">>(text),
  ["joe.bloggs@example.com", "a@b.co"], ["", "a", "a@", "@b.co", "a b@c.de", "a@b@c.de", ".a@b.co", "a..b@c.de", "a@xn--X", "a@xn--l-fda.example"]);
table("uuid", value => validate<string & Schema.Format<"uuid">>(value), text => JSON.parse<string & Schema.Format<"uuid">>(text),
  ["2eb8aa08-aa98-11ea-b4aa-73b441d16380", "2EB8AA08-AA98-11EA-B4AA-73B441D16380"],
  ["", "2eb8aa08-aa98-11ea-b4aa-73b441d1638", "2eb8aa08aa9811eab4aa73b441d16380", "2eb8aa08-aa98-11ea-b4ga-73b441d16380", "2eb8-aa08-aa98-11ea-b4aa73b44-1d16380"]);
table("ipv4", value => validate<string & Schema.Format<"ipv4">>(value), text => JSON.parse<string & Schema.Format<"ipv4">>(text),
  ["192.168.0.1", "0.0.0.0", "255.255.255.255"], ["", "256.0.0.1", "1.2.3", "1.2.3.4.5", "01.2.3.4", "0x7f.0.0.1", "1২7.0.0.1", "1.2.3.4/24", "2130706433"]);
table("ipv6", value => validate<string & Schema.Format<"ipv6">>(value), text => JSON.parse<string & Schema.Format<"ipv6">>(text),
  ["::1", "::", "1:2:3:4:5:6:7:8", "::ffff:192.168.0.1", "2001:db8::1"],
  ["", "12345::", "1:2:3:4:5:6:7", "1:2:3:4:5:6:7:8:9", "::1::", ":2:3:4:5:6:7:8", "fe80::a%eth1", "fe80::/64", "1:2:3:4:5:6:7:৪", "::ffff:256.0.0.1"]);
table("date", value => validate<string & Schema.Format<"date">>(value), text => JSON.parse<string & Schema.Format<"date">>(text),
  ["2020-02-29", "1963-06-19", "2000-12-31"], ["", "2021-02-29", "2020-2-29", "2020-13-01", "2020-00-01", "2020-01-32", "2020-01-00", "06/19/1963", "2020-01-01T00:00:00Z", "1963-06-1৪", "+2020-01-01"]);
table("date-time", value => validate<string & Schema.Format<"date-time">>(value), text => JSON.parse<string & Schema.Format<"date-time">>(text),
  ["2020-01-01T00:00:00Z", "1963-06-19T08:30:06.283185Z", "1937-01-01T12:00:27.87+00:20", "1998-12-31T23:59:60Z", "2020-01-01t00:00:00z"],
  ["", "2020-01-01", "2020-01-01T00:00:00", "2020-01-01T24:00:00Z", "2020-01-01T00:60:00Z", "2021-02-29T00:00:00Z", "1998-12-31T23:58:60Z", "2020-01-01T00:00:00+24:00", "2020-01-01T00:00:00.Z", "1963-06-1৪T00:00:00Z"]);
table("time", value => validate<string & Schema.Format<"time">>(value), text => JSON.parse<string & Schema.Format<"time">>(text),
  ["08:30:06Z", "08:30:06.283185Z", "08:30:06+01:00", "23:59:60Z", "08:30:06z"],
  ["", "08:30:06", "24:00:00Z", "00:60:00Z", "00:00:61Z", "22:59:60Z", "8:30:06Z", "08:30Z", "08:30:06+24:00", "08:30:06 PST", "1২:00:00Z"]);
table("duration", value => validate<string & Schema.Format<"duration">>(value), text => JSON.parse<string & Schema.Format<"duration">>(text),
  ["P4DT12H30M5S", "P4Y", "PT0S", "P2W", "P1M", "PT1M", "PT36H", "P1DT12H", "P1Y2M3D", "P2M3D", "PT2M3S", "P1YT1S"],
  ["", "P", "PT", "PT1D", "P1Y2W", "P2D1Y", "P1D2H", "4DT12H30M5S", "P1", "P2S", "P২Y", "P-1D", "P1Y1D", "PT1H1S"]);
table("hostname", value => validate<string & Schema.Format<"hostname">>(value), text => JSON.parse<string & Schema.Format<"hostname">>(text),
  ["www.example.com", "a", "a-b.c", "1host"],
  ["", "-a.com", "a-.com", "a_b.com", "a..b", ".a", "a b", "a".repeat(64) + ".com", ("a".repeat(63) + ".").repeat(4) + "com",
    "example.", ".", "example．com", "ab--cd", "xn--X", "XN--aa---o47jg78q", "xn--hello-txk", "a.xn--l-fda"]);
table("uri", value => validate<string & Schema.Format<"uri">>(value), text => JSON.parse<string & Schema.Format<"uri">>(text),
  ["http://foo.bar/?baz=qux#quux", "urn:oasis:names:specification:docbook:dtd:xml:4.1.2", "mailto:John.Doe@example.com", "ldap://[2001:db8::7]/c=GB?objectClass?one",
    "x://[v1.a]", "x://[vF.a:b]", "x://[V7.~]:80/p", "x://[::1]"],
  ["", "//foo.bar/?baz=qux#quux", "/abc", "abc", "\\\\WINDOWS\\fileshare", "http:// shouldfail.com", ":// should fail", "bar,baz:foo", "http://a/%zz",
    "x://[v!!]", "x://[v1.]", "x://[v.a]", "x://[v1.%41]"]);
table("uri-reference", value => validate<string & Schema.Format<"uri-reference">>(value), text => JSON.parse<string & Schema.Format<"uri-reference">>(text),
  ["http://foo.bar/?baz=qux#quux", "//foo.bar/?baz=qux#quux", "/abc", "abc", "#fragment"], ["\\\\WINDOWS\\fileshare", "#frag\\ment", "a b", "%zz"]);
table("regex", value => validate<string & Schema.Format<"regex">>(value), text => JSON.parse<string & Schema.Format<"regex">>(text),
  ["([abc])+\\s+$", "^a$"], ["^(abc]", "(", "[", "a{2,1}", "\\"]);
table("json-pointer", value => validate<string & Schema.Format<"json-pointer">>(value), text => JSON.parse<string & Schema.Format<"json-pointer">>(text),
  ["/foo/bar~0/baz~1/%a", "/", "/foo//bar", "/~0~1", "/a\n", "/a\0", "/ "], ["foo", "/foo/bar~", "/~2", "/~", "#", "#/", "a/a", "/~-1", " /a", "\n/a", "\0/a", " "]);
table("relative-json-pointer", value => validate<string & Schema.Format<"relative-json-pointer">>(value), text => JSON.parse<string & Schema.Format<"relative-json-pointer">>(text),
  ["1", "0/foo/bar", "2/0/baz/1/zip", "0#", "120/foo", "0/a\n"],
  ["", "/foo/bar", "-1/foo/bar", "+1/foo", "0##", "01/a", "01#", "1/~2", "1২", " 1", "1\n", "1 ", "1\0", "\x001", "0#\n", "0# "]);
table("url", value => validate<string & Schema.Format<"url">>(value), text => JSON.parse<string & Schema.Format<"url">>(text),
  ["https://bun.sh/docs?a=1#b"], ["", "not a url", "/docs"]);
accepts("json-pointer | the empty string", () => validate<string & Schema.Format<"json-pointer">>(""));
accepts("uri-reference | the empty string", () => validate<string & Schema.Format<"uri-reference">>(""));

finish();
