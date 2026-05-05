import { spawn, spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Kick off the subprocess immediately so multiple cases can overlap, then
// resolve to its stdout text. Tests stay sequential (snapshot matchers require
// it) but subprocess startup is parallelized.
function runTable(argSource: string): Promise<string> {
  const proc = spawn({
    cmd: [bunExe(), `${import.meta.dir}/console-table-run.ts`, argSource],
    stdout: "pipe",
    stderr: "inherit",
    env: bunEnv,
  });
  return proc.stdout.text();
}

describe("console.table", () => {
  test("throws when second arg is invalid", () => {
    expect(() => console.table({})).not.toThrow();
    expect(() => console.table({}, [])).not.toThrow();
    // @ts-expect-error
    expect(() => console.table({}, "invalid")).toThrow();
  });

  const cases: [string, { args: () => any[] }][] = [
    [
      "not object (number)",
      {
        args: () => [42],
      },
    ],
    [
      "not object (string)",
      {
        args: () => ["bun"],
      },
    ],
    [
      "object - empty",
      {
        args: () => [{}],
      },
    ],
    [
      "object",
      {
        args: () => [{ a: 42, b: "bun" }],
      },
    ],
    [
      "array - empty",
      {
        args: () => [[]],
      },
    ],
    [
      "array - plain",
      {
        args: () => [[42, "bun"]],
      },
    ],
    [
      "array - object",
      {
        args: () => [[{ a: 42, b: "bun" }]],
      },
    ],
    [
      "array - objects with diff props",
      {
        args: () => [[{ b: "bun" }, { a: 42 }]],
      },
    ],
    [
      "array - mixed",
      {
        args: () => [[{ a: 42, b: "bun" }, 42]],
      },
    ],
    [
      "set",
      {
        args: () => [new Set([42, "bun"])],
      },
    ],
    [
      "map",
      {
        args: () => [
          new Map<any, any>([
            ["a", 42],
            ["b", "bun"],
            [42, "c"],
          ]),
        ],
      },
    ],
    [
      "properties",
      {
        args: () => [[{ a: 42, b: "bun" }], ["b", "c", "a"]],
      },
    ],
    [
      "properties - empty",
      {
        args: () => [[{ a: 42, b: "bun" }], []],
      },
    ],
    [
      "properties - interesting character",
      {
        args: () => [
          {
            a: "_字",
          },
        ],
      },
    ],
    [
      "values - array",
      {
        args: () => [
          [
            { value: { a: 42, b: "bun" } },
            { value: [42, "bun"] },
            { value: new Set([42, "bun"]) },
            {
              value: new Map<any, any>([
                [42, "bun"],
                ["bun", 42],
              ]),
            },
          ],
        ],
      },
    ],
    [
      "headers object",
      {
        args: () => [
          new Headers([
            ["abc", "bun"],
            ["potato", "tomato"],
          ]),
        ],
      },
    ],
    [
      "number keys",
      {
        args: () => [{ test: { "10": 123, "100": 154 } }],
      },
    ],
  ];
  const outputs = new Map(cases.map(([label, { args }]) => [label, runTable(args.toString())]));

  test.each(cases)("expected output for: %s", async (label, { args }) => {
    const actualOutput = await outputs.get(label)!;
    expect(actualOutput).toMatchSnapshot();
    console.log(actualOutput);
  });
});

const jsonFixtureOutput = runTable(
  `(() => [${JSON.stringify(require("./console-table-json-fixture.json"), null, 2)}])`,
);
test("console.table json fixture", async () => {
  const actualOutput = (await jsonFixtureOutput)
    // todo: fix bug causing this to be necessary:
    .replaceAll("`", "'");
  expect(actualOutput).toMatchSnapshot();
  console.log(actualOutput);
});

function ansify(str: string) {
  return `\u001b[31m${str}\u001b[39m`;
}
const ansiObj = {
  [ansify("hello")]: ansify("this is a long string with ansi color codes"),
  [ansify("world")]: ansify("this is another long string with ansi color"),
  [ansify("foo")]: ansify("bar"),
};
const ansiColorsOutput = runTable(`(() => [${JSON.stringify(ansiObj, null, 2)}])`);
test("console.table ansi colors", async () => {
  const actualOutput = (await ansiColorsOutput)
    // todo: fix bug causing this to be necessary:
    .replaceAll("`", "'");
  expect(actualOutput).toMatchSnapshot();
  console.log(actualOutput);
});

test.skip("console.table character widths", () => {
  // note: this test cannot be automated because cannot test printed witdhs consistently.
  // so this test is just meant to be run manually

  // top ~2000 most used unicode codepoints
  const str = `~!@#$%^&*()_-+={[}]|:;"'<,>.?/¡¢£¤¥¦§¨©ª«¬ ®¯°±²³´µ¶·¸ʻ¹º»¼½¾¿ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿŁłŃńŅņŇňŊŋŌōŎŏŐőŒœŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŦŧŨũŪūŬŭŮůŰűŴŵŶŷŸŹźŻżŽžſƆƎƜɐɑɒɔɘəɛɜɞɟɡɢɣɤɥɨɪɬɮɯɰɴɵɶɷɸɹʁʇʌʍʎʞΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩαβγδεζηθικλμνξοπρςστυφχψωАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюяᴀᴁᴂᴃᴄᴅᴆᴇᴈᴉᴊᴋᴌᴍᴎᴏᴐᴑᴒᴓᴔᴕᴖᴗᴘᴙᴚᴛᴜᴝᴞᴟᴠᴡᴢᴣᴤᴥᴦᴧᴨᴩᴪẞỲỳỴỵỸỹ‐‑‒–—―‖‗‘’‚‛“”„‟†‡•‣․‥…‧‰‱′″‴‵‶‷‸‹›※‼‽‾‿⁀⁁⁂⁃⁄⁅⁆⁇⁈⁉⁊⁋⁌⁍⁎⁏⁐⁑⁒⁓⁔⁕⁗⁰ⁱ⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿ₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎₠₡₢₣₤₥₦₧₨₩₪₫€₭₮₯₰₱₲₳₴₵₶₷₸₹℀℁ℂ℃℄℅℆ℇ℈℉ℊℋℌℍℎℏℐℑℒℓ℔ℕ№℗℘ℙℚℛℜℝ℞℟℠℡™℣ℤ℥Ω℧ℨ℩Åℬℭ℮ℯℰℱℲℳℴℵℶℷℸ⅁⅂⅃⅄ⅅⅆⅇⅈⅉ⅋ⅎ⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞⅟ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫⅬⅭⅮⅯⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹⅺⅻⅼⅽⅾⅿↄ←↑→↓↔↕↖↗↘↙↚↛↜↝↞↟↠↡↢↣↤↥↦↧↨↩↪↫↬↭↮↯↰↱↲↳↴↵↶↷↸↹↺↻↼↽↾↿⇀⇁⇂⇃⇄⇅⇆⇇⇈⇉⇊⇋⇌⇍⇎⇏⇐⇑⇒⇓⇔⇕⇖⇗⇘⇙⇚⇛⇜⇝⇞⇟⇠⇡⇢⇣⇤⇥⇦⇧⇨⇩⇪⇫⇬⇭⇮⇯⇰⇱⇲⇳⇴⇵⇶⇷⇸⇹⇺⇻⇼⇽⇾⇿∀∁∂∃∄∅∆∇∈∉∊∋∌∍∎∏∐∑−∓∔∕∖∗∘∙√∛∜∝∞∟∠∡∢∣∤∥∦∧∨∩∪∫∬∭∮∯∰∱∲∳∴∵∶∷∸∹∺∻∼∽∾∿≀≁≂≃≄≅≆≇≈≉≊≋≌≍≎≏≐≑≒≓≔≕≖≗≘≙≚≛≜≝≞≟≠≡≢≣≤≥≦≧≨≩≪≫≬≭≮≯≰≱≲≳≴≵≶≷≸≹≺≻≼≽≾≿⊀⊁⊂⊃⊄⊅⊆⊇⊈⊉⊊⊋⊌⊍⊎⊏⊐⊑⊒⊓⊔⊕⊖⊗⊘⊙⊚⊛⊜⊝⊞⊟⊠⊡⊢⊣⊤⊥⊦⊧⊨⊩⊪⊫⊬⊭⊮⊯⊰⊱⊲⊳⊴⊵⊶⊷⊸⊹⊺⊻⊼⊽⊾⊿⋀⋁⋂⋃⋄⋅⋆⋇⋈⋉⋊⋋⋌⋍⋎⋏⋐⋑⋒⋓⋔⋕⋖⋗⋘⋙⋚⋛⋜⋝⋞⋟⋠⋡⋢⋣⋤⋥⋦⋧⋨⋩⋪⋫⋬⋭⋮⋯⋰⋱⌀⌁⌂⌃⌄⌅⌆⌇⌈⌉⌊⌋⌐⌑⌒⌓⌔⌕⌖⌗⌘⌙⌚⌛⌠⌡⌢⌣⌤⌥⌦⌧⌨⌫⌬⎛⎜⎝⎞⎟⎠⎡⎢⎣⎤⎥⎦⎧⎨⎩⎪⎫⎬⎭⏎⏏⏚⏛⏰⏱⏲⏳␢␣─━│┃┄┅┆┇┈┉┊┋┌┍┎┏┐┑┒┓└┕┖┗┘┙┚┛├┝┞┟┠┡┢┣┤┥┦┧┨┩┪┫┬┭┮┯┰┱┲┳┴┵┶┷┸┹┺┻┼┽┾┿╀╁╂╃╄╅╆╇╈╉╊╋╌╍╎╏═║╒╓╔╕╖╗╘╙╚╛╜╝╞╟╠╡╢╣╤╥╦╧╨╩╪╫╬╭╮╯╰╱╲╳╴╵╶╷╸╹╺╻╼╽╾╿▀▁▂▃▄▅▆▇█▉▊▋▌▍▎▏▐░▒▓▔▕▖▗▘▙▚▛▜▝▞▟■□▢▣▤▥▦▧▨▩▪▫▬▭▮▯▰▱▲△▴▵▶▷▸▹►▻▼▽▾▿◀◁◂◃◄◅◆◇◈◉◊○◌◍◎●◐◑◒◓◔◕◖◗◘◙◚◛◜◝◞◟◠◡◢◣◤◥◦◧◨◩◪◫◬◭◮◯◰◱◲◳◴◵◶◷◸◹◺◻◼◽◾◿☀☁☂☃☄★☆☇☈☉☊☋☌☍☎☏☐☑☒☓☔☕☖☗☘☙☚☛☜☝☞☟☠☡☢☣☤☥☦☧☨☩☪☫☬☭☮☯☰☱☲☳☴☵☶☷☸☹☺☻☼☽☾☿♀♁♂♃♄♅♆♇♈♉♊♋♌♍♎♏♐♑♒♓♔♕♖♗♘♙♚♛♜♝♞♟♠♡♢♣♤♥♦♧♨♩♪♫♬♭♮♯♲♳♴♵♶♷♸♹♺♻♼♽♾♿⚀⚁⚂⚃⚄⚅⚐⚑⚒⚓⚔⚕⚖⚗⚘⚙⚚⚛⚜⚝⚞⚟⚠⚡⚢⚣⚤⚥⚦⚧⚨⚩⚪⚫⚬⚭⚮⚯⚰⚱⚲⚳⚴⚵⚶⚷⚸⚹⚺⚻⚼⛀⛁⛂⛃⛢⛤⛥⛦⛧⛨⛩⛪⛫⛬⛭⛮⛯⛰⛱⛲⛳⛴⛵⛶⛷⛸⛹⛺⛻⛼⛽⛾⛿✁✂✃✄✅✆✇✈✉✊✋✌✍✎✏✐✑✒✓✔✕✖✗✘✙✚✛✜✝✞✟✠✡✢✣✤✥✦✧✨✩✪✫✬✭✮✯✰✱✲✳✴✵✶✷✸✹✺✻✼✽✾✿❀❁❂❃❄❅❆❇❈❉❊❋❌❍❎❏❐❑❒❓❔❕❖❗❘❙❚❛❜❝❞❟❠❡❢❣❤❥❦❧➔➘➙➚➛➜➝➞➟➠➡➢➣➤➥➦➧➨➩➪➫➬➭➮➯➱➲➳➴➵➶➷➸➹➺➻➼➽➾⟰⟱⟲⟳⟴⟵⟶⟷⟸⟹⟺⟻⟼⟽⟾⟿⤀⤁⤂⤃⤄⤅⤆⤇⤈⤉⤊⤋⤌⤍⤎⤏⤐⤑⤒⤓⤔⤕⤖⤗⤘⤙⤚⤛⤜⤝⤞⤟⤠⤡⤢⤣⤤⤥⤦⤧⤨⤩⤪⤫⤬⤭⤮⤯⤰⤱⤲⤳⤴⤵⤶⤷⤸⤹⤺⤻⤼⤽⤾⤿⥀⥁⥂⥃⥄⥅⥆⥇⥈⥉⥊⥋⥌⥍⥎⥏⥐⥑⬀⬁⬂⬃⬄⬅⬆⬇⬈⬉⬊⬋⬌⬍⬎⬏⬐⬑⬒⬓⬔⬕⬖⬗⬘⬙⬚ⱠⱡⱣⱥⱦⱭⱯⱰ⸢⸣⸤⸥⸮〃〄ﬀﬁﬂﬃﬄﬅﬆ﴾﴿﷼︐︑︒︓︔︕︖︗︘︙︰︱︲︳︴︵︶︷︸︹︺︻︼︽︾︿﹀﹁﹂﹃﹄﹅﹆﹉﹊﹋﹌﹍﹎﹏﹐﹑﹒﹔﹕﹖﹗﹘﹙﹚﹛﹜﹝﹞﹟﹠﹡﹢﹣﹤﹥﹦﹨﹩﹪﹫\ufeff！＂＃＄％＆＇（）＊＋，－．／０１２３４５６７８９：；＜＝＞？＠ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ［＼］＾＿｀ａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ｛｜｝～｟｠￠￡￢￣￤￥￦￼�`;
  const { stdout } = spawnSync({
    cmd: [
      bunExe(),
      `${import.meta.dir}/console-table-run.ts`,
      `(() => [${JSON.stringify([...str.matchAll(/.{16}|.+/g)].map(g => g[0].split("")))}])`,
    ],
    stdout: "pipe",
    stderr: "inherit",
    env: bunEnv,
  });
  const actualOutput = stdout.toString();

  console.log(actualOutput);
});

const repeat50Proc = spawn({
  cmd: [bunExe(), `${import.meta.dir}/console-table-repeat-50.ts`],
  stdout: "pipe",
  stderr: "pipe",
  env: bunEnv,
});
const repeat50Output = Promise.all([repeat50Proc.stdout.text(), repeat50Proc.stderr.text()]);
test("console.table repeat 50", async () => {
  const expected = `┌───┬───┐
│   │ n │
├───┼───┤
│ 0 │ 8 │
└───┴───┘
`;
  const [stdout, stderr] = await repeat50Output;

  expect(stdout).toBe(expected.repeat(50));
  expect(stderr).toBe("");
});

// https://github.com/oven-sh/bun/issues/29082 — cells containing C0 control
// characters used to be emitted raw, so an embedded \n moved the cursor
// mid-row and broke the table border. These tests exercise the targeted fix
// with discriminating assertions rather than snapshots, so a regression here
// points straight at the escaping logic instead of a snapshot diff.
describe.concurrent("console.table control-character escaping", () => {
  // Every `│`-delimited row must have the same number of separators as the
  // header — if any cell leaked an embedded newline, the count would differ.
  function assertRectangular(out: string) {
    const rows = out
      .split("\n")
      .filter(l => l.trim().length > 0)
      .filter(l => l.startsWith("│"));
    expect(rows.length).toBeGreaterThan(0);
    const expectedBars = rows[0]!.split("│").length;
    for (const row of rows) {
      expect(row.split("│").length).toBe(expectedBars);
    }
  }

  test("newline keeps the row on a single line", async () => {
    const out = await runTable(`(() => [{ foo: 123, bar: "Hello\\nWorld" }])`);
    assertRectangular(out);
    expect(out).toContain(`"Hello\\nWorld"`);
    // No raw literal newline mid-cell.
    expect(out).not.toMatch(/│[^│\n]*Hello\n/);
  });

  test("carriage return", async () => {
    const out = await runTable(`(() => [{ bar: "Line1\\rLine2" }])`);
    assertRectangular(out);
    expect(out).toContain(`"Line1\\rLine2"`);
  });

  test("tab", async () => {
    const out = await runTable(`(() => [{ bar: "tab\\there" }])`);
    assertRectangular(out);
    expect(out).toContain(`"tab\\there"`);
  });

  test("other C0 control chars (vertical tab, form feed, NUL)", async () => {
    // \v (0x0B), \f (0x0C), and \0 (NUL) also move the cursor or mismatch
    // the visible-width calculation — the fix covers the full C0 range
    // (0x00–0x1F except ESC), not just \n/\r/\t.
    const out = await runTable(`(() => [{ bar: "a\\vb\\fc\\x00d" }])`);
    assertRectangular(out);
    // Positive: cell rendered in its JSON-escaped form — \v/\f as short
    // escapes, NUL as \u0000.
    expect(out).toContain(`"a\\vb\\fc\\u0000d"`);
    // Negative: no C0 char survives raw (ESC 0x1B excluded — see ANSI test).
    expect(out).not.toMatch(/[\x00-\x08\x0B\x0C\x0E-\x1A\x1C-\x1F]/);
  });

  test("ANSI escape sequences (ESC) pass through unescaped so colors survive", async () => {
    // 0x1B is the first byte of every ANSI color sequence. VisibleCharacterCounter
    // already strips ANSI from the width calculation, so quoting these strings
    // would destroy chalk/picocolors output without fixing any layout bug.
    const out = await runTable(
      `(() => [[{ status: "\\x1b[31mFAIL\\x1b[0m" }, { status: "\\x1b[32mOK\\x1b[0m" }]])`,
    );
    assertRectangular(out);
    expect(out).toContain("\x1b[31mFAIL\x1b[0m");
    expect(out).toContain("\x1b[32mOK\x1b[0m");
    expect(out).not.toContain("\\u001b");
    expect(out).not.toContain("\\u001B");
  });

  test("plain strings stay unquoted", async () => {
    const out = await runTable(`(() => [{ foo: 123, bar: "Hello World" }])`);
    assertRectangular(out);
    expect(out).toContain("Hello World");
    // Plain strings are NOT promoted to the quoted form.
    expect(out).not.toContain(`"Hello World"`);
    expect(out).not.toContain(`'Hello World'`);
  });

  test("multiple newline cells in the same table", async () => {
    const out = await runTable(`(() => [[{ a: 1, b: "a\\nb\\nc" }, { a: 2, b: "plain" }]])`);
    assertRectangular(out);
    expect(out).toContain(`"a\\nb\\nc"`);
    expect(out).toContain("plain");
  });

  test("newlines in Map values", async () => {
    const out = await runTable(`(() => [new Map([["k1", "v1"], ["k2", "v\\n2"]])])`);
    assertRectangular(out);
    expect(out).toContain(`"v\\n2"`);
  });

  test("newlines in Set values", async () => {
    const out = await runTable(`(() => [new Set(["a", "b\\nc"])])`);
    assertRectangular(out);
    expect(out).toContain(`"b\\nc"`);
  });

  test("newlines in primitive arrays", async () => {
    const out = await runTable(`(() => [["hi", "a\\nb", "foo"]])`);
    assertRectangular(out);
    expect(out).toContain(`"a\\nb"`);
    // Plain entries stay unquoted.
    const rows = out.split("\n").filter(l => l.startsWith("│"));
    expect(rows.some(r => r.includes(" hi "))).toBe(true);
    expect(rows.some(r => r.includes(" foo "))).toBe(true);
  });

  test("properties arg respects newline escaping", async () => {
    const out = await runTable(`(() => [[{a:1, b:"x\\ny"}, {a:2, b:"normal"}], ["b"]])`);
    assertRectangular(out);
    expect(out).toContain(`"x\\ny"`);
    expect(out).toContain("normal");
  });

  test("object property keys with newlines are escaped in the index column", async () => {
    // When `console.table(obj)` is called with a plain object, the keys
    // populate the index column. A key containing \n used to emit a
    // literal newline in the index column and break the row layout the
    // same way data cells did before the fix.
    const out = await runTable(`(() => [{ ["a\\nb"]: 1, normal: 2 }])`);
    assertRectangular(out);
    expect(out).toContain(`"a\\nb"`);
    expect(out).toContain("normal");
  });
});
