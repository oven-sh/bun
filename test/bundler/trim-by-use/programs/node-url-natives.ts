import url from "node:url";
console.log(
  url.domainToASCII("espa\u00f1ol.com"),
  url.domainToUnicode("xn--espaol-zwa.com"),
  url.parse("http://a.b/c?d=e").pathname,
);
