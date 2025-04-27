import { CSV } from "bun";
import { describe, expect, it } from "bun:test";

import large_dataset from "./large-dataset.csv" with { type: "text" };

describe("CSV", () => {
  describe("Basic Parsing", () => {
    it("should parse empty input", () => {
      const parsed = CSV.parse("");
      expect(parsed).toEqual([]);
    });

    it("should parse basic CSV", () => {
      const parsed = CSV.parse(`col1,col2
        value1, value2`);
      expect(parsed).toEqual([{ col1: "value1", col2: "value2" }]);
    });

    it("should parse unicode", () => {
      const parsed = CSV.parse(`col1,col2
フィグマ,ボールズ
🦔,🥟`);

      expect(parsed).toEqual([
        { col1: "フィグマ", col2: "ボールズ" },
        { col1: "🦔", col2: "🥟" },
      ]);
    });

    it("should handle weird-data", () => {
      const parsed = CSV.parse(
        `,somejunk,<! />
,nope,
yes,yup,yeah
ok,ok,ok!`,
      );

      expect(parsed).toEqual([
        { "": "", "somejunk": "nope", "<! />": "" },
        { "": "", "yes": "yup", "yeah": "" },
        { "": "", "ok": "ok", "ok!": "" },
      ]);
    });

    it("should parse large dataset", () => {
      const parsed = CSV.parse(large_dataset);

      expect(parsed.length).toBe(7768);

      expect(Object.keys(parsed[0])).toEqual([
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

      const random_line = parsed[1904];
      expect(random_line).toEqual({
        time: "2015-12-13T02:38:11.094Z",
        latitude: "37.0018",
        longitude: "-117.7611",
        depth: "0",
        mag: "0.6",
        magType: "ml",
        nst: "4",
        gap: "202.76",
        dmin: "0.249",
        rms: "0.0947",
        net: "nn",
        id: "nn00522405",
        updated: "2015-12-14T02:36:01.061Z",
        place: "50km ESE of Big Pine, California",
        type: "earthquake",
      });

      // Test that there are no empty rows
      expect(parsed.every(row => Object.values(row).some(v => v !== ""))).toBe(true);
    });
  });

  describe("Header Option", () => {
    it("should parse with header (default)", () => {
      const parsed = CSV.parse(`col1,col2
value1,value2`);
      expect(parsed).toEqual([{ col1: "value1", col2: "value2" }]);
    });

    it("should parse without header", () => {
      const parsed = CSV.parse(
        `col1,col2
value1, value2`,
        { header: false },
      );
      expect(parsed).toEqual([
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
      expect(parsed).toEqual([]);

      const parsedWithoutHeader = CSV.parse("ID,Name,Value", { header: false });
      expect(parsedWithoutHeader).toEqual([["ID", "Name", "Value"]]);
    });

    it("should handle quoted headers with delimiters", () => {
      const parsed = CSV.parse(
        `"ID","Name, Title","Value ($)"
1,"Smith, CEO",1000
2,"Doe, Manager",500`,
      );

      expect(parsed).toEqual([
        { "ID": "1", "Name, Title": "Smith, CEO", "Value ($)": "1000" },
        { "ID": "2", "Name, Title": "Doe, Manager", "Value ($)": "500" },
      ]);
    });
  });

  describe("Delimiter Option", () => {
    it("should parse CSV with comma delimiter (default)", () => {
      const parsed = CSV.parse(`col1,col2
value1,value2`);
      expect(parsed).toEqual([{ col1: "value1", col2: "value2" }]);
    });

    it("should parse CSV with pipe delimiter", () => {
      const parsed = CSV.parse(
        `col1|col2
value1|value2
value3|value4`,
        { delimiter: "|" },
      );

      expect(parsed).toEqual([
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

      expect(parsed).toEqual([
        { col1: "value1", col2: "value2", col3: "value3" },
        { col1: "value4", col2: "value5", col3: "value6" },
      ]);
    });

    it("should parse CSV with tab delimiter", () => {
      const parsed = CSV.parse("col1\tcol2\nvalue1\tvalue2", { delimiter: "\t" });
      expect(parsed).toEqual([{ col1: "value1", col2: "value2" }]);
    });

    it("should parse CSV with multibyte custom delimiter", () => {
      const parsed = CSV.parse(
        `col1🦔col2
value1🦔value2
value3🦔value4`,
        { delimiter: "🦔" },
      );

      expect(parsed).toEqual([
        { col1: "value1", col2: "value2" },
        { col1: "value3", col2: "value4" },
      ]);
    });

    it("should support multi-character delimiter", () => {
      const parsed = CSV.parse(`col1<=>col2\nvalue1<=>value2`, { delimiter: "<=>" });
      expect(parsed).toEqual([{ col1: "value1", col2: "value2" }]);
    });

    it("should handle quoted fields with multi-character delimiter", () => {
      const parsed = CSV.parse(`col1<=>col2\n"value with<=>delimiter"<=>value2`, { delimiter: "<=>" });
      expect(parsed).toEqual([{ col1: "value with<=>delimiter", col2: "value2" }]);
    });

    it("should support ASCII record separator (0x1E) as delimiter", () => {
      const RECORD_SEP = String.fromCharCode(30);
      const parsed = CSV.parse(`col1${RECORD_SEP}col2\nvalue1${RECORD_SEP}value2`, { delimiter: RECORD_SEP });
      expect(parsed).toEqual([{ col1: "value1", col2: "value2" }]);
    });

    it("should support ASCII unit separator (0x1F) as delimiter", () => {
      const UNIT_SEP = String.fromCharCode(31);
      const parsed = CSV.parse(`col1${UNIT_SEP}col2\nvalue1${UNIT_SEP}value2`, { delimiter: UNIT_SEP });
      expect(parsed).toEqual([{ col1: "value1", col2: "value2" }]);
    });

    it("should handle delimiter in quotes", () => {
      const parsed = CSV.parse(`col1,col2
normal value,"here we quote , in the field"
foo,bar`);

      expect(parsed).toEqual([
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

      expect(parsed).toEqual([{ col1: "value1", col2: "value2" }]);
    });

    it("should handle quotes in quotes", () => {
      const parsed = CSV.parse(
        `col1,col2
"value1, value2","value3, value4"`,
      );

      expect(parsed).toEqual([{ col1: `value1, value2`, col2: `value3, value4` }]);
    });

    it("should handle escaped quotes", () => {
      const parsed = CSV.parse(
        `col1,col2
"value1, ""with quotes""","value2"`,
      );

      expect(parsed).toEqual([{ col1: `value1, "with quotes"`, col2: "value2" }]);
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

      expect(parsed).toEqual([
        { a: "1", b: 'ha \n"ha" \nha' },
        { a: "2", b: ' \n"' },
        { a: "3", b: "4" },
      ]);
    });

    it("should handle custom quote character", () => {
      const parsed = CSV.parse(
        `col1,col2
'value1,with comma','value2'`,
        { quote: "'" },
      );

      expect(parsed).toEqual([{ col1: "value1,with comma", col2: "value2" }]);
    });

    it("should handle quotes with spaces between closing quote and delimiter", () => {
      const parsed = CSV.parse(`a,"b" ,c`, { header: false });
      expect(parsed).toEqual([["a", "b", "c"]]);
    });

    it("should handle misplaced quotes in data", () => {
      const parsed = CSV.parse(`a,b "b",c`, { header: false });
      expect(parsed).toEqual([["a", 'b "b"', "c"]]);
    });

    it("should handle quoted fields with quotes around delimiters", () => {
      const parsed = CSV.parse(`a,""",""",c`, { header: false });
      expect(parsed).toEqual([["a", '","', "c"]]);
    });

    it("should handle quoted fields with 5 quotes in a row and delimiter", () => {
      const parsed = CSV.parse(`"1","cnonce="""",nc=""""","2"`, { header: false });
      expect(parsed).toEqual([["1", 'cnonce="",nc=""', "2"]]);
    });

    it("should handle even number of quotes", () => {
      const parsed = CSV.parse(`""""""`, { header: false });
      expect(parsed).toEqual([['"""']]);
    });

    it("should handle misplaced quotes in multiple rows", () => {
      const parsed = CSV.parse(`a,b",c\nd,e",f`, { header: false });
      expect(parsed).toEqual([
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
      expect(parsed).toEqual([
        ["a", "b", "c,c\nc"],
        ["d", "e", "f"],
      ]);
    });

    it("should handle quotes on boundaries of fields", () => {
      const parsed = CSV.parse(`a,"""b""",c`, { header: false });
      expect(parsed).toEqual([["a", '"b"', "c"]]);
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

      expect(parsed).toEqual([
        { col1: "   value1   ", col2: "   value2   " },
        { col1: "\tvalue3\t", col2: "\tvalue4\t" },
      ]);
    });

    it("should trim whitespace when option is enabled", () => {
      const parsed = CSV.parse(
        `col1,col2
   value1   ,   value2   `,
        { trim_whitespace: true },
      );

      expect(parsed).toEqual([{ col1: "value1", col2: "value2" }]);
    });

    it("should trim trailing whitespace after quotes", () => {
      const parsed = CSV.parse(
        `col1,col2
"value1"  ,"value2"  `,
        { trim_whitespace: true },
      );

      expect(parsed).toEqual([{ col1: "value1", col2: "value2" }]);
    });

    it("should preserve whitespace around quoted strings without trim option", () => {
      const parsed = CSV.parse('a, "b" ,c', { header: false });
      expect(parsed).toEqual([["a", ' "b" ', "c"]]);
    });

    it("should handle lines with whitespace only", () => {
      const parsed = CSV.parse("a,b,c\n    \nd,e,f", { header: true });
      expect(parsed).toEqual([
        { a: "    ", b: "", c: "" },
        { a: "d", b: "e", c: "f" },
      ]);
    });

    it("should correctly handle fields with only spaces", () => {
      const parsed = CSV.parse("a,b,c\n , ,d");
      expect(parsed).toEqual([{ a: " ", b: " ", c: "d" }]);
    });

    it("should handle whitespace at edges of unquoted fields", () => {
      const parsed = CSV.parse("a,  b  ,c", { header: false });
      expect(parsed).toEqual([["a", "  b  ", "c"]]);
    });
  });

  describe("Line Endings", () => {
    it("should handle LF line endings (default)", () => {
      const parsed = CSV.parse("a,b,c\nd,e,f");
      expect(parsed).toEqual([{ a: "d", b: "e", c: "f" }]);
    });

    it("should handle CRLF line endings", () => {
      const parsed = CSV.parse("a,b,c\r\nd,e,f");
      expect(parsed).toEqual([{ a: "d", b: "e", c: "f" }]);
    });

    it("should handle CR only line endings", () => {
      const parsed = CSV.parse("a,b,c\rd,e,f");
      expect(parsed).toEqual([{ a: "d", b: "e", c: "f" }]);
    });

    it("should handle mixed line endings", () => {
      const parsed = CSV.parse("a,b,c\r\nd,e,f\rg,h,i\n");
      expect(parsed).toEqual([
        { a: "d", b: "e", c: "f" },
        { a: "g", b: "h", c: "i" },
      ]);
    });

    it("should handle quoted field with CRLF", () => {
      const parsed = CSV.parse('a,b,c\n1,"line 1\r\nline 2",3');
      expect(parsed).toEqual([{ a: "1", b: "line 1\r\nline 2", c: "3" }]);
    });

    it("should handle quoted field with CR", () => {
      const parsed = CSV.parse('a,b,c\n1,"line 1\rline 2",3');
      expect(parsed).toEqual([{ a: "1", b: "line 1\rline 2", c: "3" }]);
    });

    it("should handle newlines in quoted fields", () => {
      const parsed = CSV.parse(`a,b,c
1,2,3
"Once upon 
a time",5,6
7,8,9
`);
      expect(parsed).toEqual([
        { a: "1", b: "2", c: "3" },
        { a: "Once upon \na time", b: "5", c: "6" },
        { a: "7", b: "8", c: "9" },
      ]);
    });

    it("should handle trailing newlines", () => {
      const parsed = CSV.parse(`a,b,c
1,2,3

`);
      expect(parsed).toEqual([{ a: "1", b: "2", c: "3" }]);

      const parsedWithHeader = CSV.parse(
        `a,b,c
1,2,3

`,
        { header: false },
      );
      expect(parsedWithHeader).toEqual([
        ["a", "b", "c"],
        ["1", "2", "3"],
      ]);
    });
  });

  describe("Empty Field Handling", () => {
    it("should include empty columns", () => {
      const parsed = CSV.parse(`a,,c
1,,3
`);

      expect(parsed).toEqual([
        { a: "1", "": "", c: "3" },
        { a: "", "": "", c: "" },
      ]);
    });

    it("should include empty columns (no header)", () => {
      const parsed = CSV.parse(
        `a,,c
1,,3
`,
        { header: false },
      );

      expect(parsed).toEqual([
        ["a", "", "c"],
        ["1", "", "3"],
      ]);
    });

    it("should handle input that is just the delimiter", () => {
      const parsed = CSV.parse(",", { header: false });
      expect(parsed).toEqual([["", ""]]);
    });

    it("should handle input with just empty fields", () => {
      const parsed = CSV.parse(",,\n,,,", { header: false });
      expect(parsed).toEqual([
        ["", "", ""],
        ["", "", "", ""],
      ]);
    });

    it("should handle trailing empty fields", () => {
      const parsed = CSV.parse("a,b,c,\n1,2,3,", { header: false });
      expect(parsed).toEqual([
        ["a", "b", "c", ""],
        ["1", "2", "3", ""],
      ]);
    });

    it("should handle input with first field empty in multiple rows", () => {
      const parsed = CSV.parse(",b,c\n,e,f", { header: false });
      expect(parsed).toEqual([
        ["", "b", "c"],
        ["", "e", "f"],
      ]);
    });
  });

  describe("Comments Option", () => {
    it("should handle comments when enabled", () => {
      const parsed = CSV.parse(
        `col1,col2
# comment
a,b,c
1,2,3`,
        { comments: true },
      );

      expect(parsed).toEqual([
        { col1: "a", col2: "b", col3: "c" },
        { col1: "1", col2: "2", col3: "3" },
      ]);
    });

    it("should ignore comments when disabled", () => {
      const parsed = CSV.parse(
        `col1,col2
# comment
a,b,c
1,2,3`,
        { comments: false },
      );

      expect(parsed).toEqual([
        { col1: "a", col2: "b", col3: "c" },
        { col1: "1", col2: "2", col3: "3" },
      ]);
    });

    it("should handle entire file being comments", () => {
      const parsed = CSV.parse(`# Comment 1\n# Comment 2\n# Comment 3`, { comments: true });
      expect(parsed).toEqual([]);
    });

    it("should handle multiple consecutive comment lines", () => {
      const parsed = CSV.parse(`a,b,c\n#comment1\n#comment2\nd,e,f`, { comments: true });
      expect(parsed).toEqual([{ a: "d", b: "e", c: "f" }]);
    });

    it("should handle comments at the end of file", () => {
      const parsed = CSV.parse(`a,b,c\n1,2,3\n# Comment`, { comments: true });
      expect(parsed).toEqual([{ a: "1", b: "2", c: "3" }]);
    });
  });

  describe("Row Preview Option", () => {
    it("should parse only the specified number of rows", () => {
      const parsed = CSV.parse(`a,b,c\n1,2,3\n4,5,6\n7,8,9`, { preview: 2 });
      expect(parsed).toEqual([
        { a: "1", b: "2", c: "3" },
        { a: "4", b: "5", c: "6" },
      ]);
    });

    it("should parse all rows if preview is 0", () => {
      const parsed = CSV.parse(`a,b,c\n1,2,3\n4,5,6\n7,8,9`, { preview: 0 });
      expect(parsed).toEqual([
        { a: "1", b: "2", c: "3" },
        { a: "4", b: "5", c: "6" },
        { a: "7", b: "8", c: "9" },
      ]);
    });

    it("should count rows, not lines for preview with multiline fields", () => {
      const parsed = CSV.parse(`a,b,c\n1,"multiline\nfield",3\n4,5,6\n7,8,9`, { preview: 2 });
      expect(parsed).toEqual([
        { a: "1", b: "multiline\nfield", c: "3" },
        { a: "4", b: "5", c: "6" },
      ]);
    });

    it("should handle preview with just header row", () => {
      const parsed = CSV.parse("a,b,c", { preview: 1 });
      expect(parsed).toEqual([]);
    });
  });

  describe("Type Inference", () => {
    it("should infer numeric values", () => {
      const parsed = CSV.parse(
        `num1,num2,num3,str
123,-456,78.9,"123"`,
        { infer: true },
      );

      expect(parsed).toEqual([{ num1: 123, num2: -456, num3: 78.9, str: "123" }]);
    });

    it("should infer boolean values", () => {
      const parsed = CSV.parse(
        `bool1,bool2,str1,str2
true,false,"true","false"`,
        { infer: true },
      );

      expect(parsed).toEqual([{ bool1: true, bool2: false, str1: "true", str2: "false" }]);
    });

    it("should infer null values", () => {
      const parsed = CSV.parse(
        `val1,val2,val3
null,NULL,"null"`,
        { infer: true },
      );

      expect(parsed).toEqual([{ val1: null, val2: null, val3: "null" }]);
    });

    it("should not infer non-finite numeric values", () => {
      const parsed = CSV.parse(
        `val1,val2,val3
NaN,Infinity,-Infinity`,
        { infer: true },
      );

      expect(parsed).toEqual([{ val1: "NaN", val2: "Infinity", val3: "-Infinity" }]);
    });

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

    //       expect(parsed).toEqual([{ val1: false, val2: true, val3: "0", val4: "1" }]);
    //     });
  });

  describe("Inconsistent Columns", () => {
    it("should error on inconsistent columns with header", () => {
      expect(() => {
        CSV.parse(`col1,col2,col3
  value1,value2
  value3,value4,value5,value6`);
      }).toThrow(/Record on line 2 has 2 fields, but header has 3 fields/i);
    });

    it("should allow inconsistent columns without header", () => {
      const parsed = CSV.parse(
        `row1col1,row1col2,row1col3
  row2col1,row2col2
  row3col1,row3col2,row3col3,row3col4`,
        { header: false },
      );

      expect(parsed).toEqual([
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

      expect(parsed).toEqual([
        [],
        ["row1col1", "row1col2", "row1col3"],
        ["row2col1", "row2col2"],
        [],
        ["row4col1", "row4col2", "row4col3", "row4col4"],
      ]);
    });
  });
});
