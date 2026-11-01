import { describe, expect, test } from "bun:test";
import {
  corsResponseHeaders,
  matchCorsRule,
  parseCorsConfiguration,
  preflightResponseHeaders,
  serializeCorsConfiguration,
  type CorsRule,
} from "../src/cors.ts";
import { S3Error } from "../src/errors.ts";

const XMLNS = "http://s3.amazonaws.com/doc/2006-03-01/";
const VARY = "Origin, Access-Control-Request-Headers, Access-Control-Request-Method";

interface ErrorFields {
  code: string;
  status: number;
  message: string;
  details: Record<string, string | number | undefined>;
}

const MALFORMED_XML: ErrorFields = {
  code: "MalformedXML",
  status: 400,
  message: "The XML you provided was not well-formed or did not validate against our published schema",
  details: {},
};

function invalidRequest(message: string): ErrorFields {
  return { code: "InvalidRequest", status: 400, message, details: {} };
}

/** The S3 error that the function throws, or `undefined` when it returns. */
function thrown(run: () => unknown): ErrorFields | undefined {
  try {
    run();
  } catch (error) {
    if (!(error instanceof S3Error)) throw error;
    return { code: error.code, status: error.status, message: error.message, details: error.details };
  }
  return undefined;
}

const ORIGIN = "<AllowedOrigin>https://example.com</AllowedOrigin>";
const METHOD = "<AllowedMethod>GET</AllowedMethod>";
const MINIMAL = ORIGIN + METHOD;

/** A configuration document. Each argument is the content of one `<CORSRule>`. */
function configuration(...rules: string[]): string {
  const content = rules.map(rule => `<CORSRule>${rule}</CORSRule>`).join("");
  return `<CORSConfiguration xmlns="${XMLNS}">${content}</CORSConfiguration>`;
}

/** A rule that allows GET from every origin, with the given changes. */
function corsRule(fields: Partial<CorsRule> = {}): CorsRule {
  return { allowedOrigins: ["*"], allowedMethods: ["GET"], allowedHeaders: [], exposeHeaders: [], ...fields };
}

describe("parseCorsConfiguration", () => {
  test("reads every element of each rule", () => {
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<CORSConfiguration xmlns="${XMLNS}">
  <CORSRule>
    <ID>rule-1</ID>
    <AllowedOrigin>https://example.com</AllowedOrigin>
    <AllowedOrigin>https://*.example.org</AllowedOrigin>
    <AllowedMethod>GET</AllowedMethod>
    <AllowedMethod>PUT</AllowedMethod>
    <AllowedMethod>POST</AllowedMethod>
    <AllowedMethod>DELETE</AllowedMethod>
    <AllowedMethod>HEAD</AllowedMethod>
    <AllowedHeader>Authorization</AllowedHeader>
    <AllowedHeader>x-amz-*</AllowedHeader>
    <ExposeHeader>ETag</ExposeHeader>
    <ExposeHeader>x-amz-request-id</ExposeHeader>
    <MaxAgeSeconds>3000</MaxAgeSeconds>
  </CORSRule>
  <CORSRule>
    <AllowedOrigin>*</AllowedOrigin>
    <AllowedMethod>GET</AllowedMethod>
  </CORSRule>
</CORSConfiguration>`;

    expect(parseCorsConfiguration(body)).toEqual([
      {
        id: "rule-1",
        allowedOrigins: ["https://example.com", "https://*.example.org"],
        allowedMethods: ["GET", "PUT", "POST", "DELETE", "HEAD"],
        allowedHeaders: ["Authorization", "x-amz-*"],
        exposeHeaders: ["ETag", "x-amz-request-id"],
        maxAgeSeconds: 3000,
      },
      { allowedOrigins: ["*"], allowedMethods: ["GET"], allowedHeaders: [], exposeHeaders: [] },
    ]);
  });

  describe("forms of one document", () => {
    const expected: CorsRule[] = [
      {
        id: "rule-1",
        allowedOrigins: ["https://example.com", "https://example.org"],
        allowedMethods: ["GET", "PUT"],
        allowedHeaders: ["*"],
        exposeHeaders: ["ETag"],
        maxAgeSeconds: 3000,
      },
    ];
    const compact =
      "<CORSRule><ID>rule-1</ID>" +
      "<AllowedOrigin>https://example.com</AllowedOrigin><AllowedOrigin>https://example.org</AllowedOrigin>" +
      "<AllowedMethod>GET</AllowedMethod><AllowedMethod>PUT</AllowedMethod>" +
      "<AllowedHeader>*</AllowedHeader><ExposeHeader>ETag</ExposeHeader>" +
      "<MaxAgeSeconds>3000</MaxAgeSeconds></CORSRule>";
    const withNamespace = `<CORSConfiguration xmlns="${XMLNS}">${compact}</CORSConfiguration>`;

    test.each<[name: string, body: string | Uint8Array]>([
      ["with the S3 namespace", withNamespace],
      ["without a namespace", `<CORSConfiguration>${compact}</CORSConfiguration>`],
      ["with an XML declaration", `<?xml version="1.0" encoding="UTF-8"?>\n${withNamespace}`],
      [
        "with whitespace between the elements",
        `
<CORSConfiguration xmlns="${XMLNS}">
\t<CORSRule>
\t\t<ID>rule-1</ID>

\t\t<AllowedOrigin>https://example.com</AllowedOrigin>\r
\t\t<AllowedOrigin>https://example.org</AllowedOrigin>
\t\t<AllowedMethod>GET</AllowedMethod>   <AllowedMethod>PUT</AllowedMethod>
\t\t<AllowedHeader>*</AllowedHeader>
\t\t<ExposeHeader>ETag</ExposeHeader>
\t\t<MaxAgeSeconds>3000</MaxAgeSeconds>
\t</CORSRule>
</CORSConfiguration>
`,
      ],
      [
        "with a namespace prefix",
        `<s3:CORSConfiguration xmlns:s3="${XMLNS}">
  <s3:CORSRule>
    <s3:ID>rule-1</s3:ID>
    <s3:AllowedOrigin>https://example.com</s3:AllowedOrigin>
    <s3:AllowedOrigin>https://example.org</s3:AllowedOrigin>
    <s3:AllowedMethod>GET</s3:AllowedMethod>
    <s3:AllowedMethod>PUT</s3:AllowedMethod>
    <s3:AllowedHeader>*</s3:AllowedHeader>
    <s3:ExposeHeader>ETag</s3:ExposeHeader>
    <s3:MaxAgeSeconds>3000</s3:MaxAgeSeconds>
  </s3:CORSRule>
</s3:CORSConfiguration>`,
      ],
      [
        "with the elements in the order of GetBucketCors",
        configuration(
          "<ID>rule-1</ID><AllowedMethod>GET</AllowedMethod><AllowedMethod>PUT</AllowedMethod>" +
            "<AllowedOrigin>https://example.com</AllowedOrigin><AllowedOrigin>https://example.org</AllowedOrigin>" +
            "<AllowedHeader>*</AllowedHeader><MaxAgeSeconds>3000</MaxAgeSeconds><ExposeHeader>ETag</ExposeHeader>",
        ),
      ],
      [
        "with the elements of one name apart",
        configuration(
          "<MaxAgeSeconds>3000</MaxAgeSeconds><AllowedMethod>GET</AllowedMethod>" +
            "<AllowedOrigin>https://example.com</AllowedOrigin><ExposeHeader>ETag</ExposeHeader>" +
            "<AllowedMethod>PUT</AllowedMethod><AllowedHeader>*</AllowedHeader>" +
            "<AllowedOrigin>https://example.org</AllowedOrigin><ID>rule-1</ID>",
        ),
      ],
      [
        "with comments and CDATA",
        configuration(
          "<!-- the site --><ID>rule-1</ID>" +
            "<AllowedOrigin><![CDATA[https://example.com]]></AllowedOrigin>" +
            "<AllowedOrigin>https://example<!-- not .com -->.org</AllowedOrigin>" +
            "<AllowedMethod>GET</AllowedMethod><AllowedMethod>PUT</AllowedMethod>" +
            "<AllowedHeader>*</AllowedHeader><ExposeHeader>ETag</ExposeHeader>" +
            "<MaxAgeSeconds>3000</MaxAgeSeconds>",
        ),
      ],
      ["as bytes", new TextEncoder().encode(withNamespace)],
      ["as bytes with a byte order mark", new TextEncoder().encode("\ufeff" + withNamespace)],
    ])("%s", (_, body) => {
      expect(parseCorsConfiguration(body)).toEqual(expected);
    });
  });

  describe("accepts", () => {
    const id255 = Buffer.alloc(255, "a").toString();

    test.each<[name: string, rule: string, expected: CorsRule]>([
      [
        "MaxAgeSeconds of zero",
        MINIMAL + "<MaxAgeSeconds>0</MaxAgeSeconds>",
        corsRule({ allowedOrigins: ["https://example.com"], maxAgeSeconds: 0 }),
      ],
      [
        "the largest 32-bit MaxAgeSeconds",
        MINIMAL + "<MaxAgeSeconds>2147483647</MaxAgeSeconds>",
        corsRule({ allowedOrigins: ["https://example.com"], maxAgeSeconds: 2147483647 }),
      ],
      [
        "an ID of 255 characters",
        MINIMAL + `<ID>${id255}</ID>`,
        corsRule({ allowedOrigins: ["https://example.com"], id: id255 }),
      ],
      ["an empty ID", MINIMAL + "<ID/>", corsRule({ allowedOrigins: ["https://example.com"], id: "" })],
      ["an empty AllowedOrigin", "<AllowedOrigin></AllowedOrigin>" + METHOD, corsRule({ allowedOrigins: [""] })],
      [
        "whitespace in a value, and keeps it",
        "<AllowedOrigin> https://example.com\n</AllowedOrigin>" +
          METHOD +
          "<AllowedHeader> x-amz-date </AllowedHeader>",
        corsRule({ allowedOrigins: [" https://example.com\n"], allowedHeaders: [" x-amz-date "] }),
      ],
      [
        "MaxAgeSeconds with zeros in front",
        MINIMAL + "<MaxAgeSeconds>0042</MaxAgeSeconds>",
        corsRule({ allowedOrigins: ["https://example.com"], maxAgeSeconds: 42 }),
      ],
      [
        "one wildcard in each AllowedOrigin",
        "<AllowedOrigin>*</AllowedOrigin><AllowedOrigin>https://*.example.com</AllowedOrigin>" +
          "<AllowedOrigin>*.example.com</AllowedOrigin><AllowedOrigin>https://example.com:*</AllowedOrigin>" +
          METHOD,
        corsRule({ allowedOrigins: ["*", "https://*.example.com", "*.example.com", "https://example.com:*"] }),
      ],
      [
        "one wildcard in each AllowedHeader",
        MINIMAL +
          "<AllowedHeader>*</AllowedHeader><AllowedHeader>x-amz-*</AllowedHeader>" +
          "<AllowedHeader>*-type</AllowedHeader><AllowedHeader>x-*-id</AllowedHeader>",
        corsRule({ allowedOrigins: ["https://example.com"], allowedHeaders: ["*", "x-amz-*", "*-type", "x-*-id"] }),
      ],
      [
        "the same value two times",
        MINIMAL + MINIMAL,
        corsRule({
          allowedOrigins: ["https://example.com", "https://example.com"],
          allowedMethods: ["GET", "GET"],
        }),
      ],
    ])("%s", (_, rule, expected) => {
      expect(parseCorsConfiguration(configuration(rule))).toEqual([expected]);
    });

    test("100 rules", () => {
      const rules = parseCorsConfiguration(configuration(...Array.from({ length: 100 }, () => MINIMAL)));
      expect(rules).toEqual(Array.from({ length: 100 }, () => corsRule({ allowedOrigins: ["https://example.com"] })));
    });

    test("two rules with the same ID", () => {
      const rules = parseCorsConfiguration(configuration("<ID>same</ID>" + MINIMAL, "<ID>same</ID>" + MINIMAL));
      expect(rules.map(rule => rule.id)).toEqual(["same", "same"]);
    });
  });

  test("keeps the case of the values and decodes the entities", () => {
    const body = configuration(
      "<ID>Rule &lt;1&gt; &amp; &quot;2&quot; &#x2A;</ID>" +
        "<AllowedOrigin>HTTPS://Example.COM</AllowedOrigin>" +
        "<AllowedMethod>HEAD</AllowedMethod>" +
        "<AllowedHeader>Content-Type</AllowedHeader>" +
        "<ExposeHeader>X-Amz-Request-Id</ExposeHeader>",
    );
    expect(parseCorsConfiguration(body)).toEqual([
      {
        id: 'Rule <1> & "2" *',
        allowedOrigins: ["HTTPS://Example.COM"],
        allowedMethods: ["HEAD"],
        allowedHeaders: ["Content-Type"],
        exposeHeaders: ["X-Amz-Request-Id"],
      },
    ]);
  });

  describe("MalformedXML", () => {
    test.each<[name: string, body: string | Uint8Array]>([
      ["an empty body", ""],
      ["a body that is not XML", "AllowedOrigin: *"],
      ["bytes that are not UTF-8", new Uint8Array([0x3c, 0xff, 0xfe, 0x3e])],
      ["an element without its end tag", `<CORSConfiguration><CORSRule>${MINIMAL}</CORSConfiguration>`],
      ["a document type declaration", `<!DOCTYPE CORSConfiguration>${configuration(MINIMAL)}`],
      ["another root element", `<CORSRules><CORSRule>${MINIMAL}</CORSRule></CORSRules>`],
      ["a root element in lowercase", `<corsconfiguration><CORSRule>${MINIMAL}</CORSRule></corsconfiguration>`],
      ["a rule as the root element", `<CORSRule>${MINIMAL}</CORSRule>`],
      ["a rule with another name", `<CORSConfiguration><Rule>${MINIMAL}</Rule></CORSConfiguration>`],
      ["a rule with a name in lowercase", `<CORSConfiguration><corsrule>${MINIMAL}</corsrule></CORSConfiguration>`],
      [
        "a rule with another name after a rule",
        `<CORSConfiguration><CORSRule>${MINIMAL}</CORSRule><CORSRules>${MINIMAL}</CORSRules></CORSConfiguration>`,
      ],
      ["a configuration without a rule", configuration()],
      ["an empty root element", `<CORSConfiguration xmlns="${XMLNS}"/>`],
      ["the elements of a rule in the root element", `<CORSConfiguration>${MINIMAL}</CORSConfiguration>`],
      ["101 rules", configuration(...Array.from({ length: 101 }, () => MINIMAL))],
      [
        "an unknown element next to a rule",
        `<CORSConfiguration><CORSRule>${MINIMAL}</CORSRule><Owner>me</Owner></CORSConfiguration>`,
      ],
      ["text next to a rule", `<CORSConfiguration>text<CORSRule>${MINIMAL}</CORSRule></CORSConfiguration>`],
      ["a rule in a rule", configuration(`<CORSRule>${MINIMAL}</CORSRule>`)],
      ["an empty rule", configuration("")],
      ["a rule without AllowedOrigin", configuration(METHOD)],
      ["a rule without AllowedMethod", configuration(ORIGIN)],
      ["a second rule without AllowedOrigin", configuration(MINIMAL, METHOD)],
      ["a second rule without AllowedMethod", configuration(MINIMAL, ORIGIN)],
      ["text in a rule", configuration(MINIMAL + "text")],
      ["an unknown element in a rule", configuration(MINIMAL + "<AllowedHeaders>*</AllowedHeaders>")],
      ["an unknown empty element in a rule", configuration(MINIMAL + "<Status/>")],
      ["an element name in another case", configuration(MINIMAL + "<allowedheader>*</allowedheader>")],
      ["an element in a value", configuration(`<AllowedOrigin><Origin>*</Origin></AllowedOrigin>${METHOD}`)],
      ["MaxAgeSeconds without a value", configuration(MINIMAL + "<MaxAgeSeconds></MaxAgeSeconds>")],
      ["MaxAgeSeconds that is a word", configuration(MINIMAL + "<MaxAgeSeconds>hour</MaxAgeSeconds>")],
      ["MaxAgeSeconds below zero", configuration(MINIMAL + "<MaxAgeSeconds>-1</MaxAgeSeconds>")],
      ["MaxAgeSeconds with a fraction", configuration(MINIMAL + "<MaxAgeSeconds>1.5</MaxAgeSeconds>")],
      ["MaxAgeSeconds with an exponent", configuration(MINIMAL + "<MaxAgeSeconds>1e3</MaxAgeSeconds>")],
      ["MaxAgeSeconds in hexadecimal", configuration(MINIMAL + "<MaxAgeSeconds>0x10</MaxAgeSeconds>")],
      ["MaxAgeSeconds with a unit", configuration(MINIMAL + "<MaxAgeSeconds>3000s</MaxAgeSeconds>")],
      ["MaxAgeSeconds above 32 bits", configuration(MINIMAL + "<MaxAgeSeconds>2147483648</MaxAgeSeconds>")],
      [
        "MaxAgeSeconds two times",
        configuration(MINIMAL + "<MaxAgeSeconds>1</MaxAgeSeconds><MaxAgeSeconds>1</MaxAgeSeconds>"),
      ],
      [
        "MaxAgeSeconds two times, the first is zero",
        configuration(MINIMAL + "<MaxAgeSeconds>0</MaxAgeSeconds><MaxAgeSeconds>1</MaxAgeSeconds>"),
      ],
      ["an ID of 256 characters", configuration(MINIMAL + `<ID>${Buffer.alloc(256, "a").toString()}</ID>`)],
      ["ID two times", configuration(MINIMAL + "<ID>a</ID><ID>b</ID>")],
      ["ID two times, the first is empty", configuration(MINIMAL + "<ID></ID><ID>b</ID>")],
    ])("%s", (_, body) => {
      expect(thrown(() => parseCorsConfiguration(body))).toEqual(MALFORMED_XML);
    });
  });

  describe("InvalidRequest", () => {
    test.each<[method: string]>([
      ["OPTIONS"],
      ["PATCH"],
      ["TRACE"],
      ["CONNECT"],
      ["get"],
      ["Get"],
      [" GET"],
      ["GET,PUT"],
      ["*"],
      [""],
    ])("AllowedMethod %p", method => {
      const body = configuration(`${ORIGIN}<AllowedMethod>GET</AllowedMethod><AllowedMethod>${method}</AllowedMethod>`);
      expect(thrown(() => parseCorsConfiguration(body))).toEqual(
        invalidRequest("Found unsupported HTTP method in CORS config. Unsupported method is " + method),
      );
    });

    test.each<[name: string, rule: string, message: string]>([
      [
        "AllowedOrigin with two wildcards",
        "<AllowedOrigin>https://*.example.*</AllowedOrigin>" + METHOD,
        'AllowedOrigin "https://*.example.*" can not have more than one wildcard.',
      ],
      [
        "AllowedOrigin with two wildcards side by side",
        "<AllowedOrigin>**</AllowedOrigin>" + METHOD,
        'AllowedOrigin "**" can not have more than one wildcard.',
      ],
      [
        "AllowedOrigin with three wildcards",
        "<AllowedOrigin>*://*.example.com:*</AllowedOrigin>" + METHOD,
        'AllowedOrigin "*://*.example.com:*" can not have more than one wildcard.',
      ],
      [
        "a second AllowedOrigin with two wildcards",
        ORIGIN + "<AllowedOrigin>http://*.*</AllowedOrigin>" + METHOD,
        'AllowedOrigin "http://*.*" can not have more than one wildcard.',
      ],
      [
        "AllowedHeader with two wildcards",
        MINIMAL + "<AllowedHeader>x-*-meta-*</AllowedHeader>",
        'AllowedHeader "x-*-meta-*" can not have more than one wildcard.',
      ],
      [
        "a second AllowedHeader with two wildcards",
        MINIMAL + "<AllowedHeader>x-amz-*</AllowedHeader><AllowedHeader>**</AllowedHeader>",
        'AllowedHeader "**" can not have more than one wildcard.',
      ],
      [
        "ExposeHeader that is a wildcard",
        MINIMAL + "<ExposeHeader>*</ExposeHeader>",
        'ExposeHeader "*" contains wildcard. We currently do not support wildcard for ExposeHeader.',
      ],
      [
        "ExposeHeader with a wildcard",
        MINIMAL + "<ExposeHeader>ETag</ExposeHeader><ExposeHeader>x-amz-*</ExposeHeader>",
        'ExposeHeader "x-amz-*" contains wildcard. We currently do not support wildcard for ExposeHeader.',
      ],
      [
        "a value with characters that XML escapes",
        "<AllowedOrigin>*&lt;&amp;&gt;*</AllowedOrigin>" + METHOD,
        'AllowedOrigin "*<&>*" can not have more than one wildcard.',
      ],
    ])("%s", (_, rule, message) => {
      expect(thrown(() => parseCorsConfiguration(configuration(rule)))).toEqual(invalidRequest(message));
    });

    test.each<[name: string, rule: string, message: string]>([
      [
        "AllowedMethod",
        ORIGIN + "<AllowedMethod>PATCH</AllowedMethod>",
        "Found unsupported HTTP method in CORS config. Unsupported method is PATCH",
      ],
      [
        "AllowedOrigin",
        "<AllowedOrigin>*.*</AllowedOrigin>" + METHOD,
        'AllowedOrigin "*.*" can not have more than one wildcard.',
      ],
      [
        "AllowedHeader",
        MINIMAL + "<AllowedHeader>*-*</AllowedHeader>",
        'AllowedHeader "*-*" can not have more than one wildcard.',
      ],
      [
        "ExposeHeader",
        MINIMAL + "<ExposeHeader>x-*</ExposeHeader>",
        'ExposeHeader "x-*" contains wildcard. We currently do not support wildcard for ExposeHeader.',
      ],
    ])("%s in a rule after the first one", (_, rule, message) => {
      const body = configuration(MINIMAL, MINIMAL, rule, MINIMAL);
      expect(thrown(() => parseCorsConfiguration(body))).toEqual(invalidRequest(message));
    });
  });

  describe("a document with more than one error", () => {
    const badMethod = "<AllowedMethod>PATCH</AllowedMethod>";
    const badOrigin = "<AllowedOrigin>*.*</AllowedOrigin>";
    const badHeader = "<AllowedHeader>*-*</AllowedHeader>";
    const badExposeHeader = "<ExposeHeader>x-*</ExposeHeader>";
    const methodError = invalidRequest("Found unsupported HTTP method in CORS config. Unsupported method is PATCH");
    const originError = invalidRequest('AllowedOrigin "*.*" can not have more than one wildcard.');
    const headerError = invalidRequest('AllowedHeader "*-*" can not have more than one wildcard.');
    const exposeHeaderError = invalidRequest(
      'ExposeHeader "x-*" contains wildcard. We currently do not support wildcard for ExposeHeader.',
    );

    // The elements of each rule are in the reverse order of the checks.
    test.each<[name: string, body: string, expected: ErrorFields]>([
      [
        "AllowedMethod, not AllowedOrigin",
        configuration(badExposeHeader + badHeader + badOrigin + badMethod),
        methodError,
      ],
      [
        "AllowedOrigin, not AllowedHeader",
        configuration(badExposeHeader + badHeader + badOrigin + METHOD),
        originError,
      ],
      ["AllowedHeader, not ExposeHeader", configuration(badExposeHeader + badHeader + MINIMAL), headerError],
      [
        "the first AllowedMethod that is not valid",
        configuration(ORIGIN + badMethod + "<AllowedMethod>TRACE</AllowedMethod>"),
        methodError,
      ],
      [
        "the first rule that is not valid",
        configuration(MINIMAL, MINIMAL + badExposeHeader, ORIGIN + badMethod),
        exposeHeaderError,
      ],
    ])("InvalidRequest is for %s", (_, body, expected) => {
      expect(thrown(() => parseCorsConfiguration(body))).toEqual(expected);
    });

    // Amazon S3 does not document the order of these. The parser takes the
    // structure of the whole document first.
    test.each<[name: string, body: string]>([
      ["a rule without AllowedOrigin", configuration(badMethod)],
      ["a rule without AllowedMethod", configuration(badOrigin)],
      ["a later rule without AllowedOrigin", configuration(ORIGIN + badMethod, METHOD)],
      ["a later rule without AllowedMethod", configuration(ORIGIN + badMethod, ORIGIN)],
      ["101 rules", configuration(...Array.from({ length: 101 }, () => ORIGIN + badMethod))],
      ["an unknown element", configuration(ORIGIN + badMethod + "<AllowedHeaders>*</AllowedHeaders>")],
      [
        "an unknown element in a later rule",
        configuration(ORIGIN + badMethod, MINIMAL + "<AllowedHeaders>*</AllowedHeaders>"),
      ],
      ["MaxAgeSeconds", configuration(MINIMAL + badExposeHeader + "<MaxAgeSeconds>-1</MaxAgeSeconds>")],
      [
        "MaxAgeSeconds in a later rule",
        configuration(badOrigin + METHOD, MINIMAL + "<MaxAgeSeconds>1</MaxAgeSeconds><MaxAgeSeconds>2</MaxAgeSeconds>"),
      ],
      ["ID", configuration(MINIMAL + badHeader + "<ID>a</ID><ID>b</ID>")],
    ])("MalformedXML for %s is before InvalidRequest", (_, body) => {
      expect(thrown(() => parseCorsConfiguration(body))).toEqual(MALFORMED_XML);
    });
  });
});

describe("serializeCorsConfiguration", () => {
  test("writes the elements in the order of Amazon S3", () => {
    const rules: CorsRule[] = [
      {
        id: "rule-1",
        allowedOrigins: ["https://example.com", "https://*.example.org"],
        allowedMethods: ["GET", "PUT"],
        allowedHeaders: ["Authorization", "x-amz-*"],
        exposeHeaders: ["ETag", "x-amz-request-id"],
        maxAgeSeconds: 3000,
      },
      { allowedOrigins: ["*"], allowedMethods: ["HEAD"], allowedHeaders: [], exposeHeaders: [] },
    ];

    expect(serializeCorsConfiguration(rules)).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<CORSConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">' +
        "<CORSRule>" +
        "<ID>rule-1</ID>" +
        "<AllowedMethod>GET</AllowedMethod><AllowedMethod>PUT</AllowedMethod>" +
        "<AllowedOrigin>https://example.com</AllowedOrigin><AllowedOrigin>https://*.example.org</AllowedOrigin>" +
        "<AllowedHeader>Authorization</AllowedHeader><AllowedHeader>x-amz-*</AllowedHeader>" +
        "<MaxAgeSeconds>3000</MaxAgeSeconds>" +
        "<ExposeHeader>ETag</ExposeHeader><ExposeHeader>x-amz-request-id</ExposeHeader>" +
        "</CORSRule>" +
        "<CORSRule><AllowedMethod>HEAD</AllowedMethod><AllowedOrigin>*</AllowedOrigin></CORSRule>" +
        "</CORSConfiguration>",
    );
  });

  test.each<[name: string, rule: CorsRule, expected: string]>([
    [
      "MaxAgeSeconds of zero",
      corsRule({ maxAgeSeconds: 0 }),
      "<AllowedMethod>GET</AllowedMethod><AllowedOrigin>*</AllowedOrigin><MaxAgeSeconds>0</MaxAgeSeconds>",
    ],
    [
      "an empty ID",
      corsRule({ id: "" }),
      "<ID></ID><AllowedMethod>GET</AllowedMethod><AllowedOrigin>*</AllowedOrigin>",
    ],
    [
      "an ID and a MaxAgeSeconds that are undefined",
      corsRule({ id: undefined, maxAgeSeconds: undefined }),
      "<AllowedMethod>GET</AllowedMethod><AllowedOrigin>*</AllowedOrigin>",
    ],
    [
      "characters that XML escapes",
      corsRule({ id: "<a> & <b>", allowedOrigins: ["https://example.com/?a=1&b=2"] }),
      "<ID>&lt;a&gt; &amp; &lt;b&gt;</ID><AllowedMethod>GET</AllowedMethod>" +
        "<AllowedOrigin>https://example.com/?a=1&amp;b=2</AllowedOrigin>",
    ],
  ])("%s", (_, rule, expected) => {
    expect(serializeCorsConfiguration([rule])).toBe(
      `<?xml version="1.0" encoding="UTF-8"?>\n<CORSConfiguration xmlns="${XMLNS}"><CORSRule>${expected}</CORSRule></CORSConfiguration>`,
    );
  });

  describe("round trip", () => {
    test.each<[name: string, rules: CorsRule[]]>([
      ["a rule with the required elements", [corsRule()]],
      [
        "a rule with every element",
        [
          {
            id: "rule-1",
            allowedOrigins: ["https://example.com", "https://*.example.org", "https://example.net:*"],
            allowedMethods: ["GET", "PUT", "POST", "DELETE", "HEAD"],
            allowedHeaders: ["*", "Content-Type", "x-amz-*"],
            exposeHeaders: ["ETag", "x-amz-request-id", "x-amz-version-id"],
            maxAgeSeconds: 86400,
          },
        ],
      ],
      [
        "rules that have different elements",
        [
          corsRule({ id: "headers", allowedHeaders: ["Authorization"] }),
          corsRule({ exposeHeaders: ["ETag"] }),
          corsRule({ maxAgeSeconds: 0 }),
          corsRule({ id: "" }),
          corsRule({ allowedOrigins: [""], allowedMethods: ["DELETE", "DELETE"] }),
        ],
      ],
      [
        "characters that XML escapes",
        [
          corsRule({
            id: `<ID> & "quotes" 'apostrophes' ]]> é 日本 🪣`,
            allowedOrigins: ["https://example.com/?a=1&b=2"],
            allowedHeaders: ["<x-header>"],
            exposeHeaders: ["&amp;"],
          }),
        ],
      ],
      ["100 rules", Array.from({ length: 100 }, (_, index) => corsRule({ id: `rule-${index}`, maxAgeSeconds: index }))],
    ])("%s", (_, rules) => {
      expect(parseCorsConfiguration(serializeCorsConfiguration(rules))).toEqual(rules);
    });

    test("a document of GetBucketCors", () => {
      const body =
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<CORSConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">' +
        "<CORSRule><ID>rule-1</ID><AllowedMethod>PUT</AllowedMethod><AllowedMethod>POST</AllowedMethod>" +
        "<AllowedOrigin>https://example.com</AllowedOrigin><AllowedHeader>*</AllowedHeader>" +
        "<MaxAgeSeconds>3000</MaxAgeSeconds><ExposeHeader>ETag</ExposeHeader></CORSRule>" +
        "<CORSRule><AllowedMethod>GET</AllowedMethod><AllowedOrigin>*</AllowedOrigin></CORSRule>" +
        "</CORSConfiguration>";
      expect(serializeCorsConfiguration(parseCorsConfiguration(body))).toBe(body);
    });
  });
});

describe("matchCorsRule", () => {
  describe("AllowedOrigin", () => {
    test.each<[pattern: string, origin: string, matches: boolean]>([
      ["*", "https://example.com", true],
      ["*", "http://localhost:3000", true],
      ["*", "null", true],

      ["https://example.com", "https://example.com", true],
      ["https://example.com", "http://example.com", false],
      ["https://example.com", "https://example.com:8443", false],
      ["https://example.com", "https://example.com/", false],
      ["https://example.com", "https://www.example.com", false],
      ["https://example.com", "https://example.com.test", false],
      ["https://example.com", "example.com", false],
      ["https://example.com", "https://exampleXcom", false],
      ["http://localhost:3000", "http://localhost:3000", true],
      ["http://localhost:3000", "http://localhost:3001", false],

      ["https://*.example.com", "https://www.example.com", true],
      ["https://*.example.com", "https://a.b.example.com", true],
      ["https://*.example.com", "https://.example.com", true],
      ["https://*.example.com", "https://example.com", false],
      ["https://*.example.com", "http://www.example.com", false],
      ["https://*.example.com", "https://www.example.com:8443", false],
      ["https://*.example.com", "https://www.example.com.test", false],
      ["https://*.example.com", "https://www.example.org", false],
      ["https://*.example.com", "https://wwwXexample.com", false],

      ["https://example.com:*", "https://example.com:8443", true],
      ["https://example.com:*", "https://example.com:", true],
      ["https://example.com:*", "https://example.com", false],
      ["https://example.com:*", "https://example.org:8443", false],
      ["https://example.com:*", "http://example.com:8443", false],

      ["http*://example.com", "http://example.com", true],
      ["http*://example.com", "https://example.com", true],
      ["http*://example.com", "ftp://example.com", false],
      ["*.example.com", "https://www.example.com", true],
      ["*.example.com", "https://example.com", false],
      ["https://*", "https://example.com", true],
      ["https://*", "https://", true],
      ["https://*", "http://example.com", false],

      // The text before and after the wildcard does not overlap in the origin.
      ["https://a*a", "https://aa", true],
      ["https://a*a", "https://a", false],
      ["ab*ba", "aba", false],

      // The comparison is on the text. An origin does not have to be a URL.
      ["*suffix", "foo.suffix", true],
      ["*suffix", "foo.suffix.get", false],
      ["start*end", "startend", true],
      ["start*end", "start12end", true],
      ["start*end", "0start12end", false],
      ["prefix*", "prefix", true],
      ["prefix*", "prefix.suffix", true],
      ["prefix*", "bla.prefix", false],

      ["https://example.com", "https://EXAMPLE.com", false],
      ["https://example.com", "HTTPS://example.com", false],
      ["https://Example.com", "https://example.com", false],
      ["https://Example.com", "https://Example.com", true],
      ["https://*.example.com", "https://www.Example.com", false],
      ["HTTPS://*.example.com", "https://www.example.com", false],
      ["https://*.example.com", "https://WWW.example.com", true],

      ["", "", true],
      ["", "https://example.com", false],
    ])("%p and the origin %p: %p", (pattern, origin, matches) => {
      const rule = corsRule({ allowedOrigins: [pattern] });
      expect(matchCorsRule([rule], origin, "GET")).toEqual(
        matches ? { rule, allowOrigin: pattern === "*" ? "*" : origin } : undefined,
      );
    });

    test.each<[name: string, allowedOrigins: string[], origin: string, matches: boolean]>([
      ["the first", ["https://example.com", "https://example.org"], "https://example.com", true],
      ["the last", ["https://example.com", "https://example.org"], "https://example.org", true],
      [
        "a pattern after an exact origin",
        ["https://example.com", "https://*.example.com"],
        "https://a.example.com",
        true,
      ],
      ["none", ["https://example.com", "https://*.example.com"], "https://example.org", false],
    ])("one of many matches: %s", (_, allowedOrigins, origin, matches) => {
      const rule = corsRule({ allowedOrigins });
      expect(matchCorsRule([rule], origin, "GET")).toEqual(matches ? { rule, allowOrigin: origin } : undefined);
    });
  });

  describe("allowOrigin", () => {
    test.each<[name: string, allowedOrigins: string[], origin: string, allowOrigin: string]>([
      ["the literal *", ["*"], "https://example.com", "*"],
      ["an exact origin", ["https://example.com"], "https://example.com", "https://example.com"],
      ["a wildcard in a pattern", ["https://*.example.com"], "https://www.example.com", "https://www.example.com"],
      ["a wildcard at the end of a pattern", ["http*"], "https://example.com", "https://example.com"],
      ["an exact origin before the literal *", ["https://example.com", "*"], "https://example.com", "*"],
      ["the literal * before an exact origin", ["*", "https://example.com"], "https://example.com", "*"],
      ["the literal * and another origin", ["https://example.com", "*"], "https://example.org", "*"],
    ])("%s", (_, allowedOrigins, origin, allowOrigin) => {
      const rule = corsRule({ allowedOrigins });
      expect(matchCorsRule([rule], origin, "GET")).toEqual({ rule, allowOrigin });
    });
  });

  describe("AllowedMethod", () => {
    test.each<[allowedMethods: string[], method: string, matches: boolean]>([
      [["GET"], "GET", true],
      [["GET"], "HEAD", false],
      [["GET"], "PUT", false],
      [["GET", "HEAD"], "HEAD", true],
      [["PUT", "POST", "DELETE"], "DELETE", true],
      [["PUT", "POST", "DELETE"], "GET", false],
      [["GET", "PUT", "POST", "DELETE", "HEAD"], "OPTIONS", false],
      [["GET", "PUT", "POST", "DELETE", "HEAD"], "PATCH", false],
      [["GET"], "get", false],
      [["GET"], "", false],
    ])("%j and the method %p: %p", (allowedMethods, method, matches) => {
      const rule = corsRule({ allowedMethods });
      expect(matchCorsRule([rule], "https://example.com", method)).toEqual(
        matches ? { rule, allowOrigin: "*" } : undefined,
      );
    });
  });

  describe("AllowedHeader", () => {
    test.each<[allowedHeaders: string[], requestHeaders: string[], matches: boolean]>([
      [[], [], true],
      [["content-type"], [], true],
      [[], ["content-type"], false],

      [["content-type"], ["content-type"], true],
      [["content-type"], ["content-length"], false],
      [["content-type"], ["content-type", "x-amz-date"], false],
      [["content-type", "x-amz-date"], ["x-amz-date", "content-type"], true],
      [["content-type", "x-amz-date"], ["x-amz-date"], true],
      [["content-type", "x-amz-date"], ["x-amz-date", "authorization", "content-type"], false],

      [["content-type"], ["Content-Type"], true],
      [["Content-Type"], ["content-type"], true],
      [["CONTENT-TYPE"], ["cOnTeNt-TyPe"], true],
      [["X-Amz-*"], ["x-amz-date"], true],
      [["x-amz-*"], ["X-AMZ-DATE"], true],

      [["*"], ["content-type"], true],
      [["*"], ["Content-Type", "Authorization", "x-amz-date", "x-custom"], true],
      [["x-amz-*"], ["x-amz-date", "x-amz-content-sha256", "x-amz-meta-a"], true],
      [["x-amz-*"], ["x-amz-"], true],
      [["x-amz-*"], ["x-amz"], false],
      [["x-amz-*"], ["x-amz-date", "content-type"], false],
      [["x-amz-*"], ["x-amzn-trace-id"], false],
      [["x-amz-*"], ["my-x-amz-date"], false],
      [["x-amz-*", "content-type"], ["x-amz-date", "content-type"], true],
      [["*-type"], ["content-type"], true],
      [["*-type"], ["content-types"], false],
      [["x-*-id"], ["x-request-id"], true],
      [["x-*-id"], ["x--id"], true],
      [["x-*-id"], ["x-id"], false],

      [["content-type"], [" content-type "], true],
      [["content.type"], ["contentXtype"], false],
    ])("%j and the request headers %j: %p", (allowedHeaders, requestHeaders, matches) => {
      const rule = corsRule({ allowedHeaders });
      expect(matchCorsRule([rule], "https://example.com", "GET", requestHeaders)).toEqual(
        matches ? { rule, allowOrigin: "*" } : undefined,
      );
    });

    test("does not apply to a request that is not a preflight request", () => {
      const rule = corsRule({ allowedHeaders: [] });
      expect(matchCorsRule([rule], "https://example.com", "GET")).toEqual({ rule, allowOrigin: "*" });
      expect(matchCorsRule([rule], "https://example.com", "GET", undefined)).toEqual({ rule, allowOrigin: "*" });
    });
  });

  describe("the order of the rules", () => {
    const exact = corsRule({ id: "exact", allowedOrigins: ["https://example.com"], allowedMethods: ["GET", "PUT"] });
    const pattern = corsRule({
      id: "pattern",
      allowedOrigins: ["https://*.com"],
      allowedMethods: ["GET"],
      allowedHeaders: ["*"],
    });
    const any = corsRule({ id: "any", allowedOrigins: ["*"], allowedMethods: ["GET", "HEAD"] });

    test.each<[name: string, rules: CorsRule[], method: string, requestHeaders: string[] | undefined, id: string]>([
      ["the first of three rules that match", [exact, pattern, any], "GET", undefined, "exact"],
      ["the first of three rules that match, in another order", [any, pattern, exact], "GET", undefined, "any"],
      ["the first of two rules that match, after one that does not", [any, exact, pattern], "PUT", undefined, "exact"],
      ["the second rule when the method is not in the first", [pattern, exact, any], "PUT", undefined, "exact"],
      ["the third rule when the method is not in the others", [exact, pattern, any], "HEAD", undefined, "any"],
      ["the second rule when a header is not in the first", [exact, pattern, any], "GET", ["x-amz-date"], "pattern"],
      ["the first rule when the request names no header", [exact, pattern, any], "GET", [], "exact"],
    ])("%s", (_, rules, method, requestHeaders, id) => {
      const match = matchCorsRule(rules, "https://example.com", method, requestHeaders);
      expect(match?.rule.id).toBe(id);
      expect(match?.rule).toBe(rules.find(rule => rule.id === id)!);
    });

    test("the rule decides allowOrigin, not a rule after it", () => {
      expect(matchCorsRule([exact, any], "https://example.com", "GET")).toEqual({
        rule: exact,
        allowOrigin: "https://example.com",
      });
      expect(matchCorsRule([any, exact], "https://example.com", "GET")).toEqual({ rule: any, allowOrigin: "*" });
    });

    test("a request must match the origin, the method and the headers in one rule", () => {
      const origin = corsRule({ allowedOrigins: ["https://example.com"], allowedMethods: ["PUT"] });
      const method = corsRule({ allowedOrigins: ["https://example.org"], allowedMethods: ["GET"] });
      const headers = corsRule({ allowedOrigins: ["https://example.net"], allowedHeaders: ["*"] });
      expect(matchCorsRule([origin, method, headers], "https://example.com", "GET")).toBeUndefined();
      expect(matchCorsRule([origin, method, headers], "https://example.org", "GET", ["x-amz-date"])).toBeUndefined();
    });

    test("no rule", () => {
      expect(matchCorsRule([], "https://example.com", "GET")).toBeUndefined();
    });
  });
});

/** The headers of a preflight request. An argument that is `undefined` leaves its header out. */
function preflight(origin?: string, method?: string, requestHeaders?: string): Headers {
  const headers = new Headers();
  if (origin !== undefined) headers.set("Origin", origin);
  if (method !== undefined) headers.set("Access-Control-Request-Method", method);
  if (requestHeaders !== undefined) headers.set("Access-Control-Request-Headers", requestHeaders);
  return headers;
}

describe("preflightResponseHeaders", () => {
  const rules: CorsRule[] = [
    {
      id: "site",
      allowedOrigins: ["https://example.com", "https://*.example.com"],
      allowedMethods: ["GET", "PUT", "DELETE"],
      allowedHeaders: ["Content-Type", "x-amz-*"],
      exposeHeaders: ["ETag", "x-amz-request-id"],
      maxAgeSeconds: 3000,
    },
    { id: "public", allowedOrigins: ["*"], allowedMethods: ["GET", "HEAD"], allowedHeaders: [], exposeHeaders: [] },
  ];
  const publicHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD",
    "Vary": VARY,
  };

  test.each<[name: string, request: Headers, expected: Record<string, string>]>([
    [
      "a request without Access-Control-Request-Headers",
      preflight("https://example.com", "PUT"),
      {
        "Access-Control-Allow-Origin": "https://example.com",
        "Access-Control-Allow-Methods": "GET, PUT, DELETE",
        "Access-Control-Expose-Headers": "ETag, x-amz-request-id",
        "Access-Control-Max-Age": "3000",
        "Access-Control-Allow-Credentials": "true",
        "Vary": VARY,
      },
    ],
    [
      "a request with Access-Control-Request-Headers",
      preflight("https://example.com", "PUT", "Content-Type,X-Amz-Date ,  x-amz-meta-Name"),
      {
        "Access-Control-Allow-Origin": "https://example.com",
        "Access-Control-Allow-Methods": "GET, PUT, DELETE",
        "Access-Control-Allow-Headers": "content-type, x-amz-date, x-amz-meta-name",
        "Access-Control-Expose-Headers": "ETag, x-amz-request-id",
        "Access-Control-Max-Age": "3000",
        "Access-Control-Allow-Credentials": "true",
        "Vary": VARY,
      },
    ],
    [
      "a request with one header in Access-Control-Request-Headers",
      preflight("https://example.com", "GET", "CONTENT-TYPE"),
      {
        "Access-Control-Allow-Origin": "https://example.com",
        "Access-Control-Allow-Methods": "GET, PUT, DELETE",
        "Access-Control-Allow-Headers": "content-type",
        "Access-Control-Expose-Headers": "ETag, x-amz-request-id",
        "Access-Control-Max-Age": "3000",
        "Access-Control-Allow-Credentials": "true",
        "Vary": VARY,
      },
    ],
    [
      "an origin that matches a pattern",
      preflight("https://app.example.com", "DELETE"),
      {
        "Access-Control-Allow-Origin": "https://app.example.com",
        "Access-Control-Allow-Methods": "GET, PUT, DELETE",
        "Access-Control-Expose-Headers": "ETag, x-amz-request-id",
        "Access-Control-Max-Age": "3000",
        "Access-Control-Allow-Credentials": "true",
        "Vary": VARY,
      },
    ],
    ["an origin that only the literal * allows", preflight("https://example.org", "GET"), publicHeaders],
    ["a method that only the second rule allows", preflight("https://example.com", "HEAD"), publicHeaders],
    ["an empty Access-Control-Request-Headers", preflight("https://example.org", "GET", ""), publicHeaders],
    [
      "an Access-Control-Request-Headers without a name",
      preflight("https://example.org", "GET", " , ,"),
      publicHeaders,
    ],
  ])("%s", (_, request, expected) => {
    expect(preflightResponseHeaders(rules, request, "OBJECT")).toEqual(expected);
  });

  test("writes the headers in the order of Amazon S3", () => {
    const request = preflight("https://example.com", "PUT", "content-type");
    expect(Object.keys(preflightResponseHeaders(rules, request, "OBJECT"))).toEqual([
      "Access-Control-Allow-Origin",
      "Access-Control-Allow-Methods",
      "Access-Control-Allow-Headers",
      "Access-Control-Expose-Headers",
      "Access-Control-Max-Age",
      "Access-Control-Allow-Credentials",
      "Vary",
    ]);
  });

  test("reads the request headers by their lowercase names", () => {
    const request: Record<string, string> = {
      "origin": "https://example.com",
      "access-control-request-method": "PUT",
      "access-control-request-headers": "x-amz-date",
    };
    const headers = { get: (name: string) => request[name] ?? null };
    expect(preflightResponseHeaders(rules, headers, "OBJECT")).toEqual({
      "Access-Control-Allow-Origin": "https://example.com",
      "Access-Control-Allow-Methods": "GET, PUT, DELETE",
      "Access-Control-Allow-Headers": "x-amz-date",
      "Access-Control-Expose-Headers": "ETag, x-amz-request-id",
      "Access-Control-Max-Age": "3000",
      "Access-Control-Allow-Credentials": "true",
      "Vary": VARY,
    });
  });

  describe("Access-Control-Allow-Credentials", () => {
    test.each<[name: string, allowedOrigins: string[], origin: string, expected: Record<string, string>]>([
      [
        "is absent for the literal *",
        ["*"],
        "https://example.com",
        { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET", "Vary": VARY },
      ],
      [
        "is absent for the literal * next to the origin",
        ["https://example.com", "*"],
        "https://example.com",
        { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET", "Vary": VARY },
      ],
      [
        "is present for an exact origin",
        ["https://example.com"],
        "https://example.com",
        {
          "Access-Control-Allow-Origin": "https://example.com",
          "Access-Control-Allow-Methods": "GET",
          "Access-Control-Allow-Credentials": "true",
          "Vary": VARY,
        },
      ],
      [
        "is present for a pattern with a wildcard",
        ["https://*.example.com"],
        "https://www.example.com",
        {
          "Access-Control-Allow-Origin": "https://www.example.com",
          "Access-Control-Allow-Methods": "GET",
          "Access-Control-Allow-Credentials": "true",
          "Vary": VARY,
        },
      ],
      [
        "is present for a pattern that matches every origin with a scheme",
        ["http*"],
        "https://example.com",
        {
          "Access-Control-Allow-Origin": "https://example.com",
          "Access-Control-Allow-Methods": "GET",
          "Access-Control-Allow-Credentials": "true",
          "Vary": VARY,
        },
      ],
    ])("%s", (_, allowedOrigins, origin, expected) => {
      const configured = [corsRule({ allowedOrigins })];
      expect(preflightResponseHeaders(configured, preflight(origin, "GET"), "BUCKET")).toEqual(expected);
    });
  });

  describe("Access-Control-Max-Age and Access-Control-Expose-Headers", () => {
    test.each<[name: string, fields: Partial<CorsRule>, expected: Record<string, string>]>([
      ["are absent for a rule without them", {}, {}],
      ["MaxAgeSeconds of zero", { maxAgeSeconds: 0 }, { "Access-Control-Max-Age": "0" }],
      ["MaxAgeSeconds", { maxAgeSeconds: 86400 }, { "Access-Control-Max-Age": "86400" }],
      ["one ExposeHeader", { exposeHeaders: ["ETag"] }, { "Access-Control-Expose-Headers": "ETag" }],
      [
        "many ExposeHeader",
        { exposeHeaders: ["ETag", "X-Amz-Version-Id", "x-amz-meta-a"] },
        { "Access-Control-Expose-Headers": "ETag, X-Amz-Version-Id, x-amz-meta-a" },
      ],
    ])("%s", (_, fields, expected) => {
      const request = preflight("https://example.com", "GET");
      expect(preflightResponseHeaders([corsRule(fields)], request, "BUCKET")).toEqual({
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET",
        ...expected,
        "Vary": VARY,
      });
    });
  });

  describe("BadRequest", () => {
    const site = "https://example.com";
    const noOrigin = "Insufficient information. Origin request header needed.";

    test.each<
      [
        name: string,
        rules: CorsRule[] | undefined,
        origin: string | undefined,
        method: string | undefined,
        message: string,
      ]
    >([
      ["no request header", rules, undefined, undefined, noOrigin],
      ["no Origin", rules, undefined, "GET", noOrigin],
      ["an empty Origin", rules, "", "GET", noOrigin],
      ["no Origin and no configuration", undefined, undefined, "GET", noOrigin],
      ["no Origin and the method PATCH", rules, undefined, "PATCH", noOrigin],

      ["no method", rules, site, undefined, "Invalid Access-Control-Request-Method: null"],
      ["no method and no configuration", undefined, site, undefined, "Invalid Access-Control-Request-Method: null"],
      ["an empty method", rules, site, "", "Invalid Access-Control-Request-Method: "],
      ["the method PATCH", rules, site, "PATCH", "Invalid Access-Control-Request-Method: PATCH"],
      ["the method OPTIONS", rules, site, "OPTIONS", "Invalid Access-Control-Request-Method: OPTIONS"],
      ["the method get", rules, site, "get", "Invalid Access-Control-Request-Method: get"],
      ["two methods", rules, site, "GET, PUT", "Invalid Access-Control-Request-Method: GET, PUT"],
      [
        "the method PATCH and no configuration",
        undefined,
        site,
        "PATCH",
        "Invalid Access-Control-Request-Method: PATCH",
      ],
    ])("%s", (_, configured, origin, method, message) => {
      const request = preflight(origin, method, "content-type");
      expect(thrown(() => preflightResponseHeaders(configured, request, "OBJECT"))).toEqual({
        code: "BadRequest",
        status: 400,
        message,
        details: {},
      });
    });
  });

  describe("AccessForbidden", () => {
    type Row = [
      name: string,
      origin: string,
      method: string,
      requestHeaders: string | undefined,
      resourceType: "BUCKET" | "OBJECT",
    ];

    test.each<Row>([
      ["a bucket", "https://example.com", "GET", undefined, "BUCKET"],
      ["an object", "https://example.com", "PUT", undefined, "OBJECT"],
      ["a request with Access-Control-Request-Headers", "https://example.com", "DELETE", "content-type", "OBJECT"],
    ])("no configuration: %s", (_, origin, method, requestHeaders, resourceType) => {
      const request = preflight(origin, method, requestHeaders);
      expect(thrown(() => preflightResponseHeaders(undefined, request, resourceType))).toEqual({
        code: "AccessForbidden",
        status: 403,
        message: "CORSResponse: CORS is not enabled for this bucket.",
        details: { Method: method, ResourceType: resourceType },
      });
    });

    const notAllowed =
      "CORSResponse: This CORS request is not allowed. This is usually because the evalution of Origin, request method / Access-Control-Request-Method or Access-Control-Request-Headers are not whitelisted by the resource's CORS spec.";

    test.each<Row>([
      ["an origin that no rule allows for the method", "https://example.org", "PUT", undefined, "OBJECT"],
      ["an origin in another case", "https://EXAMPLE.com", "PUT", undefined, "OBJECT"],
      ["a method that no rule allows", "https://example.com", "POST", undefined, "BUCKET"],
      ["a header that no rule allows", "https://example.com", "PUT", "content-type, authorization", "OBJECT"],
      ["a header for a rule without AllowedHeader", "https://example.org", "GET", "content-type", "BUCKET"],
    ])("no rule matches: %s", (_, origin, method, requestHeaders, resourceType) => {
      const request = preflight(origin, method, requestHeaders);
      expect(thrown(() => preflightResponseHeaders(rules, request, resourceType))).toEqual({
        code: "AccessForbidden",
        status: 403,
        message: notAllowed,
        details: { Method: method, ResourceType: resourceType },
      });
    });

    test("no rule matches: a configuration without a rule", () => {
      const request = preflight("https://example.com", "GET");
      expect(thrown(() => preflightResponseHeaders([], request, "BUCKET"))).toEqual({
        code: "AccessForbidden",
        status: 403,
        message: notAllowed,
        details: { Method: "GET", ResourceType: "BUCKET" },
      });
    });
  });
});

describe("corsResponseHeaders", () => {
  const rules: CorsRule[] = [
    {
      id: "site",
      allowedOrigins: ["https://example.com", "https://*.example.com"],
      allowedMethods: ["GET", "PUT"],
      allowedHeaders: [],
      exposeHeaders: ["ETag", "x-amz-request-id"],
      maxAgeSeconds: 3000,
    },
    { id: "public", allowedOrigins: ["*"], allowedMethods: ["GET", "HEAD"], allowedHeaders: ["*"], exposeHeaders: [] },
  ];

  test.each<[name: string, rules: CorsRule[] | undefined, origin: string, method: string]>([
    ["no configuration", undefined, "https://example.com", "GET"],
    ["a configuration without a rule", [], "https://example.com", "GET"],
    ["an origin that no rule allows for the method", rules, "https://example.org", "PUT"],
    ["an origin in another case", rules, "https://EXAMPLE.com", "PUT"],
    ["a method that no rule allows", rules, "https://example.com", "DELETE"],
    ["the method OPTIONS", rules, "https://example.com", "OPTIONS"],
    ["a method in lowercase", rules, "https://example.com", "get"],
    ["an empty origin", rules, "", "GET"],
  ])("returns no header for %s", (_, configured, origin, method) => {
    expect(corsResponseHeaders(configured, origin, method)).toEqual({});
  });

  test.each<[name: string, origin: string, method: string, expected: Record<string, string>]>([
    [
      "an exact origin",
      "https://example.com",
      "PUT",
      {
        "Access-Control-Allow-Origin": "https://example.com",
        "Access-Control-Allow-Methods": "GET, PUT",
        "Access-Control-Expose-Headers": "ETag, x-amz-request-id",
        "Access-Control-Max-Age": "3000",
        "Access-Control-Allow-Credentials": "true",
        "Vary": VARY,
      },
    ],
    [
      "an origin that matches a pattern",
      "https://app.example.com",
      "GET",
      {
        "Access-Control-Allow-Origin": "https://app.example.com",
        "Access-Control-Allow-Methods": "GET, PUT",
        "Access-Control-Expose-Headers": "ETag, x-amz-request-id",
        "Access-Control-Max-Age": "3000",
        "Access-Control-Allow-Credentials": "true",
        "Vary": VARY,
      },
    ],
    [
      "an origin that only the literal * allows",
      "https://example.org",
      "GET",
      { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, HEAD", "Vary": VARY },
    ],
    [
      "a method that only the second rule allows",
      "https://example.com",
      "HEAD",
      { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, HEAD", "Vary": VARY },
    ],
  ])("returns the headers of the first rule that matches: %s", (_, origin, method, expected) => {
    expect(corsResponseHeaders(rules, origin, method)).toEqual(expected);
  });

  test("does not use AllowedHeader", () => {
    const withoutHeaders = corsRule({ allowedOrigins: ["https://example.com"], allowedHeaders: [] });
    const withHeaders = corsRule({ allowedOrigins: ["https://example.com"], allowedHeaders: ["x-amz-*"] });
    const expected = {
      "Access-Control-Allow-Origin": "https://example.com",
      "Access-Control-Allow-Methods": "GET",
      "Access-Control-Allow-Credentials": "true",
      "Vary": VARY,
    };
    expect(corsResponseHeaders([withoutHeaders], "https://example.com", "GET")).toEqual(expected);
    expect(corsResponseHeaders([withHeaders], "https://example.com", "GET")).toEqual(expected);
  });

  test("uses a configuration that PutBucketCors accepts", () => {
    const configured = parseCorsConfiguration(
      configuration(
        "<AllowedOrigin>https://*.example.com</AllowedOrigin><AllowedMethod>GET</AllowedMethod>" +
          "<ExposeHeader>ETag</ExposeHeader><MaxAgeSeconds>600</MaxAgeSeconds>",
      ),
    );
    expect(corsResponseHeaders(configured, "https://www.example.com", "GET")).toEqual({
      "Access-Control-Allow-Origin": "https://www.example.com",
      "Access-Control-Allow-Methods": "GET",
      "Access-Control-Expose-Headers": "ETag",
      "Access-Control-Max-Age": "600",
      "Access-Control-Allow-Credentials": "true",
      "Vary": VARY,
    });
  });
});
