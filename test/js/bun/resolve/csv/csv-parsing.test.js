import { CSV } from "bun";
import { describe, expect, it } from "bun:test";

import large_dataset from "./large-dataset.csv" with { type: "text" };

describe("CSV", () => {
  describe("Basic Parsing", () => {
    it("should parse empty input", () => {
      const parsed = CSV.parse("");
      expect(parsed.data).toEqual([]);
    });

    it("should parse basic CSV", () => {
      const parsed = CSV.parse(`col1,col2
value1,value2`);
      expect(parsed.data).toEqual([{ col1: "value1", col2: "value2" }]);
    });

    it("should parse unicode", () => {
      const parsed = CSV.parse(`col1,col2
フィグマ,ボールズ
🦔,👨‍👩‍👦`);

      expect(parsed.data).toEqual([
        { col1: "フィグマ", col2: "ボールズ" },
        { col1: "🦔", col2: "👨‍👩‍👦" },
      ]);
    });

    it("should handle weird-data", () => {
      const parsed = CSV.parse(
        `,somejunk,<! />
,nope,
yes,yup,yeah
ok,ok,ok!`,
      );

      expect(parsed.data).toEqual([
        { "": "", somejunk: "nope", "<! />": "" },
        { "": "yes", somejunk: "yup", "<! />": "yeah" },
        { "": "ok", somejunk: "ok", "<! />": "ok!" },
      ]);
    });

    it("should parse large dataset", () => {
      const parsed = CSV.parse(large_dataset);

      expect(parsed.data.length).toEqual(7268);
      expect(parsed.rows).toEqual(7268);

      expect(Object.keys(parsed.data[0])).toEqual([
        "time",
        "latitude",
        "longitude",
        "depth",
        "mag",
        "magType",
        "nst",
        "gap",
        "dmin",
        "rms",
        "net",
        "id",
        "updated",
        "place",
        "type",
      ]);

      const random_line = parsed.data[1904];
      expect(random_line).toEqual({
        time: "2015-12-13T02:34:10.000Z",
        latitude: "57.6454",
        longitude: "-155.6064",
        depth: "97.4",
        mag: "2.2",
        magType: "ml",
        nst: "",
        gap: "",
        dmin: "",
        rms: "0.24",
        net: "ak",
        id: "ak12285792",
        updated: "2015-12-18T20:45:41.519Z",
        place: "98km W of Larsen Bay, Alaska",
        type: "earthquake",
      });

      // Test that there are no empty rows
      expect(parsed.data.every(row => Object.values(row).some(v => v !== ""))).toEqual(true);
    });
  });

  describe("Header Option", () => {
    it("should parse with header (default)", () => {
      const parsed = CSV.parse(`col1,col2
value1,value2`);
      expect(parsed.data).toEqual([{ col1: "value1", col2: "value2" }]);
    });

    it("should parse without header", () => {
      const parsed = CSV.parse(
        `col1,col2
value1,value2`,
        { header: false },
      );
      expect(parsed.data).toEqual([
        ["col1", "col2"],
        ["value1", "value2"],
      ]);
    });

    it("should warn on duplicate headers", () => {
      try {
        const parsed = CSV.parse(
          `a,b,b
1,2,3
`,
          { header: true },
        );
      } catch (e) {
        expect(e.message).toMatch(/Duplicate header/gi);
      }
    });

    it("should handle file with only header", () => {
      const parsed = CSV.parse("ID,Name,Value");
      expect(parsed.data).toEqual([]);

      const parsedWithoutHeader = CSV.parse("ID,Name,Value", { header: false });
      expect(parsedWithoutHeader.data).toEqual([["ID", "Name", "Value"]]);
    });

    it("should handle quoted headers with delimiters", () => {
      const parsed = CSV.parse(
        `"ID","Name, Title","Value ($)"
1,"Smith, CEO",1000
2,"Doe, Manager",500`,
      );

      expect(parsed.data).toEqual([
        { "ID": "1", "Name, Title": "Smith, CEO", "Value ($)": "1000" },
        { "ID": "2", "Name, Title": "Doe, Manager", "Value ($)": "500" },
      ]);
    });
  });

  describe("Delimiter Option", () => {
    it("should parse CSV with comma delimiter (default)", () => {
      const parsed = CSV.parse(`col1,col2
value1,value2`);
      expect(parsed.data).toEqual([{ col1: "value1", col2: "value2" }]);
    });

    it("should parse CSV with pipe delimiter", () => {
      const parsed = CSV.parse(
        `col1|col2
value1|value2
value3|value4`,
        { delimiter: "|" },
      );

      expect(parsed.data).toEqual([
        { col1: "value1", col2: "value2" },
        { col1: "value3", col2: "value4" },
      ]);
    });

    it("should parse CSV with semicolon delimiter", () => {
      const parsed = CSV.parse(
        `col1;col2;col3
value1;value2;value3
value4;value5;value6`,
        { delimiter: ";" },
      );

      expect(parsed.data).toEqual([
        { col1: "value1", col2: "value2", col3: "value3" },
        { col1: "value4", col2: "value5", col3: "value6" },
      ]);
    });

    it("should parse CSV with tab delimiter", () => {
      const parsed = CSV.parse("col1\tcol2\nvalue1\tvalue2", { delimiter: "\t" });
      expect(parsed.data).toEqual([{ col1: "value1", col2: "value2" }]);
    });

    it("should parse CSV with multibyte custom delimiter", () => {
      const parsed = CSV.parse(
        `col1🦔col2
value1🦔value2
value3🦔value4`,
        { delimiter: "🦔" },
      );

      expect(parsed.data).toEqual([
        { col1: "value1", col2: "value2" },
        { col1: "value3", col2: "value4" },
      ]);
    });

    it("should support multi-character delimiter", () => {
      const parsed = CSV.parse(`col1<=>col2\nvalue1<=>value2`, { delimiter: "<=>" });
      expect(parsed.data).toEqual([{ col1: "value1", col2: "value2" }]);
    });

    it("should handle quoted fields with multi-character delimiter", () => {
      const parsed = CSV.parse(`col1<=>col2\n"value with<=>delimiter"<=>value2`, { delimiter: "<=>" });
      expect(parsed.data).toEqual([{ col1: "value with<=>delimiter", col2: "value2" }]);
    });

    it("should support ASCII record separator (0x1E) as delimiter", () => {
      const RECORD_SEP = String.fromCharCode(30);
      const parsed = CSV.parse(`col1${RECORD_SEP}col2\nvalue1${RECORD_SEP}value2`, { delimiter: RECORD_SEP });
      expect(parsed.data).toEqual([{ col1: "value1", col2: "value2" }]);
    });

    it("should support ASCII unit separator (0x1F) as delimiter", () => {
      const UNIT_SEP = String.fromCharCode(31);
      const parsed = CSV.parse(`col1${UNIT_SEP}col2\nvalue1${UNIT_SEP}value2`, { delimiter: UNIT_SEP });
      expect(parsed.data).toEqual([{ col1: "value1", col2: "value2" }]);
    });

    it("should handle delimiter in quotes", () => {
      const parsed = CSV.parse(`col1,col2
normal value,"here we quote , in the field"
foo,bar`);

      expect(parsed.data).toEqual([
        { col1: "normal value", col2: "here we quote , in the field" },
        { col1: "foo", col2: "bar" },
      ]);
    });
  });

  describe("Quote Handling", () => {
    it("should handle standard quotes", () => {
      const parsed = CSV.parse(
        `col1,col2
"value1","value2"`,
      );

      expect(parsed.data).toEqual([{ col1: "value1", col2: "value2" }]);
    });

    it("should handle quotes in quotes", () => {
      const parsed = CSV.parse(
        `col1,col2
"value1, value2","value3, value4"`,
      );

      expect(parsed.data).toEqual([{ col1: `value1, value2`, col2: `value3, value4` }]);
    });

    it("should handle escaped quotes", () => {
      const parsed = CSV.parse(
        `col1,col2
"value1, ""with quotes""","value2"`,
      );

      expect(parsed.data).toEqual([{ col1: `value1, "with quotes"`, col2: "value2" }]);
    });

    it("should handle quotes in multiline fields", () => {
      const parsed = CSV.parse(`a,b
1,"ha 
""ha"" 
ha"
2," 
"""" 
"
3,4
`);

      expect(parsed.data).toEqual([
        { a: "1", b: 'ha \n"ha" \nha' },
        { a: "2", b: ' \n"" \n' },
        { a: "3", b: "4" },
      ]);
    });

    it("should handle custom quote character", () => {
      const parsed = CSV.parse(
        `col1,col2
'value1,with comma','value2'`,
        { quote: "'" },
      );

      expect(parsed.data).toEqual([{ col1: "value1,with comma", col2: "value2" }]);
    });

    it("should handle unicode quote & delimiter characters", () => {
      const parsed = CSV.parse(`🦔t,e☁︎s,t🦔☁︎2`, { header: false, quote: "🦔", delimiter: "☁︎" });

      expect(parsed.data).toEqual([["t,e☁︎s,t", "2"]]);
    });

    it("should handle quotes with spaces between closing quote and delimiter", () => {
      const parsed = CSV.parse(`a,"b" ,c`, { header: false });
      expect(parsed.data).toEqual([["a", "b", "c"]]);
    });

    it("should handle multiple whitespace characters between quote and delimiter", () => {
      const parsed = CSV.parse(`a,"b"  \t  ,c`, { header: false });
      expect(parsed.data).toEqual([["a", "b", "c"]]);
    });

    it("should handle whitespace between quote and end of line", () => {
      const parsed = CSV.parse(`a,"b" \n1,"2" `, { header: false });
      expect(parsed.data).toEqual([
        ["a", "b"],
        ["1", "2"],
      ]);
    });

    it("should handle misplaced quotes in data", () => {
      const parsed = CSV.parse(`a,b "b",c`, { header: false });
      expect(parsed.data).toEqual([["a", 'b "b"', "c"]]);
    });

    it("should handle quoted fields with quotes around delimiters", () => {
      const parsed = CSV.parse(`a,""",""",c`, { header: false });
      expect(parsed.data).toEqual([["a", '","', "c"]]);
    });

    it("should handle quoted fields with 5 quotes in a row and delimiter", () => {
      const parsed = CSV.parse(`"1","cnonce="""",nc=""""","2"`, { header: false });
      expect(parsed.data).toEqual([["1", 'cnonce="",nc=""', "2"]]);
    });

    it("should handle even number of quotes", () => {
      const parsed = CSV.parse(`""""""`, { header: false });
      expect(parsed.data).toEqual([['""']]);
    });

    it("should handle misplaced quotes in multiple rows", () => {
      const parsed = CSV.parse(`a,b",c\nd,e",f`, { header: false });
      expect(parsed.data).toEqual([
        ["a", 'b"', "c"],
        ["d", 'e"', "f"],
      ]);
    });

    it("should handle quoted field with no closing quote", () => {
      expect(() => {
        CSV.parse(`a,"b,c\nd,e,f`);
      }).toThrow(/Unexpected end of file inside quoted field/i);
    });

    it("should handle quoted fields at end of row with delimiters", () => {
      const parsed = CSV.parse(`a,b,"c,c\nc"\nd,e,f`, { header: false });
      expect(parsed.data).toEqual([
        ["a", "b", "c,c\nc"],
        ["d", "e", "f"],
      ]);
    });

    it("should handle quotes on boundaries of fields", () => {
      const parsed = CSV.parse(`a,"""b""",c`, { header: false });
      expect(parsed.data).toEqual([["a", '"b"', "c"]]);
    });

    it("should throw on unexpected end of quoted field", () => {
      expect(() => {
        CSV.parse(`col1,col2
"unclosed quote`);
      }).toThrow(/Unexpected end of file inside quoted field/i);

      expect(() => {
        CSV.parse(`col1,col2
value1,"unclosed`);
      }).toThrow(/Unexpected end of file inside quoted field/i);
    });
  });

  describe("Whitespace Handling", () => {
    it("should preserve whitespace by default", () => {
      const parsed = CSV.parse(`col1,col2
   value1   ,   value2   
\tvalue3\t,\tvalue4\t`);

      expect(parsed.data).toEqual([
        { col1: "   value1   ", col2: "   value2   " },
        { col1: "\tvalue3\t", col2: "\tvalue4\t" },
      ]);
    });

    it("should trim whitespace when option is enabled", () => {
      const parsed = CSV.parse(
        `col1,col2
   value1   ,   value2   `,
        { trimWhitespace: true },
      );

      expect(parsed.data).toEqual([{ col1: "value1", col2: "value2" }]);
    });

    it("should trim trailing whitespace after quotes", () => {
      const parsed = CSV.parse(
        `col1,col2
"value1"  ,"value2"  `,
        { trimWhitespace: true },
      );

      expect(parsed.data).toEqual([{ col1: "value1", col2: "value2" }]);
    });

    it("should preserve whitespace around quoted strings without trim option", () => {
      const parsed = CSV.parse('a, "b" ,c', { header: false });
      expect(parsed.data).toEqual([["a", ' "b" ', "c"]]);
    });

    it("should handle lines with whitespace only", () => {
      const parsed = CSV.parse("a,b,c\n    \nd,e,f", { header: true });
      expect(parsed.data).toEqual([
        { a: "    ", b: "", c: "" },
        { a: "d", b: "e", c: "f" },
      ]);
    });

    it("should correctly handle fields with only spaces", () => {
      const parsed = CSV.parse("a,b,c\n , ,d");
      expect(parsed.data).toEqual([{ a: " ", b: " ", c: "d" }]);
    });

    it("should handle whitespace at edges of unquoted fields", () => {
      const parsed = CSV.parse("a,  b  ,c", { header: false });
      expect(parsed.data).toEqual([["a", "  b  ", "c"]]);
    });
  });

  describe("Line Endings", () => {
    it("should handle LF line endings (default)", () => {
      const parsed = CSV.parse("a,b,c\nd,e,f");
      expect(parsed.data).toEqual([{ a: "d", b: "e", c: "f" }]);
    });

    it("should handle CRLF line endings", () => {
      const parsed = CSV.parse("a,b,c\r\nd,e,f");
      expect(parsed.data).toEqual([{ a: "d", b: "e", c: "f" }]);
    });

    it("should handle CR only line endings", () => {
      const parsed = CSV.parse("a,b,c\rd,e,f");
      expect(parsed.data).toEqual([{ a: "d", b: "e", c: "f" }]);
    });

    it("should handle mixed line endings", () => {
      const parsed = CSV.parse("a,b,c\r\nd,e,f\rg,h,i\n");
      expect(parsed.data).toEqual([
        { a: "d", b: "e", c: "f" },
        { a: "g", b: "h", c: "i" },
      ]);
    });

    it("should handle quoted field with CRLF", () => {
      const parsed = CSV.parse('a,b,c\n1,"line 1\r\nline 2",3');
      expect(parsed.data).toEqual([{ a: "1", b: "line 1\r\nline 2", c: "3" }]);
    });

    it("should handle quoted field with CR", () => {
      const parsed = CSV.parse('a,b,c\n1,"line 1\rline 2",3');
      expect(parsed.data).toEqual([{ a: "1", b: "line 1\rline 2", c: "3" }]);
    });

    it("should handle newlines in quoted fields", () => {
      const parsed = CSV.parse(`a,b,c
1,2,3
"Once upon 
a time",5,6
7,8,9
`);
      expect(parsed.data).toEqual([
        { a: "1", b: "2", c: "3" },
        { a: "Once upon \na time", b: "5", c: "6" },
        { a: "7", b: "8", c: "9" },
      ]);
    });

    it("should include trailing newlines", () => {
      const parsed = CSV.parse(`a,b,c
1,2,3

`);
      expect(parsed.data).toEqual([
        { a: "1", b: "2", c: "3" },
        { a: "", b: "", c: "" },
      ]);

      const parsedWithHeader = CSV.parse(
        `a,b,c
1,2,3

`,
        { header: false },
      );
      expect(parsedWithHeader.data).toEqual([["a", "b", "c"], ["1", "2", "3"], []]);
    });
  });

  it("should remove trailing newlines if skipEmptyLines is true", () => {
    const parsed = CSV.parse(
      `a,b,c
1,2,3

`,
      { skipEmptyLines: true },
    );
    expect(parsed.data).toEqual([{ a: "1", b: "2", c: "3" }]);

    const parsedWithHeader = CSV.parse(
      `a,b,c
1,2,3

`,
      { header: false, skipEmptyLines: true },
    );
    expect(parsedWithHeader.data).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("should preserve empty lines if skipEmptyLines is false", () => {
    const parsed = CSV.parse(
      `a,b,c

1,2,3

`,
      { skipEmptyLines: false },
    );
    expect(parsed.data).toEqual([
      { a: "", b: "", c: "" },
      { a: "1", b: "2", c: "3" },
      { a: "", b: "", c: "" },
    ]);

    const parsedWithHeader = CSV.parse(
      `a,b,c

1,2,3

`,
      { header: false, skipEmptyLines: false },
    );
    expect(parsedWithHeader.data).toEqual([["a", "b", "c"], [], ["1", "2", "3"], []]);
  });

  describe("Empty Field Handling", () => {
    it("should include empty columns", () => {
      const parsed = CSV.parse(`a,,c
1,,3
`);

      expect(parsed.data).toEqual([{ a: "1", "": "", c: "3" }]);
    });

    it("should include empty columns (no header)", () => {
      const parsed = CSV.parse(
        `a,,c
1,,3
`,
        { header: false },
      );

      expect(parsed.data).toEqual([
        ["a", "", "c"],
        ["1", "", "3"],
      ]);
    });

    it("should handle input that is just the delimiter", () => {
      const parsed = CSV.parse(",,,", { header: false });
      expect(parsed.data).toEqual([["", "", "", ""]]);
    });

    it("should handle input that is just the delimiter with skipEmptyLines option", () => {
      const parsed = CSV.parse(",,,", { header: false, skipEmptyLines: true });
      expect(parsed.data).toEqual([]);
    });

    it("should handle input with just empty fields", () => {
      const parsed = CSV.parse(",,\n,,,", { header: false });
      expect(parsed.data).toEqual([
        ["", "", ""],
        ["", "", "", ""],
      ]);
    });

    it("should handle input with just empty fields with skipEmptyLines option", () => {
      const parsed = CSV.parse(",,\n,,,", { header: false, skipEmptyLines: true });
      expect(parsed.data).toEqual([]);
    });

    it("should handle trailing empty fields", () => {
      const parsed = CSV.parse("a,b,c,\n1,2,3,", { header: false });
      expect(parsed.data).toEqual([
        ["a", "b", "c", ""],
        ["1", "2", "3", ""],
      ]);
    });

    it("should handle input with first field empty in multiple rows", () => {
      const parsed = CSV.parse(",b,c\n,e,f", { header: false });
      expect(parsed.data).toEqual([
        ["", "b", "c"],
        ["", "e", "f"],
      ]);
    });
  });

  describe("Comments Option", () => {
    it("should handle comments when enabled", () => {
      const parsed = CSV.parse(
        `col1,col2
#   comment   
a,b
1,2`,
        { comments: true },
      );

      expect(parsed.data).toEqual([
        { col1: "a", col2: "b" },
        { col1: "1", col2: "2" },
      ]);

      expect(parsed.comments).toEqual([
        {
          line: 2,
          text: "comment", // the comments leading and trailing whitespaces are trimmed
        },
      ]);
    });

    it("treats comments as values when comments option is disabled", () => {
      const parsed = CSV.parse(
        `col1,col2
# comment
a,b,c
1,2,3`,
        { comments: false },
      );

      expect(parsed.data).toEqual([
        { col1: "# comment", col2: "" },
        { col1: "a", col2: "b" },
        { col1: "1", col2: "2" },
      ]);
    });

    it("should handle entire file being comments", () => {
      const parsed = CSV.parse(`# Comment 1\n# Comment 2\n# Comment 3`, { comments: true });
      expect(parsed.data).toEqual([]);
    });

    it("should handle multiple consecutive comment lines", () => {
      const parsed = CSV.parse(`a,b,c\n#comment1\n#comment2\nd,e,f`, { comments: true });
      expect(parsed.data).toEqual([{ a: "d", b: "e", c: "f" }]);
    });

    it("should handle comments at the end of file", () => {
      const parsed = CSV.parse(`a,b,c\n1,2,3\n# Comment`, { comments: true });
      expect(parsed.data).toEqual([{ a: "1", b: "2", c: "3" }]);
    });
  });

  describe("Row Preview Option", () => {
    it("should parse only the specified number of rows", () => {
      const parsed = CSV.parse(`a,b,c\n1,2,3\n4,5,6\n7,8,9`, { preview: 2 });
      expect(parsed.data).toEqual([
        { a: "1", b: "2", c: "3" },
        { a: "4", b: "5", c: "6" },
      ]);
    });

    it("should ignore all rows if preview is 0", () => {
      try {
        const parsed = CSV.parse(`a,b,c\n1,2,3\n4,5,6\n7,8,9`, { preview: 0 });
      } catch (error) {
        expect(error.message).toMatch(/Preview value must be greater than 0/);
      }
    });

    it("should count rows, not lines for preview with multiline fields", () => {
      const parsed = CSV.parse(`a,b,c\n1,"multiline\nfield",3\n4,5,6\n7,8,9`, { preview: 2 });
      expect(parsed.data).toEqual([
        { a: "1", b: "multiline\nfield", c: "3" },
        { a: "4", b: "5", c: "6" },
      ]);
    });

    it("should handle preview with just header row", () => {
      const parsed = CSV.parse("a,b,c", { preview: 1 });
      expect(parsed.data).toEqual([]);
    });
  });

  describe("Type Inference", () => {
    it("should infer numeric values", () => {
      const parsed = CSV.parse(
        `num1,num2,num3,str
123,-456,78.9,"123"`,
        { dynamicTyping: true },
      );

      expect(parsed.data).toEqual([{ num1: 123, num2: -456, num3: 78.9, str: "123" }]);
    });

    it("should infer boolean values", () => {
      const parsed = CSV.parse(
        `bool1,bool2,str1,str2
true,false,"true","false"`,
        { dynamicTyping: true },
      );

      expect(parsed.data).toEqual([{ bool1: true, bool2: false, str1: "true", str2: "false" }]);
    });

    it("should infer null values", () => {
      const parsed = CSV.parse(
        `val1,val2,val3
null,NULL,"null"`,
        { dynamicTyping: true },
      );

      expect(parsed.data).toEqual([{ val1: null, val2: null, val3: "null" }]);
    });

    it("should not infer non-finite numeric values", () => {
      const parsed = CSV.parse(
        `val1,val2,val3
NaN,Infinity,-Infinity`,
        { dynamicTyping: true, header: true },
      );

      expect(parsed.data).toEqual([{ val1: "NaN", val2: "Infinity", val3: "-Infinity" }]);
    });

    it("should parse too big numbers as strings", () => {
      const parsed = CSV.parse(
        `val1,val2
9007199254740993,12345678901234567890
`,
        { dynamicTyping: true },
      );

      expect(parsed.data).toEqual([
        {
          val1: "9007199254740993",
          val2: "12345678901234567890",
        },
      ]);
    });

    // TODO: maybe someday
    //     it("should correctly parse BigInts", () => {
    //       const parsed = CSV.parse(
    //         `val1,val2
    // 1,2
    // 3,9007199254740993
    // 5,6
    // 7,8`,
    //         { dynamicTyping: true },
    //       );

    //       expect(parsed.data).toEqual([
    //         { val1: BigInt(1), val2: BigInt(2) },
    //         { val1: BigInt(3), val2: 9007199254740993n },
    //         { val1: BigInt(5), val2: BigInt(6) },
    //         { val1: BigInt(7), val2: BigInt(8) },
    //       ]);
    //     });

    // TODO: maybe someday
    //     it("should support custom inference function", () => {
    //       const customInfer = (value, col, row, isQuoted) => {
    //         if (isQuoted) return value;
    //         if (value === "0") return false;
    //         if (value === "1") return true;
    //         return value;
    //       };

    //       const parsed = CSV.parse(
    //         `val1,val2,val3,val4
    // 0,1,"0","1"`,
    //         { infer: customInfer },
    //       );

    //       expect(parsed.data).toEqual([{ val1: false, val2: true, val3: "0", val4: "1" }]);
    //     });
  });

  describe("Inconsistent Columns", () => {
    it("should handle inconsistent columns with header by filling missing fields", () => {
      const parsed = CSV.parse(`col1,col2,col3
value1,value2
value3,value4,value5,value6`);
      expect(parsed.data).toEqual([
        { col1: "value1", col2: "value2", col3: "" },
        { col1: "value3", col2: "value4", col3: "value5" }, // Extra columns are ignored when header: true
      ]);
    });

    it("should allow inconsistent columns without header", () => {
      const parsed = CSV.parse(
        `row1col1,row1col2,row1col3
row2col1,row2col2
row3col1,row3col2,row3col3,row3col4`,
        { header: false },
      );

      expect(parsed.data).toEqual([
        ["row1col1", "row1col2", "row1col3"],
        ["row2col1", "row2col2"],
        ["row3col1", "row3col2", "row3col3", "row3col4"],
      ]);
    });

    it("should handle empty rows with inconsistent columns", () => {
      const parsed = CSV.parse(
        `
row1col1,row1col2,row1col3
row2col1,row2col2

row4col1,row4col2,row4col3,row4col4`,
        { header: false },
      );

      expect(parsed.data).toEqual([
        [],
        ["row1col1", "row1col2", "row1col3"],
        ["row2col1", "row2col2"],
        [],
        ["row4col1", "row4col2", "row4col3", "row4col4"],
      ]);
    });
  });

  describe("Error Handling", () => {
    it("should handle invalid Unicode sequences gracefully", () => {
      // Test with malformed UTF-8 bytes
      const invalidUtf8 = Buffer.from([0xff, 0xfe, 0xfd]);
      expect(() => CSV.parse(invalidUtf8.toString("latin1"))).not.toThrow();
    });

    it("should handle extremely large field values", () => {
      const largeValue = "x".repeat(1000000); // 1MB field
      const parsed = CSV.parse(`field\n"${largeValue}"`);
      expect(parsed.data[0].field).toEqual(largeValue);
    });

    it("should handle deeply nested quotes", () => {
      const parsed = CSV.parse(`a\n""""""""""""""""""""""`);
      expect(parsed.data[0].a).toEqual('""""""""""');
    });

    it("should handle malformed CSV with recovery", () => {
      // Test various malformed structures
      const parsed = CSV.parse(`a,b,c\n1,2\n3,4,5,6\n7,8,9`);
      expect(parsed.errors.length).toBeGreaterThan(0);
    });
  });

  describe("Advanced Quote Edge Cases", () => {
    it("should handle multi-character quote strings", () => {
      const parsed = CSV.parse(`a,b\n|||value|||,normal`, { quote: "|||" });
      expect(parsed.data[0]).toEqual({ a: "value", b: "normal" });
    });

    it("should handle quote characters that contain delimiters", () => {
      const parsed = CSV.parse(`a,b\n",value,",normal`, { quote: ",", delimiter: "," });
      // This is a tricky edge case - how should this be handled?
    });

    it("should handle quotes at field boundaries", () => {
      const parsed = CSV.parse(`a"b"c,d"e"f`, { header: false });
      expect(parsed.data[0]).toEqual(['a"b"c', 'd"e"f']);
    });

    it("should handle alternating quote characters", () => {
      const parsed = CSV.parse(`"a"b"c"d"`, { header: false });
      // Test how the parser handles this ambiguous case

      expect(parsed).toEqual({
        data: [["a"]],
        rows: 1,
        columns: 1,
      });
    });

    describe("Advanced Dynamic Typing", () => {
      it("should handle scientific notation", () => {
        const parsed = CSV.parse(`num\n1.23e10\n-4.56E-7`, { dynamicTyping: true });
        expect(parsed.data[0].num).toEqual(1.23e10);
        expect(parsed.data[1].num).toEqual(-4.56e-7);
      });

      it("should handle hexadecimal numbers", () => {
        const parsed = CSV.parse(`hex\n0xFF\n0x123ABC`, { dynamicTyping: true });
        // Should these be parsed as numbers or strings?

        expect(parsed).toEqual({
          data: [{ hex: 255 }, { hex: 1194684 }],
          rows: 2,
          columns: 1,
        });
      });

      it("should handle numbers with leading zeros", () => {
        const parsed = CSV.parse(`val\n007\n000123`, { dynamicTyping: true });
        expect(parsed).toEqual({
          data: [{ val: 7 }, { val: 123 }],
          rows: 2,
          columns: 1,
        });
      });
    });
  });

  describe("Advanced Line Endings", () => {
    it("should handle Unicode line separators", () => {
      const LS = String.fromCharCode(0x2028); // Line Separator
      const PS = String.fromCharCode(0x2029); // Paragraph Separator
      const parsed = CSV.parse(`a,b${LS}1,2${PS}3,4`);
      expect(parsed.data.length).toEqual(2);
    });

    it("should handle mixed line endings within quoted fields", () => {
      const parsed = CSV.parse(`a,b\n1,"line1\rline2\r\nline3\nline4"\n3,4`);
      expect(parsed.data[0].b).toEqual("line1\rline2\r\nline3\nline4");
    });

    it("should handle files ending without final newline", () => {
      const parsed = CSV.parse("a,b\n1,2\n3,4"); // No final newline
      expect(parsed.data.length).toEqual(2);
    });
  });

  describe("Header Edge Cases", () => {
    // TODO: figure out numeric keys in objects
    // it("should handle numeric headers", () => {
    //   const parsed = CSV.parse(`1,2,3\na,b,c`);
    //   expect(parsed.data[0]).toEqual({ "1": "a", "2": "b", "3": "c" });
    // });

    it("should handle headers with only whitespace", () => {
      const parsed = CSV.parse(`   ,\t,
a,b,c`);
      expect(parsed).toEqual({
        data: [
          {
            "   ": "a",
            "\t": "b",
            "": "c",
          },
        ],
        rows: 1,
        columns: 3,
      });
    });

    it("should handle duplicate headers with numeric suffixes", () => {
      // Some parsers append _1, _2, etc. to duplicate headers
      const parsed = CSV.parse(`name,name,name\nJohn,Jane,Bob`);
      // How should your parser handle this?
    });

    it("should handle empty string headers", () => {
      const parsed = CSV.parse(`,b,\na,c,d`);
      expect(Object.keys(parsed.data[0])).toContain("");
    });

    it("should suffix duplicate headers with _1, _2, etc.", () => {
      const parsed = CSV.parse(`a,a,a
42,69,123`);
      expect(parsed).toEqual({
        data: [{ a: "42", a_1: "69", a_2: "123" }],
        rows: 1,
        columns: 3,
      });
    });
  });

  describe("Multi-Character Delimiters", () => {
    it("should handle delimiter that is substring of another", () => {
      const parsed = CSV.parse(`a<>b<><>c`, { delimiter: "<>", header: false });
      expect(parsed.data[0]).toEqual(["a", "b", "", "c"]);
    });

    it("should handle overlapping potential delimiters", () => {
      const parsed = CSV.parse(`a<<<>>>b`, { delimiter: "<<>>", header: false });
      // How should this ambiguous case be resolved?
    });

    it("should handle delimiter that contains quote characters", () => {
      const parsed = CSV.parse(`a,"b",c<">d`, { delimiter: `<">`, header: false });
      // Complex interaction between quotes and delimiters
    });
  });

  describe("Performance Tests", () => {
    it("should handle files with many columns", () => {
      const headers = Array.from({ length: 1000 }, (_, i) => `col${i}`).join(",");
      const data = Array.from({ length: 1000 }, () => "value").join(",");
      const csv = `${headers}\n${data}`;
      const parsed = CSV.parse(csv);
      expect(parsed.columns).toEqual(1000);
    });

    it("should handle files with very long lines", () => {
      const longField = "x".repeat(100000);
      const parsed = CSV.parse(`field\n"${longField}"`);
      expect(parsed.data[0].field.length).toEqual(100000);
    });
  });

  describe("Option Combinations", () => {
    it("should handle trimWhitespace with custom quotes", () => {
      const parsed = CSV.parse(`'  value  ',normal`, {
        header: false,
        quote: "'",
        trimWhitespace: true,
      });
      expect(parsed.data[0]).toEqual(["  value  ", "normal"]);
    });

    it("should handle skipEmptyLines with comments", () => {
      const parsed = CSV.parse(`a,b\n\n# comment\n\n1,2`, {
        comments: true,
        skipEmptyLines: true,
      });
      expect(parsed.data.length).toEqual(1);
      expect(parsed.comments.length).toEqual(1);
    });

    it("should handle preview with header counting", () => {
      const parsed = CSV.parse(`a,b\n1,2\n3,4\n5,6`, { header: true, preview: 1 });
      expect(parsed.data.length).toEqual(1); // Should be 1 data row after header
    });
  });
});
