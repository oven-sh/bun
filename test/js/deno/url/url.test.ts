// GENERATED - DO NOT EDIT
// Copyright 2018+ the Deno authors. All rights reserved. MIT license.
// https://raw.githubusercontent.com/denoland/deno/main/cli/tests/unit/url_test.ts
import { createDenoTest } from "deno:harness";
const { test, assert, assertEquals, assertStrictEquals, assertThrows } = createDenoTest(import.meta.path);
test(function urlParsing() {
    const url = new URL("https://foo:bar@baz.qat:8000/qux/quux?foo=bar&baz=12#qat");
    assertEquals(url.hash, "#qat");
    assertEquals(url.host, "baz.qat:8000");
    assertEquals(url.hostname, "baz.qat");
    assertEquals(url.href, "https://foo:bar@baz.qat:8000/qux/quux?foo=bar&baz=12#qat");
    assertEquals(url.origin, "https://baz.qat:8000");
    assertEquals(url.password, "bar");
    assertEquals(url.pathname, "/qux/quux");
    assertEquals(url.port, "8000");
    assertEquals(url.protocol, "https:");
    assertEquals(url.search, "?foo=bar&baz=12");
    assertEquals(url.searchParams.getAll("foo"), [
        "bar"
    ]);
    assertEquals(url.searchParams.getAll("baz"), [
        "12"
    ]);
    assertEquals(url.username, "foo");
    assertEquals(String(url), "https://foo:bar@baz.qat:8000/qux/quux?foo=bar&baz=12#qat");
});
test(function urlProtocolParsing() {
    assertEquals(new URL("Aa+-.1://foo").protocol, "aa+-.1:");
    assertEquals(new URL("aA+-.1://foo").protocol, "aa+-.1:");
    assertThrows(()=>new URL("1://foo"), TypeError, "Invalid URL: '1://foo'");
    assertThrows(()=>new URL("+://foo"), TypeError, "Invalid URL: '+://foo'");
    assertThrows(()=>new URL("-://foo"), TypeError, "Invalid URL: '-://foo'");
    assertThrows(()=>new URL(".://foo"), TypeError, "Invalid URL: '.://foo'");
    assertThrows(()=>new URL("_://foo"), TypeError, "Invalid URL: '_://foo'");
    assertThrows(()=>new URL("=://foo"), TypeError, "Invalid URL: '=://foo'");
    assertThrows(()=>new URL("!://foo"), TypeError, "Invalid URL: '!://foo'");
    assertThrows(()=>new URL(`"://foo`), TypeError, `Invalid URL: '"://foo'`);
    assertThrows(()=>new URL("$://foo"), TypeError, "Invalid URL: '$://foo'");
    assertThrows(()=>new URL("%://foo"), TypeError, "Invalid URL: '%://foo'");
    assertThrows(()=>new URL("^://foo"), TypeError, "Invalid URL: '^://foo'");
    assertThrows(()=>new URL("*://foo"), TypeError, "Invalid URL: '*://foo'");
    assertThrows(()=>new URL("*://foo"), TypeError, "Invalid URL: '*://foo'");
    assertThrows(()=>new URL("!:", "*://foo"), TypeError, "Invalid URL: '!:' with base '*://foo'");
});
test(function urlAuthenticationParsing() {
    const specialUrl = new URL("http://foo:bar@baz");
    assertEquals(specialUrl.username, "foo");
    assertEquals(specialUrl.password, "bar");
    assertEquals(specialUrl.hostname, "baz");
    assertThrows(()=>new URL("file://foo:bar@baz"), TypeError, "Invalid URL");
    const nonSpecialUrl = new URL("abcd://foo:bar@baz");
    assertEquals(nonSpecialUrl.username, "foo");
    assertEquals(nonSpecialUrl.password, "bar");
    assertEquals(nonSpecialUrl.hostname, "baz");
});
test(function urlHostnameParsing() {
    assertEquals(new URL("http://[::1]").hostname, "[::1]");
    assertEquals(new URL("file://[::1]").hostname, "[::1]");
    assertEquals(new URL("abcd://[::1]").hostname, "[::1]");
    assertEquals(new URL("http://[0:f:0:0:f:f:0:0]").hostname, "[0:f::f:f:0:0]");
    assertThrows(()=>new URL("http:// a"), TypeError, "Invalid URL");
    assertThrows(()=>new URL("file:// a"), TypeError, "Invalid URL");
    assertThrows(()=>new URL("abcd:// a"), TypeError, "Invalid URL");
    assertThrows(()=>new URL("http://%"), TypeError, "Invalid URL");
    assertThrows(()=>new URL("file://%"), TypeError, "Invalid URL");
    assertEquals(new URL("abcd://%").hostname, "%");
    assertEquals(new URL("http://%21").hostname, "!");
    assertEquals(new URL("file://%21").hostname, "!");
    assertEquals(new URL("abcd://%21").hostname, "%21");
    assertEquals(new URL("http://260").hostname, "0.0.1.4");
    assertEquals(new URL("file://260").hostname, "0.0.1.4");
    assertEquals(new URL("abcd://260").hostname, "260");
    assertEquals(new URL("http://255.0.0.0").hostname, "255.0.0.0");
    assertThrows(()=>new URL("http://256.0.0.0"), TypeError, "Invalid URL");
    assertEquals(new URL("http://0.255.0.0").hostname, "0.255.0.0");
    assertThrows(()=>new URL("http://0.256.0.0"), TypeError, "Invalid URL");
    assertEquals(new URL("http://0.0.255.0").hostname, "0.0.255.0");
    assertThrows(()=>new URL("http://0.0.256.0"), TypeError, "Invalid URL");
    assertEquals(new URL("http://0.0.0.255").hostname, "0.0.0.255");
    assertThrows(()=>new URL("http://0.0.0.256"), TypeError, "Invalid URL");
    assertEquals(new URL("http://0.0.65535").hostname, "0.0.255.255");
    assertThrows(()=>new URL("http://0.0.65536"), TypeError, "Invalid URL");
    assertEquals(new URL("http://0.16777215").hostname, "0.255.255.255");
    assertThrows(()=>new URL("http://0.16777216"), TypeError, "Invalid URL");
    assertEquals(new URL("http://4294967295").hostname, "255.255.255.255");
    assertThrows(()=>new URL("http://4294967296"), TypeError, "Invalid URL");
});
test(function urlPortParsing() {
    const specialUrl = new URL("http://foo:8000");
    assertEquals(specialUrl.hostname, "foo");
    assertEquals(specialUrl.port, "8000");
    assertThrows(()=>new URL("file://foo:8000"), TypeError, "Invalid URL");
    const nonSpecialUrl = new URL("abcd://foo:8000");
    assertEquals(nonSpecialUrl.hostname, "foo");
    assertEquals(nonSpecialUrl.port, "8000");
});
test(function urlModifications() {
    const url = new URL("https://foo:bar@baz.qat:8000/qux/quux?foo=bar&baz=12#qat");
    url.hash = "";
    assertEquals(url.href, "https://foo:bar@baz.qat:8000/qux/quux?foo=bar&baz=12");
    url.host = "qat.baz:8080";
    assertEquals(url.href, "https://foo:bar@qat.baz:8080/qux/quux?foo=bar&baz=12");
    url.hostname = "foo.bar";
    assertEquals(url.href, "https://foo:bar@foo.bar:8080/qux/quux?foo=bar&baz=12");
    url.password = "qux";
    assertEquals(url.href, "https://foo:qux@foo.bar:8080/qux/quux?foo=bar&baz=12");
    url.pathname = "/foo/bar%qat";
    assertEquals(url.href, "https://foo:qux@foo.bar:8080/foo/bar%qat?foo=bar&baz=12");
    url.port = "";
    assertEquals(url.href, "https://foo:qux@foo.bar/foo/bar%qat?foo=bar&baz=12");
    url.protocol = "http:";
    assertEquals(url.href, "http://foo:qux@foo.bar/foo/bar%qat?foo=bar&baz=12");
    url.search = "?foo=bar&foo=baz";
    assertEquals(url.href, "http://foo:qux@foo.bar/foo/bar%qat?foo=bar&foo=baz");
    assertEquals(url.searchParams.getAll("foo"), [
        "bar",
        "baz"
    ]);
    url.username = "foo@bar";
    assertEquals(url.href, "http://foo%40bar:qux@foo.bar/foo/bar%qat?foo=bar&foo=baz");
    url.searchParams.set("bar", "qat");
    assertEquals(url.href, "http://foo%40bar:qux@foo.bar/foo/bar%qat?foo=bar&foo=baz&bar=qat");
    url.searchParams.delete("foo");
    assertEquals(url.href, "http://foo%40bar:qux@foo.bar/foo/bar%qat?bar=qat");
    url.searchParams.append("foo", "bar");
    assertEquals(url.href, "http://foo%40bar:qux@foo.bar/foo/bar%qat?bar=qat&foo=bar");
});
test(function urlModifyHref() {
    const url = new URL("http://example.com/");
    url.href = "https://foo:bar@example.com:8080/baz/qat#qux";
    assertEquals(url.protocol, "https:");
    assertEquals(url.username, "foo");
    assertEquals(url.password, "bar");
    assertEquals(url.host, "example.com:8080");
    assertEquals(url.hostname, "example.com");
    assertEquals(url.pathname, "/baz/qat");
    assertEquals(url.hash, "#qux");
});
test(function urlNormalize() {
    const url = new URL("http://example.com");
    assertEquals(url.pathname, "/");
    assertEquals(url.href, "http://example.com/");
});
test(function urlModifyPathname() {
    const url = new URL("http://foo.bar/baz%qat/qux%quux");
    assertEquals(url.pathname, "/baz%qat/qux%quux");
    url.pathname = url.pathname;
    assertEquals(url.pathname, "/baz%qat/qux%quux");
    url.pathname = "baz#qat qux";
    assertEquals(url.pathname, "/baz%23qat%20qux");
    url.pathname = url.pathname;
    assertEquals(url.pathname, "/baz%23qat%20qux");
    url.pathname = "\\a\\b\\c";
    assertEquals(url.pathname, "/a/b/c");
});
test(function urlModifyHash() {
    const url = new URL("http://foo.bar");
    url.hash = "%foo bar/qat%qux#bar";
    assertEquals(url.hash, "#%foo%20bar/qat%qux#bar");
    url.hash = url.hash;
    assertEquals(url.hash, "#%foo%20bar/qat%qux#bar");
});
test(function urlSearchParamsReuse() {
    const url = new URL("https://foo:bar@baz.qat:8000/qux/quux?foo=bar&baz=12#qat");
    const sp = url.searchParams;
    url.host = "baz.qat";
    assert(sp === url.searchParams, "Search params should be reused.");
});
// TODO: bug in webkit WTF::URLParser
test.todo(function urlBackSlashes() {
    const url = new URL("https:\\\\foo:bar@baz.qat:8000\\qux\\quux?foo=bar&baz=12#qat");
    assertEquals(url.href, "https://foo:bar@baz.qat:8000/qux/quux?foo=bar&baz=12#qat");
});
test(function urlProtocolSlashes() {
    assertEquals(new URL("http:foo").href, "http://foo/");
    assertEquals(new URL("http://foo").href, "http://foo/");
    assertEquals(new URL("file:foo").href, "file:///foo");
    assertEquals(new URL("file://foo").href, "file://foo/");
    assertEquals(new URL("abcd:foo").href, "abcd:foo");
    assertEquals(new URL("abcd://foo").href, "abcd://foo");
});
test(function urlRequireHost() {
    assertEquals(new URL("file:///").href, "file:///");
    assertThrows(()=>new URL("ftp:///"), TypeError, "Invalid URL");
    assertThrows(()=>new URL("http:///"), TypeError, "Invalid URL");
    assertThrows(()=>new URL("https:///"), TypeError, "Invalid URL");
    assertThrows(()=>new URL("ws:///"), TypeError, "Invalid URL");
    assertThrows(()=>new URL("wss:///"), TypeError, "Invalid URL");
});
test(function urlDriveLetter() {
    assertEquals(new URL("file:///C:").href, "file:///C:");
    assertEquals(new URL("file:///C:/").href, "file:///C:/");
    assertEquals(new URL("file:///C:/..").href, "file:///C:/");
    // assertEquals(new URL("file://foo/C:").href, "file:///C:"); // this is against browser behavior
});
test(function urlHostnameUpperCase() {
    assertEquals(new URL("http://EXAMPLE.COM").href, "http://example.com/");
    assertEquals(new URL("abcd://EXAMPLE.COM").href, "abcd://EXAMPLE.COM");
});
test(function urlEmptyPath() {
    assertEquals(new URL("http://foo").pathname, "/");
    assertEquals(new URL("file://foo").pathname, "/");
    assertEquals(new URL("abcd://foo").pathname, "");
});
test(function urlPathRepeatedSlashes() {
    assertEquals(new URL("http://foo//bar//").pathname, "//bar//");
    // assertEquals(new URL("file://foo///bar//").pathname, "/bar//"); // deno's behavior is wrong
    assertEquals(new URL("file://foo///bar//").pathname, "///bar//");
    assertEquals(new URL("abcd://foo//bar//").pathname, "//bar//");
});
test(function urlTrim() {
    assertEquals(new URL(" http://example.com  ").href, "http://example.com/");
});
test(function urlEncoding() {
    assertEquals(new URL("http://a !$&*()=,;+'\"@example.com").username, "a%20!$&*()%3D,%3B+'%22");
    assertEquals(new URL("http://:a !$&*()=,;+'\"@example.com").password, "a%20!$&*()%3D,%3B+'%22");
    assertEquals(new URL("http://mañana/c?d#e").hostname, "xn--maana-pta");
    assertEquals(new URL("abcd://mañana/c?d#e").hostname, "ma%C3%B1ana");
    assertEquals(new URL("http://example.com/a ~!@$&*()=:/,;+'\"\\").pathname, "/a%20~!@$&*()=:/,;+'%22/");
    assertEquals(new URL("http://example.com?a ~!@$&*()=:/,;?+'\"\\").search, "?a%20~!@$&*()=:/,;?+%27%22\\");
    assertEquals(new URL("abcd://example.com?a ~!@$&*()=:/,;?+'\"\\").search, "?a%20~!@$&*()=:/,;?+'%22\\");
    assertEquals(new URL("http://example.com#a ~!@#$&*()=:/,;?+'\"\\").hash, "#a%20~!@#$&*()=:/,;?+'%22\\");
});
test(function urlBase() {
    assertEquals(new URL("d", new URL("http://foo/a?b#c")).href, "http://foo/d");
    assertEquals(new URL("", "http://foo/a/b?c#d").href, "http://foo/a/b?c");
    assertEquals(new URL("", "file://foo/a/b?c#d").href, "file://foo/a/b?c");
    assertEquals(new URL("", "abcd://foo/a/b?c#d").href, "abcd://foo/a/b?c");
    assertEquals(new URL("#e", "http://foo/a/b?c#d").href, "http://foo/a/b?c#e");
    assertEquals(new URL("#e", "file://foo/a/b?c#d").href, "file://foo/a/b?c#e");
    assertEquals(new URL("#e", "abcd://foo/a/b?c#d").href, "abcd://foo/a/b?c#e");
    assertEquals(new URL("?e", "http://foo/a/b?c#d").href, "http://foo/a/b?e");
    assertEquals(new URL("?e", "file://foo/a/b?c#d").href, "file://foo/a/b?e");
    assertEquals(new URL("?e", "abcd://foo/a/b?c#d").href, "abcd://foo/a/b?e");
    assertEquals(new URL("e", "http://foo/a/b?c#d").href, "http://foo/a/e");
    assertEquals(new URL("e", "file://foo/a/b?c#d").href, "file://foo/a/e");
    assertEquals(new URL("e", "abcd://foo/a/b?c#d").href, "abcd://foo/a/e");
    assertEquals(new URL(".", "http://foo/a/b?c#d").href, "http://foo/a/");
    assertEquals(new URL(".", "file://foo/a/b?c#d").href, "file://foo/a/");
    assertEquals(new URL(".", "abcd://foo/a/b?c#d").href, "abcd://foo/a/");
    assertEquals(new URL("..", "http://foo/a/b?c#d").href, "http://foo/");
    assertEquals(new URL("..", "file://foo/a/b?c#d").href, "file://foo/");
    assertEquals(new URL("..", "abcd://foo/a/b?c#d").href, "abcd://foo/");
    assertEquals(new URL("/e", "http://foo/a/b?c#d").href, "http://foo/e");
    assertEquals(new URL("/e", "file://foo/a/b?c#d").href, "file://foo/e");
    assertEquals(new URL("/e", "abcd://foo/a/b?c#d").href, "abcd://foo/e");
    assertEquals(new URL("//bar", "http://foo/a/b?c#d").href, "http://bar/");
    assertEquals(new URL("//bar", "file://foo/a/b?c#d").href, "file://bar/");
    assertEquals(new URL("//bar", "abcd://foo/a/b?c#d").href, "abcd://bar");
    assertEquals(new URL("efgh:", "http://foo/a/b?c#d").href, "efgh:");
    assertEquals(new URL("efgh:", "file://foo/a/b?c#d").href, "efgh:");
    assertEquals(new URL("efgh:", "abcd://foo/a/b?c#d").href, "efgh:");
    assertEquals(new URL("/foo", "abcd:/").href, "abcd:/foo");
});
test(function urlDriveLetterBase() {
    assertEquals(new URL("/b", "file:///C:/a/b").href, "file:///C:/b");
    assertEquals(new URL("/D:", "file:///C:/a/b").href, "file:///D:");
});
test(function urlSameProtocolBase() {
    assertEquals(new URL("http:", "http://foo/a").href, "http://foo/a");
    assertEquals(new URL("file:", "file://foo/a").href, "file://foo/a");
    assertEquals(new URL("abcd:", "abcd://foo/a").href, "abcd:");
    assertEquals(new URL("http:b", "http://foo/a").href, "http://foo/b");
    assertEquals(new URL("file:b", "file://foo/a").href, "file://foo/b");
    assertEquals(new URL("abcd:b", "abcd://foo/a").href, "abcd:b");
});
test(function deletingAllParamsRemovesQuestionMarkFromURL() {
    const url = new URL("http://example.com/?param1&param2");
    url.searchParams.delete("param1");
    url.searchParams.delete("param2");
    assertEquals(url.href, "http://example.com/");
    assertEquals(url.search, "");
});
test(function removingNonExistentParamRemovesQuestionMarkFromURL() {
    const url = new URL("http://example.com/?");
    assertEquals(url.href, "http://example.com/?");
    url.searchParams.delete("param1");
    assertEquals(url.href, "http://example.com/");
    assertEquals(url.search, "");
});
test(function sortingNonExistentParamRemovesQuestionMarkFromURL() {
    const url = new URL("http://example.com/?");
    assertEquals(url.href, "http://example.com/?");
    url.searchParams.sort();
    assertEquals(url.href, "http://example.com/");
    assertEquals(url.search, "");
});
test(function protocolNotHttpOrFile() {
    const url = new URL("about:blank");
    assertEquals(url.href, "about:blank");
    assertEquals(url.protocol, "about:");
    assertEquals(url.origin, "null");
});
test(function throwForInvalidPortConstructor() {
    const urls = [
        `https://baz.qat:${2 ** 16}`,
        "https://baz.qat:-32",
        "https://baz.qat:deno",
        "https://baz.qat:9land",
        "https://baz.qat:10.5"
    ];
    for (const url of urls){
        assertThrows(()=>new URL(url), TypeError, "Invalid URL");
    }
    new URL("https://baz.qat:65535");
    new URL("https://baz.qat:0");
});
test(function doNotOverridePortIfInvalid() {
    const initialPort = "3000";
    const url = new URL(`https://deno.land:${initialPort}`);
    url.port = `${2 ** 16}`;
    assertEquals(url.port, initialPort);
});
test(function emptyPortForSchemeDefaultPort() {
    const nonDefaultPort = "3500";
    const url = new URL("ftp://baz.qat:21");
    assertEquals(url.port, "");
    url.port = nonDefaultPort;
    assertEquals(url.port, nonDefaultPort);
    url.port = "21";
    assertEquals(url.port, "");
    url.protocol = "http";
    assertEquals(url.port, "");
    const url2 = new URL("https://baz.qat:443");
    assertEquals(url2.port, "");
    url2.port = nonDefaultPort;
    assertEquals(url2.port, nonDefaultPort);
    url2.port = "443";
    assertEquals(url2.port, "");
    url2.protocol = "http";
    assertEquals(url2.port, "");
});
test(function assigningPortPropertyAffectsReceiverOnly() {
    const u1 = new URL("http://google.com/");
    const u2 = new URL(u1 as any);
    u2.port = "123";
    assertStrictEquals(u1.port, "");
    assertStrictEquals(u2.port, "123");
});
test(function urlSearchParamsIdentityPreserved() {
    const u = new URL("http://foo.com/");
    const sp1 = u.searchParams;
    u.href = "http://bar.com/?baz=42";
    const sp2 = u.searchParams;
    assertStrictEquals(sp1, sp2);
});
test(function urlTakeURLObjectAsParameter() {
    const url = new URL(new URL("https://foo:bar@baz.qat:8000/qux/quux?foo=bar&baz=12#qat"));
    assertEquals(url.href, "https://foo:bar@baz.qat:8000/qux/quux?foo=bar&baz=12#qat");
});
