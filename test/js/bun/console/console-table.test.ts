import { spawnSync } from "bun";
import { jscDescribe } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, withoutAggressiveGC } from "harness";

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
    ? Bun.inspect.table(data, { depth: 0 } as Bun.BunInspectOptions)
    : Bun.inspect.table(data, properties, { depth: 0 } as Bun.BunInspectOptions);
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

// Every cell must be read exactly once, matching Node. The table is built in
// two logical passes (column sizing, then rendering); re-reading in the second
// pass doubles getter side effects and renders the second call's value.
describe("console.table reads each cell once", () => {
  const box = (v: string) => `┌───┬───┐\n│   │ x │\n├───┼───┤\n│ 0 │ ${v} │\n└───┴───┘\n`;

  test("enumerable getter on an array row", () => {
    let calls = 0;
    const row = {};
    Object.defineProperty(row, "x", { get: () => ++calls, enumerable: true });
    const out = Bun.inspect.table([row]);
    expect({ calls, out }).toEqual({ calls: 1, out: box("1") });
  });

  test("enumerable getter with an explicit properties list", () => {
    let calls = 0;
    const row = {};
    Object.defineProperty(row, "x", { get: () => ++calls, enumerable: true });
    const out = Bun.inspect.table([row], ["x"]);
    expect({ calls, out }).toEqual({ calls: 1, out: box("1") });
  });

  test("getter on a plain-object row key", () => {
    let calls = 0;
    const data = {};
    Object.defineProperty(data, "r", {
      get() {
        calls++;
        return { a: calls };
      },
      enumerable: true,
    });
    const out = Bun.inspect.table(data);
    expect({ calls, out }).toEqual({
      calls: 1,
      out: `┌───┬───┐\n│   │ a │\n├───┼───┤\n│ r │ 1 │\n└───┴───┘\n`,
    });
  });

  test("a generator is not consumed twice", () => {
    function* rows() {
      yield { a: 1 };
      yield { a: 2 };
    }
    expect(Bun.inspect.table(rows())).toBe(`┌───┬───┐\n│   │ a │\n├───┼───┤\n│ 0 │ 1 │\n│ 1 │ 2 │\n└───┴───┘\n`);
  });

  test("getter on a primitive routed to the Values column", () => {
    let calls = 0;
    const data = {};
    Object.defineProperty(data, "a", { get: () => ++calls, enumerable: true });
    const out = Bun.inspect.table(data);
    expect({ calls, out }).toEqual({
      calls: 1,
      out: `┌───┬────────┐\n│   │ Values │\n├───┼────────┤\n│ a │ 1      │\n└───┴────────┘\n`,
    });
  });

  // String-ifying a cell runs user code. It must run exactly once per cell,
  // and the table must show that single call's result, not a later one's.
  test("a custom inspect on a cell value is invoked exactly once", () => {
    let calls = 0;
    const out = Bun.inspect.table([
      {
        x: {
          [Bun.inspect.custom]() {
            return "C" + ++calls;
          },
        },
      },
    ]);
    expect({ calls, out }).toEqual({
      calls: 1,
      out: `┌───┬────┐\n│   │ x  │\n├───┼────┤\n│ 0 │ C1 │\n└───┴────┘\n`,
    });
  });

  test("a throwing custom inspect in a cell still propagates", () => {
    const boom = new Error("boom");
    expect(() =>
      Bun.inspect.table([
        {
          x: {
            [Bun.inspect.custom]() {
              throw boom;
            },
          },
        },
      ]),
    ).toThrow(boom);
  });

  // Each getter runs arbitrary user code, including a full GC. The cell must
  // still render the value that its single read returned.
  test("cell values survive a full GC between the width and render passes", () => {
    const N = 64;
    const rows = Array.from({ length: N }, (_, i) => ({
      get x() {
        Bun.gc(true);
        return { id: i };
      },
    }));
    const out = Bun.inspect.table(rows);
    const missing: number[] = [];
    for (let i = 0; i < N; i++) if (!out.includes(`{ id: ${i} }`)) missing.push(i);
    expect(missing).toEqual([]);
  });

  // Cells are keyed by column index in the width pass. A row that revisits an
  // already-discovered column after creating a later one must not displace or
  // truncate the cells it already captured.
  test("a row whose key order differs from the column order", () => {
    expect(Bun.inspect.table([{ a: 1 }, { b: 2, a: 3 }])).toBe(
      `┌───┬───┬───┐\n│   │ a │ b │\n├───┼───┼───┤\n│ 0 │ 1 │   │\n│ 1 │ 3 │ 2 │\n└───┴───┴───┘\n`,
    );
  });

  // A single read per cell means the column is sized from the same value that
  // gets rendered: the [[Get]] result, matching Node. The old render pass
  // re-read through [[GetOwnProperty]], which a Proxy can observably diverge.
  test("a Proxy row renders the [[Get]] value the width pass saw", () => {
    const p = new Proxy({ x: "FROM_TARGET" }, { get: () => "FROM_GET" });
    expect(Bun.inspect.table([p])).toBe(
      `┌───┬──────────┐\n│   │ x        │\n├───┼──────────┤\n│ 0 │ FROM_GET │\n└───┴──────────┘\n`,
    );
  });

  test("console.table", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `let calls = 0;
const row = {};
Object.defineProperty(row, "x", { get: () => ++calls, enumerable: true });
console.table([row]);
console.log("calls=" + calls);`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: box("1") + "calls=1\n", stderr: "", exitCode: 0 });
  });
});

// A cell's column is found among the columns that earlier rows made, by which
// property name it is and not by the text of that name: compared with each of
// them while they are few, through an index once they are not
// (MAX_SCANNED_COLUMNS in ConsoleObject.rs). Both have to agree on which names
// are the same column, and neither may hand out the index or Values column.
describe("console.table column lookup", () => {
  // Two rows with the same 7-character keys, each cell holding its own key, so
  // the header and both rows render as the same line of 7-wide cells and the
  // whole table can be spelled out. The second row lists the keys in the
  // opposite order: each of its cells has to be found in the column the first
  // row created, not in the column at the same position.
  function wideTable(columns: number) {
    const keys = Array.from({ length: columns }, (_, i) => "c" + (100000 + i));
    const first: Record<string, string> = {};
    for (const key of keys) first[key] = key;
    const second: Record<string, string> = {};
    for (let i = keys.length - 1; i >= 0; i--) second[keys[i]] = keys[i];

    const rule = (left: string, mid: string, right: string) => {
      const segment = mid + "─────────";
      return left + "───" + Buffer.alloc(Buffer.byteLength(segment) * columns, segment).toString() + right + "\n";
    };
    const body = "│ " + keys.join(" │ ") + " │\n";
    const expected =
      rule("┌", "┬", "┐") + "│   " + body + rule("├", "┼", "┤") + "│ 0 " + body + "│ 1 " + body + rule("└", "┴", "┘");
    return { rows: [first, second], expected };
  }

  test("cells land in the column their name was first seen in", () => {
    const { rows, expected } = wideTable(300);
    expect(Bun.inspect.table(rows)).toBe(expected);
  });

  // Names with a text that defeats a lookup which hashes it: all of them have
  // one `Bun.hash.wyhash`. For a key of 16 bytes that hash no longer depends
  // on bytes 4..8 and 12..16 once the other eight are its second secret.
  const hex = (i: number) => i.toString(16).padStart(4, "0");
  const sameHashName = (i: number) => "\xd1\x7e\x03\xe7" + hex(i >>> 16) + "\xdb\x28\xb4\xa0" + hex(i & 0xffff);
  const plainName = (i: number) => "c" + (100000 + i);

  test("the names made to share one hash share it", () => {
    const hashes = Array.from({ length: 100 }, (_, i) => Bun.hash.wyhash(Buffer.from(sameHashName(i), "latin1")));
    expect(new Set(hashes).size).toBe(1);
  });

  // A table of up to three rows: `columns` names, the same names backwards,
  // as many new names. The first row makes its columns without a lookup, the
  // second finds each of them through the index, the third adds to the
  // index. `wider` is how many times as wide the wide table is on a release
  // build: wide enough there for each of these to fail when its part of the
  // lookup is taken out, narrow enough for main to fail in under 5 seconds.
  test.each([
    { shape: "one row of plain names", rows: 1, name: plainName, wider: 256 },
    { shape: "three rows of plain names", rows: 3, name: plainName, wider: 128 },
    { shape: "three rows of names that share one hash", rows: 3, name: sameHashName, wider: 128 },
  ])("rendering is linear in the number of columns: $shape", ({ rows, name, wider }) => {
    function table(columns: number) {
      const indexes = Array.from({ length: columns }, (_, i) => i);
      const row = (indexes: number[]) => Object.fromEntries(indexes.map(i => [name(i), i]));
      return [row(indexes), row(indexes.toReversed()), row(indexes.map(i => columns + i))].slice(0, rows);
    }

    // Whatever the names look like: no name made two columns, and the first
    // two rows have the same cells.
    function check(out: string, columns: number) {
      const lines = out.split("\n");
      expect({
        columns: lines[0].split("┬").length - 1,
        sameCells: rows < 2 || lines[3].slice("│ 0".length) === lines[4].slice("│ 1".length),
      }).toEqual({ columns: rows < 3 ? columns : 2 * columns, sameCells: true });
    }

    // CPU time leaves out the time that other processes run. On Windows it
    // only advances with the clock interrupt, about every 16 ms.
    const now = isWindows
      ? () => performance.now()
      : () => {
          const { user, system } = process.cpuUsage();
          return (user + system) / 1000;
        };

    function render(data: object[], times: number) {
      let out = "";
      const start = now();
      for (let i = 0; i < times; i++) out = Bun.inspect.table(data);
      const ms = now() - start;
      check(out, Object.keys(data[0]).length);
      return ms;
    }

    // `widthRatio` narrow tables have as many cells as one wide table, so the
    // two take about as long when the cost of a cell does not depend on the
    // width. The fastest of several runs has the least other work in it. A
    // build that fails takes long for the wide table, and does not repeat it.
    const widthRatio = isDebug || isASAN ? 64 : wider;
    const narrowColumns = isDebug || isASAN ? 32 : 125;
    const narrow = table(narrowColumns);
    const wide = table(narrowColumns * widthRatio);
    withoutAggressiveGC(() => {
      // A collection that starts during a measurement would be most of it.
      Bun.gc(true);
      let narrowMs = Infinity;
      for (let run = 0; run < 3; run++) narrowMs = Math.min(narrowMs, render(narrow, widthRatio));

      const deadline = performance.now() + 1_500;
      let wideMs = Infinity;
      do {
        Bun.gc(true);
        wideMs = Math.min(wideMs, render(wide, 1));
      } while (wideMs >= 4 * narrowMs && performance.now() < deadline);

      expect(wideMs / narrowMs).toBeLessThan(4);
    });
  });

  // The column names and the cells of each row, trimmed, without the row-index
  // column.
  function shape(table: string) {
    const cellsOf = (line: string) =>
      line
        .split("│")
        .slice(2, -1)
        .map(cell => cell.trim());
    const [, header, , ...lines] = table.split("\n");
    return { columns: cellsOf(header), cells: lines.slice(0, -2).map(cellsOf) };
  }

  // Enough columns to leave the scan behind. Keep it above MAX_SCANNED_COLUMNS.
  const fillerNames = Array.from({ length: 10 }, (_, i) => "f" + i);
  const filler = Object.fromEntries(fillerNames.map(name => [name, 0]));

  // `rows` on their own are narrow enough to be scanned. Behind a row of
  // filler columns, every one of their names goes through the index.
  function expectColumns(rows: unknown[], columns: string[], cells: string[][]) {
    expect(shape(Bun.inspect.table(rows))).toEqual({ columns, cells });

    const blank = (names: unknown[]) => names.map(() => "");
    expect(shape(Bun.inspect.table([filler, ...rows]))).toEqual({
      columns: [...fillerNames, ...columns],
      cells: [[...fillerNames.map(() => "0"), ...blank(columns)], ...cells.map(row => [...blank(fillerNames), ...row])],
    });
  }

  // What the table has to show: columns in first-seen order, a cell where the
  // row has that key.
  function expectedShape(rows: Record<string, unknown>[]) {
    const columns: string[] = [];
    for (const row of rows) for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key);
    return { columns, cells: rows.map(row => columns.map(key => (key in row ? String(row[key]) : ""))) };
  }

  test("rows that each share some columns with earlier rows and add their own", () => {
    // Row r has the keys k(2r) to k(2r+5), listed backwards on odd rows, so it
    // finds four columns of earlier rows and makes two. The columns grow past
    // the scan limit at the fourth row. Later rows find indexed columns and
    // columns that were added after the index was built.
    const rows = Array.from({ length: 12 }, (_, r) => {
      const keys = Array.from({ length: 6 }, (_, i) => "k" + (2 * r + i));
      if (r % 2) keys.reverse();
      return Object.fromEntries(keys.map(key => [key, r]));
    });
    expect(shape(Bun.inspect.table(rows))).toEqual(expectedShape(rows));
  });

  test("narrow rows after a wide first row", () => {
    const wide = Object.fromEntries(Array.from({ length: 20 }, (_, i) => ["w" + i, i]));
    const rows = [wide, { w19: "a", w0: "b" }, {}, { n0: 1, w7: 2 }, { n0: 3 }, wide];
    expect(shape(Bun.inspect.table(rows))).toEqual(expectedShape(rows));
  });

  test("names with non-ASCII characters are matched across rows", () => {
    // 日本 is stored as UTF-16, é as Latin-1.
    expectColumns(
      [
        { 日本: 1, é: 2 },
        { é: 3, 日本: 4 },
      ],
      ["日本", "é"],
      [
        ["1", "2"],
        ["4", "3"],
      ],
    );
  });

  test("the empty name is a column like any other", () => {
    expectColumns(
      [
        { "": 1, "a": 2 },
        { "a": 3, "": 4 },
      ],
      ["", "a"],
      [
        ["1", "2"],
        ["4", "3"],
      ],
    );
  });

  test("a property named like the index column gets its own column", () => {
    // The name " " trims to "" here. The point is the extra column.
    expectColumns([{ " ": 1 }, { " ": 2 }], [""], [["1"], ["2"]]);
  });

  test("a property named Values is separate from the Values column", () => {
    expectColumns(
      [{ Values: 1 }, 2, { Values: 3 }],
      ["Values", "Values"],
      [
        ["1", ""],
        ["", "2"],
        ["3", ""],
      ],
    );
  });

  test("one name spelled by different strings is one column", () => {
    // No string in this file spells these names, so the first row that has
    // one is where its text becomes a property name.
    const unique = Math.random().toString(36).slice(2);
    const narrow = "n" + unique;
    const late = "l" + unique;
    const wide = "日" + unique;
    const respell = (name: string) => name.slice(0, 1) + name.slice(1);
    // A flat 16-bit string keeps its storage when it becomes a property name.
    const in16Bit = (name: string) => new TextDecoder("utf-16le").decode(Buffer.from(name, "utf16le"));
    const rows = [
      { [in16Bit(narrow)]: 1, [respell(wide)]: 2, [respell(late)]: 9 },
      { [respell(narrow)]: 3, [respell(wide)]: 4, [in16Bit(late)]: 10 },
      JSON.parse(`{${JSON.stringify(wide)}:5,${JSON.stringify(narrow)}:6}`),
      JSON.parse(`{${JSON.stringify(narrow)}:7}`),
      new Proxy(
        {},
        {
          ownKeys: () => [respell(narrow), respell(wide)],
          getOwnPropertyDescriptor: () => ({ value: 8, enumerable: true, configurable: true }),
          get: () => 8,
        },
      ),
    ];
    // `narrow` is 16-bit although its text fits in 8 bits, and `late` is 8-bit
    // when its 16-bit spelling arrives.
    const stored = Object.fromEntries(Object.keys(rows[0]).map(key => [key, /8Bit:\(\d\)/.exec(jscDescribe(key))![0]]));
    expect(stored).toEqual({ [narrow]: "8Bit:(0)", [wide]: "8Bit:(0)", [late]: "8Bit:(1)" });
    expectColumns(
      rows,
      [narrow, wide, late],
      [
        ["1", "2", "9"],
        ["3", "4", "10"],
        ["6", "5", ""],
        ["7", "", ""],
        ["8", "8", ""],
      ],
    );
  });

  test("an index is one column for array rows and object rows", () => {
    expectColumns(
      [["a", "b"], { 1: "c", 0: "d" }, { "0": "e" }, new Uint8Array([7, 8])],
      ["0", "1"],
      [
        ["a", "b"],
        ["d", "c"],
        ["e", ""],
        ["7", "8"],
      ],
    );
  });

  test("a column keeps its name after the rows that had it are collected", () => {
    // Rows alternate between two sets of names, so the last row that had the
    // names of a new row is two collections back.
    const unique = Math.random().toString(36).slice(2);
    const families = ["gc", "zz"].map(prefix => Array.from({ length: 12 }, (_, i) => prefix + unique + i));
    const body = (row: number) => "{" + families[row % 2].map(name => JSON.stringify(name) + ":" + row).join(",") + "}";
    const collected: boolean[] = [];
    function* rows() {
      const refs: WeakRef<object>[] = [];
      for (let row = 0; row < 6; row++) {
        {
          const value = JSON.parse(body(row));
          refs.push(new WeakRef(value));
          yield value;
        }
        // The table can still hold the row it just read. The row before it
        // is garbage, and only the table still uses its names.
        Bun.gc(true);
        if (row > 0) collected.push(refs[row - 1].deref() === undefined);
      }
    }
    const blank = families[0].map(() => "");
    expect(shape(Bun.inspect.table(rows()))).toEqual({
      columns: families.flat(),
      cells: [0, 1, 2, 3, 4, 5].map(row => {
        const cells = families[0].map(() => String(row));
        return row % 2 ? [...blank, ...cells] : [...cells, ...blank];
      }),
    });
    expect(collected).toEqual([true, true, true, true, true]);
  });
});
