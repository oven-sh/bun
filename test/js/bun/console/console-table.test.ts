import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// `console.table` and `Bun.inspect.table` share the same native TablePrinter,
// so we can render in-process instead of spawning a subprocess per case.
// One difference to mirror so the existing snapshots stay valid: when the
// first argument is not an object, `console.table` falls back to
// `console.log`-style formatting, whereas `Bun.inspect.table` returns "".
function renderTable(...args: any[]): string {
  const [data, properties] = args;
  if (typeof data !== "object" || data === null) {
    // console.log(x): bare strings print raw, everything else is inspected.
    return (typeof data === "string" ? data : Bun.inspect(data)) + "\n";
  }
  return properties === undefined ? Bun.inspect.table(data) : Bun.inspect.table(data, properties);
}

// Strip cell contents, keeping only the header row's column names, so column
// model assertions don't depend on per-cell formatter output.
function columnNames(out: string): string[] {
  const header = out.split("\n")[1] ?? "";
  return header
    .split("│")
    .slice(2, -1)
    .map(s => s.trim());
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

  // https://nodejs.org/api/console.html#consoletabletabulardata-properties
  // Node builds the column union by assigning into a null-proto object keyed by
  // the ObjectKeys of each row, then reading it back with ObjectKeys. That
  // means: symbol keys are excluded, duplicate keys dedupe, and the final
  // column order is array-index names (sorted numerically) before string names
  // (first-seen). Set entries always render in a single Values column.
  describe("column model (node compat)", () => {
    test("symbol keys on a row are not columns", () => {
      const out = Bun.inspect.table([{ a: 1, [Symbol("s")]: 2, [Symbol("s")]: 3 }]);
      expect(columnNames(out)).toEqual(["a"]);
      expect(out).toBe(`┌───┬───┐\n│   │ a │\n├───┼───┤\n│ 0 │ 1 │\n└───┴───┘\n`);
    });

    test("symbol-keyed rows on a plain-object table are skipped", () => {
      const out = Bun.inspect.table({ x: { a: 1 }, [Symbol("y")]: { b: 2 } });
      expect(columnNames(out)).toEqual(["a"]);
      expect(out).toBe(`┌───┬───┐\n│   │ a │\n├───┼───┤\n│ x │ 1 │\n└───┴───┘\n`);
    });

    test("properties filter is deduplicated", () => {
      const out = Bun.inspect.table([{ a: 1, b: 2 }], ["b", "b", "a"]);
      expect(columnNames(out)).toEqual(["b", "a"]);
      expect(out).toBe(`┌───┬───┬───┐\n│   │ b │ a │\n├───┼───┼───┤\n│ 0 │ 2 │ 1 │\n└───┴───┴───┘\n`);
    });

    test("Set of objects renders a single Values column", () => {
      const out = Bun.inspect.table(new Set([1, { a: 2 }]));
      expect(columnNames(out)).toEqual(["Values"]);
      expect(out).toBe(
        `┌───┬──────────┐\n│   │ Values   │\n├───┼──────────┤\n│ 0 │ 1        │\n│ 1 │ { a: 2 } │\n└───┴──────────┘\n`,
      );
    });

    test("SetIterator of objects renders a single Values column", () => {
      const out = Bun.inspect.table(new Set([1, { a: 2 }]).values());
      expect(columnNames(out)).toEqual(["Values"]);
      expect(out).toBe(
        `┌───┬──────────┐\n│   │ Values   │\n├───┼──────────┤\n│ 0 │ 1        │\n│ 1 │ { a: 2 } │\n└───┴──────────┘\n`,
      );
    });

    test("properties filter is ignored for Set and Map inputs", () => {
      expect(columnNames(Bun.inspect.table(new Set([{ a: 1 }]), ["a"]))).toEqual(["Values"]);
      expect(columnNames(Bun.inspect.table(new Set([{ a: 1 }]).values(), ["a"]))).toEqual(["Values"]);
      expect(columnNames(Bun.inspect.table(new Map([["k", { a: 1 }]]), ["a"]))).toEqual(["Key", "Values"]);
    });

    test("multi-row column union puts integer-like keys first", () => {
      expect(columnNames(Bun.inspect.table([{ b: 1 }, { a: 2, "7": 3 }]))).toEqual(["7", "b", "a"]);
      expect(
        columnNames(
          Bun.inspect.table([
            { b: 1, "1": 2 },
            { "0": 3, a: 4 },
          ]),
        ),
      ).toEqual(["0", "1", "b", "a"]);
      expect(columnNames(Bun.inspect.table([{ "10": 1 }, { "2": 2 }, { "1": 3 }]))).toEqual(["1", "2", "10"]);
      // 4294967295 is not an array index; "01" and "-1" are string keys
      expect(columnNames(Bun.inspect.table([{ "4294967295": 1 }, { "4294967294": 2 }]))).toEqual([
        "4294967294",
        "4294967295",
      ]);
      expect(columnNames(Bun.inspect.table([{ "01": 1 }, { "0": 2 }]))).toEqual(["0", "01"]);
      expect(columnNames(Bun.inspect.table([{ "-1": 1 }, { "0": 2 }]))).toEqual(["0", "-1"]);
    });

    test("multi-row column union places cells in the right columns", () => {
      expect(Bun.inspect.table([{ b: 1 }, { a: 2, "7": 3 }])).toBe(
        `┌───┬───┬───┬───┐\n│   │ 7 │ b │ a │\n├───┼───┼───┼───┤\n│ 0 │   │ 1 │   │\n│ 1 │ 3 │   │ 2 │\n└───┴───┴───┴───┘\n`,
      );
    });

    test("properties filter is reordered and deduplicated together", () => {
      const out = Bun.inspect.table([{ a: 1, "7": 2 }], ["a", "7", "a", "7"]);
      expect(columnNames(out)).toEqual(["7", "a"]);
      expect(out).toBe(`┌───┬───┬───┐\n│   │ 7 │ a │\n├───┼───┼───┤\n│ 0 │ 2 │ 1 │\n└───┴───┴───┘\n`);
    });

    test("single-row integer-key order is unchanged", () => {
      expect(columnNames(Bun.inspect.table([{ a: 1, "0": 2, "42": 3, b: 4 }]))).toEqual(["0", "42", "a", "b"]);
    });

    // Checked via a spawned process so the assertion exercises console.table
    // itself, and so cell depth is the console.table default rather than
    // whatever Bun.inspect.table's option processing chose.
    test("console.table clamps cell depth and applies the column model", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `console.table([{ a: { x: { y: { z: 9 } } } }]);
console.table([{ a: 1, [Symbol("s")]: 2 }]);
console.table([{ a: 1, b: 2 }], ["b", "b", "a"]);
console.table(new Set([1, { a: 2 }]));
console.table([{ b: 1 }, { a: 2, "7": 3 }]);`,
        ],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const tables = stdout.split(/\n(?=┌)/);
      expect({ stderr, tableCount: tables.length }).toEqual({ stderr: "", tableCount: 5 });

      // (d) depth clamp: nested object under `x` must be truncated, not expanded
      expect(tables[0]).toContain("[Object");
      expect(tables[0]).not.toContain("z: 9");

      expect(columnNames(tables[1])).toEqual(["a"]);
      expect(columnNames(tables[2])).toEqual(["b", "a"]);
      expect(columnNames(tables[3])).toEqual(["Values"]);
      expect(columnNames(tables[4])).toEqual(["7", "b", "a"]);

      expect(exitCode).toBe(0);
    });
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
