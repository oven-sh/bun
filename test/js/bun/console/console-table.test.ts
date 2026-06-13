import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// `console.table` and `Bun.inspect.table` share the same native TablePrinter,
// so we can render in-process instead of spawning a subprocess per case.
// Two differences to mirror so the existing snapshots stay valid:
//   1. When the first argument is not an object, `console.table` falls back to
//      `console.log`-style formatting, whereas `Bun.inspect.table` returns "".
//   2. `console.table` formats cell values starting at depth 0, whereas
//      `Bun.inspect.table` starts at `max_depth` (5). Pass `{ depth: 0 }`
//      explicitly so nested objects in cells render the same way.
function renderTable(...args: any[]): string {
  const [data, properties] = args;
  if (typeof data !== "object" || data === null) {
    // console.log(x): bare strings print raw, everything else is inspected.
    return (typeof data === "string" ? data : Bun.inspect(data)) + "\n";
  }
  return properties === undefined
    ? Bun.inspect.table(data, { depth: 0 })
    : Bun.inspect.table(data, properties, { depth: 0 });
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

  test.each(cases)("expected output for: %s", (label, { args }) => {
    const actualOutput = renderTable(...args());
    expect(actualOutput).toMatchSnapshot();
  });
});

test("console.table json fixture", () => {
  const actualOutput = renderTable(require("./console-table-json-fixture.json"))
    // todo: fix bug causing this to be necessary:
    .replaceAll("`", "'");
  expect(actualOutput).toMatchSnapshot();
});

function ansify(str: string) {
  return `\u001b[31m${str}\u001b[39m`;
}
const ansiObj = {
  [ansify("hello")]: ansify("this is a long string with ansi color codes"),
  [ansify("world")]: ansify("this is another long string with ansi color"),
  [ansify("foo")]: ansify("bar"),
};
test("console.table ansi colors", () => {
  // String cell *values* that contain a control character (ESC, 0x1B) are
  // promoted to quoted/escaped form so the escape sequence is shown literally
  // instead of being interpreted by the terminal (issue #32223), matching
  // Node. The index-column *keys* are still rendered as-is, so their ANSI is
  // stripped for width and left intact, exercising the width calculation.
  const actualOutput = renderTable(ansiObj)
    // todo: fix bug causing this to be necessary:
    .replaceAll("`", "'");
  expect(actualOutput).toMatchSnapshot();
});

test.skip("console.table character widths", () => {
  // note: this test cannot be automated because cannot test printed witdhs consistently.
  // so this test is just meant to be run manually

  // top ~2000 most used unicode codepoints
  const str = `~!@#$%^&*()_-+={[}]|:;"'<,>.?/¡¢£¤¥¦§¨©ª«¬ ®¯°±²³´µ¶·¸ʻ¹º»¼½¾¿ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿŁłŃńŅņŇňŊŋŌōŎŏŐőŒœŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŦŧŨũŪūŬŭŮůŰűŴŵŶŷŸŹźŻżŽžſƆƎƜɐɑɒɔɘəɛɜɞɟɡɢɣɤɥɨɪɬɮɯɰɴɵɶɷɸɹʁʇʌʍʎʞΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩαβγδεζηθικλμνξοπρςστυφχψωАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюяᴀᴁᴂᴃᴄᴅᴆᴇᴈᴉᴊᴋᴌᴍᴎᴏᴐᴑᴒᴓᴔᴕᴖᴗᴘᴙᴚᴛᴜᴝᴞᴟᴠᴡᴢᴣᴤᴥᴦᴧᴨᴩᴪẞỲỳỴỵỸỹ‐‑‒–—―‖‗‘’‚‛“”„‟†‡•‣․‥…‧‰‱′″‴‵‶‷‸‹›※‼‽‾‿⁀⁁⁂⁃⁄⁅⁆⁇⁈⁉⁊⁋⁌⁍⁎⁏⁐⁑⁒⁓⁔⁕⁗⁰ⁱ⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿ₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎₠₡₢₣₤₥₦₧₨₩₪₫€₭₮₯₰₱₲₳₴₵₶₷₸₹℀℁ℂ℃℄℅℆ℇ℈℉ℊℋℌℍℎℏℐℑℒℓ℔ℕ№℗℘ℙℚℛℜℝ℞℟℠℡™℣ℤ℥Ω℧ℨ℩Åℬℭ℮ℯℰℱℲℳℴℵℶℷℸ⅁⅂⅃⅄ⅅⅆⅇⅈⅉ⅋ⅎ⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞⅟ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫⅬⅭⅮⅯⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹⅺⅻⅼⅽⅾⅿↄ←↑→↓↔↕↖↗↘↙↚↛↜↝↞↟↠↡↢↣↤↥↦↧↨↩↪↫↬↭↮↯↰↱↲↳↴↵↶↷↸↹↺↻↼↽↾↿⇀⇁⇂⇃⇄⇅⇆⇇⇈⇉⇊⇋⇌⇍⇎⇏⇐⇑⇒⇓⇔⇕⇖⇗⇘⇙⇚⇛⇜⇝⇞⇟⇠⇡⇢⇣⇤⇥⇦⇧⇨⇩⇪⇫⇬⇭⇮⇯⇰⇱⇲⇳⇴⇵⇶⇷⇸⇹⇺⇻⇼⇽⇾⇿∀∁∂∃∄∅∆∇∈∉∊∋∌∍∎∏∐∑−∓∔∕∖∗∘∙√∛∜∝∞∟∠∡∢∣∤∥∦∧∨∩∪∫∬∭∮∯∰∱∲∳∴∵∶∷∸∹∺∻∼∽∾∿≀≁≂≃≄≅≆≇≈≉≊≋≌≍≎≏≐≑≒≓≔≕≖≗≘≙≚≛≜≝≞≟≠≡≢≣≤≥≦≧≨≩≪≫≬≭≮≯≰≱≲≳≴≵≶≷≸≹≺≻≼≽≾≿⊀⊁⊂⊃⊄⊅⊆⊇⊈⊉⊊⊋⊌⊍⊎⊏⊐⊑⊒⊓⊔⊕⊖⊗⊘⊙⊚⊛⊜⊝⊞⊟⊠⊡⊢⊣⊤⊥⊦⊧⊨⊩⊪⊫⊬⊭⊮⊯⊰⊱⊲⊳⊴⊵⊶⊷⊸⊹⊺⊻⊼⊽⊾⊿⋀⋁⋂⋃⋄⋅⋆⋇⋈⋉⋊⋋⋌⋍⋎⋏⋐⋑⋒⋓⋔⋕⋖⋗⋘⋙⋚⋛⋜⋝⋞⋟⋠⋡⋢⋣⋤⋥⋦⋧⋨⋩⋪⋫⋬⋭⋮⋯⋰⋱⌀⌁⌂⌃⌄⌅⌆⌇⌈⌉⌊⌋⌐⌑⌒⌓⌔⌕⌖⌗⌘⌙⌚⌛⌠⌡⌢⌣⌤⌥⌦⌧⌨⌫⌬⎛⎜⎝⎞⎟⎠⎡⎢⎣⎤⎥⎦⎧⎨⎩⎪⎫⎬⎭⏎⏏⏚⏛⏰⏱⏲⏳␢␣─━│┃┄┅┆┇┈┉┊┋┌┍┎┏┐┑┒┓└┕┖┗┘┙┚┛├┝┞┟┠┡┢┣┤┥┦┧┨┩┪┫┬┭┮┯┰┱┲┳┴┵┶┷┸┹┺┻┼┽┾┿╀╁╂╃╄╅╆╇╈╉╊╋╌╍╎╏═║╒╓╔╕╖╗╘╙╚╛╜╝╞╟╠╡╢╣╤╥╦╧╨╩╪╫╬╭╮╯╰╱╲╳╴╵╶╷╸╹╺╻╼╽╾╿▀▁▂▃▄▅▆▇█▉▊▋▌▍▎▏▐░▒▓▔▕▖▗▘▙▚▛▜▝▞▟■□▢▣▤▥▦▧▨▩▪▫▬▭▮▯▰▱▲△▴▵▶▷▸▹►▻▼▽▾▿◀◁◂◃◄◅◆◇◈◉◊○◌◍◎●◐◑◒◓◔◕◖◗◘◙◚◛◜◝◞◟◠◡◢◣◤◥◦◧◨◩◪◫◬◭◮◯◰◱◲◳◴◵◶◷◸◹◺◻◼◽◾◿☀☁☂☃☄★☆☇☈☉☊☋☌☍☎☏☐☑☒☓☔☕☖☗☘☙☚☛☜☝☞☟☠☡☢☣☤☥☦☧☨☩☪☫☬☭☮☯☰☱☲☳☴☵☶☷☸☹☺☻☼☽☾☿♀♁♂♃♄♅♆♇♈♉♊♋♌♍♎♏♐♑♒♓♔♕♖♗♘♙♚♛♜♝♞♟♠♡♢♣♤♥♦♧♨♩♪♫♬♭♮♯♲♳♴♵♶♷♸♹♺♻♼♽♾♿⚀⚁⚂⚃⚄⚅⚐⚑⚒⚓⚔⚕⚖⚗⚘⚙⚚⚛⚜⚝⚞⚟⚠⚡⚢⚣⚤⚥⚦⚧⚨⚩⚪⚫⚬⚭⚮⚯⚰⚱⚲⚳⚴⚵⚶⚷⚸⚹⚺⚻⚼⛀⛁⛂⛃⛢⛤⛥⛦⛧⛨⛩⛪⛫⛬⛭⛮⛯⛰⛱⛲⛳⛴⛵⛶⛷⛸⛹⛺⛻⛼⛽⛾⛿✁✂✃✄✅✆✇✈✉✊✋✌✍✎✏✐✑✒✓✔✕✖✗✘✙✚✛✜✝✞✟✠✡✢✣✤✥✦✧✨✩✪✫✬✭✮✯✰✱✲✳✴✵✶✷✸✹✺✻✼✽✾✿❀❁❂❃❄❅❆❇❈❉❊❋❌❍❎❏❐❑❒❓❔❕❖❗❘❙❚❛❜❝❞❟❠❡❢❣❤❥❦❧➔➘➙➚➛➜➝➞➟➠➡➢➣➤➥➦➧➨➩➪➫➬➭➮➯➱➲➳➴➵➶➷➸➹➺➻➼➽➾⟰⟱⟲⟳⟴⟵⟶⟷⟸⟹⟺⟻⟼⟽⟾⟿⤀⤁⤂⤃⤄⤅⤆⤇⤈⤉⤊⤋⤌⤍⤎⤏⤐⤑⤒⤓⤔⤕⤖⤗⤘⤙⤚⤛⤜⤝⤞⤟⤠⤡⤢⤣⤤⤥⤦⤧⤨⤩⤪⤫⤬⤭⤮⤯⤰⤱⤲⤳⤴⤵⤶⤷⤸⤹⤺⤻⤼⤽⤾⤿⥀⥁⥂⥃⥄⥅⥆⥇⥈⥉⥊⥋⥌⥍⥎⥏⥐⥑⬀⬁⬂⬃⬄⬅⬆⬇⬈⬉⬊⬋⬌⬍⬎⬏⬐⬑⬒⬓⬔⬕⬖⬗⬘⬙⬚ⱠⱡⱣⱥⱦⱭⱯⱰ⸢⸣⸤⸥⸮〃〄ﬀﬁﬂﬃﬄﬅﬆ﴾﴿﷼︐︑︒︓︔︕︖︗︘︙︰︱︲︳︴︵︶︷︸︹︺︻︼︽︾︿﹀﹁﹂﹃﹄﹅﹆﹉﹊﹋﹌﹍﹎﹏﹐﹑﹒﹔﹕﹖﹗﹘﹙﹚﹛﹜﹝﹞﹟﹠﹡﹢﹣﹤﹥﹦﹨﹩﹪﹫\ufeff！＂＃＄％＆＇（）＊＋，－．／０１２３４５６７８９：；＜＝＞？＠ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ［＼］＾＿｀ａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ｛｜｝～｟｠￠￡￢￣￤￥￦￼�`;
  const { stdout } = spawnSync({
    cmd: [bunExe(), "-e", `console.table(${JSON.stringify([...str.matchAll(/.{16}|.+/g)].map(g => g[0].split("")))})`],
    stdout: "pipe",
    stderr: "inherit",
    env: bunEnv,
  });
  const actualOutput = stdout.toString();

  console.log(actualOutput);
});

test("console.table repeat 50", () => {
  const expected = `┌───┬───┐
│   │ n │
├───┼───┤
│ 0 │ 8 │
└───┴───┘
`;
  for (let i = 0; i < 50; i++) {
    expect(renderTable([{ n: 8 }])).toBe(expected);
  }
});

// https://github.com/oven-sh/bun/issues/32223
// `console.table` used to write control characters in string cells raw, which
// breaks the layout (\n, \r, \t) or is interpreted by the terminal (ANSI
// escapes). Node escapes them instead. These tests drive the real
// `console.table` through a subprocess and assert the table is undamaged.
describe.concurrent("console.table escapes control characters in string cells", () => {
  async function tableOutput(code: string): Promise<string> {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", code],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // Surface stderr if the subprocess failed so the crash is diagnosable. We
    // don't assert stderr is empty: debug/ASAN builds emit benign startup noise.
    if (exitCode !== 0) throw new Error(`console.table subprocess exited with ${exitCode}\nstderr:\n${stderr}`);
    return stdout;
  }

  // A well-formed table is rectangular: every non-empty line is framed by box
  // drawing characters on both ends and has the same display width. A control
  // character leaking into a cell breaks one or both of these.
  function assertRectangular(out: string) {
    const lines = out.split(/\r?\n/).filter(l => l.length > 0);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toMatch(/^[┌│├└]/u);
      expect(line).toMatch(/[┐│┤┘]$/u);
    }
    expect(new Set(lines.map(l => Bun.stringWidth(l))).size).toBe(1);
  }

  test("ANSI escape sequences are shown literally, not rendered", async () => {
    const out = await tableOutput(String.raw`console.table([{ value: "\x1b[32mhello\x1b[0m" }]);`);
    // The raw ESC byte must not leak into the output; it is escaped instead.
    expect(out).not.toContain("\x1b");
    expect(out).toContain("hello");
    assertRectangular(out);
  });

  test("embedded newline keeps the row on a single line", async () => {
    const out = await tableOutput(String.raw`console.table([{ v: "a\nb" }]);`);
    // Before the fix the literal newline split the data row, leaving a line
    // ("b │") that is not framed by the box border. assertRectangular catches it.
    assertRectangular(out);
  });

  test("embedded tab and carriage return do not corrupt the table", async () => {
    const out = await tableOutput(String.raw`console.table([{ v: "x\ty\rz" }]);`);
    expect(out).not.toContain("\t");
    // Normalize real CRLF line endings first; any remaining lone \r is a raw
    // carriage return that leaked into a cell.
    expect(out.replace(/\r\n/g, "\n")).not.toContain("\r");
    assertRectangular(out);
  });

  test("other C0 control characters (NUL, vertical tab, form feed) are escaped", async () => {
    const out = await tableOutput(String.raw`console.table([{ v: "a\x00b\x0bc\x0cd" }]);`);
    expect(out).not.toContain("\x00");
    expect(out).not.toContain("\x0b");
    expect(out).not.toContain("\x0c");
    assertRectangular(out);
  });

  test("plain string cells still render without surrounding quotes", async () => {
    // Bun deliberately prints clean string cells unquoted; the fix must not
    // change that for strings that contain no control characters.
    const out = await tableOutput(`console.table([{ a: 42, b: "bun" }]);`);
    expect(out).toContain(" bun ");
    expect(out).not.toContain('"bun"');
    expect(out).not.toContain("'bun'");
    assertRectangular(out);
  });
});
