// Tests translated from official yaml-test-suite
// Generated from yaml-test-suite commit: 6e6c296ae9c9d2d5c4134b4b64d01b29ac19ff6f
// Using YAML.parse() with eemeli/yaml package as reference
// Total: 402 test directories

import { YAML } from "bun";
import { expect, test } from "bun:test";

test("yaml-test-suite/229Q", () => {
  // Spec Example 2.4. Sequence of Mappings
  const input: string = `-
  name: Mark McGwire
  hr:   65
  avg:  0.278
-
  name: Sammy Sosa
  hr:   63
  avg:  0.288
`;

  const parsed = YAML.parse(input);

  const expected: any = [
    { name: "Mark McGwire", hr: 65, avg: 0.278 },
    { name: "Sammy Sosa", hr: 63, avg: 0.288 },
  ];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/236B", () => {
  // Invalid value after mapping
  // Error test - expecting parse to fail
  const input: string = `foo:
  bar
invalid
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/26DV", () => {
  // Whitespace around colon in mappings
  const input: string = `"top1" : 
  "key1" : &alias1 scalar1
'top2' : 
  'key2' : &alias2 scalar2
top3: &node3 
  *alias1 : scalar3
top4: 
  *alias2 : scalar4
top5   :    
  scalar5
top6: 
  &anchor6 'key6' : scalar6
`;

  const parsed = YAML.parse(input);

  // This YAML has anchors and aliases - creating shared references

  // Detected anchors that are referenced: alias2, alias1

  const expected: any = {
    top1: { key1: "scalar1" },
    top2: { key2: "scalar2" },
    top3: { scalar1: "scalar3" },
    top4: { scalar2: "scalar4" },
    top5: "scalar5",
    top6: { key6: "scalar6" },
  };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/27NA", () => {
  // Spec Example 5.9. Directive Indicator
  const input: string = `%YAML 1.2
--- text
`;

  const parsed = YAML.parse(input);

  const expected: any = "text";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/2AUY", () => {
  // Tags in Block Sequence
  const input: string = ` - !!str a
 - b
 - !!int 42
 - d
`;

  const parsed = YAML.parse(input);

  const expected: any = ["a", "b", 42, "d"];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/2CMS", () => {
  // Invalid mapping in plain multiline
  // Error test - expecting parse to fail
  const input: string = `this
 is
  invalid: x
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/2EBW", () => {
  // Allowed characters in keys
  const input: string =
    "a!\"#$%&'()*+,-./09:;<=>?@AZ[\\]^_`az{|}~: safe\n?foo: safe question mark\n:foo: safe colon\n-foo: safe dash\nthis is#not: a comment\n";

  const parsed = YAML.parse(input);

  // This YAML has anchors and aliases - creating shared references

  const expected: any = {
    "a!\"#$%&'()*+,-./09:;<=>?@AZ[\\]^_`az{|}~": "safe",
    "?foo": "safe question mark",
    ":foo": "safe colon",
    "-foo": "safe dash",
    "this is#not": "a comment",
  };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/2G84/00", () => {
  // Literal modifers
  // Error test - expecting parse to fail
  const input: string = `--- |0
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/2G84/01", () => {
  // Literal modifers
  // Error test - expecting parse to fail
  const input: string = `--- |10
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/2G84/02", () => {
  // Literal modifers
  const input: string = "--- |1-";

  const parsed = YAML.parse(input);

  const expected: any = "";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/2G84/03", () => {
  // Literal modifers
  const input: string = "--- |1+";

  const parsed = YAML.parse(input);

  const expected: any = "";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/2JQS", () => {
  // Block Mapping with Missing Keys (using test.event for expected values)
  const input: string = `: a
: b
`;

  const parsed = YAML.parse(input);

  const expected: any = { null: "b" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/2LFX", () => {
  // Spec Example 6.13. Reserved Directives [1.3]
  const input: string = `%FOO  bar baz # Should be ignored
              # with a warning.
---
"foo"
`;

  const parsed = YAML.parse(input);

  const expected: any = "foo";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/2SXE", () => {
  // Anchors With Colon in Name
  // Note: &a anchors the key "key" itself, *a references that string
  const input: string = `&a: key: &a value
foo:
  *a:
`;

  const parsed = YAML.parse(input);

  const expected: any = { key: "value", foo: "key" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/2XXW", () => {
  // Spec Example 2.25. Unordered Sets
  const input: string = `# Sets are represented as a
# Mapping where each key is
# associated with a null value
--- !!set
? Mark McGwire
? Sammy Sosa
? Ken Griff
`;

  const parsed = YAML.parse(input);

  const expected: any = { "Mark McGwire": null, "Sammy Sosa": null, "Ken Griff": null };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/33X3", () => {
  // Three explicit integers in a block sequence
  const input: string = `---
- !!int 1
- !!int -2
- !!int 33
`;

  const parsed = YAML.parse(input);

  const expected: any = [1, -2, 33];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/35KP", () => {
  // Tags for Root Objects
  const input: string = `--- !!map
? a
: b
--- !!seq
- !!str c
--- !!str
d
e
`;

  const parsed = YAML.parse(input);

  const expected: any = [{ a: "b" }, ["c"], "d e"];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/36F6", () => {
  // Multiline plain scalar with empty line
  const input: string = `---
plain: a
 b

 c
`;

  const parsed = YAML.parse(input);

  const expected: any = { plain: "a b\nc" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/3ALJ", () => {
  // Block Sequence in Block Sequence
  const input: string = `- - s1_i1
  - s1_i2
- s2
`;

  const parsed = YAML.parse(input);

  const expected: any = [["s1_i1", "s1_i2"], "s2"];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/3GZX", () => {
  // Spec Example 7.1. Alias Nodes
  const input: string = `First occurrence: &anchor Foo
Second occurrence: *anchor
Override anchor: &anchor Bar
Reuse anchor: *anchor
`;

  const parsed = YAML.parse(input);

  // This YAML has anchors and aliases - creating shared references

  // Detected anchors that are referenced: anchor

  const expected: any = {
    "First occurrence": "Foo",
    "Second occurrence": "Foo",
    "Override anchor": "Bar",
    "Reuse anchor": "Bar",
  };

  expect(parsed).toEqual(expected);

  // Verify shared references
  expect((parsed as any)["occurrence"]).toBe((parsed as any)["anchor"]);
});

test("yaml-test-suite/3HFZ", () => {
  // Invalid content after document end marker
  // Error test - expecting parse to fail
  const input: string = `---
key: value
... invalid
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/3MYT", () => {
  // Plain Scalar looking like key, comment, anchor and tag
  const input: string = `---
k:#foo
 &a !t s
`;

  const parsed = YAML.parse(input);

  const expected: any = "k:#foo &a !t s";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/3R3P", () => {
  // Single block sequence with anchor
  const input: string = `&sequence
- a
`;

  const parsed = YAML.parse(input);

  const expected: any = ["a"];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/3RLN/00", () => {
  // Leading tabs in double quoted
  const input: string = `"1 leading
    \\ttab"
`;

  const parsed = YAML.parse(input);

  const expected: any = "1 leading \ttab";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/3RLN/01", () => {
  // Leading tabs in double quoted
  const input: string = `"2 leading
    \\	tab"
`;

  const parsed = YAML.parse(input);

  const expected: any = "2 leading \ttab";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/3RLN/02", () => {
  // Leading tabs in double quoted
  const input: string = `"3 leading
    	tab"
`;

  const parsed = YAML.parse(input);

  const expected: any = "3 leading tab";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/3RLN/03", () => {
  // Leading tabs in double quoted
  const input: string = `"4 leading
    \\t  tab"
`;

  const parsed = YAML.parse(input);

  const expected: any = "4 leading \t  tab";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/3RLN/04", () => {
  // Leading tabs in double quoted
  const input: string = `"5 leading
    \\	  tab"
`;

  const parsed = YAML.parse(input);

  const expected: any = "5 leading \t  tab";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/3RLN/05", () => {
  // Leading tabs in double quoted
  const input: string = `"6 leading
    	  tab"
`;

  const parsed = YAML.parse(input);

  const expected: any = "6 leading tab";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/3UYS", () => {
  // Escaped slash in double quotes
  const input: string = `escaped slash: "a\\/b"
`;

  const parsed = YAML.parse(input);

  const expected: any = { "escaped slash": "a/b" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/4ABK", () => {
  // Flow Mapping Separate Values (using test.event for expected values)
  const input: string = `{
unquoted : "separate",
http://foo.com,
omitted value:,
}
`;

  const parsed = YAML.parse(input);

  const expected: any = { unquoted: "separate", "http://foo.com": null, "omitted value": null };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/4CQQ", () => {
  // Spec Example 2.18. Multi-line Flow Scalars
  const input: string = `plain:
  This unquoted scalar
  spans many lines.

quoted: "So does this
  quoted scalar.\\n"
`;

  const parsed = YAML.parse(input);

  const expected: any = { plain: "This unquoted scalar spans many lines.", quoted: "So does this quoted scalar.\n" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/4EJS", () => {
  // Invalid tabs as indendation in a mapping
  // Error test - expecting parse to fail
  const input: string = `---
a:
	b:
		c: value
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test.todo("yaml-test-suite/4FJ6", () => {
  // Nested implicit complex keys (using test.event for expected values)
  const input: string = `---
[
  [ a, [ [[b,c]]: d, e]]: 23
]
`;

  const parsed = YAML.parse(input);

  const expected: any = [
    { "[\n  a,\n  [\n      {\n          ? [ [ b, c ] ]\n          : d\n        },\n      e\n    ]\n]": 23 },
  ];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/4GC6", () => {
  // Spec Example 7.7. Single Quoted Characters
  const input: string = `'here''s to "quotes"'
`;

  const parsed = YAML.parse(input);

  const expected: any = 'here\'s to "quotes"';

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/4H7K", () => {
  // Flow sequence with invalid extra closing bracket
  // Error test - expecting parse to fail
  const input: string = `---
[ a, b, c ] ]
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/4HVU", () => {
  // Wrong indendation in Sequence
  // Error test - expecting parse to fail
  const input: string = `key:
   - ok
   - also ok
  - wrong
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/4JVG", () => {
  // Scalar value with two anchors
  // Error test - expecting parse to fail
  const input: string = `top1: &node1
  &k1 key1: val1
top2: &node2
  &v2 val2
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/4MUZ/00", () => {
  // Flow mapping colon on line after key
  const input: string = `{"foo"
: "bar"}
`;

  const parsed = YAML.parse(input);

  const expected: any = { foo: "bar" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/4MUZ/01", () => {
  // Flow mapping colon on line after key
  const input: string = `{"foo"
: bar}
`;

  const parsed = YAML.parse(input);

  const expected: any = { foo: "bar" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/4MUZ/02", () => {
  // Flow mapping colon on line after key
  const input: string = `{foo
: bar}
`;

  const parsed = YAML.parse(input);

  const expected: any = { foo: "bar" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/4Q9F", () => {
  // Folded Block Scalar [1.3]
  const input: string = `--- >
 ab
 cd
 
 ef


 gh
`;

  const parsed = YAML.parse(input);

  const expected: any = "ab cd\nef\n\ngh\n";

  expect(parsed).toEqual(expected);
});

test.todo("yaml-test-suite/4QFQ", () => {
  // Spec Example 8.2. Block Indentation Indicator [1.3]
  const input: string = `- |
 detected
- >
 
  
  # detected
- |1
  explicit
- >
 detected
`;

  const parsed = YAML.parse(input);

  const expected: any = ["detected\n", "\n\n# detected\n", " explicit\n", "detected\n"];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/4RWC", () => {
  // Trailing spaces after flow collection
  const input: string = `  [1, 2, 3]  
  `;

  const parsed = YAML.parse(input);

  const expected: any = [1, 2, 3];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/4UYU", () => {
  // Colon in Double Quoted String
  const input: string = `"foo: bar\\": baz"
`;

  const parsed = YAML.parse(input);

  const expected: any = 'foo: bar": baz';

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/4V8U", () => {
  // Plain scalar with backslashes
  const input: string = `---
plain\\value\\with\\backslashes
`;

  const parsed = YAML.parse(input);

  const expected: any = "plain\\value\\with\\backslashes";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/4WA9", () => {
  // Literal scalars
  const input: string = `- aaa: |2
    xxx
  bbb: |
    xxx
`;

  const parsed = YAML.parse(input);

  const expected: any = [{ aaa: "xxx\n", bbb: "xxx\n" }];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/4ZYM", () => {
  // Spec Example 6.4. Line Prefixes
  const input: string = `plain: text
  lines
quoted: "text
  	lines"
block: |
  text
   	lines
`;

  const parsed = YAML.parse(input);

  const expected: any = { plain: "text lines", quoted: "text lines", block: "text\n \tlines\n" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/52DL", () => {
  // Explicit Non-Specific Tag [1.3]
  const input: string = `---
! a
`;

  const parsed = YAML.parse(input);

  const expected: any = "a";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/54T7", () => {
  // Flow Mapping
  const input: string = `{foo: you, bar: far}
`;

  const parsed = YAML.parse(input);

  const expected: any = { foo: "you", bar: "far" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/55WF", () => {
  // Invalid escape in double quoted string
  // Error test - expecting parse to fail
  const input: string = `---
"\\."
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/565N", () => {
  // Construct Binary
  const input: string = `canonical: !!binary "\\
 R0lGODlhDAAMAIQAAP//9/X17unp5WZmZgAAAOfn515eXvPz7Y6OjuDg4J+fn5\\
 OTk6enp56enmlpaWNjY6Ojo4SEhP/++f/++f/++f/++f/++f/++f/++f/++f/+\\
 +f/++f/++f/++f/++f/++SH+Dk1hZGUgd2l0aCBHSU1QACwAAAAADAAMAAAFLC\\
 AgjoEwnuNAFOhpEMTRiggcz4BNJHrv/zCFcLiwMWYNG84BwwEeECcgggoBADs="
generic: !!binary |
 R0lGODlhDAAMAIQAAP//9/X17unp5WZmZgAAAOfn515eXvPz7Y6OjuDg4J+fn5
 OTk6enp56enmlpaWNjY6Ojo4SEhP/++f/++f/++f/++f/++f/++f/++f/++f/+
 +f/++f/++f/++f/++f/++SH+Dk1hZGUgd2l0aCBHSU1QACwAAAAADAAMAAAFLC
 AgjoEwnuNAFOhpEMTRiggcz4BNJHrv/zCFcLiwMWYNG84BwwEeECcgggoBADs=
description:
 The binary value above is a tiny arrow encoded as a gif image.
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    canonical:
      "R0lGODlhDAAMAIQAAP//9/X17unp5WZmZgAAAOfn515eXvPz7Y6OjuDg4J+fn5OTk6enp56enmlpaWNjY6Ojo4SEhP/++f/++f/++f/++f/++f/++f/++f/++f/++f/++f/++f/++f/++f/++SH+Dk1hZGUgd2l0aCBHSU1QACwAAAAADAAMAAAFLCAgjoEwnuNAFOhpEMTRiggcz4BNJHrv/zCFcLiwMWYNG84BwwEeECcgggoBADs=",
    generic:
      "R0lGODlhDAAMAIQAAP//9/X17unp5WZmZgAAAOfn515eXvPz7Y6OjuDg4J+fn5\nOTk6enp56enmlpaWNjY6Ojo4SEhP/++f/++f/++f/++f/++f/++f/++f/++f/+\n+f/++f/++f/++f/++f/++SH+Dk1hZGUgd2l0aCBHSU1QACwAAAAADAAMAAAFLC\nAgjoEwnuNAFOhpEMTRiggcz4BNJHrv/zCFcLiwMWYNG84BwwEeECcgggoBADs=\n",
    description: "The binary value above is a tiny arrow encoded as a gif image.",
  };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/57H4", () => {
  // Spec Example 8.22. Block Collection Nodes
  const input: string = `sequence: !!seq
- entry
- !!seq
 - nested
mapping: !!map
 foo: bar
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    sequence: ["entry", ["nested"]],
    mapping: { foo: "bar" },
  };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/58MP", () => {
  // Flow mapping edge cases
  const input: string = `{x: :x}
`;

  const parsed = YAML.parse(input);

  const expected: any = { x: ":x" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/5BVJ", () => {
  // Spec Example 5.7. Block Scalar Indicators
  const input: string = `literal: |
  some
  text
folded: >
  some
  text
`;

  const parsed = YAML.parse(input);

  const expected: any = { literal: "some\ntext\n", folded: "some text\n" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/5C5M", () => {
  // Spec Example 7.15. Flow Mappings
  const input: string = `- { one : two , three: four , }
- {five: six,seven : eight}
`;

  const parsed = YAML.parse(input);

  const expected: any = [
    { one: "two", three: "four" },
    { five: "six", seven: "eight" },
  ];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/5GBF", () => {
  // Spec Example 6.5. Empty Lines
  const input: string = `Folding:
  "Empty line
   	
  as a line feed"
Chomping: |
  Clipped empty lines
 

`;

  const parsed = YAML.parse(input);

  const expected: any = { Folding: "Empty line\nas a line feed", Chomping: "Clipped empty lines\n" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/5KJE", () => {
  // Spec Example 7.13. Flow Sequence
  const input: string = `- [ one, two, ]
- [three ,four]
`;

  const parsed = YAML.parse(input);

  const expected: any = [
    ["one", "two"],
    ["three", "four"],
  ];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/5LLU", () => {
  // Block scalar with wrong indented line after spaces only
  // Error test - expecting parse to fail
  const input: string = `block scalar: >
 
  
   
 invalid
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/5MUD", () => {
  // Colon and adjacent value on next line
  const input: string = `---
{ "foo"
  :bar }
`;

  const parsed = YAML.parse(input);

  const expected: any = { foo: "bar" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/5NYZ", () => {
  // Spec Example 6.9. Separated Comment
  const input: string = `key:    # Comment
  value
`;

  const parsed = YAML.parse(input);

  const expected: any = { key: "value" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/5T43", () => {
  // Colon at the beginning of adjacent flow scalar
  const input: string = `- { "key":value }
- { "key"::value }
`;

  const parsed = YAML.parse(input);

  const expected: any = [{ key: "value" }, { key: ":value" }];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/5TRB", () => {
  // Invalid document-start marker in doublequoted tring
  // Error test - expecting parse to fail
  const input: string = `---
"
---
"
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/5TYM", () => {
  // Spec Example 6.21. Local Tag Prefix
  const input: string = `%TAG !m! !my-
--- # Bulb here
!m!light fluorescent
...
%TAG !m! !my-
--- # Color here
!m!light green
`;

  const parsed = YAML.parse(input);

  const expected: any = ["fluorescent", "green"];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/5U3A", () => {
  // Sequence on same Line as Mapping Key
  // Error test - expecting parse to fail
  const input: string = `key: - a
     - b
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test.todo("yaml-test-suite/5WE3", () => {
  // Spec Example 8.17. Explicit Block Mapping Entries
  const input: string = `? explicit key # Empty value
? |
  block key
: - one # Explicit compact
  - two # block value
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    "explicit key": null,
    "block key\n": ["one", "two"],
  };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/62EZ", () => {
  // Invalid block mapping key on same line as previous key
  // Error test - expecting parse to fail
  const input: string = `---
x: { y: z }in: valid
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/652Z", () => {
  // Question mark at start of flow key
  const input: string = `{ ?foo: bar,
bar: 42
}
`;

  const parsed = YAML.parse(input);

  const expected: any = { "?foo": "bar", bar: 42 };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/65WH", () => {
  // Single Entry Block Sequence
  const input: string = `- foo
`;

  const parsed = YAML.parse(input);

  const expected: any = ["foo"];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/6BCT", () => {
  // Spec Example 6.3. Separation Spaces
  const input: string = `- foo:	 bar
- - baz
  -	baz
`;

  const parsed = YAML.parse(input);

  const expected: any = [{ foo: "bar" }, ["baz", "baz"]];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/6BFJ", () => {
  // Mapping, key and flow sequence item anchors (using test.event for expected values)
  const input: string = `---
&mapping
&key [ &item a, b, c ]: value
`;

  const parsed = YAML.parse(input);

  const expected: any = { "a,b,c": "value" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/6CA3", () => {
  // Tab indented top flow
  const input: string = `	[
	]
`;

  const parsed = YAML.parse(input);

  const expected: any = [];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/6CK3", () => {
  // Spec Example 6.26. Tag Shorthands
  const input: string = `%TAG !e! tag:example.com,2000:app/
---
- !local foo
- !!str bar
- !e!tag%21 baz
`;

  const parsed = YAML.parse(input);

  const expected: any = ["foo", "bar", "baz"];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/6FWR", () => {
  // Block Scalar Keep
  const input: string = `--- |+
 ab
 
  
...
`;

  const parsed = YAML.parse(input);

  const expected: any = "ab\n\n \n";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/6H3V", () => {
  // Backslashes in singlequotes
  const input: string = `'foo: bar\\': baz'
`;

  const parsed = YAML.parse(input);

  const expected: any = { "foo: bar\\": "baz'" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/6HB6", () => {
  // Spec Example 6.1. Indentation Spaces
  const input: string = `  # Leading comment line spaces are
   # neither content nor indentation.
    
Not indented:
 By one space: |
    By four
      spaces
 Flow style: [    # Leading spaces
   By two,        # in flow style
  Also by two,    # are neither
  	Still by two   # content nor
    ]             # indentation.
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    "Not indented": {
      "By one space": "By four\n  spaces\n",
      "Flow style": ["By two", "Also by two", "Still by two"],
    },
  };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/6JQW", () => {
  // Spec Example 2.13. In literals, newlines are preserved
  const input: string = `# ASCII Art
--- |
  \\//||\\/||
  // ||  ||__
`;

  const parsed = YAML.parse(input);

  const expected: any = "\\//||\\/||\n// ||  ||__\n";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/6JTT", () => {
  // Flow sequence without closing bracket
  // Error test - expecting parse to fail
  const input: string = `---
[ [ a, b, c ]
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/6JWB", () => {
  // Tags for Block Objects
  const input: string = `foo: !!seq
  - !!str a
  - !!map
    key: !!str value
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    foo: ["a", { key: "value" }],
  };

  expect(parsed).toEqual(expected);
});

test.todo("yaml-test-suite/6KGN", () => {
  // Anchor for empty node
  const input: string = `---
a: &anchor
b: *anchor
`;

  const parsed = YAML.parse(input);

  // This YAML has anchors and aliases - creating shared references

  // Detected anchors that are referenced: anchor

  const expected: any = { a: null, b: null };

  expect(parsed).toEqual(expected);

  // Verify shared references
  expect((parsed as any)["a"]).toBe((parsed as any)["b"]);
});

test("yaml-test-suite/6LVF", () => {
  // Spec Example 6.13. Reserved Directives
  const input: string = `%FOO  bar baz # Should be ignored
              # with a warning.
--- "foo"
`;

  const parsed = YAML.parse(input);

  const expected: any = "foo";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/6M2F", () => {
  // Aliases in Explicit Block Mapping (using test.event for expected values)
  const input: string = `? &a a
: &b b
: *a
`;

  const parsed = YAML.parse(input);

  // This YAML has anchors and aliases - creating shared references

  // Detected anchors that are referenced: a

  const expected: any = { a: "b", null: "a" };

  expect(parsed).toEqual(expected);
});

test.todo("yaml-test-suite/6PBE", () => {
  // Zero-indented sequences in explicit mapping keys (using test.event for expected values)
  const input: string = `---
?
- a
- b
:
- c
- d
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    "a,b": ["c", "d"],
  };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/6S55", () => {
  // Invalid scalar at the end of sequence
  // Error test - expecting parse to fail
  const input: string = `key:
 - bar
 - baz
 invalid
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/6SLA", () => {
  // Allowed characters in quoted mapping key
  const input: string = `"foo\\nbar:baz\\tx \\\\$%^&*()x": 23
'x\\ny:z\\tx $%^&*()x': 24
`;

  const parsed = YAML.parse(input);

  // This YAML has anchors and aliases - creating shared references

  const expected: any = { "foo\nbar:baz\tx \\$%^&*()x": 23, "x\\ny:z\\tx $%^&*()x": 24 };

  expect(parsed).toEqual(expected);
});

test.todo("yaml-test-suite/6VJK", () => {
  // Spec Example 2.15. Folded newlines are preserved for "more indented" and blank lines
  const input: string = `>
 Sammy Sosa completed another
 fine season with great stats.

   63 Home Runs
   0.288 Batting Average

 What a year!
`;

  const parsed = YAML.parse(input);

  const expected: any =
    "Sammy Sosa completed another fine season with great stats.\n\n  63 Home Runs\n  0.288 Batting Average\n\nWhat a year!\n";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/6WLZ", () => {
  // Spec Example 6.18. Primary Tag Handle [1.3]
  const input: string = `# Private
---
!foo "bar"
...
# Global
%TAG ! tag:example.com,2000:app/
---
!foo "bar"
`;

  const parsed = YAML.parse(input);

  const expected: any = ["bar", "bar"];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/6WPF", () => {
  // Spec Example 6.8. Flow Folding [1.3]
  const input: string = `---
"
  foo 
 
    bar

  baz
"
`;

  const parsed = YAML.parse(input);

  const expected: any = " foo\nbar\nbaz ";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/6XDY", () => {
  // Two document start markers
  const input: string = `---
---
`;

  const parsed = YAML.parse(input);

  const expected: any = [null, null];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/6ZKB", () => {
  // Spec Example 9.6. Stream
  const input: string = `Document
---
# Empty
...
%YAML 1.2
---
matches %: 20
`;

  const parsed = YAML.parse(input);

  const expected: any = ["Document", null, { "matches %": 20 }];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/735Y", () => {
  // Spec Example 8.20. Block Node Types
  const input: string = `-
  "flow in block"
- >
 Block scalar
- !!map # Block collection
  foo : bar
`;

  const parsed = YAML.parse(input);

  const expected: any = ["flow in block", "Block scalar\n", { foo: "bar" }];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/74H7", () => {
  // Tags in Implicit Mapping
  const input: string = `!!str a: b
c: !!int 42
e: !!str f
g: h
!!str 23: !!bool false
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    a: "b",
    c: 42,
    e: "f",
    g: "h",
    "23": false,
  };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/753E", () => {
  // Block Scalar Strip [1.3]
  const input: string = `--- |-
 ab
 
 
...
`;

  const parsed = YAML.parse(input);

  const expected: any = "ab";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/7A4E", () => {
  // Spec Example 7.6. Double Quoted Lines
  const input: string = `" 1st non-empty

 2nd non-empty 
	3rd non-empty "
`;

  const parsed = YAML.parse(input);

  const expected: any = " 1st non-empty\n2nd non-empty 3rd non-empty ";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/7BMT", () => {
  // Node and Mapping Key Anchors [1.3]
  const input: string = `---
top1: &node1
  &k1 key1: one
top2: &node2 # comment
  key2: two
top3:
  &k3 key3: three
top4: &node4
  &k4 key4: four
top5: &node5
  key5: five
top6: &val6
  six
top7:
  &val7 seven
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    top1: { key1: "one" },
    top2: { key2: "two" },
    top3: { key3: "three" },
    top4: { key4: "four" },
    top5: { key5: "five" },
    top6: "six",
    top7: "seven",
  };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/7BUB", () => {
  // Spec Example 2.10. Node for “Sammy Sosa” appears twice in this document
  const input: string = `---
hr:
  - Mark McGwire
  # Following node labeled SS
  - &SS Sammy Sosa
rbi:
  - *SS # Subsequent occurrence
  - Ken Griffey
`;

  const parsed = YAML.parse(input);

  // This YAML has anchors and aliases - creating shared references

  // Detected anchors that are referenced: SS

  const expected: any = {
    hr: ["Mark McGwire", "Sammy Sosa"],
    rbi: ["Sammy Sosa", "Ken Griffey"],
  };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/7FWL", () => {
  // Spec Example 6.24. Verbatim Tags
  const input: string = `!<tag:yaml.org,2002:str> foo :
  !<!bar> baz
`;

  const parsed = YAML.parse(input);

  const expected: any = { foo: "baz" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/7LBH", () => {
  // Multiline double quoted implicit keys
  // Error test - expecting parse to fail
  const input: string = `"a\\nb": 1
"c
 d": 1
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/7MNF", () => {
  // Missing colon
  // Error test - expecting parse to fail
  const input: string = `top1:
  key1: val1
top2
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test.todo("yaml-test-suite/7T8X", () => {
  // Spec Example 8.10. Folded Lines - 8.13. Final Empty Lines
  const input: string = `>

 folded
 line

 next
 line
   * bullet

   * list
   * lines

 last
 line

# Comment
`;

  const parsed = YAML.parse(input);

  const expected: any = "\nfolded line\nnext line\n  * bullet\n\n  * list\n  * lines\n\nlast line\n";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/7TMG", () => {
  // Comment in flow sequence before comma
  const input: string = `---
[ word1
# comment
, word2]
`;

  const parsed = YAML.parse(input);

  const expected: any = ["word1", "word2"];

  expect(parsed).toEqual(expected);
});

test.todo("yaml-test-suite/7W2P", () => {
  // Block Mapping with Missing Values
  const input: string = `? a
? b
c:
`;

  const parsed = YAML.parse(input);

  const expected: any = { a: null, b: null, c: null };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/7Z25", () => {
  // Bare document after document end marker
  const input: string = `---
scalar1
...
key: value
`;

  const parsed = YAML.parse(input);

  const expected: any = ["scalar1", { key: "value" }];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/7ZZ5", () => {
  // Empty flow collections
  const input: string = `---
nested sequences:
- - - []
- - - {}
key1: []
key2: {}
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    "nested sequences": [[[[]]], [[{}]]],
    key1: [],
    key2: {},
  };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/82AN", () => {
  // Three dashes and content without space
  const input: string = `---word1
word2
`;

  const parsed = YAML.parse(input);

  const expected: any = "---word1 word2";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/87E4", () => {
  // Spec Example 7.8. Single Quoted Implicit Keys
  const input: string = `'implicit block key' : [
  'implicit flow key' : value,
 ]
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    "implicit block key": [{ "implicit flow key": "value" }],
  };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/8CWC", () => {
  // Plain mapping key ending with colon
  const input: string = `---
key ends with two colons::: value
`;

  const parsed = YAML.parse(input);

  const expected: any = { "key ends with two colons::": "value" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/8G76", () => {
  // Spec Example 6.10. Comment Lines
  const input: string = `  # Comment
   


`;

  const parsed = YAML.parse(input);

  const expected: any = null;

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/8KB6", () => {
  // Multiline plain flow mapping key without value
  const input: string = `---
- { single line, a: b}
- { multi
  line, a: b}
`;

  const parsed = YAML.parse(input);

  const expected: any = [
    { "single line": null, a: "b" },
    { "multi line": null, a: "b" },
  ];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/8MK2", () => {
  // Explicit Non-Specific Tag
  const input: string = `! a
`;

  const parsed = YAML.parse(input);

  const expected: any = "a";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/8QBE", () => {
  // Block Sequence in Block Mapping
  const input: string = `key:
 - item1
 - item2
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    key: ["item1", "item2"],
  };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/8UDB", () => {
  // Spec Example 7.14. Flow Sequence Entries
  const input: string = `[
"double
 quoted", 'single
           quoted',
plain
 text, [ nested ],
single: pair,
]
`;

  const parsed = YAML.parse(input);

  const expected: any = ["double quoted", "single quoted", "plain text", ["nested"], { single: "pair" }];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/8XDJ", () => {
  // Comment in plain multiline value
  // Error test - expecting parse to fail
  const input: string = `key: word1
#  xxx
  word2
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/8XYN", () => {
  // Anchor with unicode character
  const input: string = `---
- &😁 unicode anchor
`;

  const parsed = YAML.parse(input);

  const expected: any = ["unicode anchor"];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/93JH", () => {
  // Block Mappings in Block Sequence
  const input: string = ` - key: value
   key2: value2
 -
   key3: value3
`;

  const parsed = YAML.parse(input);

  const expected: any = [{ key: "value", key2: "value2" }, { key3: "value3" }];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/93WF", () => {
  // Spec Example 6.6. Line Folding [1.3]
  const input: string = `--- >-
  trimmed
  
 

  as
  space
`;

  const parsed = YAML.parse(input);

  const expected: any = "trimmed\n\n\nas space";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/96L6", () => {
  // Spec Example 2.14. In the folded scalars, newlines become spaces
  const input: string = `--- >
  Mark McGwire's
  year was crippled
  by a knee injury.
`;

  const parsed = YAML.parse(input);

  const expected: any = "Mark McGwire's year was crippled by a knee injury.\n";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/96NN/00", () => {
  // Leading tab content in literals
  const input: string = `foo: |-
 	bar
`;

  const parsed = YAML.parse(input);

  const expected: any = { foo: "\tbar" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/96NN/01", () => {
  // Leading tab content in literals
  const input: string = `foo: |-
 	bar`;

  const parsed = YAML.parse(input);

  const expected: any = { foo: "\tbar" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/98YD", () => {
  // Spec Example 5.5. Comment Indicator
  const input: string = `# Comment only.
`;

  const parsed = YAML.parse(input);

  const expected: any = null;

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/9BXH", () => {
  // Multiline doublequoted flow mapping key without value
  const input: string = `---
- { "single line", a: b}
- { "multi
  line", a: b}
`;

  const parsed = YAML.parse(input);

  const expected: any = [
    { "single line": null, a: "b" },
    { "multi line": null, a: "b" },
  ];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/9C9N", () => {
  // Wrong indented flow sequence
  // Error test - expecting parse to fail
  const input: string = `---
flow: [a,
b,
c]
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/9CWY", () => {
  // Invalid scalar at the end of mapping
  // Error test - expecting parse to fail
  const input: string = `key:
 - item1
 - item2
invalid
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/9DXL", () => {
  // Spec Example 9.6. Stream [1.3]
  const input: string = `Mapping: Document
---
# Empty
...
%YAML 1.2
---
matches %: 20
`;

  const parsed = YAML.parse(input);

  const expected: any = [{ Mapping: "Document" }, null, { "matches %": 20 }];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/9FMG", () => {
  // Multi-level Mapping Indent
  const input: string = `a:
  b:
    c: d
  e:
    f: g
h: i
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    a: {
      b: { c: "d" },
      e: { f: "g" },
    },
    h: "i",
  };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/9HCY", () => {
  // Need document footer before directives
  // Error test - expecting parse to fail
  const input: string = `!foo "bar"
%TAG ! tag:example.com,2000:app/
---
!foo "bar"
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/9J7A", () => {
  // Simple Mapping Indent
  const input: string = `foo:
  bar: baz
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    foo: { bar: "baz" },
  };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/9JBA", () => {
  // Invalid comment after end of flow sequence
  // Error test - expecting parse to fail
  const input: string = `---
[ a, b, c, ]#invalid
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/9KAX", () => {
  // Various combinations of tags and anchors
  const input: string = `---
&a1
!!str
scalar1
---
!!str
&a2
scalar2
---
&a3
!!str scalar3
---
&a4 !!map
&a5 !!str key5: value4
---
a6: 1
&anchor6 b6: 2
---
!!map
&a8 !!str key8: value7
---
!!map
!!str &a10 key10: value9
---
!!str &a11
value11
`;

  const parsed = YAML.parse(input);

  // Note: Original YAML may have anchors/aliases
  // Some values in the parsed result may be shared object references

  const expected: any = [
    "scalar1",
    "scalar2",
    "scalar3",
    { key5: "value4" },
    { a6: 1, b6: 2 },
    { key8: "value7" },
    { key10: "value9" },
    "value11",
  ];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/9KBC", () => {
  // Mapping starting at --- line
  // Error test - expecting parse to fail
  const input: string = `--- key1: value1
    key2: value2
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/9MAG", () => {
  // Flow sequence with invalid comma at the beginning
  // Error test - expecting parse to fail
  const input: string = `---
[ , a, b, c ]
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/9MMA", () => {
  // Directive by itself with no document
  // Error test - expecting parse to fail
  const input: string = `%YAML 1.2
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test.todo("yaml-test-suite/9MMW", () => {
  // Single Pair Implicit Entries (using test.event for expected values)
  const input: string = `- [ YAML : separate ]
- [ "JSON like":adjacent ]
- [ {JSON: like}:adjacent ]
`;

  const parsed = YAML.parse(input);

  const expected: any = [[{ YAML: "separate" }], [{ "JSON like": "adjacent" }], [{ "[object Object]": "adjacent" }]];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/9MQT/00", () => {
  // Scalar doc with '...' in content
  const input: string = `--- "a
...x
b"
`;

  const parsed = YAML.parse(input);

  const expected: any = "a ...x b";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/9MQT/01", () => {
  // Scalar doc with '...' in content
  // Error test - expecting parse to fail
  const input: string = `--- "a
... x
b"
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/9SA2", () => {
  // Multiline double quoted flow mapping key
  const input: string = `---
- { "single line": value}
- { "multi
  line": value}
`;

  const parsed = YAML.parse(input);

  const expected: any = [{ "single line": "value" }, { "multi line": "value" }];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/9SHH", () => {
  // Spec Example 5.8. Quoted Scalar Indicators
  const input: string = `single: 'text'
double: "text"
`;

  const parsed = YAML.parse(input);

  const expected: any = { single: "text", double: "text" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/9TFX", () => {
  // Spec Example 7.6. Double Quoted Lines [1.3]
  const input: string = `---
" 1st non-empty

 2nd non-empty 
 3rd non-empty "
`;

  const parsed = YAML.parse(input);

  const expected: any = " 1st non-empty\n2nd non-empty 3rd non-empty ";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/9U5K", () => {
  // Spec Example 2.12. Compact Nested Mapping
  const input: string = `---
# Products purchased
- item    : Super Hoop
  quantity: 1
- item    : Basketball
  quantity: 4
- item    : Big Shoes
  quantity: 1
`;

  const parsed = YAML.parse(input);

  const expected: any = [
    { item: "Super Hoop", quantity: 1 },
    { item: "Basketball", quantity: 4 },
    { item: "Big Shoes", quantity: 1 },
  ];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/9WXW", () => {
  // Spec Example 6.18. Primary Tag Handle
  const input: string = `# Private
!foo "bar"
...
# Global
%TAG ! tag:example.com,2000:app/
---
!foo "bar"
`;

  const parsed = YAML.parse(input);

  const expected: any = ["bar", "bar"];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/9YRD", () => {
  // Multiline Scalar at Top Level
  const input: string = `a
b  
  c
d

e
`;

  const parsed = YAML.parse(input);

  const expected: any = "a b c d\ne";

  expect(parsed).toEqual(expected);
});

test.todo("yaml-test-suite/A2M4", () => {
  // Spec Example 6.2. Indentation Indicators
  const input: string = `? a
: -	b
  -  -	c
     - d
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    a: ["b", ["c", "d"]],
  };

  expect(parsed).toEqual(expected);
});

test.todo("yaml-test-suite/A6F9", () => {
  // Spec Example 8.4. Chomping Final Line Break
  const input: string = `strip: |-
  text
clip: |
  text
keep: |+
  text
`;

  const parsed = YAML.parse(input);

  const expected: any = { strip: "text", clip: "text\n", keep: "text\n" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/A984", () => {
  // Multiline Scalar in Mapping
  const input: string = `a: b
 c
d:
 e
  f
`;

  const parsed = YAML.parse(input);

  const expected: any = { a: "b c", d: "e f" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/AB8U", () => {
  // Sequence entry that looks like two with wrong indentation
  const input: string = `- single multiline
 - sequence entry
`;

  const parsed = YAML.parse(input);

  const expected: any = ["single multiline - sequence entry"];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/AVM7", () => {
  // Empty Stream
  const input: string = "";

  const parsed = YAML.parse(input);

  const expected: any = null;

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/AZ63", () => {
  // Sequence With Same Indentation as Parent Mapping
  const input: string = `one:
- 2
- 3
four: 5
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    one: [2, 3],
    four: 5,
  };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/AZW3", () => {
  // Lookahead test cases
  const input: string = `- bla"keks: foo
- bla]keks: foo
`;

  const parsed = YAML.parse(input);

  const expected: any = [{ 'bla"keks': "foo" }, { "bla]keks": "foo" }];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/B3HG", () => {
  // Spec Example 8.9. Folded Scalar [1.3]
  const input: string = `--- >
 folded
 text


`;

  const parsed = YAML.parse(input);

  const expected: any = "folded text\n";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/B63P", () => {
  // Directive without document
  // Error test - expecting parse to fail
  const input: string = `%YAML 1.2
...
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/BD7L", () => {
  // Invalid mapping after sequence
  // Error test - expecting parse to fail
  const input: string = `- item1
- item2
invalid: x
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/BEC7", () => {
  // Spec Example 6.14. “YAML” directive
  const input: string = `%YAML 1.3 # Attempt parsing
          # with a warning
---
"foo"
`;

  const parsed = YAML.parse(input);

  const expected: any = "foo";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/BF9H", () => {
  // Trailing comment in multiline plain scalar
  // Error test - expecting parse to fail
  const input: string = `---
plain: a
       b # end of scalar
       c
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/BS4K", () => {
  // Comment between plain scalar lines
  // Error test - expecting parse to fail
  const input: string = `word1  # comment
word2
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/BU8L", () => {
  // Node Anchor and Tag on Seperate Lines
  const input: string = `key: &anchor
 !!map
  a: b
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    key: { a: "b" },
  };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/C2DT", () => {
  // Spec Example 7.18. Flow Mapping Adjacent Values
  const input: string = `{
"adjacent":value,
"readable": value,
"empty":
}
`;

  const parsed = YAML.parse(input);

  const expected: any = { adjacent: "value", readable: "value", empty: null };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/C2SP", () => {
  // Flow Mapping Key on two lines
  // Error test - expecting parse to fail
  const input: string = `[23
]: 42
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/C4HZ", () => {
  // Spec Example 2.24. Global Tags
  const input: string = `%TAG ! tag:clarkevans.com,2002:
--- !shape
  # Use the ! handle for presenting
  # tag:clarkevans.com,2002:circle
- !circle
  center: &ORIGIN {x: 73, y: 129}
  radius: 7
- !line
  start: *ORIGIN
  finish: { x: 89, y: 102 }
- !label
  start: *ORIGIN
  color: 0xFFEEBB
  text: Pretty vector drawing.
`;

  const parsed = YAML.parse(input);

  // This YAML has anchors and aliases - creating shared references

  // Detected anchors that are referenced: ORIGIN

  const expected: any = [
    {
      center: { x: 73, y: 129 },
      radius: 7,
    },
    {
      start: { x: 73, y: 129 },
      finish: { x: 89, y: 102 },
    },
    {
      start: { x: 73, y: 129 },
      color: 16772795,
      text: "Pretty vector drawing.",
    },
  ];

  expect(parsed).toEqual(expected);

  // Verify shared references
  expect((parsed as any)["center"]).toBe((parsed as any)["start"]);
  expect((parsed as any)["center"]).toBe((parsed as any)["start"]);
});

test("yaml-test-suite/CC74", () => {
  // Spec Example 6.20. Tag Handles
  const input: string = `%TAG !e! tag:example.com,2000:app/
---
!e!foo "bar"
`;

  const parsed = YAML.parse(input);

  const expected: any = "bar";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/CFD4", () => {
  // Empty implicit key in single pair flow sequences (using test.event for expected values)
  const input: string = `- [ : empty key ]
- [: another empty key]
`;

  const parsed = YAML.parse(input);

  const expected: any = [[{ null: "empty key" }], [{ null: "another empty key" }]];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/CML9", () => {
  // Missing comma in flow
  // Error test - expecting parse to fail
  const input: string = `key: [ word1
#  xxx
  word2 ]
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/CN3R", () => {
  // Various location of anchors in flow sequence
  const input: string = `&flowseq [
 a: b,
 &c c: d,
 { &e e: f },
 &g { g: h }
]
`;

  const parsed = YAML.parse(input);

  const expected: any = [{ a: "b" }, { c: "d" }, { e: "f" }, { g: "h" }];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/CPZ3", () => {
  // Doublequoted scalar starting with a tab
  const input: string = `---
tab: "\\tstring"
`;

  const parsed = YAML.parse(input);

  const expected: any = { tab: "\tstring" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/CQ3W", () => {
  // Double quoted string without closing quote
  // Error test - expecting parse to fail
  const input: string = `---
key: "missing closing quote
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/CT4Q", () => {
  // Spec Example 7.20. Single Pair Explicit Entry
  const input: string = `[
? foo
 bar : baz
]
`;

  const parsed = YAML.parse(input);

  const expected: any = [{ "foo bar": "baz" }];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/CTN5", () => {
  // Flow sequence with invalid extra comma
  // Error test - expecting parse to fail
  const input: string = `---
[ a, b, c, , ]
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/CUP7", () => {
  // Spec Example 5.6. Node Property Indicators
  const input: string = `anchored: !local &anchor value
alias: *anchor
`;

  const parsed = YAML.parse(input);

  // This YAML has anchors and aliases - creating shared references

  // Detected anchors that are referenced: anchor

  const expected: any = { anchored: "value", alias: "value" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/CVW2", () => {
  // Invalid comment after comma
  // Error test - expecting parse to fail
  const input: string = `---
[ a, b, c,#invalid
]
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/CXX2", () => {
  // Mapping with anchor on document start line
  // Error test - expecting parse to fail
  const input: string = `--- &anchor a: b
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/D49Q", () => {
  // Multiline single quoted implicit keys
  // Error test - expecting parse to fail
  const input: string = `'a\\nb': 1
'c
 d': 1
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/D83L", () => {
  // Block scalar indicator order
  const input: string = `- |2-
  explicit indent and chomp
- |-2
  chomp and explicit indent
`;

  const parsed = YAML.parse(input);

  const expected: any = ["explicit indent and chomp", "chomp and explicit indent"];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/D88J", () => {
  // Flow Sequence in Block Mapping
  const input: string = `a: [b, c]
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    a: ["b", "c"],
  };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/D9TU", () => {
  // Single Pair Block Mapping
  const input: string = `foo: bar
`;

  const parsed = YAML.parse(input);

  const expected: any = { foo: "bar" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/DBG4", () => {
  // Spec Example 7.10. Plain Characters
  const input: string = `# Outside flow collection:
- ::vector
- ": - ()"
- Up, up, and away!
- -123
- http://example.com/foo#bar
# Inside flow collection:
- [ ::vector,
  ": - ()",
  "Up, up and away!",
  -123,
  http://example.com/foo#bar ]
`;

  const parsed = YAML.parse(input);

  const expected: any = [
    "::vector",
    ": - ()",
    "Up, up, and away!",
    -123,
    "http://example.com/foo#bar",
    ["::vector", ": - ()", "Up, up and away!", -123, "http://example.com/foo#bar"],
  ];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/DC7X", () => {
  // Various trailing tabs
  const input: string = `a: b	
seq:	
 - a	
c: d	#X
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    a: "b",
    seq: ["a"],
    c: "d",
  };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/DE56/00", () => {
  // Trailing tabs in double quoted
  const input: string = `"1 trailing\\t
    tab"
`;

  const parsed = YAML.parse(input);

  const expected: any = "1 trailing\t tab";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/DE56/01", () => {
  // Trailing tabs in double quoted
  const input: string = `"2 trailing\\t  
    tab"
`;

  const parsed = YAML.parse(input);

  const expected: any = "2 trailing\t tab";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/DE56/02", () => {
  // Trailing tabs in double quoted
  const input: string = `"3 trailing\\	
    tab"
`;

  const parsed = YAML.parse(input);

  const expected: any = "3 trailing\t tab";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/DE56/03", () => {
  // Trailing tabs in double quoted
  const input: string = `"4 trailing\\	  
    tab"
`;

  const parsed = YAML.parse(input);

  const expected: any = "4 trailing\t tab";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/DE56/04", () => {
  // Trailing tabs in double quoted
  const input: string = `"5 trailing	
    tab"
`;

  const parsed = YAML.parse(input);

  const expected: any = "5 trailing tab";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/DE56/05", () => {
  // Trailing tabs in double quoted
  const input: string = `"6 trailing	  
    tab"
`;

  const parsed = YAML.parse(input);

  const expected: any = "6 trailing tab";

  expect(parsed).toEqual(expected);
});

test.todo("yaml-test-suite/DFF7", () => {
  // Spec Example 7.16. Flow Mapping Entries (using test.event for expected values)
  const input: string = `{
? explicit: entry,
implicit: entry,
?
}
`;

  const parsed = YAML.parse(input);

  const expected: any = { explicit: "entry", implicit: "entry", null: null };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/DHP8", () => {
  // Flow Sequence
  const input: string = `[foo, bar, 42]
`;

  const parsed = YAML.parse(input);

  const expected: any = ["foo", "bar", 42];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/DK3J", () => {
  // Zero indented block scalar with line that looks like a comment
  const input: string = `--- >
line1
# no comment
line3
`;

  const parsed = YAML.parse(input);

  const expected: any = "line1 # no comment line3\n";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/DK4H", () => {
  // Implicit key followed by newline
  // Error test - expecting parse to fail
  const input: string = `---
[ key
  : value ]
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/DK95/00", () => {
  // Tabs that look like indentation
  const input: string = `foo:
 	bar
`;

  const parsed = YAML.parse(input);

  const expected: any = { foo: "bar" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/DK95/01", () => {
  // Tabs that look like indentation
  // Error test - expecting parse to fail
  const input: string = `foo: "bar
	baz"
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/DK95/02", () => {
  // Tabs that look like indentation
  const input: string = `foo: "bar
  	baz"
`;

  const parsed = YAML.parse(input);

  const expected: any = { foo: "bar baz" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/DK95/03", () => {
  // Tabs that look like indentation
  const input: string = ` 	
foo: 1
`;

  const parsed = YAML.parse(input);

  const expected: any = { foo: 1 };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/DK95/04", () => {
  // Tabs that look like indentation
  const input: string = `foo: 1
	
bar: 2
`;

  const parsed = YAML.parse(input);

  const expected: any = { foo: 1, bar: 2 };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/DK95/05", () => {
  // Tabs that look like indentation
  const input: string = `foo: 1
 	
bar: 2
`;

  const parsed = YAML.parse(input);

  const expected: any = { foo: 1, bar: 2 };

  expect(parsed).toEqual(expected);
});

test.todo("yaml-test-suite/DK95/06", () => {
  // Tabs that look like indentation
  // Error test - expecting parse to fail
  const input: string = `foo:
  a: 1
  	b: 2
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/DK95/07", () => {
  // Tabs that look like indentation
  const input: string = `%YAML 1.2
	
---
`;

  const parsed = YAML.parse(input);

  const expected: any = null;

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/DK95/08", () => {
  // Tabs that look like indentation
  const input: string = `foo: "bar
 	 	 baz 	 	 "
`;

  const parsed = YAML.parse(input);

  const expected: any = { foo: "bar baz \t \t " };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/DMG6", () => {
  // Wrong indendation in Map
  // Error test - expecting parse to fail
  const input: string = `key:
  ok: 1
 wrong: 2
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/DWX9", () => {
  // Spec Example 8.8. Literal Content
  const input: string = `|
 
  
  literal
   
  
  text

 # Comment
`;

  const parsed = YAML.parse(input);

  const expected: any = "\n\nliteral\n \n\ntext\n";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/E76Z", () => {
  // Aliases in Implicit Block Mapping
  const input: string = `&a a: &b b
*b : *a
`;

  const parsed = YAML.parse(input);

  // This YAML has anchors and aliases - creating shared references

  // Detected anchors that are referenced: a, b

  const expected: any = { a: "b", b: "a" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/EB22", () => {
  // Missing document-end marker before directive
  // Error test - expecting parse to fail
  const input: string = `---
scalar1 # comment
%YAML 1.2
---
scalar2
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/EHF6", () => {
  // Tags for Flow Objects
  const input: string = `!!map {
  k: !!seq
  [ a, !!str b]
}
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    k: ["a", "b"],
  };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/EW3V", () => {
  // Wrong indendation in mapping
  // Error test - expecting parse to fail
  const input: string = `k1: v1
 k2: v2
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/EX5H", () => {
  // Multiline Scalar at Top Level [1.3]
  const input: string = `---
a
b  
  c
d

e
`;

  const parsed = YAML.parse(input);

  const expected: any = "a b c d\ne";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/EXG3", () => {
  // Three dashes and content without space [1.3]
  const input: string = `---
---word1
word2
`;

  const parsed = YAML.parse(input);

  const expected: any = "---word1 word2";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/F2C7", () => {
  // Anchors and Tags
  const input: string = ` - &a !!str a
 - !!int 2
 - !!int &c 4
 - &d d
`;

  const parsed = YAML.parse(input);

  const expected: any = ["a", 2, 4, "d"];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/F3CP", () => {
  // Nested flow collections on one line
  const input: string = `---
{ a: [b, c, { d: [e, f] } ] }
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    a: [
      "b",
      "c",
      {
        d: ["e", "f"],
      },
    ],
  };

  expect(parsed).toEqual(expected);
});

test.todo("yaml-test-suite/F6MC", () => {
  // More indented lines at the beginning of folded block scalars
  const input: string = `---
a: >2
   more indented
  regular
b: >2


   more indented
  regular
`;

  const parsed = YAML.parse(input);

  const expected: any = { a: " more indented\nregular\n", b: "\n\n more indented\nregular\n" };

  expect(parsed).toEqual(expected);
});

test.todo("yaml-test-suite/F8F9", () => {
  // Spec Example 8.5. Chomping Trailing Lines
  const input: string = ` # Strip
  # Comments:
strip: |-
  # text
  
 # Clip
  # comments:

clip: |
  # text
 
 # Keep
  # comments:

keep: |+
  # text

 # Trail
  # comments.
`;

  const parsed = YAML.parse(input);

  const expected: any = { strip: "# text", clip: "# text\n", keep: "# text\n\n" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/FBC9", () => {
  // Allowed characters in plain scalars
  const input: string =
    "safe: a!\"#$%&'()*+,-./09:;<=>?@AZ[\\]^_`az{|}~\n     !\"#$%&'()*+,-./09:;<=>?@AZ[\\]^_`az{|}~\nsafe question mark: ?foo\nsafe colon: :foo\nsafe dash: -foo\n";

  const parsed = YAML.parse(input);

  // This YAML has anchors and aliases - creating shared references

  const expected: any = {
    safe: "a!\"#$%&'()*+,-./09:;<=>?@AZ[\\]^_`az{|}~ !\"#$%&'()*+,-./09:;<=>?@AZ[\\]^_`az{|}~",
    "safe question mark": "?foo",
    "safe colon": ":foo",
    "safe dash": "-foo",
  };

  expect(parsed).toEqual(expected);
});

test.todo("yaml-test-suite/FH7J", () => {
  // Tags on Empty Scalars (using test.event for expected values)
  const input: string = `- !!str
-
  !!null : a
  b: !!str
- !!str : !!null
`;

  const parsed = YAML.parse(input);

  const expected: any = ["", { null: "a", b: "" }, { null: null }];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/FP8R", () => {
  // Zero indented block scalar
  const input: string = `--- >
line1
line2
line3
`;

  const parsed = YAML.parse(input);

  const expected: any = "line1 line2 line3\n";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/FQ7F", () => {
  // Spec Example 2.1. Sequence of Scalars
  const input: string = `- Mark McGwire
- Sammy Sosa
- Ken Griffey
`;

  const parsed = YAML.parse(input);

  const expected: any = ["Mark McGwire", "Sammy Sosa", "Ken Griffey"];

  expect(parsed).toEqual(expected);
});

test.todo("yaml-test-suite/FRK4", () => {
  // Spec Example 7.3. Completely Empty Flow Nodes (using test.event for expected values)
  const input: string = `{
  ? foo :,
  : bar,
}
`;

  const parsed = YAML.parse(input);

  const expected: any = { foo: null, null: "bar" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/FTA2", () => {
  // Single block sequence with anchor and explicit document start
  const input: string = `--- &sequence
- a
`;

  const parsed = YAML.parse(input);

  const expected: any = ["a"];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/FUP4", () => {
  // Flow Sequence in Flow Sequence
  const input: string = `[a, [b, c]]
`;

  const parsed = YAML.parse(input);

  const expected: any = ["a", ["b", "c"]];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/G4RS", () => {
  // Spec Example 2.17. Quoted Scalars
  const input: string = `unicode: "Sosa did fine.\\u263A"
control: "\\b1998\\t1999\\t2000\\n"
hex esc: "\\x0d\\x0a is \\r\\n"

single: '"Howdy!" he cried.'
quoted: ' # Not a ''comment''.'
tie-fighter: '|\\-*-/|'
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    unicode: "Sosa did fine.☺",
    control: "\b1998\t1999\t2000\n",
    "hex esc": "\r\n is \r\n",
    single: '"Howdy!" he cried.',
    quoted: " # Not a 'comment'.",
    "tie-fighter": "|\\-*-/|",
  };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/G5U8", () => {
  // Plain dashes in flow sequence
  // Error test - expecting parse to fail
  const input: string = `---
- [-, -]
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/G7JE", () => {
  // Multiline implicit keys
  // Error test - expecting parse to fail
  const input: string = `a\\nb: 1
c
 d: 1
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/G992", () => {
  // Spec Example 8.9. Folded Scalar
  const input: string = `>
 folded
 text


`;

  const parsed = YAML.parse(input);

  const expected: any = "folded text\n";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/G9HC", () => {
  // Invalid anchor in zero indented sequence
  // Error test - expecting parse to fail
  const input: string = `---
seq:
&anchor
- a
- b
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/GDY7", () => {
  // Comment that looks like a mapping key
  // Error test - expecting parse to fail
  const input: string = `key: value
this is #not a: key
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/GH63", () => {
  // Mixed Block Mapping (explicit to implicit)
  const input: string = `? a
: 1.3
fifteen: d
`;

  const parsed = YAML.parse(input);

  const expected: any = { a: 1.3, fifteen: "d" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/GT5M", () => {
  // Node anchor in sequence
  // Error test - expecting parse to fail
  const input: string = `- item1
&node
- item2
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/H2RW", () => {
  // Blank lines
  const input: string = `foo: 1

bar: 2
    
text: |
  a
    
  b

  c
 
  d
`;

  const parsed = YAML.parse(input);

  const expected: any = { foo: 1, bar: 2, text: "a\n  \nb\n\nc\n\nd\n" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/H3Z8", () => {
  // Literal unicode
  const input: string = `---
wanted: love ♥ and peace ☮
`;

  const parsed = YAML.parse(input);

  const expected: any = { wanted: "love ♥ and peace ☮" };

  expect(parsed).toEqual(expected);
});

test.todo("yaml-test-suite/H7J7", () => {
  // Node anchor not indented
  // Error test - expecting parse to fail
  const input: string = `key: &x
!!map
  a: b
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/H7TQ", () => {
  // Extra words on %YAML directive
  // Error test - expecting parse to fail
  const input: string = `%YAML 1.2 foo
---
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/HM87/00", () => {
  // Scalars in flow start with syntax char
  const input: string = `[:x]
`;

  const parsed = YAML.parse(input);

  const expected: any = [":x"];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/HM87/01", () => {
  // Scalars in flow start with syntax char
  const input: string = `[?x]
`;

  const parsed = YAML.parse(input);

  const expected: any = ["?x"];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/HMK4", () => {
  // Spec Example 2.16. Indentation determines scope
  const input: string = `name: Mark McGwire
accomplishment: >
  Mark set a major league
  home run record in 1998.
stats: |
  65 Home Runs
  0.278 Batting Average
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    name: "Mark McGwire",
    accomplishment: "Mark set a major league home run record in 1998.\n",
    stats: "65 Home Runs\n0.278 Batting Average\n",
  };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/HMQ5", () => {
  // Spec Example 6.23. Node Properties
  const input: string = `!!str &a1 "foo":
  !!str bar
&a2 baz : *a1
`;

  const parsed = YAML.parse(input);

  // This YAML has anchors and aliases - creating shared references

  // Detected anchors that are referenced: a1

  const expected: any = { foo: "bar", baz: "foo" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/HRE5", () => {
  // Double quoted scalar with escaped single quote
  // Error test - expecting parse to fail
  const input: string = `---
double: "quoted \\' scalar"
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/HS5T", () => {
  // Spec Example 7.12. Plain Lines
  const input: string = `1st non-empty

 2nd non-empty 
	3rd non-empty
`;

  const parsed = YAML.parse(input);

  const expected: any = "1st non-empty\n2nd non-empty 3rd non-empty";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/HU3P", () => {
  // Invalid Mapping in plain scalar
  // Error test - expecting parse to fail
  const input: string = `key:
  word1 word2
  no: key
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/HWV9", () => {
  // Document-end marker
  const input: string = `...
`;

  const parsed = YAML.parse(input);

  const expected: any = null;

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/J3BT", () => {
  // Spec Example 5.12. Tabs and Spaces
  const input: string = `# Tabs and spaces
quoted: "Quoted 	"
block:	|
  void main() {
  	printf("Hello, world!\\n");
  }
`;

  const parsed = YAML.parse(input);

  const expected: any = { quoted: "Quoted \t", block: 'void main() {\n\tprintf("Hello, world!\\n");\n}\n' };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/J5UC", () => {
  // Multiple Pair Block Mapping
  const input: string = `foo: blue
bar: arrr
baz: jazz
`;

  const parsed = YAML.parse(input);

  const expected: any = { foo: "blue", bar: "arrr", baz: "jazz" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/J7PZ", () => {
  // Spec Example 2.26. Ordered Mappings
  const input: string = `# The !!omap tag is one of the optional types
# introduced for YAML 1.1. In 1.2, it is not
# part of the standard tags and should not be
# enabled by default.
# Ordered maps are represented as
# A sequence of mappings, with
# each mapping having one key
--- !!omap
- Mark McGwire: 65
- Sammy Sosa: 63
- Ken Griffy: 58
`;

  const parsed = YAML.parse(input);

  const expected: any = [{ "Mark McGwire": 65 }, { "Sammy Sosa": 63 }, { "Ken Griffy": 58 }];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/J7VC", () => {
  // Empty Lines Between Mapping Elements
  const input: string = `one: 2


three: 4
`;

  const parsed = YAML.parse(input);

  const expected: any = { one: 2, three: 4 };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/J9HZ", () => {
  // Spec Example 2.9. Single Document with Two Comments
  const input: string = `---
hr: # 1998 hr ranking
  - Mark McGwire
  - Sammy Sosa
rbi:
  # 1998 rbi ranking
  - Sammy Sosa
  - Ken Griffey
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    hr: ["Mark McGwire", "Sammy Sosa"],
    rbi: ["Sammy Sosa", "Ken Griffey"],
  };

  expect(parsed).toEqual(expected);
});

test.todo("yaml-test-suite/JEF9/00", () => {
  // Trailing whitespace in streams
  const input: string = `- |+


`;

  const parsed = YAML.parse(input);

  const expected: any = ["\n\n"];

  expect(parsed).toEqual(expected);
});

test.todo("yaml-test-suite/JEF9/01", () => {
  // Trailing whitespace in streams
  const input: string = `- |+
   
`;

  const parsed = YAML.parse(input);

  const expected: any = ["\n"];

  expect(parsed).toEqual(expected);
});

test.todo("yaml-test-suite/JEF9/02", () => {
  // Trailing whitespace in streams
  const input: string = `- |+
   `;

  const parsed = YAML.parse(input);

  const expected: any = ["\n"];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/JHB9", () => {
  // Spec Example 2.7. Two Documents in a Stream
  const input: string = `# Ranking of 1998 home runs
---
- Mark McGwire
- Sammy Sosa
- Ken Griffey

# Team ranking
---
- Chicago Cubs
- St Louis Cardinals
`;

  const parsed = YAML.parse(input);

  const expected: any = [
    ["Mark McGwire", "Sammy Sosa", "Ken Griffey"],
    ["Chicago Cubs", "St Louis Cardinals"],
  ];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/JKF3", () => {
  // Multiline unidented double quoted block key
  // Error test - expecting parse to fail
  const input: string = `- - "bar
bar": x
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/JQ4R", () => {
  // Spec Example 8.14. Block Sequence
  const input: string = `block sequence:
  - one
  - two : three
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    "block sequence": ["one", { two: "three" }],
  };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/JR7V", () => {
  // Question marks in scalars
  const input: string = `- a?string
- another ? string
- key: value?
- [a?string]
- [another ? string]
- {key: value? }
- {key: value?}
- {key?: value }
`;

  const parsed = YAML.parse(input);

  const expected: any = [
    "a?string",
    "another ? string",
    { key: "value?" },
    ["a?string"],
    ["another ? string"],
    { key: "value?" },
    { key: "value?" },
    { "key?": "value" },
  ];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/JS2J", () => {
  // Spec Example 6.29. Node Anchors
  const input: string = `First occurrence: &anchor Value
Second occurrence: *anchor
`;

  const parsed = YAML.parse(input);

  // This YAML has anchors and aliases - creating shared references

  // Detected anchors that are referenced: anchor

  const expected: any = { "First occurrence": "Value", "Second occurrence": "Value" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/JTV5", () => {
  // Block Mapping with Multiline Scalars
  const input: string = `? a
  true
: null
  d
? e
  42
`;

  const parsed = YAML.parse(input);

  const expected: any = { "a true": "null d", "e 42": null };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/JY7Z", () => {
  // Trailing content that looks like a mapping
  // Error test - expecting parse to fail
  const input: string = `key1: "quoted1"
key2: "quoted2" no key: nor value
key3: "quoted3"
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/K3WX", () => {
  // Colon and adjacent value after comment on next line
  const input: string = `---
{ "foo" # comment
  :bar }
`;

  const parsed = YAML.parse(input);

  const expected: any = { foo: "bar" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/K4SU", () => {
  // Multiple Entry Block Sequence
  const input: string = `- foo
- bar
- 42
`;

  const parsed = YAML.parse(input);

  const expected: any = ["foo", "bar", 42];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/K527", () => {
  // Spec Example 6.6. Line Folding
  const input: string = `>-
  trimmed
  
 

  as
  space
`;

  const parsed = YAML.parse(input);

  const expected: any = "trimmed\n\n\nas space";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/K54U", () => {
  // Tab after document header
  const input: string = `---	scalar
`;

  const parsed = YAML.parse(input);

  const expected: any = "scalar";

  expect(parsed).toEqual(expected);
});

test.todo("yaml-test-suite/K858", () => {
  // Spec Example 8.6. Empty Scalar Chomping
  const input: string = `strip: >-

clip: >

keep: |+

`;

  const parsed = YAML.parse(input);

  const expected: any = { strip: "", clip: "", keep: "\n" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/KH5V/00", () => {
  // Inline tabs in double quoted
  const input: string = `"1 inline\\ttab"
`;

  const parsed = YAML.parse(input);

  const expected: any = "1 inline\ttab";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/KH5V/01", () => {
  // Inline tabs in double quoted
  const input: string = `"2 inline\\	tab"
`;

  const parsed = YAML.parse(input);

  const expected: any = "2 inline\ttab";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/KH5V/02", () => {
  // Inline tabs in double quoted
  const input: string = `"3 inline	tab"
`;

  const parsed = YAML.parse(input);

  const expected: any = "3 inline\ttab";

  expect(parsed).toEqual(expected);
});

test.todo("yaml-test-suite/KK5P", () => {
  // Various combinations of explicit block mappings (using test.event for expected values)
  const input: string = `complex1:
  ? - a
complex2:
  ? - a
  : b
complex3:
  ? - a
  : >
    b
complex4:
  ? >
    a
  :
complex5:
  ? - a
  : - b
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    complex1: { a: null },
    complex2: { a: "b" },
    complex3: { a: "b\n" },
    complex4: { "a\n": null },
    complex5: {
      a: ["b"],
    },
  };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/KMK3", () => {
  // Block Submapping
  const input: string = `foo:
  bar: 1
baz: 2
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    foo: { bar: 1 },
    baz: 2,
  };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/KS4U", () => {
  // Invalid item after end of flow sequence
  // Error test - expecting parse to fail
  const input: string = `---
[
sequence item
]
invalid item
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/KSS4", () => {
  // Scalars on --- line
  const input: string = `--- "quoted
string"
--- &node foo
`;

  const parsed = YAML.parse(input);

  // Note: Original YAML may have anchors/aliases
  // Some values in the parsed result may be shared object references

  const expected: any = ["quoted string", "foo"];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/L24T/00", () => {
  // Trailing line of spaces
  const input: string = `foo: |
  x
   
`;

  const parsed = YAML.parse(input);

  const expected: any = { foo: "x\n \n" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/L24T/01", () => {
  // Trailing line of spaces
  const input: string = `foo: |
  x
   `;

  const parsed = YAML.parse(input);

  const expected: any = { foo: "x\n \n" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/L383", () => {
  // Two scalar docs with trailing comments
  const input: string = `--- foo  # comment
--- foo  # comment
`;

  const parsed = YAML.parse(input);

  const expected: any = ["foo", "foo"];

  expect(parsed).toEqual(expected);
});

test.todo("yaml-test-suite/L94M", () => {
  // Tags in Explicit Mapping
  const input: string = `? !!str a
: !!int 47
? c
: !!str d
`;

  const parsed = YAML.parse(input);

  const expected: any = { a: 47, c: "d" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/L9U5", () => {
  // Spec Example 7.11. Plain Implicit Keys
  const input: string = `implicit block key : [
  implicit flow key : value,
 ]
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    "implicit block key": [{ "implicit flow key": "value" }],
  };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/LE5A", () => {
  // Spec Example 7.24. Flow Nodes
  const input: string = `- !!str "a"
- 'b'
- &anchor "c"
- *anchor
- !!str
`;

  const parsed = YAML.parse(input);

  // This YAML has anchors and aliases - creating shared references

  // Detected anchors that are referenced: anchor

  const expected: any = ["a", "b", "c", "c", ""];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/LHL4", () => {
  // Invalid tag
  // Error test - expecting parse to fail
  const input: string = `---
!invalid{}tag scalar
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/LP6E", () => {
  // Whitespace After Scalars in Flow
  const input: string = `- [a, b , c ]
- { "a"  : b
   , c : 'd' ,
   e   : "f"
  }
- [      ]
`;

  const parsed = YAML.parse(input);

  const expected: any = [["a", "b", "c"], { a: "b", c: "d", e: "f" }, []];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/LQZ7", () => {
  // Spec Example 7.4. Double Quoted Implicit Keys
  const input: string = `"implicit block key" : [
  "implicit flow key" : value,
 ]
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    "implicit block key": [{ "implicit flow key": "value" }],
  };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/LX3P", () => {
  // Implicit Flow Mapping Key on one line (using test.event for expected values)
  const input: string = `[flow]: block
`;

  const parsed = YAML.parse(input);

  const expected: any = { flow: "block" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/M29M", () => {
  // Literal Block Scalar
  const input: string = `a: |
 ab
 
 cd
 ef
 

...
`;

  const parsed = YAML.parse(input);

  const expected: any = { a: "ab\n\ncd\nef\n" };

  expect(parsed).toEqual(expected);
});

test.todo("yaml-test-suite/M2N8/00", () => {
  // Question mark edge cases (using test.event for expected values)
  const input: string = `- ? : x
`;

  const parsed = YAML.parse(input);

  const expected: any = [{ "[object Object]": null }];

  expect(parsed).toEqual(expected);
});

test.todo("yaml-test-suite/M2N8/01", () => {
  // Question mark edge cases (using test.event for expected values)
  const input: string = `? []: x
`;

  const parsed = YAML.parse(input);

  const expected: any = { "{\n  ? []\n  : x\n}": null };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/M5C3", () => {
  // Spec Example 8.21. Block Scalar Nodes
  const input: string = `literal: |2
  value
folded:
   !foo
  >1
 value
`;

  const parsed = YAML.parse(input);

  const expected: any = { literal: "value\n", folded: "value\n" };

  expect(parsed).toEqual(expected);
});

test.todo("yaml-test-suite/M5DY", () => {
  // Spec Example 2.11. Mapping between Sequences (using test.event for expected values)
  const input: string = `? - Detroit Tigers
  - Chicago cubs
:
  - 2001-07-23

? [ New York Yankees,
    Atlanta Braves ]
: [ 2001-07-02, 2001-08-12,
    2001-08-14 ]
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    "Detroit Tigers,Chicago cubs": ["2001-07-23"],
    "New York Yankees,Atlanta Braves": ["2001-07-02", "2001-08-12", "2001-08-14"],
  };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/M6YH", () => {
  // Block sequence indentation
  const input: string = `- |
 x
-
 foo: bar
-
 - 42
`;

  const parsed = YAML.parse(input);

  const expected: any = ["x\n", { foo: "bar" }, [42]];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/M7A3", () => {
  // Spec Example 9.3. Bare Documents
  const input: string = `Bare
document
...
# No document
...
|
%!PS-Adobe-2.0 # Not the first line
`;

  const parsed = YAML.parse(input);

  const expected: any = ["Bare document", "%!PS-Adobe-2.0 # Not the first line\n"];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/M7NX", () => {
  // Nested flow collections
  const input: string = `---
{
 a: [
  b, c, {
   d: [e, f]
  }
 ]
}
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    a: [
      "b",
      "c",
      {
        d: ["e", "f"],
      },
    ],
  };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/M9B4", () => {
  // Spec Example 8.7. Literal Scalar
  const input: string = `|
 literal
 	text


`;

  const parsed = YAML.parse(input);

  const expected: any = "literal\n\ttext\n";

  expect(parsed).toEqual(expected);
});

test.todo("yaml-test-suite/MJS9", () => {
  // Spec Example 6.7. Block Folding
  const input: string = `>
  foo 
 
  	 bar

  baz
`;

  const parsed = YAML.parse(input);

  const expected: any = "foo \n\n\t bar\n\nbaz\n";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/MUS6/00", () => {
  // Directive variants
  // Error test - expecting parse to fail
  const input: string = `%YAML 1.1#...
---
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/MUS6/01", () => {
  // Directive variants
  // Error test - expecting parse to fail
  const input: string = `%YAML 1.2
---
%YAML 1.2
---
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/MUS6/02", () => {
  // Directive variants
  const input: string = `%YAML  1.1
---
`;

  const parsed = YAML.parse(input);

  const expected: any = null;

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/MUS6/03", () => {
  // Directive variants
  const input: string = `%YAML 	 1.1
---
`;

  const parsed = YAML.parse(input);

  const expected: any = null;

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/MUS6/04", () => {
  // Directive variants
  const input: string = `%YAML 1.1  # comment
---
`;

  const parsed = YAML.parse(input);

  const expected: any = null;

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/MUS6/05", () => {
  // Directive variants
  const input: string = `%YAM 1.1
---
`;

  const parsed = YAML.parse(input);

  const expected: any = null;

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/MUS6/06", () => {
  // Directive variants
  const input: string = `%YAMLL 1.1
---
`;

  const parsed = YAML.parse(input);

  const expected: any = null;

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/MXS3", () => {
  // Flow Mapping in Block Sequence
  const input: string = `- {a: b}
`;

  const parsed = YAML.parse(input);

  const expected: any = [{ a: "b" }];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/MYW6", () => {
  // Block Scalar Strip
  const input: string = `|-
 ab
 
 
...
`;

  const parsed = YAML.parse(input);

  const expected: any = "ab";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/MZX3", () => {
  // Non-Specific Tags on Scalars
  const input: string = `- plain
- "double quoted"
- 'single quoted'
- >
  block
- plain again
`;

  const parsed = YAML.parse(input);

  const expected: any = ["plain", "double quoted", "single quoted", "block\n", "plain again"];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/N4JP", () => {
  // Bad indentation in mapping
  // Error test - expecting parse to fail
  const input: string = `map:
  key1: "quoted1"
 key2: "bad indentation"
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/N782", () => {
  // Invalid document markers in flow style
  // Error test - expecting parse to fail
  const input: string = `[
--- ,
...
]
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/NAT4", () => {
  // Various empty or newline only quoted strings
  const input: string = `---
a: '
  '
b: '  
  '
c: "
  "
d: "  
  "
e: '

  '
f: "

  "
g: '


  '
h: "


  "
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    a: " ",
    b: " ",
    c: " ",
    d: " ",
    e: "\n",
    f: "\n",
    g: "\n\n",
    h: "\n\n",
  };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/NB6Z", () => {
  // Multiline plain value with tabs on empty lines
  const input: string = `key:
  value
  with
  	
  tabs
`;

  const parsed = YAML.parse(input);

  const expected: any = { key: "value with\ntabs" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/NHX8", () => {
  // Empty Lines at End of Document (using test.event for expected values)
  const input: string = `:


`;

  const parsed = YAML.parse(input);

  const expected: any = { null: null };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/NJ66", () => {
  // Multiline plain flow mapping key
  const input: string = `---
- { single line: value}
- { multi
  line: value}
`;

  const parsed = YAML.parse(input);

  const expected: any = [{ "single line": "value" }, { "multi line": "value" }];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/NKF9", () => {
  // Empty keys in block and flow mapping (using test.event for expected values)
  const input: string = `---
key: value
: empty key
---
{
 key: value, : empty key
}
---
# empty key and value
:
---
# empty key and value
{ : }
`;

  const parsed = YAML.parse(input);

  const expected: any = [
    { key: "value", null: "empty key" },
    { key: "value", null: "empty key" },
    { null: null },
    { null: null },
  ];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/NP9H", () => {
  // Spec Example 7.5. Double Quoted Line Breaks
  const input: string = `"folded 
to a space,	
 
to a line feed, or 	\\
 \\ 	non-content"
`;

  const parsed = YAML.parse(input);

  const expected: any = "folded to a space,\nto a line feed, or \t \tnon-content";

  expect(parsed).toEqual(expected);
});

test.todo("yaml-test-suite/P2AD", () => {
  // Spec Example 8.1. Block Scalar Header
  const input: string = `- | # Empty header↓
 literal
- >1 # Indentation indicator↓
  folded
- |+ # Chomping indicator↓
 keep

- >1- # Both indicators↓
  strip
`;

  const parsed = YAML.parse(input);

  const expected: any = ["literal\n", " folded\n", "keep\n\n", " strip"];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/P2EQ", () => {
  // Invalid sequene item on same line as previous item
  // Error test - expecting parse to fail
  const input: string = `---
- { y: z }- invalid
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/P76L", () => {
  // Spec Example 6.19. Secondary Tag Handle
  const input: string = `%TAG !! tag:example.com,2000:app/
---
!!int 1 - 3 # Interval, not integer
`;

  const parsed = YAML.parse(input);

  const expected: any = "1 - 3";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/P94K", () => {
  // Spec Example 6.11. Multi-Line Comments
  const input: string = `key:    # Comment
        # lines
  value


`;

  const parsed = YAML.parse(input);

  const expected: any = { key: "value" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/PBJ2", () => {
  // Spec Example 2.3. Mapping Scalars to Sequences
  const input: string = `american:
  - Boston Red Sox
  - Detroit Tigers
  - New York Yankees
national:
  - New York Mets
  - Chicago Cubs
  - Atlanta Braves
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    american: ["Boston Red Sox", "Detroit Tigers", "New York Yankees"],
    national: ["New York Mets", "Chicago Cubs", "Atlanta Braves"],
  };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/PRH3", () => {
  // Spec Example 7.9. Single Quoted Lines
  const input: string = `' 1st non-empty

 2nd non-empty 
	3rd non-empty '
`;

  const parsed = YAML.parse(input);

  const expected: any = " 1st non-empty\n2nd non-empty 3rd non-empty ";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/PUW8", () => {
  // Document start on last line
  const input: string = `---
a: b
---
`;

  const parsed = YAML.parse(input);

  const expected: any = [{ a: "b" }, null];

  expect(parsed).toEqual(expected);
});

test.todo("yaml-test-suite/PW8X", () => {
  // Anchors on Empty Scalars (using test.event for expected values)
  const input: string = `- &a
- a
-
  &a : a
  b: &b
-
  &c : &a
-
  ? &d
-
  ? &e
  : &a
`;

  const parsed = YAML.parse(input);

  const expected: any = [null, "a", { null: "a", b: null }, { null: null }, { null: null }, { null: null }];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/Q4CL", () => {
  // Trailing content after quoted value
  // Error test - expecting parse to fail
  const input: string = `key1: "quoted1"
key2: "quoted2" trailing content
key3: "quoted3"
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/Q5MG", () => {
  // Tab at beginning of line followed by a flow mapping
  const input: string = `	{}
`;

  const parsed = YAML.parse(input);

  const expected: any = {};

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/Q88A", () => {
  // Spec Example 7.23. Flow Content
  const input: string = `- [ a, b ]
- { a: b }
- "a"
- 'b'
- c
`;

  const parsed = YAML.parse(input);

  const expected: any = [["a", "b"], { a: "b" }, "a", "b", "c"];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/Q8AD", () => {
  // Spec Example 7.5. Double Quoted Line Breaks [1.3]
  const input: string = `---
"folded 
to a space,
 
to a line feed, or 	\\
 \\ 	non-content"
`;

  const parsed = YAML.parse(input);

  const expected: any = "folded to a space,\nto a line feed, or \t \tnon-content";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/Q9WF", () => {
  // Spec Example 6.12. Separation Spaces (using test.event for expected values)
  const input: string = `{ first: Sammy, last: Sosa }:
# Statistics:
  hr:  # Home runs
     65
  avg: # Average
   0.278
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    "[object Object]": { hr: 65, avg: 0.278 },
  };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/QB6E", () => {
  // Wrong indented multiline quoted scalar
  // Error test - expecting parse to fail
  const input: string = `---
quoted: "a
b
c"
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/QF4Y", () => {
  // Spec Example 7.19. Single Pair Flow Mappings
  const input: string = `[
foo: bar
]
`;

  const parsed = YAML.parse(input);

  const expected: any = [{ foo: "bar" }];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/QLJ7", () => {
  // Tag shorthand used in documents but only defined in the first
  // Error test - expecting parse to fail
  const input: string = `%TAG !prefix! tag:example.com,2011:
--- !prefix!A
a: b
--- !prefix!B
c: d
--- !prefix!C
e: f
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/QT73", () => {
  // Comment and document-end marker
  const input: string = `# comment
...
`;

  const parsed = YAML.parse(input);

  const expected: any = null;

  expect(parsed).toEqual(expected);
});

test.todo("yaml-test-suite/R4YG", () => {
  // Spec Example 8.2. Block Indentation Indicator
  const input: string = `- |
 detected
- >
 
  
  # detected
- |1
  explicit
- >
 	
 detected
`;

  const parsed = YAML.parse(input);

  const expected: any = ["detected\n", "\n\n# detected\n", " explicit\n", "\t\ndetected\n"];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/R52L", () => {
  // Nested flow mapping sequence and mappings
  const input: string = `---
{ top1: [item1, {key2: value2}, item3], top2: value2 }
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    top1: ["item1", { key2: "value2" }, "item3"],
    top2: "value2",
  };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/RHX7", () => {
  // YAML directive without document end marker
  // Error test - expecting parse to fail
  const input: string = `---
key: value
%YAML 1.2
---
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/RLU9", () => {
  // Sequence Indent
  const input: string = `foo:
- 42
bar:
  - 44
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    foo: [42],
    bar: [44],
  };

  expect(parsed).toEqual(expected);
});

test.todo("yaml-test-suite/RR7F", () => {
  // Mixed Block Mapping (implicit to explicit)
  const input: string = `a: 4.2
? d
: 23
`;

  const parsed = YAML.parse(input);

  const expected: any = { d: 23, a: 4.2 };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/RTP8", () => {
  // Spec Example 9.2. Document Markers
  const input: string = `%YAML 1.2
---
Document
... # Suffix
`;

  const parsed = YAML.parse(input);

  const expected: any = "Document";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/RXY3", () => {
  // Invalid document-end marker in single quoted string
  // Error test - expecting parse to fail
  const input: string = `---
'
...
'
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test.todo("yaml-test-suite/RZP5", () => {
  // Various Trailing Comments [1.3] (using test.event for expected values)
  const input: string = `a: "double
  quotes" # lala
b: plain
 value  # lala
c  : #lala
  d
? # lala
 - seq1
: # lala
 - #lala
  seq2
e: &node # lala
 - x: y
block: > # lala
  abcde
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    a: "double quotes",
    b: "plain value",
    c: "d",
    seq1: ["seq2"],
    e: [{ x: "y" }],
    block: "abcde\n",
  };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/RZT7", () => {
  // Spec Example 2.28. Log File
  const input: string = `---
Time: 2001-11-23 15:01:42 -5
User: ed
Warning:
  This is an error message
  for the log file
---
Time: 2001-11-23 15:02:31 -5
User: ed
Warning:
  A slightly different error
  message.
---
Date: 2001-11-23 15:03:17 -5
User: ed
Fatal:
  Unknown variable "bar"
Stack:
  - file: TopClass.py
    line: 23
    code: |
      x = MoreObject("345\\n")
  - file: MoreClass.py
    line: 58
    code: |-
      foo = bar
`;

  const parsed = YAML.parse(input);

  const expected: any = [
    { Time: "2001-11-23 15:01:42 -5", User: "ed", Warning: "This is an error message for the log file" },
    { Time: "2001-11-23 15:02:31 -5", User: "ed", Warning: "A slightly different error message." },
    {
      Date: "2001-11-23 15:03:17 -5",
      User: "ed",
      Fatal: 'Unknown variable "bar"',
      Stack: [
        { file: "TopClass.py", line: 23, code: 'x = MoreObject("345\\n")\n' },
        { file: "MoreClass.py", line: 58, code: "foo = bar" },
      ],
    },
  ];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/S3PD", () => {
  // Spec Example 8.18. Implicit Block Mapping Entries (using test.event for expected values)
  const input: string = `plain key: in-line value
: # Both empty
"quoted key":
- entry
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    "plain key": "in-line value",
    null: null,
    "quoted key": ["entry"],
  };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/S4GJ", () => {
  // Invalid text after block scalar indicator
  // Error test - expecting parse to fail
  const input: string = `---
folded: > first line
  second line
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/S4JQ", () => {
  // Spec Example 6.28. Non-Specific Tags
  const input: string = `# Assuming conventional resolution:
- "12"
- 12
- ! 12
`;

  const parsed = YAML.parse(input);

  const expected: any = ["12", 12, "12"];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/S4T7", () => {
  // Document with footer
  const input: string = `aaa: bbb
...
`;

  const parsed = YAML.parse(input);

  const expected: any = { aaa: "bbb" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/S7BG", () => {
  // Colon followed by comma
  const input: string = `---
- :,
`;

  const parsed = YAML.parse(input);

  const expected: any = [":,"];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/S98Z", () => {
  // Block scalar with more spaces than first content line
  // Error test - expecting parse to fail
  const input: string = `empty block scalar: >
 
  
   
 # comment
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test.todo("yaml-test-suite/S9E8", () => {
  // Spec Example 5.3. Block Structure Indicators
  const input: string = `sequence:
- one
- two
mapping:
  ? sky
  : blue
  sea : green
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    sequence: ["one", "two"],
    mapping: { sky: "blue", sea: "green" },
  };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/SBG9", () => {
  // Flow Sequence in Flow Mapping (using test.event for expected values)
  const input: string = `{a: [b, c], [d, e]: f}
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    a: ["b", "c"],
    "d,e": "f",
  };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/SF5V", () => {
  // Duplicate YAML directive
  // Error test - expecting parse to fail
  const input: string = `%YAML 1.2
%YAML 1.2
---
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/SKE5", () => {
  // Anchor before zero indented sequence
  const input: string = `---
seq:
 &anchor
- a
- b
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    seq: ["a", "b"],
  };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/SM9W/00", () => {
  // Single character streams
  const input: string = "-";

  const parsed = YAML.parse(input);

  const expected: any = [null];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/SM9W/01", () => {
  // Single character streams (using test.event for expected values)
  const input: string = ":";

  const parsed = YAML.parse(input);

  const expected: any = { null: null };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/SR86", () => {
  // Anchor plus Alias
  // Error test - expecting parse to fail
  const input: string = `key1: &a value
key2: &b *a
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/SSW6", () => {
  // Spec Example 7.7. Single Quoted Characters [1.3]
  const input: string = `---
'here''s to "quotes"'
`;

  const parsed = YAML.parse(input);

  const expected: any = 'here\'s to "quotes"';

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/SU5Z", () => {
  // Comment without whitespace after doublequoted scalar
  // Error test - expecting parse to fail
  const input: string = `key: "value"# invalid comment
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/SU74", () => {
  // Anchor and alias as mapping key
  // Error test - expecting parse to fail
  const input: string = `key1: &alias value1
&b *alias : value2
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/SY6V", () => {
  // Anchor before sequence entry on same line
  // Error test - expecting parse to fail
  const input: string = `&anchor - sequence entry
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/SYW4", () => {
  // Spec Example 2.2. Mapping Scalars to Scalars
  const input: string = `hr:  65    # Home runs
avg: 0.278 # Batting average
rbi: 147   # Runs Batted In
`;

  const parsed = YAML.parse(input);

  const expected: any = { hr: 65, avg: 0.278, rbi: 147 };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/T26H", () => {
  // Spec Example 8.8. Literal Content [1.3]
  const input: string = `--- |
 
  
  literal
   
  
  text

 # Comment
`;

  const parsed = YAML.parse(input);

  const expected: any = "\n\nliteral\n \n\ntext\n";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/T4YY", () => {
  // Spec Example 7.9. Single Quoted Lines [1.3]
  const input: string = `---
' 1st non-empty

 2nd non-empty 
 3rd non-empty '
`;

  const parsed = YAML.parse(input);

  const expected: any = " 1st non-empty\n2nd non-empty 3rd non-empty ";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/T5N4", () => {
  // Spec Example 8.7. Literal Scalar [1.3]
  const input: string = `--- |
 literal
 	text


`;

  const parsed = YAML.parse(input);

  const expected: any = "literal\n\ttext\n";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/T833", () => {
  // Flow mapping missing a separating comma
  // Error test - expecting parse to fail
  const input: string = `---
{
 foo: 1
 bar: 2 }
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/TD5N", () => {
  // Invalid scalar after sequence
  // Error test - expecting parse to fail
  const input: string = `- item1
- item2
invalid
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/TE2A", () => {
  // Spec Example 8.16. Block Mappings
  const input: string = `block mapping:
 key: value
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    "block mapping": { key: "value" },
  };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/TL85", () => {
  // Spec Example 6.8. Flow Folding
  const input: string = `"
  foo 
 
  	 bar

  baz
"
`;

  const parsed = YAML.parse(input);

  const expected: any = " foo\nbar\nbaz ";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/TS54", () => {
  // Folded Block Scalar
  const input: string = `>
 ab
 cd
 
 ef


 gh
`;

  const parsed = YAML.parse(input);

  const expected: any = "ab cd\nef\n\ngh\n";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/U3C3", () => {
  // Spec Example 6.16. “TAG” directive
  const input: string = `%TAG !yaml! tag:yaml.org,2002:
---
!yaml!str "foo"
`;

  const parsed = YAML.parse(input);

  const expected: any = "foo";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/U3XV", () => {
  // Node and Mapping Key Anchors
  const input: string = `---
top1: &node1
  &k1 key1: one
top2: &node2 # comment
  key2: two
top3:
  &k3 key3: three
top4:
  &node4
  &k4 key4: four
top5:
  &node5
  key5: five
top6: &val6
  six
top7:
  &val7 seven
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    top1: { key1: "one" },
    top2: { key2: "two" },
    top3: { key3: "three" },
    top4: { key4: "four" },
    top5: { key5: "five" },
    top6: "six",
    top7: "seven",
  };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/U44R", () => {
  // Bad indentation in mapping (2)
  // Error test - expecting parse to fail
  const input: string = `map:
  key1: "quoted1"
   key2: "bad indentation"
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/U99R", () => {
  // Invalid comma in tag
  // Error test - expecting parse to fail
  const input: string = `- !!str, xxx
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/U9NS", () => {
  // Spec Example 2.8. Play by Play Feed from a Game
  const input: string = `---
time: 20:03:20
player: Sammy Sosa
action: strike (miss)
...
---
time: 20:03:47
player: Sammy Sosa
action: grand slam
...
`;

  const parsed = YAML.parse(input);

  const expected: any = [
    { time: "20:03:20", player: "Sammy Sosa", action: "strike (miss)" },
    { time: "20:03:47", player: "Sammy Sosa", action: "grand slam" },
  ];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/UDM2", () => {
  // Plain URL in flow mapping
  const input: string = `- { url: http://example.org }
`;

  const parsed = YAML.parse(input);

  const expected: any = [{ url: "http://example.org" }];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/UDR7", () => {
  // Spec Example 5.4. Flow Collection Indicators
  const input: string = `sequence: [ one, two, ]
mapping: { sky: blue, sea: green }
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    sequence: ["one", "two"],
    mapping: { sky: "blue", sea: "green" },
  };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/UGM3", () => {
  // Spec Example 2.27. Invoice
  const input: string = `--- !<tag:clarkevans.com,2002:invoice>
invoice: 34843
date   : 2001-01-23
bill-to: &id001
    given  : Chris
    family : Dumars
    address:
        lines: |
            458 Walkman Dr.
            Suite #292
        city    : Royal Oak
        state   : MI
        postal  : 48046
ship-to: *id001
product:
    - sku         : BL394D
      quantity    : 4
      description : Basketball
      price       : 450.00
    - sku         : BL4438H
      quantity    : 1
      description : Super Hoop
      price       : 2392.00
tax  : 251.42
total: 4443.52
comments:
    Late afternoon is best.
    Backup contact is Nancy
    Billsmer @ 338-4338.
`;

  const parsed = YAML.parse(input);

  // This YAML has anchors and aliases - creating shared references

  const expected: any = {
    invoice: 34843,
    date: "2001-01-23",
    "bill-to": {
      given: "Chris",
      family: "Dumars",
      address: {
        lines: "458 Walkman Dr.\nSuite #292\n",
        city: "Royal Oak",
        state: "MI",
        postal: 48046,
      },
    },
    "ship-to": {
      given: "Chris",
      family: "Dumars",
      address: {
        lines: "458 Walkman Dr.\nSuite #292\n",
        city: "Royal Oak",
        state: "MI",
        postal: 48046,
      },
    },
    product: [
      {
        sku: "BL394D",
        quantity: 4,
        description: "Basketball",
        price: 450,
      },
      {
        sku: "BL4438H",
        quantity: 1,
        description: "Super Hoop",
        price: 2392,
      },
    ],
    tax: 251.42,
    total: 4443.52,
    comments: "Late afternoon is best. Backup contact is Nancy Billsmer @ 338-4338.",
  };

  expect(parsed).toEqual(expected);

  // Verify shared references - bill-to and ship-to should be the same object
  expect((parsed as any)["bill-to"]).toBe((parsed as any)["ship-to"]);
});

test("yaml-test-suite/UKK6/00", () => {
  // Syntax character edge cases (using test.event for expected values)
  const input: string = `- :
`;

  const parsed = YAML.parse(input);

  const expected: any = [{ null: null }];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/UKK6/01", () => {
  // Syntax character edge cases
  const input: string = `::
`;

  const parsed = YAML.parse(input);

  const expected: any = { ":": null };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/UKK6/02", () => {
  // Syntax character edge cases (using test.event for expected values)
  const input: string = `!
`;

  const parsed = YAML.parse(input);

  const expected: any = "";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/UT92", () => {
  // Spec Example 9.4. Explicit Documents
  const input: string = `---
{ matches
% : 20 }
...
---
# Empty
...
`;

  const parsed = YAML.parse(input);

  const expected: any = [{ "matches %": 20 }, null];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/UV7Q", () => {
  // Legal tab after indentation
  const input: string = `x:
 - x
  	x
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    x: ["x x"],
  };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/V55R", () => {
  // Aliases in Block Sequence
  const input: string = `- &a a
- &b b
- *a
- *b
`;

  const parsed = YAML.parse(input);

  // This YAML has anchors and aliases - creating shared references

  // Detected anchors that are referenced: a, b

  const expected: any = ["a", "b", "a", "b"];

  expect(parsed).toEqual(expected);
});

test.todo("yaml-test-suite/V9D5", () => {
  // Spec Example 8.19. Compact Block Mappings (using test.event for expected values)
  const input: string = `- sun: yellow
- ? earth: blue
  : moon: white
`;

  const parsed = YAML.parse(input);

  const expected: any = [
    { sun: "yellow" },
    {
      "[object Object]": { moon: "white" },
    },
  ];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/VJP3/00", () => {
  // Flow collections over many lines
  // Error test - expecting parse to fail
  const input: string = `k: {
k
:
v
}
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/VJP3/01", () => {
  // Flow collections over many lines
  const input: string = `k: {
 k
 :
 v
 }
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    k: { k: "v" },
  };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/W42U", () => {
  // Spec Example 8.15. Block Sequence Entry Types
  const input: string = `- # Empty
- |
 block node
- - one # Compact
  - two # sequence
- one: two # Compact mapping
`;

  const parsed = YAML.parse(input);

  const expected: any = [null, "block node\n", ["one", "two"], { one: "two" }];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/W4TN", () => {
  // Spec Example 9.5. Directives Documents
  const input: string = `%YAML 1.2
--- |
%!PS-Adobe-2.0
...
%YAML 1.2
---
# Empty
...
`;

  const parsed = YAML.parse(input);

  const expected: any = ["%!PS-Adobe-2.0\n", null];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/W5VH", () => {
  // Allowed characters in alias
  const input: string = `a: &:@*!$"<foo>: scalar a
b: *:@*!$"<foo>:
`;

  const parsed = YAML.parse(input);

  // This YAML has anchors and aliases - creating shared references

  const expected: any = { a: "scalar a", b: "scalar a" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/W9L4", () => {
  // Literal block scalar with more spaces in first line
  // Error test - expecting parse to fail
  const input: string = `---
block scalar: |
     
  more spaces at the beginning
  are invalid
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/WZ62", () => {
  // Spec Example 7.2. Empty Content
  const input: string = `{
  foo : !!str,
  !!str : bar,
}
`;

  const parsed = YAML.parse(input);

  const expected: any = { foo: "", "": "bar" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/X38W", () => {
  // Aliases in Flow Objects
  // Special case: *a references the same array as first key, creating duplicate key
  const input: string = `{ &a [a, &b b]: *b, *a : [c, *b, d]}
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    "a,b": ["c", "b", "d"],
  };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/X4QW", () => {
  // Comment without whitespace after block scalar indicator
  // Error test - expecting parse to fail
  const input: string = `block: ># comment
  scalar
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/X8DW", () => {
  // Explicit key and value seperated by comment
  const input: string = `---
? key
# comment
: value
`;

  const parsed = YAML.parse(input);

  const expected: any = { key: "value" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/XLQ9", () => {
  // Multiline scalar that looks like a YAML directive
  const input: string = `---
scalar
%YAML 1.2
`;

  const parsed = YAML.parse(input);

  const expected: any = "scalar %YAML 1.2";

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/XV9V", () => {
  // Spec Example 6.5. Empty Lines [1.3]
  const input: string = `Folding:
  "Empty line

  as a line feed"
Chomping: |
  Clipped empty lines
 

`;

  const parsed = YAML.parse(input);

  const expected: any = { Folding: "Empty line\nas a line feed", Chomping: "Clipped empty lines\n" };

  expect(parsed).toEqual(expected);
});

test.todo("yaml-test-suite/XW4D", () => {
  // Various Trailing Comments (using test.event for expected values)
  const input: string = `a: "double
  quotes" # lala
b: plain
 value  # lala
c  : #lala
  d
? # lala
 - seq1
: # lala
 - #lala
  seq2
e:
 &node # lala
 - x: y
block: > # lala
  abcde
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    a: "double quotes",
    b: "plain value",
    c: "d",
    seq1: ["seq2"],
    e: [{ x: "y" }],
    block: "abcde\n",
  };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/Y2GN", () => {
  // Anchor with colon in the middle
  const input: string = `---
key: &an:chor value
`;

  const parsed = YAML.parse(input);

  const expected: any = { key: "value" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/Y79Y/000", () => {
  // Tabs in various contexts
  // Error test - expecting parse to fail
  const input: string = `foo: |
	
bar: 1
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/Y79Y/001", () => {
  // Tabs in various contexts
  const input: string = `foo: |
 	
bar: 1
`;

  const parsed = YAML.parse(input);

  const expected: any = { foo: "\t\n", bar: 1 };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/Y79Y/002", () => {
  // Tabs in various contexts
  const input: string = `- [
	
 foo
 ]
`;

  const parsed = YAML.parse(input);

  const expected: any = [["foo"]];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/Y79Y/003", () => {
  // Tabs in various contexts
  // Error test - expecting parse to fail
  const input: string = `- [
	foo,
 foo
 ]
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/Y79Y/004", () => {
  // Tabs in various contexts
  // Error test - expecting parse to fail
  const input: string = `-	-
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test.todo("yaml-test-suite/Y79Y/005", () => {
  // Tabs in various contexts
  // Error test - expecting parse to fail
  const input: string = `- 	-
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test.todo("yaml-test-suite/Y79Y/006", () => {
  // Tabs in various contexts
  // Error test - expecting parse to fail
  const input: string = `?	-
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/Y79Y/007", () => {
  // Tabs in various contexts
  // Error test - expecting parse to fail
  const input: string = `? -
:	-
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test.todo("yaml-test-suite/Y79Y/008", () => {
  // Tabs in various contexts
  // Error test - expecting parse to fail
  const input: string = `?	key:
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/Y79Y/009", () => {
  // Tabs in various contexts
  // Error test - expecting parse to fail
  const input: string = `? key:
:	key:
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/Y79Y/010", () => {
  // Tabs in various contexts
  const input: string = `-	-1
`;

  const parsed = YAML.parse(input);

  const expected: any = [-1];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/YD5X", () => {
  // Spec Example 2.5. Sequence of Sequences
  const input: string = `- [name        , hr, avg  ]
- [Mark McGwire, 65, 0.278]
- [Sammy Sosa  , 63, 0.288]
`;

  const parsed = YAML.parse(input);

  const expected: any = [
    ["name", "hr", "avg"],
    ["Mark McGwire", 65, 0.278],
    ["Sammy Sosa", 63, 0.288],
  ];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/YJV2", () => {
  // Dash in flow sequence
  // Error test - expecting parse to fail
  const input: string = `[-]
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/Z67P", () => {
  // Spec Example 8.21. Block Scalar Nodes [1.3]
  const input: string = `literal: |2
  value
folded: !foo >1
 value
`;

  const parsed = YAML.parse(input);

  const expected: any = { literal: "value\n", folded: "value\n" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/Z9M4", () => {
  // Spec Example 6.22. Global Tag Prefix
  const input: string = `%TAG !e! tag:example.com,2000:app/
---
- !e!foo "bar"
`;

  const parsed = YAML.parse(input);

  const expected: any = ["bar"];

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/ZCZ6", () => {
  // Invalid mapping in plain single line value
  // Error test - expecting parse to fail
  const input: string = `a: b: c: d
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/ZF4X", () => {
  // Spec Example 2.6. Mapping of Mappings
  const input: string = `Mark McGwire: {hr: 65, avg: 0.278}
Sammy Sosa: {
    hr: 63,
    avg: 0.288
  }
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    "Mark McGwire": { hr: 65, avg: 0.278 },
    "Sammy Sosa": { hr: 63, avg: 0.288 },
  };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/ZH7C", () => {
  // Anchors in Mapping
  const input: string = `&a a: b
c: &d d
`;

  const parsed = YAML.parse(input);

  const expected: any = { a: "b", c: "d" };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/ZK9H", () => {
  // Nested top level flow mapping
  const input: string = `{ key: [[[
  value
 ]]]
}
`;

  const parsed = YAML.parse(input);

  const expected: any = {
    key: [[["value"]]],
  };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/ZL4Z", () => {
  // Invalid nested mapping
  // Error test - expecting parse to fail
  const input: string = `---
a: 'b': c
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test("yaml-test-suite/ZVH3", () => {
  // Wrong indented sequence item
  // Error test - expecting parse to fail
  const input: string = `- key: value
 - item1
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});

test.todo("yaml-test-suite/ZWK4", () => {
  // Key with anchor after missing explicit mapping value
  const input: string = `---
a: 1
? b
&anchor c: 3
`;

  const parsed = YAML.parse(input);

  const expected: any = { a: 1, b: null, c: 3 };

  expect(parsed).toEqual(expected);
});

test("yaml-test-suite/ZXT5", () => {
  // Implicit key followed by newline and adjacent value
  // Error test - expecting parse to fail
  const input: string = `[ "key"
  :value ]
`;

  expect(() => {
    return YAML.parse(input);
  }).toThrow();
});
