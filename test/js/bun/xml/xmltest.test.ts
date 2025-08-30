test("001", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("002", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc ></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("003", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc></doc >
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("004", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    <!ATTLIST doc a1 CDATA #IMPLIED>
    ]>
    <doc a1="v1"></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__attrs": {
      "a1": "v1",
    },
    "__name": "doc",
  });
});
test("005", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    <!ATTLIST doc a1 CDATA #IMPLIED>
    ]>
    <doc a1 = "v1"></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__attrs": {
      "a1": "v1",
    },
    "__name": "doc",
  });
});
test("006", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    <!ATTLIST doc a1 CDATA #IMPLIED>
    ]>
    <doc a1='v1'></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__attrs": {
      "a1": "v1",
    },
    "__name": "doc",
  });
});
test("007", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc>&#32;</doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
    "__text": " ",
  });
});
test("008", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc>&amp;&lt;&gt;&quot;&apos;</doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
    "__text": "&<>\"'",
  });
});
test("009", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc>&#x20;</doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
    "__text": " ",
  });
});
test("010", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    <!ATTLIST doc a1 CDATA #IMPLIED>
    ]>
    <doc a1="v1" ></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__attrs": {
      "a1": "v1",
    },
    "__name": "doc",
  });
});
test("011", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    <!ATTLIST doc a1 CDATA #IMPLIED a2 CDATA #IMPLIED>
    ]>
    <doc a1="v1" a2="v2"></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__attrs": {
      "a1": "v1",
      "a2": "v2",
    },
    "__name": "doc",
  });
});
test("012", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    <!ATTLIST doc : CDATA #IMPLIED>
    ]>
    <doc :="v1"></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__attrs": {
      ":": "v1",
    },
    "__name": "doc",
  });
});
test("013", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    <!ATTLIST doc _.-0123456789 CDATA #IMPLIED>
    ]>
    <doc _.-0123456789="v1"></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__attrs": {
      "_.-0123456789": "v1",
    },
    "__name": "doc",
  });
});
test("014", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    <!ATTLIST doc abcdefghijklmnopqrstuvwxyz CDATA #IMPLIED>
    ]>
    <doc abcdefghijklmnopqrstuvwxyz="v1"></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__attrs": {
      "abcdefghijklmnopqrstuvwxyz": "v1",
    },
    "__name": "doc",
  });
});
test("015", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    <!ATTLIST doc ABCDEFGHIJKLMNOPQRSTUVWXYZ CDATA #IMPLIED>
    ]>
    <doc ABCDEFGHIJKLMNOPQRSTUVWXYZ="v1"></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__attrs": {
      "ABCDEFGHIJKLMNOPQRSTUVWXYZ": "v1",
    },
    "__name": "doc",
  });
});
test("016", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc><?pi?></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("017", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc><?pi some data ? > <??></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("018", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc><![CDATA[<foo>]]></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
    "__text": "<foo>",
  });
});
test("019", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc><![CDATA[<&]]></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
    "__text": "<&",
  });
});
test("020", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc><![CDATA[<&]>]]]></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
    "__text": "<&]>]",
  });
});
test("021", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc><!-- a comment --></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("022", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc><!-- a comment ->--></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("023", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    <!ENTITY e "">
    ]>
    <doc>&e;</doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
    "__text": "&e;",
  });
});
test("024", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (foo)>
    <!ELEMENT foo (#PCDATA)>
    <!ENTITY e "&#60;foo></foo>">
    ]>
    <doc>&e;</doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
    "__text": "&e;",
  });
});
test("025", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (foo*)>
    <!ELEMENT foo (#PCDATA)>
    ]>
    <doc><foo/><foo></foo></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__children": [
      {
        "__name": "foo",
      },
      {
        "__name": "foo",
      },
    ],
    "__name": "doc",
  });
});
test("026", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (foo*)>
    <!ELEMENT foo EMPTY>
    ]>
    <doc><foo/><foo></foo></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__children": [
      {
        "__name": "foo",
      },
      {
        "__name": "foo",
      },
    ],
    "__name": "doc",
  });
});
test("027", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (foo*)>
    <!ELEMENT foo ANY>
    ]>
    <doc><foo/><foo></foo></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__children": [
      {
        "__name": "foo",
      },
      {
        "__name": "foo",
      },
    ],
    "__name": "doc",
  });
});
test("028", async () => {
  const xml = `
    <?xml version="1.0"?>
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("029", async () => {
  const xml = `
    <?xml version='1.0'?>
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("030", async () => {
  const xml = `
    <?xml version = "1.0"?>
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("031", async () => {
  const xml = `
    <?xml version='1.0' encoding="UTF-8"?>
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("032", async () => {
  const xml = `
    <?xml version='1.0' standalone='yes'?>
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("033", async () => {
  const xml = `
    <?xml version='1.0' encoding="UTF-8" standalone='yes'?>
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("034", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc/>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("035", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc />
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("036", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc></doc>
    <?pi data?>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("037", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc></doc>
    <!-- comment -->

  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("038", async () => {
  const xml = `
    <!-- comment -->
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc></doc>

  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("039", async () => {
  const xml = `
    <?pi data?>
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("040", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    <!ATTLIST doc a1 CDATA #IMPLIED>
    ]>
    <doc a1="&quot;&lt;&amp;&gt;&apos;"></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__attrs": {
      "a1": "\"<&>'",
    },
    "__name": "doc",
  });
});
test("041", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    <!ATTLIST doc a1 CDATA #IMPLIED>
    ]>
    <doc a1="&#65;"></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__attrs": {
      "a1": "A",
    },
    "__name": "doc",
  });
});
test("042", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc>&#00000000000000000000000000000000065;</doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
    "__text": "A",
  });
});
test("043", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ATTLIST doc a1 CDATA #IMPLIED>
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc a1="foo
    bar"></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toMatchInlineSnapshot(`
    {
      "__attrs": {
        "a1": 
    "foo
        bar"
    ,
      },
      "__name": "doc",
    }
  `);
});
test("044", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (e*)>
    <!ELEMENT e EMPTY>
    <!ATTLIST e a1 CDATA "v1" a2 CDATA "v2" a3 CDATA #IMPLIED>
    ]>
    <doc>
    <e a3="v3"/>
    <e a1="w1"/>
    <e a2="w2" a3="v3"/>
    </doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__children": [
      {
        "__attrs": {
          "a3": "v3",
        },
        "__name": "e",
      },
      {
        "__attrs": {
          "a1": "w1",
        },
        "__name": "e",
      },
      {
        "__attrs": {
          "a2": "w2",
          "a3": "v3",
        },
        "__name": "e",
      },
    ],
    "__name": "doc",
  });
});
test("045", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    <!ATTLIST doc a1 CDATA "v1">
    <!ATTLIST doc a1 CDATA "z1">
    ]>
    <doc></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("046", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    <!ATTLIST doc a1 CDATA "v1">
    <!ATTLIST doc a2 CDATA "v2">
    ]>
    <doc></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("047", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc>X
    Y</doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toMatchInlineSnapshot(`
    {
      "__name": "doc",
      "__text": 
    "X
        Y"
    ,
    }
  `);
});
test("048", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc>]</doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
    "__text": "]",
  });
});
test("049", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc>£</doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
    "__text": "£",
  });
});
test("050", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc>เจมส์</doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
    "__text": "เจมส์",
  });
});
test("051", async () => {
  const xml = `
    <!DOCTYPE เจมส์ [
    <!ELEMENT เจมส์  (#PCDATA)>
    ]>
    <เจมส์></เจมส์>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "เจมส์",
  });
});
test("052", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc>𐀀􏿽</doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
    "__text": "𐀀􏿽",
  });
});
test("053", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ENTITY e "<e/>">
    <!ELEMENT doc (e)>
    <!ELEMENT e EMPTY>
    ]>
    <doc>&e;</doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
    "__text": "&e;",
  });
});
test("054", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    ]>


    <doc
    ></doc
    >


  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("055", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    ]>
    <?pi  data?>
    <doc></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("056", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc>&#x0000000000000000000000000000000000000041;</doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
    "__text": "A",
  });
});
test("057", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (a*)>
    ]>
    <doc></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("058", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ATTLIST doc a1 NMTOKENS #IMPLIED>
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc a1=" 1  	2 	"></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__attrs": {
      "a1": " 1  	2 	",
    },
    "__name": "doc",
  });
});
test("059", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (e*)>
    <!ELEMENT e EMPTY>
    <!ATTLIST e a1 CDATA #IMPLIED a2 CDATA #IMPLIED a3 CDATA #IMPLIED>
    ]>
    <doc>
    <e a1="v1" a2="v2" a3="v3"/>
    <e a1="w1" a2="v2"/>
    <e a1="v1" a2="w2" a3="v3"/>
    </doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__children": [
      {
        "__attrs": {
          "a1": "v1",
          "a2": "v2",
          "a3": "v3",
        },
        "__name": "e",
      },
      {
        "__attrs": {
          "a1": "w1",
          "a2": "v2",
        },
        "__name": "e",
      },
      {
        "__attrs": {
          "a1": "v1",
          "a2": "w2",
          "a3": "v3",
        },
        "__name": "e",
      },
    ],
    "__name": "doc",
  });
});
test("060", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc>X&#10;Y</doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toMatchInlineSnapshot(`
    {
      "__name": "doc",
      "__text": 
    "X
    Y"
    ,
    }
  `);
});
test("061", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc>&#163;</doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
    "__text": "£",
  });
});
test("062", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc>&#xe40;&#xe08;&#xe21;ส์</doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
    "__text": "เจมส์",
  });
});
test("063", async () => {
  const xml = `
    <!DOCTYPE เจมส์ [
    <!ELEMENT เจมส์ (#PCDATA)>
    ]>
    <เจมส์></เจมส์>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "เจมส์",
  });
});
test("064", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc>&#x10000;&#x10FFFD;</doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
    "__text": "𐀀􏿽",
  });
});
test("065", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ENTITY e "&#60;">
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("066", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    <!ATTLIST doc a1 CDATA #IMPLIED>
    <!-- 34 is double quote -->
    <!ENTITY e1 "&#34;">
    ]>
    <doc a1="&e1;"></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__attrs": {
      "a1": "&e1;",
    },
    "__name": "doc",
  });
});
test("067", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc>&#13;</doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toMatchInlineSnapshot(`
    {
      "__name": "doc",
      "__text": 
    "
    "
    ,
    }
  `);
});
test("068", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    <!ENTITY e "&#13;">
    ]>
    <doc>&e;</doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
    "__text": "&e;",
  });
});
test("069", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    <!NOTATION n PUBLIC "whatever">
    ]>
    <doc></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("070", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ENTITY % e "<!ELEMENT doc (#PCDATA)>">
    %e;
    ]>
    <doc></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("071", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    <!ATTLIST doc a ID #IMPLIED>
    ]>
    <doc></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("072", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    <!ATTLIST doc a IDREF #IMPLIED>
    ]>
    <doc></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("073", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    <!ATTLIST doc a IDREFS #IMPLIED>
    ]>
    <doc></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("074", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    <!ATTLIST doc a ENTITY #IMPLIED>
    ]>
    <doc></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("075", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    <!ATTLIST doc a ENTITIES #IMPLIED>
    ]>
    <doc></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("076", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    <!ATTLIST doc a NOTATION (n1|n2) #IMPLIED>
    <!NOTATION n1 SYSTEM "http://www.w3.org/">
    <!NOTATION n2 SYSTEM "http://www.w3.org/">
    ]>
    <doc></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("077", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    <!ATTLIST doc a (1|2) #IMPLIED>
    ]>
    <doc></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("078", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    <!ATTLIST doc a CDATA #REQUIRED>
    ]>
    <doc a="v"></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__attrs": {
      "a": "v",
    },
    "__name": "doc",
  });
});
test("079", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    <!ATTLIST doc a CDATA #FIXED "v">
    ]>
    <doc a="v"></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__attrs": {
      "a": "v",
    },
    "__name": "doc",
  });
});
test("080", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    <!ATTLIST doc a CDATA #FIXED "v">
    ]>
    <doc></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("081", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (a, b, c)>
    <!ELEMENT a (a?)>
    <!ELEMENT b (b*)>
    <!ELEMENT c (a | b)+>
    ]>
    <doc><a/><b/><c><a/></c></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__children": [
      {
        "__name": "a",
      },
      {
        "__name": "b",
      },
      {
        "__children": [
          {
            "__name": "a",
          },
        ],
        "__name": "c",
      },
    ],
    "__name": "doc",
  });
});
test("082", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ENTITY % e SYSTEM "e.dtd">
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("083", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ENTITY % e PUBLIC 'whatever' "e.dtd">
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("084", async () => {
  const xml = `
    <!DOCTYPE doc [<!ELEMENT doc (#PCDATA)>]><doc></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("085", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    <!ENTITY % e "<foo>">
    <!ENTITY e "">
    ]>
    <doc>&e;</doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
    "__text": "&e;",
  });
});
test("086", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    <!ENTITY e "">
    <!ENTITY e "<foo>">
    ]>
    <doc>&e;</doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
    "__text": "&e;",
  });
});
test("087", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ENTITY e "<foo/&#62;">
    <!ELEMENT doc (foo)>
    <!ELEMENT foo EMPTY>
    ]>
    <doc>&e;</doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
    "__text": "&e;",
  });
});
test("088", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    <!ENTITY e "&lt;foo>">
    ]>
    <doc>&e;</doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
    "__text": "&e;",
  });
});
test("089", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ENTITY e "&#x10000;&#x10FFFD;&#x10FFFF;">
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc>&e;</doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
    "__text": "&e;",
  });
});
test("090", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ATTLIST e a NOTATION (n) #IMPLIED>
    <!ELEMENT doc (e)*>
    <!ELEMENT e (#PCDATA)>
    <!NOTATION n PUBLIC "whatever">
    ]>
    <doc></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("091", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!NOTATION n SYSTEM "http://www.w3.org/">
    <!ENTITY e SYSTEM "http://www.w3.org/" NDATA n>
    <!ELEMENT doc (#PCDATA)>
    <!ATTLIST doc a ENTITY "e">
    ]>
    <doc></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("092", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (a)*>
    <!ELEMENT a EMPTY>
    ]>
    <doc>
    <a/>
        <a/>	<a/>


    </doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__children": [
      {
        "__name": "a",
      },
      {
        "__name": "a",
      },
      {
        "__name": "a",
      },
    ],
    "__name": "doc",
  });
});
test("093", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc>


    </doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("094", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ENTITY % e "foo">
    <!ELEMENT doc (#PCDATA)>
    <!ATTLIST doc a1 CDATA "%e;">
    ]>
    <doc></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("095", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ATTLIST doc a1 CDATA #IMPLIED>
    <!ATTLIST doc a1 NMTOKENS #IMPLIED>
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc a1="1  2"></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__attrs": {
      "a1": "1  2",
    },
    "__name": "doc",
  });
});
test("096", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ATTLIST doc a1 NMTOKENS " 1  	2 	">
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("097", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    <!ENTITY % e SYSTEM "097.ent">
    <!ATTLIST doc a1 CDATA "v1">
    %e;
    <!ATTLIST doc a2 CDATA "v2">
    ]>
    <doc></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("098", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc><?pi x
    y?></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("099", async () => {
  const xml = `
    <?xml version="1.0" encoding="utf-8"?>
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("100", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ENTITY e PUBLIC ";!*#@$_%" "100.xml">
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("101", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    <!ENTITY e "&#34;">
    ]>
    <doc></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("102", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    <!ATTLIST doc a CDATA #IMPLIED>
    ]>
    <doc a="&#34;"></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toMatchInlineSnapshot(`
    {
      "__attrs": {
        "a": """,
      },
      "__name": "doc",
    }
  `);
});
test("103", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc>&#60;doc></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
    "__text": "<doc>",
  });
});
test("104", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    <!ATTLIST doc a CDATA #IMPLIED>
    ]>
    <doc a="x	y"></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__attrs": {
      "a": "x	y",
    },
    "__name": "doc",
  });
});
test("105", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    <!ATTLIST doc a CDATA #IMPLIED>
    ]>
    <doc a="x&#9;y"></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__attrs": {
      "a": "x	y",
    },
    "__name": "doc",
  });
});
test("106", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    <!ATTLIST doc a CDATA #IMPLIED>
    ]>
    <doc a="x&#10;y"></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toMatchInlineSnapshot(`
    {
      "__attrs": {
        "a": 
    "x
    y"
    ,
      },
      "__name": "doc",
    }
  `);
});
test("107", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    <!ATTLIST doc a CDATA #IMPLIED>
    ]>
    <doc a="x&#13;y"></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toMatchInlineSnapshot(`
    {
      "__attrs": {
        "a": 
    "x
    y"
    ,
      },
      "__name": "doc",
    }
  `);
});
test("108", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    <!ENTITY e "
    ">
    <!ATTLIST doc a CDATA #IMPLIED>
    ]>
    <doc a="x&e;y"></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__attrs": {
      "a": "x&e;y",
    },
    "__name": "doc",
  });
});
test("109", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    <!ATTLIST doc a CDATA #IMPLIED>
    ]>
    <doc a=""></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__attrs": {
      "a": "",
    },
    "__name": "doc",
  });
});
test("110", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    <!ENTITY e "&#13;&#10;">
    <!ATTLIST doc a CDATA #IMPLIED>
    ]>
    <doc a="x&e;y"></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__attrs": {
      "a": "x&e;y",
    },
    "__name": "doc",
  });
});
test("111", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    <!ATTLIST doc a NMTOKENS #IMPLIED>
    ]>
    <doc a="&#32;x&#32;&#32;y&#32;"></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__attrs": {
      "a": " x  y ",
    },
    "__name": "doc",
  });
});
test("112", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (a | b)>
    <!ELEMENT a (#PCDATA)>
    ]>
    <doc><a></a></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__children": [
      {
        "__name": "a",
      },
    ],
    "__name": "doc",
  });
});
test("113", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    <!ATTLIST e a CDATA #IMPLIED>
    ]>
    <doc></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("114", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    <!ENTITY e "<![CDATA[&foo;]]>">
    ]>
    <doc>&e;</doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
    "__text": "&e;",
  });
});
test("115", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    <!ENTITY e1 "&e2;">
    <!ENTITY e2 "v">
    ]>
    <doc>&e1;</doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
    "__text": "&e1;",
  });
});
test("116", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    ]>
    <doc><![CDATA[
    ]]></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
test("117", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    <!ENTITY rsqb "]">
    ]>
    <doc>&rsqb;</doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
    "__text": "&rsqb;",
  });
});
test("118", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc (#PCDATA)>
    <!ENTITY rsqb "]]">
    ]>
    <doc>&rsqb;</doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
    "__text": "&rsqb;",
  });
});
test("119", async () => {
  const xml = `
    <!DOCTYPE doc [
    <!ELEMENT doc ANY>
    ]>
    <doc><!-- -á --></doc>
  `;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    "__name": "doc",
  });
});
