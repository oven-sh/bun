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

// Rows that come from an iterator end when user code says so. A collection
// gives a replaced iterator as many steps as it reports elements. Any other
// iterable gets a budget of 1000 rows.
describe("console.table reads a bounded number of rows from an iterator", () => {
  function* rows(count: number) {
    for (let i = 0; i < count; i++) yield { n: i };
  }
  const lastLines = (text: string, count: number) => text.split("\n").slice(-count);

  test("a generator past the budget is cut and marked", () => {
    expect(lastLines(Bun.inspect.table(rows(1001)), 4)).toEqual([
      "│ 999 │ 999 │",
      "└─────┴─────┘",
      "... more rows",
      "",
    ]);
  });

  test("a generator that ends at the budget is not marked", () => {
    expect(lastLines(Bun.inspect.table(rows(1000)), 3)).toEqual(["│ 999 │ 999 │", "└─────┴─────┘", ""]);
  });

  test("an array, a typed array, a Map and a Set print every row", () => {
    const dataRows = (table: string) => table.split("\n").length - 5;
    expect({
      array: dataRows(Bun.inspect.table(Array.from(rows(1500)))),
      typedArray: dataRows(Bun.inspect.table(new Uint8Array(1500))),
      map: dataRows(Bun.inspect.table(new Map(Array.from({ length: 1500 }, (_, i) => [i, i])))),
      set: dataRows(Bun.inspect.table(new Set(Array.from({ length: 1500 }, (_, i) => i)))),
    }).toEqual({ array: 1500, typedArray: 1500, map: 1500, set: 1500 });
  });

  // Each child counts what its iterator hands out and exits with 2 well past
  // the budget, so the unfixed printer fails here at once and does not run
  // until memory is gone.
  const endless = `let yielded = 0;
function* endless() {
  for (;;) {
    if (++yielded > 5000) process.exit(2);
    yield { t: 1 };
  }
}`;

  async function run(source: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `${endless}\n${source}\nconsole.log("yielded=" + yielded);`],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { lines: stdout.split("\n"), stderr, exitCode };
  }

  test.concurrent("an iterator that never ends", async () => {
    const { lines, stderr, exitCode } = await run(`console.table({ host: "db1", [Symbol.iterator]: endless });`);
    expect(stderr).toBe("");
    // One read past the budget tells a cut table from one that ends there.
    expect(lines.slice(-5)).toEqual(["│ 999 │ 1 │", "└─────┴───┘", "... more rows", "yielded=1001", ""]);
    expect(exitCode).toBe(0);
  });

  // Only user code can make these iterable, so only the budget bounds the walk.
  test.concurrent.each([
    ["a WeakMap", `WeakMap.prototype[Symbol.iterator] = endless;\nconsole.table(new WeakMap());`],
    ["a WeakSet", `WeakSet.prototype[Symbol.iterator] = endless;\nconsole.table(new WeakSet());`],
    ["an ArrayBuffer", `ArrayBuffer.prototype[Symbol.iterator] = endless;\nconsole.table(new ArrayBuffer(1 << 20));`],
  ])("%s that user code made iterable", async (_, source) => {
    const { lines, stderr, exitCode } = await run(source);
    expect(stderr).toBe("");
    // Three header lines, the rows, the bottom border, then the three lines below.
    expect({ rows: lines.length - 7, tail: lines.slice(-3) }).toEqual({
      rows: 1000,
      tail: ["... more rows", "yielded=1001", ""],
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("an array whose iterator was replaced", async () => {
    const { lines, stderr, exitCode } = await run(
      `Array.prototype[Symbol.iterator] = endless;\nconsole.table([{ a: 1 }, { a: 2 }]);`,
    );
    expect(stderr).toBe("");
    expect(lines).toEqual([
      "┌───┬───┐",
      "│   │ t │",
      "├───┼───┤",
      "│ 0 │ 1 │",
      "│ 1 │ 1 │",
      "└───┴───┘",
      "... more rows",
      "yielded=3",
      "",
    ]);
    expect(exitCode).toBe(0);
  });

  test.concurrent("a Map whose iterator was replaced", async () => {
    const { lines, stderr, exitCode } = await run(
      `Map.prototype[Symbol.iterator] = function* () { for (const row of endless()) yield ["k", row.t]; };
console.table(new Map([["a", 1], ["b", 2]]));`,
    );
    expect(stderr).toBe("");
    // Two entries, so two steps, then one more to learn that the iterator had more.
    expect(lines).toEqual([
      "┌───┬─────┬────────┐",
      "│   │ Key │ Values │",
      "├───┼─────┼────────┤",
      "│ 0 │ k   │ 1      │",
      "│ 1 │ k   │ 1      │",
      "└───┴─────┴────────┘",
      "... more rows",
      "yielded=3",
      "",
    ]);
    expect(exitCode).toBe(0);
  });
});
