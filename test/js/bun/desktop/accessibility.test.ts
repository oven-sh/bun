import { hasLibrary } from "./library";

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const prelude = readFileSync(join(import.meta.dir, "accessibility.fixture.js"), "utf8");
const chromium = ["google-chrome-stable", "google-chrome", "chromium-browser", "chromium", "microsoft-edge"]
  .map(name => Bun.which(name))
  .find(Boolean);
const engine = {
  type: "chromium",
  path: process.env.BUN_CHROME_PATH ?? chromium,
  args: process.getuid?.() === 0 ? ["--no-sandbox"] : [],
};

/** What the app has printed. */
async function run(main: string, env = {}) {
  using dir = tempDir("accessibility", {
    "package.json": JSON.stringify({ name: "fixture", main: "main.js" }),
    "main.js": `${prelude}\napp.whenReady().then(async () => {${main}\n}).then(() => app.exit(0), error => { console.error(error); app.exit(1); });`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--preload=bun:desktop/electron", "."],
    env: { ...bunEnv, BUN_DESKTOP_HEADLESS: "1", XDG_CONFIG_HOME: String(dir), ...env },
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) throw new Error(`exited with ${exitCode}\n${stdout}\n${stderr}`);
  return stdout.trim();
}

const tree = (html: string) => run(`await open(${JSON.stringify(html)}); print(ask("tree root"));`);

describe.skipIf(!hasLibrary).concurrent("what a screen reader is told", () => {
  test("text, lists and landmarks", async () => {
    expect(
      await tree(`
        <nav aria-label=Site><a href=/a aria-current=page>Home</a></nav>
        <main><h2>Head <em>line</em></h2><p>Some <b>bold</b> text<br>more</p><ol><li>one<li>two</ol><pre><code><span>a</span> <span>b</span></code></pre>
        <img alt="A cat" width=9 height=9><img alt="" width=9 height=9><hr><p><span class=generated></span></p></main>
        <style>.generated::before { content: "*" / "star" }</style>`),
    ).toMatchInlineSnapshot(`
      "AXWebArea AXTitle="Title" AXFocused=true
        AXGroup AXLandmarkNavigation AXTitle="Site" AXDescription="Site"
          AXLink AXTitle="Home" AXDescription="Home"
            AXStaticText AXValue="Home"
        AXGroup AXLandmarkMain
          AXHeading AXTitle="Head line" AXValue=2
            AXStaticText AXValue="Head "
            AXGroup AXEmphasisStyleGroup
              AXStaticText AXValue="line"
          AXGroup
            AXStaticText AXValue="Some "
            AXStaticText AXValue="bold"
            AXStaticText AXValue=" text"
            AXGroup AXEmptyGroup
            AXStaticText AXValue="more"
          AXList AXContentList
            AXGroup
              AXListMarker AXValue="1. "
              AXStaticText AXValue="one"
            AXGroup
              AXListMarker AXValue="2. "
              AXStaticText AXValue="two"
          AXGroup
            AXGroup AXCodeStyleGroup
              AXStaticText AXValue="a"
              AXStaticText AXValue=" "
              AXStaticText AXValue="b"
          AXImage AXTitle="A cat" AXDescription="A cat"
          AXSplitter
          AXGroup
            AXStaticText AXValue="star""
    `);
  });

  test("controls", async () => {
    expect(
      await tree(`
        <label>Name <input value=Ann required></label><input type=password value=abc aria-label=Secret><input type=search placeholder=Find>
        <textarea aria-label=Notes>a\nb</textarea><label><input type=checkbox checked> Agree</label>
        <select aria-label=Size><option>S<option selected>M</select><input type=range aria-label=Volume value=30>
        <button aria-pressed=true>Bold</button><button aria-haspopup=dialog aria-expanded=false>More</button><button disabled title=Why>No</button>
        <progress value=1 max=4></progress><details><summary>Sum</summary>hidden</details>
        <div role=switch aria-checked=false tabindex=0>Wi-Fi</div><div role=tablist><div role=tab aria-selected=true>A</div><div role=tab>B</div></div>`),
    ).toMatchInlineSnapshot(`
      "AXWebArea AXTitle="Title" AXFocused=true
        AXGroup
          AXStaticText AXValue="Name "
          AXTextField AXTitle="Name" AXValue="Ann" AXRequired=true
        AXTextField AXSecureTextField AXTitle="Secret" AXDescription="Secret" AXValue="•••"
        AXTextField AXSearchField AXPlaceholderValue="Find"
        AXTextArea AXTitle="Notes" AXDescription="Notes" AXValue="a\\nb"
        AXCheckBox AXTitle="Agree" AXValue=1
        AXPopUpButton AXTitle="Size" AXDescription="Size" AXValue="M" AXExpanded=false
        AXSlider AXTitle="Volume" AXDescription="Volume" AXValue=30
        AXCheckBox AXToggleButton AXTitle="Bold" AXValue=1
        AXPopUpButton AXTitle="More" AXExpanded=false
        AXButton AXTitle="No" AXHelp="Why"
        AXProgressIndicator AXValue=1
        AXGroup
          AXButton AXTitle="Sum" AXExpanded=false
            AXStaticText AXValue="Sum"
        AXCheckBox AXSwitch AXTitle="Wi-Fi" AXValue=0
        AXTabGroup AXValue=AXRadioButton
          AXRadioButton AXTabButton AXTitle="A" AXValue=1 AXSelected=true
          AXRadioButton AXTabButton AXTitle="B" AXValue=0"
    `);
  });

  test("what is hidden, inert or owned by something else", async () => {
    expect(
      await tree(`
        <p hidden>a</p><p aria-hidden=true>b</p><p inert>c</p><p style="visibility:hidden">d<span style="visibility:visible">e</span></p>
        <p style="content-visibility:hidden">f</p><div role=list aria-owns=far></div><div><div role=listitem id=far>g</div></div>`),
    ).toMatchInlineSnapshot(`
      "AXWebArea AXTitle="Title" AXFocused=true
        AXStaticText AXValue="e"
        AXGroup AXEmptyGroup
        AXList AXContentList
          AXGroup
            AXStaticText AXValue="g""
    `);
  });

  test("what content-visibility: auto skips is read, and skipped again when the screen reader has gone", async () => {
    expect(
      await run(`
        const far = "<section style='content-visibility: auto; margin-top: 3000px'>";
        const page = await open(\`\${far}<h2>one</h2><p hidden>hidden</p>\${far}<ul><li id=deep>two</ul></section></section><p id=p style="content-visibility: hidden">never</p>\`);
        print(ask("tree root"));
        await page.executeJavaScript(\`p.insertAdjacentHTML("afterend", "\${far}<b id=late>late</b>")\`);
        await until(() => ask("tree #late") !== "?" || ask("tree root").includes("late"));
        ask("stop");
        await until(() => page.executeJavaScript("!deep.checkVisibility({ contentVisibilityAuto: true })"));`),
    ).toMatchInlineSnapshot(`
      "AXWebArea AXTitle="Title" AXFocused=true
        AXHeading AXTitle="one" AXValue=2
          AXStaticText AXValue="one"
        AXList AXContentList
          AXGroup
            AXListMarker AXValue="• "
            AXStaticText AXValue="two"
        AXGroup AXEmptyGroup"
    `);
  });

  test("a modal dialog hides the rest while it is open", async () => {
    expect(
      await run(`
        const page = await open('<button id=before>Open</button><dialog id=d aria-label=Sure><button id=yes>Yes</button></dialog>');
        await page.executeJavaScript("before.focus(); d.showModal()");
        print(...await hear("AXFocusedUIElementChanged #yes", /Focused/), ask("tree root"));
        press("Escape");
        print(...await hear("AXFocusedUIElementChanged #before", /Focused/), ask("tree root"));`),
    ).toMatchInlineSnapshot(`
      "AXFocusedUIElementChanged #yes
      AXWebArea AXTitle="Title"
        AXGroup AXApplicationDialog AXTitle="Sure" AXDescription="Sure"
          AXButton AXTitle="Yes" AXFocused=true
      AXFocusedUIElementChanged #before
      AXWebArea AXTitle="Title"
        AXButton AXTitle="Open" AXFocused=true"
    `);
  });

  test("role descriptions, positions in sets and relations", async () => {
    expect(
      await run(`
        await open(\`<aside id=a></aside><div id=d role=dialog aria-label=x>x</div><div id=r role=group aria-roledescription=slide>x</div><input id=e type=email>
          <div role=radiogroup><div role=radio id=one>1</div><span><div role=radio id=two>2</div></span></div>
          <input type=radio name=n id=n1><p>apart</p><input type=radio name=n id=n2>
          <div role=tree id=t><div role=treeitem id=top aria-expanded=true>a<div role=group><div role=treeitem id=low>b</div></div></div><div role=treeitem>c</div></div>
          <div role=separator id=s tabindex=0 aria-orientation=vertical aria-label=Resize aria-valuenow=20></div>
          <input id=bad aria-invalid=spelling aria-errormessage=why aria-controls=t aria-describedby=why><p id=why>Because</p>\`);
        for (const id of ["#a", "#d", "#r", "#e"]) print(...get(id, "AXRoleDescription"));
        for (const id of ["#two", "#n2", "#low"]) print(...get(id, "AXARIAPosInSet", "AXARIASetSize"));
        print(...get("#t", "AXRows"), ...get("#top", "AXDisclosing", "AXDisclosedRows"), ...get("#low", "AXDisclosureLevel", "AXDisclosedByRow", "AXIndex"));
        print(...get("#s", "AXRole", "AXTitle", "AXOrientation", "AXValue"), ...get("#bad", "AXInvalid", "AXErrorMessageElements", "AXLinkedUIElements"));`),
    ).toMatchInlineSnapshot(`
      "AXRoleDescription = "complementary"
      AXRoleDescription = "dialog"
      AXRoleDescription = "slide"
      AXRoleDescription = "email"
      AXARIAPosInSet = 2
      AXARIASetSize = 2
      AXARIAPosInSet = 2
      AXARIASetSize = 2
      AXARIAPosInSet = 1
      AXARIASetSize = 1
      AXRows = [#top, #low, AXRow]
      AXDisclosing = true
      AXDisclosedRows = [#low]
      AXDisclosureLevel = 1
      AXDisclosedByRow = #top
      AXIndex = 1
      AXRole = "AXSplitter"
      AXTitle = "Resize"
      AXOrientation = "AXVerticalOrientation"
      AXValue = 20
      AXInvalid = "spelling"
      AXErrorMessageElements = [#why]
      AXLinkedUIElements = [#t]"
    `);
  });

  test("tables", async () => {
    expect(
      await run(`
        await open(\`<table id=t><caption>Cap</caption><thead><tr><td><th id=a aria-sort=ascending>A<th id=b>B
          <tbody><tr><th id=one rowspan=2>1<td id=wide colspan=2>x<tr><td id=y>y<td id=z>z</table>\`);
        print(...get("#t", "AXTitle", "AXRowCount", "AXColumnCount", "AXColumnHeaderUIElements", "AXRowHeaderUIElements", "AXCellForColumnAndRow 2,1", "AXCellForColumnAndRow 0,2"));
        print(...get("#wide", "AXColumnIndexRange", "AXRowIndexRange", "AXColumnHeaderUIElements"));
        print(...get("#z", "AXColumnIndexRange", "AXRowIndexRange", "AXColumnHeaderUIElements", "AXRowHeaderUIElements"), ...get("#a", "AXSortDirection"));`),
    ).toMatchInlineSnapshot(`
      "AXTitle = "Cap"
      AXRowCount = 3
      AXColumnCount = 3
      AXColumnHeaderUIElements = [#a, #b]
      AXRowHeaderUIElements = [#one]
      AXCellForColumnAndRow 2,1 = #wide
      AXCellForColumnAndRow 0,2 = #one
      AXColumnIndexRange = 1..3
      AXRowIndexRange = 1..2
      AXColumnHeaderUIElements = [#a, #b]
      AXColumnIndexRange = 2..3
      AXRowIndexRange = 2..3
      AXColumnHeaderUIElements = [#b]
      AXRowHeaderUIElements = [#one]
      AXSortDirection = "AXAscendingSortDirection""
    `);
  });

  test("live regions", async () => {
    expect(
      await run(`
        const page = await open(\`<div role=status id=status></div><div aria-live=off id=off></div><div aria-live=polite aria-busy=true id=busy></div>
          <div aria-live=polite id=adds>x</div><div aria-live=polite aria-relevant=removals id=removes><p>x</p></div><div role=log id=last></div>\`);
        const after = async code => {
          await page.executeJavaScript(code + "; last.append('.')");
          print(code, ...await hear("AXLiveRegionChanged #last", /^AX(Live|Ann|ElementBusy)(?!.*#last)/));
        };
        await after("document.getElementById('status').textContent = 'done'");
        await after("document.getElementById('status').firstChild.data = 'again'");
        await after("off.textContent = busy.textContent = 'x'");
        await after("busy.ariaBusy = 'false'");
        await after("adds.replaceChildren(); removes.append('y')");
        await after("removes.replaceChildren()");
        await after("document.body.insertAdjacentHTML('beforeend', '<div role=alert id=alert>Oh no</div>')");
        await after("document.ariaNotify('low'); adds.ariaNotify('high', { priority: 'high' })");`),
    ).toMatchInlineSnapshot(`
      "document.getElementById('status').textContent = 'done'
      AXLiveRegionChanged #status
      document.getElementById('status').firstChild.data = 'again'
      AXLiveRegionChanged #status
      off.textContent = busy.textContent = 'x'
      busy.ariaBusy = 'false'
      AXElementBusyChanged #busy {AXElementBusy: false}
      AXLiveRegionChanged #busy
      adds.replaceChildren(); removes.append('y')
      removes.replaceChildren()
      AXLiveRegionChanged #removes
      document.body.insertAdjacentHTML('beforeend', '<div role=alert id=alert>Oh no</div>')
      AXLiveRegionCreated #alert
      AXLiveRegionChanged #alert
      document.ariaNotify('low'); adds.ariaNotify('high', { priority: 'high' })
      AXAnnouncementRequested window {AXAnnouncementKey: "low", AXPriorityKey: 50}
      AXAnnouncementRequested window {AXAnnouncementKey: "high", AXPriorityKey: 90}"
    `);
  });

  test.each([
    ["an input", `<input id=f value="héllo 😀 world">`],
    ["a textarea", `<textarea id=f>héllo 😀 world</textarea>`],
    ["an editing host", `<div id=f contenteditable><p>héllo 😀 world</p></div>`],
  ])("typing and moving in %s", async (_, html) => {
    expect(
      await run(`
        const page = await open(${JSON.stringify(html)});
        await page.executeJavaScript("f.focus()");
        await hear("AXSelectedTextChanged #f");
        const after = async (expected, ...key) => {
          press(...key);
          const info = (await hear(expected + " #f", /^\\w+ #f /)).join();
          print([key.join("+"), ...info.match(/(ChangeType|Direction|Granularity|EditType|ChangeValue): [^,]+/g), ...get("#f", "AXSelectedTextRange", "AXSelectedText")].join(", "));
        };
        await after("AXSelectedTextChanged", "Right");
        await after("AXSelectedTextChanged", "Right", "shift");
        await after("AXValueChanged", "x");
        await after("AXValueChanged", "l");
        await after("AXValueChanged", "Backspace");
        ask("set #f AXSelectedTextRange 6..8");
        await hear("AXSelectedTextChanged #f");
        print(...get("#f", "AXSelectedText", "AXNumberOfCharacters", "AXRangeForIndex 6", "AXStringForRange 6..10"));
        ask('set #f AXSelectedText "new"');
        await hear("AXValueChanged #f");
        print(...get("#f", "AXValue"));`),
    ).toBe(
      [
        `Right, ChangeType: 2, Direction: 4, Granularity: 1, AXSelectedTextRange = 1..1, AXSelectedText = ""`,
        `Right+shift, ChangeType: 3, Direction: 4, Granularity: 1, AXSelectedTextRange = 1..2, AXSelectedText = "é"`,
        `x, ChangeType: 1, Direction: 0, Granularity: 0, ChangeType: 1, EditType: 1, ChangeValue: "é", EditType: 3, ChangeValue: "x", AXSelectedTextRange = 2..2, AXSelectedText = ""`,
        `l, ChangeType: 1, Direction: 0, Granularity: 0, ChangeType: 1, EditType: 3, ChangeValue: "l", AXSelectedTextRange = 3..3, AXSelectedText = ""`,
        `Backspace, ChangeType: 1, Direction: 0, Granularity: 0, ChangeType: 1, EditType: 1, ChangeValue: "l", AXSelectedTextRange = 2..2, AXSelectedText = ""`,
        `AXSelectedText = "😀"`,
        `AXNumberOfCharacters = 14`,
        `AXRangeForIndex 6 = 6..8`,
        `AXStringForRange 6..10 = "😀 w"`,
        `AXValue = "hxllo new world"`,
      ].join("\n"),
    );
  });

  test("lines of fields", async () => {
    expect(
      await run(`
        const page = await open(\`<style>* { font: 10px/10px monospace; margin: 0; padding: 0; border: 0 } #a, #e { width: 5.5ch; display: block; overflow: hidden }</style>
          <textarea id=a rows=9>aaa bbb\\n\\nccc\\n</textarea><div id=e contenteditable><p>aaa bbb</p><p><br></p><p>ccc<br>ddd</p></div><div id=empty contenteditable><p><br></p></div>\`);
        for (const id of ["#a", "#e"]) print(...get(id, "AXValue", "AXRangeForLine 0", "AXRangeForLine 1", "AXRangeForLine 2", "AXRangeForLine 3", "AXLineForIndex 8", "AXLineForIndex 13"));
        const top = expression => +ask("get #e " + expression).split(" ")[1] - ask("get #e AXBoundsForRange 0..1").split(" ")[1];
        print(top("AXBoundsForRange 4..5"), top("AXBoundsForRange 8..8"), top("AXBoundsForRange 13..14"));
        await page.executeJavaScript("empty.focus()");
        await hear("AXFocusedUIElementChanged #empty");
        print(...get("#empty", "AXValue", "AXSelectedTextRange", "AXInsertionPointLineNumber"));`),
    ).toMatchInlineSnapshot(`
      "AXValue = "aaa bbb\\n\\nccc\\n"
      AXRangeForLine 0 = 0..4
      AXRangeForLine 1 = 4..8
      AXRangeForLine 2 = 8..9
      AXRangeForLine 3 = 9..13
      AXLineForIndex 8 = 2
      AXLineForIndex 13 = inf
      AXValue = "aaa bbb\\n\\nccc\\nddd"
      AXRangeForLine 0 = 0..4
      AXRangeForLine 1 = 4..8
      AXRangeForLine 2 = 8..9
      AXRangeForLine 3 = 9..13
      AXLineForIndex 8 = 2
      AXLineForIndex 13 = 4
      10
      20
      40
      AXValue = ""
      AXSelectedTextRange = 0..0
      AXInsertionPointLineNumber = 0"
    `);
  });

  test("text markers", async () => {
    expect(
      await run(`
        const page = await open('<p id=a>One tw<b>o</b> three. Four.</p><p id=b>Five <a href=/ id=link style="font-family: Given">six</a></p><button id=c>Seven</button>');
        const start = id => "AXTextMarkerRangeForUIElement " + id + " | AXStartTextMarkerForTextMarkerRange | ";
        const end = id => "AXTextMarkerRangeForUIElement " + id + " | AXEndTextMarkerForTextMarkerRange | ";
        const show = (...all) => print(...all.map(it => ask("get root " + it)));
        show("AXStartTextMarker", "AXEndTextMarker", "AXTextMarkerRangeForUIElement #a | AXStringForTextMarkerRange");
        show(start("#a") + "AXNextTextMarkerForTextMarker", end("#a") + "AXNextTextMarkerForTextMarker", start("#b") + "AXPreviousTextMarkerForTextMarker");
        show(start("#a") + "AXNextWordEndTextMarkerForTextMarker | AXNextWordEndTextMarkerForTextMarker | AXLeftWordTextMarkerRangeForTextMarker | AXStringForTextMarkerRange");
        show(start("#b") + "AXPreviousWordStartTextMarkerForTextMarker", start("#a") + "AXSentenceTextMarkerRangeForTextMarker | AXStringForTextMarkerRange");
        show(start("#link") + "AXLineTextMarkerRangeForTextMarker | AXStringForTextMarkerRange", start("#c") + "AXUIElementForTextMarker", "AXTextMarkerForIndex 24", start("#link") + "AXIndexForTextMarker");
        show("AXTextMarkerRangeForUIElement #link | AXAttributedStringForTextMarkerRange");
        ask("set root AXSelectedTextMarkerRange = AXTextMarkerRangeForUIElement #b");
        await hear("AXSelectedTextChanged");
        print(await page.executeJavaScript("String(getSelection())"));`),
    ).toMatchInlineSnapshot(`
      ""One tw"@0
      "Seven"@5
      "One two three. Four."
      "One tw"@1
      "Five "@0
      " three. Four."@13
      "two"
      " three. Four."@12
      "One two three. "
      "Five six"
      #c
      "Five "@3
      26
      "six" 0..3 AXLink #link, 0..3 AXUnderline 1, 0..3 AXForegroundColor #0000eeff, 0..3 AXFont {AXFontFamily: "Given", AXFontName: "Given", AXFontSize: 16}
      Five six"
    `);
  });

  test.each([
    ["<input id=x value='ab c'>"],
    ["<input id=x value=' ab,  c. '>"],
    ["<input id=x>"],
    ["<textarea id=x cols=6>one two three\\n\\n four.\\n</textarea>"],
    [
      "<div id=x contenteditable style='width: 5ch'><p>one two<br><br>three</p><p><br></p><p>f<b>ou</b>r <img alt=i> </p></div>",
    ],
    [
      "<div id=x role=group><h1>One. Two</h1><img alt=i><input value=a><pre>a\\n\\nb\\n</pre><hr><ul><li>😀 漢字<li></ul></div>",
    ],
  ])("questions about text markers lead on, or say that there is no more: %s", async html => {
    expect(
      await run(`
        for (const around of ["", "<p>around</p>"]) {
          window?.destroy();
          protocol.isProtocolHandled("app") && protocol.unhandle("app");
          await open(around + "${html}" + around);
          const length = +ask("get root AXEndTextMarker | AXIndexForTextMarker");
          const same = (a, b) => ask("get root " + a).replace(/@0$/, "") === ask("get root " + b).replace(/@0$/, "");
          const ranges = ["LeftWord", "RightWord", "LeftLine", "RightLine"].map(it => "AX" + it + "TextMarkerRange");
          const steps = ["", "Word", "Line", "Sentence", "Paragraph"].flatMap(it => ["AXNext" + it + (it && "End"), "AXPrevious" + it + (it && "Start")]).map(it => it + "TextMarker");
          for (const name of [...ranges, ...steps]) {
            const leadsOn = /Next|Right/.test(name);
            const far = name.endsWith("Range") ? " | AX" + (leadsOn ? "End" : "Start") + "TextMarkerForTextMarkerRange" : "";
            for (let index = 0; index <= length; index++) {
              for (const first of ["AXTextMarkerForIndex " + index, "AXTextMarkerForIndex " + index + " | AXNextWordEndTextMarkerForTextMarker"]) {
                for (let at = first, count = 0; ask("get root " + at) !== "nil"; count++) {
                  const answer = at + " | " + name + "ForTextMarker";
                  const ends = ask("get root " + answer).split("..");
                  if (far && same(at, answer + far) && ends[0] === ends[1]) break;
                  const [from, to] = [at, answer + far].map(it => +ask("get root " + it + " | AXIndexForTextMarker"));
                  if ((leadsOn ? to < from : to > from) || count > length + 9) {
                    print(name + " from " + first + " is stuck at " + ask("get root " + at));
                    break;
                  }
                  at = answer + far;
                }
              }
            }
          }
        }`),
    ).toBe("");
  });

  test("words beside a text marker", async () => {
    expect(
      await run(`
        await open("<input id=x value='ab  c'>");
        for (const side of ["Left", "Right"]) {
          print([0, 1, 2, 3, 4, 5].map(it => ask("get #x AXTextMarkerForIndex " + it + " | AX" + side + "WordTextMarkerRangeForTextMarker | AXStringForTextMarkerRange")).join());
        }`),
    ).toBe(`"","a","ab"," ","  ","c"\n"ab","b","  "," ","c",""`);
  });

  test("the rotor", async () => {
    expect(
      await run(`
        await open('<nav id=n><a href=/ id=a>a</a></nav><h1 id=h1>x</h1><input id=i><h2 id=h2>y</h2><table id=t><tr><th>z</table><h1 id=h3>z</h1><button id=b>b</button>');
        const search = (...all) => print(...get("root", ...all.map(it => "AXUIElementsForSearchPredicate ?" + it)));
        search("AXHeadingSearchKey", "AXHeadingSearchKey #i", "AXHeadingSearchKey #h3 back", "AXHeadingLevel2SearchKey", "AXHeadingSameLevelSearchKey #h1");
        search("AXLinkSearchKey,AXButtonSearchKey", "AXLandmarkSearchKey", "AXControlSearchKey", "AXTableSearchKey", "AXTextFieldSearchKey");`),
    ).toMatchInlineSnapshot(`
      "AXUIElementsForSearchPredicate ?AXHeadingSearchKey = [#h1, #h2, #h3]
      AXUIElementsForSearchPredicate ?AXHeadingSearchKey #i = [#h2, #h3]
      AXUIElementsForSearchPredicate ?AXHeadingSearchKey #h3 back = [#h2, #h1]
      AXUIElementsForSearchPredicate ?AXHeadingLevel2SearchKey = [#h2]
      AXUIElementsForSearchPredicate ?AXHeadingSameLevelSearchKey #h1 = [#h3]
      AXUIElementsForSearchPredicate ?AXLinkSearchKey,AXButtonSearchKey = [#a, #b]
      AXUIElementsForSearchPredicate ?AXLandmarkSearchKey = [#n]
      AXUIElementsForSearchPredicate ?AXControlSearchKey = [#i, #b]
      AXUIElementsForSearchPredicate ?AXTableSearchKey = [#t]
      AXUIElementsForSearchPredicate ?AXTextFieldSearchKey = [#i]"
    `);
  });

  test("actions", async () => {
    expect(
      await run(`
        const page = await open(\`<button id=b>b</button><input type=checkbox id=c><input type=range id=r><details><summary id=s>s</summary>x</details>
          <select id=sel><option id=x>x<option id=y>y</select><button id=no disabled>no</button><p id=far style="margin-top: 2000px">far</p>
          <script>seen = []; for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) b.addEventListener(type, e => seen.push(type + e.isTrusted))</script>\`);
        const after = async (question, expected) => (ask(question), print(question, ...await hear(expected, /^AX(Value|Expanded|Menu)/)));
        await after("do #b AXPress", "AXFocusedUIElementChanged #b");
        print(await page.executeJavaScript("seen.join() + navigator.userActivation.hasBeenActive"));
        await after("do #c AXPress", "AXValueChanged #c");
        await after("do #r AXIncrement", "AXValueChanged #r");
        print(ask("set #r AXValue 70"));
        await after("set #s AXExpanded 1", "AXExpandedChanged #s");
        await after("do #sel AXPress", "AXMenuOpened");
        print(ask("tree #sel"));
        await after("do #y AXPress", "AXMenuClosed");
        print(...get("#r", "AXValue"), ...get("#sel", "AXValue"), ask("names #no").replace(/.* AXVisited /, ""));
        ask("do #far AXScrollToVisible");
        await until(() => ask("get #far AXPosition").split(" ")[1] < 300);`),
    ).toMatchInlineSnapshot(`
      "do #b AXPress
      pointerdowntrue,mousedowntrue,pointeruptrue,mouseuptrue,clicktruetrue
      do #c AXPress
      AXValueChanged #c
      do #r AXIncrement
      AXValueChanged #r
      false
      set #s AXExpanded 1
      AXExpandedChanged #s
      do #sel AXPress
      AXMenuOpened AXMenu
      AXExpandedChanged #sel
      AXMenuItemSelected #x
      AXPopUpButton AXValue="x" AXExpanded=true
        AXMenu
          AXMenuItem AXValue="x" AXFocused=true AXSelected=true
          AXMenuItem AXValue="y"
      do #y AXPress
      AXMenuClosed AXWebArea
      AXValueChanged #sel
      AXExpandedChanged #sel
      AXValue = 51
      AXValue = "y"
      AXShowMenu AXScrollToVisible"
    `);
  });

  test("text is not typed into what has taken the focus away", async () => {
    expect(
      await run(`
        const page = await open("<input id=a value=a><input id=b value=b>");
        page.debugger.attach();
        await page.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
        await page.executeJavaScript("a.onfocus = () => b.focus(); 0");
        ask('set #a AXValue "secret"');
        await until(() => page.executeJavaScript("document.activeElement === b"));
        print(await page.executeJavaScript("a.value + b.value"));`),
    ).toBe("ab");
  });

  test("the events of a press", async () => {
    expect(
      await run(`
        const page = await open(\`<input id=i style="position: absolute; inset: 10px; width: 20px; height: 20px; box-sizing: border-box"><script>
          const seen = [];
          for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
            i.addEventListener(type, it => seen.push([type, it.isTrusted, it.pointerType, it.pressure, it.buttons, it.detail, it.clientX, i.matches(":active")].join()));
          }
        </script>\`);
        ask("do #i AXPress");
        print(await until(() => page.executeJavaScript("seen.length === 5 && seen.join(' ')")));`),
    ).toBe(
      "pointerdown,true,mouse,0,1,0,20,false mousedown,true,,,1,0,20,false " +
        "pointerup,true,mouse,0,0,0,20,true mouseup,true,,,0,0,20,true click,true,mouse,0,1,1,20,false",
    );
  });

  test("the active descendant", async () => {
    expect(
      await run(`
        const page = await open(\`<div role=listbox id=l tabindex=0 aria-activedescendant=a><div role=option id=a>a</div><div role=option id=b>b</div></div>
          <input role=combobox id=c aria-expanded=true aria-controls=l>\`);
        await page.executeJavaScript("l.focus()");
        print(...await hear("AXFocusedUIElementChanged #a", /Focused/));
        await page.executeJavaScript("l.ariaActiveDescendantElement = b; 0");
        print(...await hear("AXFocusedUIElementChanged #b", /Focused/));
        await page.executeJavaScript("c.focus(); c.setAttribute('aria-activedescendant', 'a')");
        print(...await hear("AXFocusedUIElementChanged #a", /Focused/), ...get("#c", "AXSelectedChildren", "AXOwns"), ...get("#a", "AXFocused", "AXARIAPosInSet"));
        print(ask("names #a").includes("AXARIAPosInSet"));`),
    ).toMatchInlineSnapshot(`
      "AXFocusedUIElementChanged #a
      AXFocusedUIElementChanged #b
      AXFocusedUIElementChanged #a
      AXSelectedChildren = [#a]
      AXOwns = [#l]
      AXFocused = true
      AXARIAPosInSet = 1
      false"
    `);
  });

  test("a choice among many, and a completion", async () => {
    expect(
      await run(`
        const page = await open(\`<div role=listbox id=l tabindex=0 aria-multiselectable=true aria-activedescendant=a><div role=option id=a aria-selected=false>a</div></div>
          <input role=combobox id=c value=ap>\`);
        await page.executeJavaScript("l.focus()");
        await hear("AXFocusedUIElementChanged #a");
        await page.executeJavaScript("a.ariaSelected = 'true'");
        print(...await hear("AXFocusedUIElementChanged #a"));
        await page.executeJavaScript("c.focus()");
        await hear("AXFocusedUIElementChanged #c");
        await page.executeJavaScript("c.value = 'apple'");
        print((await hear("AXValueChanged #c", /^AXValueChanged #c/))[0].match(/(EditType|ChangeValue): [^,]+/g));`),
    ).toMatchInlineSnapshot(`
      "AXUIElementDestroyed #a
      AXFocusedUIElementChanged #a
      EditType: 2,ChangeValue: "apple""
    `);
  });

  test("what is at a point is what is painted last", async () => {
    expect(
      await run(`
        const page = await open(\`<style>* { margin: 0 } main, i, button, p { position: absolute; width: 20px; height: 20px } main { width: 400px; height: 300px }</style>
          <i id=side style="z-index: 2"><button id=raised>a</button></i>
          <i style="left: 20px; isolation: isolate"><button id=trapped style="z-index: 9">b</button></i>
          <i style="left: 40px"><button id=escaped style="z-index: 9">c</button></i>
          <span aria-owns=menu></span>
          <main id=main><button id=later style="left: 60px">d</button><button id=field style="left: 80px">e</button><p style="left: 80px; pointer-events: none" id=hint role=note>f</p>
            <button id=below style="left: 100px; z-index: -1">g</button><button id=covered style="left: 120px; z-index: 99999999">h</button></main>
          <p role=menu id=menu style="left: 60px"></p><p role=note popover id=up style="left: 120px; top: 0; padding: 0; border: 0"></p><script>up.showPopover()</script>\`);
        const hits = () => [10, 30, 50, 70, 90, 110, 130, 150].map(x => ask("hit root " + x + ",10")).join(" ");
        print(hits(), ask("hit #main 70,10"));
        await page.executeJavaScript("side.style.zIndex = ''; hint.style.pointerEvents = ''");
        await until(() => hits().startsWith("#main"));
        print(hits());`),
    ).toMatchInlineSnapshot(`
      "#raised #main #escaped #menu #field #below #up #main
      #later
      #main #main #escaped #menu #hint #below #up #main"
    `);
  });

  test("what only holds what takes the focus is no stop for the keyboard", async () => {
    expect(
      await run(`
        await open('<div role=group tabindex=-1><button id=a>a</button></div><div role=region aria-label=r id=r tabindex=0>r</div><div role=listbox id=l tabindex=0><p role=option>o</div><a href=/ id=k><button id=b>b</button></a>');
        print(ask("get root AXUIElementsForSearchPredicate ?AXKeyboardFocusableSearchKey"));`),
    ).toBe("[#a, #r, #l, #k, #b]");
  });

  test("the selection follows the focus unless the author says what is selected", async () => {
    expect(
      await run(`
        const list = (id, first, own = "") => \`<div role=listbox id=\${id} tabindex=0 aria-activedescendant=\${id}2 \${own}><p role=option id=\${id}1 \${first}>1<p role=option id=\${id}2>2</div>\`;
        const page = await open(list("a", "") + list("b", "aria-selected=true") + list("c", "aria-checked=true") + list("d", "", "aria-multiselectable=true") +
          "<select id=s><option id=x>x<option id=y>y</select>");
        for (const id of "abcd") {
          await page.executeJavaScript(id + ".focus()");
          await hear("AXFocusedUIElementChanged #" + id + 2);
          print(...get("#" + id, "AXSelectedChildren"));
        }
        await page.executeJavaScript("a.focus(); a1.ariaSelected = 'false'");
        await hear("AXFocusedUIElementChanged #a2");
        print(...get("#a", "AXSelectedChildren"));
        ask("do #s AXPress");
        await hear("AXMenuOpened");
        press("Down");
        print(...await hear("AXMenuItemSelected #y", /Selected.* (#y|AXMenu$)/), ...get("#s>0", "AXSelectedChildren"));`),
    ).toMatchInlineSnapshot(`
      "AXSelectedChildren = [#a2]
      AXSelectedChildren = [#b1]
      AXSelectedChildren = []
      AXSelectedChildren = []
      AXSelectedChildren = []
      AXSelectedChildrenChanged AXMenu
      AXMenuItemSelected #y
      AXSelectedChildren = [#y]"
    `);
  });

  test("a field is not invalid because it is empty", async () => {
    expect(
      await run(`
        const page = await open(\`<form id=f><input required id=a><textarea required id=b></textarea><input type=email value=x id=c><input type=email value=x aria-invalid=false id=d>
          <input type=checkbox required id=e></form>\`);
        const all = () => [..."fabcde"].map(id => ask("get #" + id + " AXInvalid")).join();
        print(all());
        await page.executeJavaScript("b.setCustomValidity('no'); c.value = ''; document.ariaNotify('')");
        await hear("AXInvalidStatusChanged #b");
        print(all());`),
    ).toMatchInlineSnapshot(`
      ""false","false","false","true","false","true"
      "false","false","true","false","false","true""
    `);
  });

  test("a span is no group, however it is laid out", async () => {
    expect(
      await tree(
        `<div role=menu><div role=menuitem style=display:flex><span></span><span>Add</span></div></div><span style=display:block>block</span>`,
      ),
    ).toMatchInlineSnapshot(`
      "AXWebArea AXTitle="Title" AXFocused=true
        AXMenu
          AXMenuItem AXTitle="Add"
        AXStaticText AXValue="block""
    `);
  });

  test("places follow scrolling, transforms and zoom", async () => {
    expect(
      await run(`
        const page = await open(\`<style>* { margin: 0 } p { width: 20px; height: 10px }</style>
          <div id=s style="height: 50px; overflow: auto"><p id=a style="margin-top: 100px">a</p></div><p id=t style="transform: translate(5px, 5px) scale(2); transform-origin: 0 0">t</p>\`);
        print(...get("#a", "AXFrame"), ...get("#t", "AXFrame"));
        await page.executeJavaScript("s.scrollTop = 60");
        await until(() => ask("get #a AXFrame") === "0 40 20 10");
        page.setZoomFactor(2);
        await until(() => ask("get #a AXFrame") === "0 80 40 20");`),
    ).toMatchInlineSnapshot(`
      "AXFrame = 0 100 20 10
      AXFrame = 5 55 40 20"
    `);
  });

  test("a frame without a size has a place", async () => {
    expect(
      await run(`
        await open('<iframe id=outer src=/in title=Inner style="position: absolute; left: 50px; top: 60px; width: 0; height: 0; border: 0"></iframe>', {
          "/in": '<button id=inner style="width: 9px; height: 9px"></button>',
        });
        await until(() => ask("get #inner AXRole") !== "?");
        print(...get("#outer", "AXPosition"));`),
    ).toBe("AXPosition = 50 60");
  });

  test("frames are where they are shown", async () => {
    expect(
      await run(`
        const page = await open('<p>before</p><iframe src=/in title=Inner style="position: absolute; left: 50px; top: 60px; border: 5px solid"></iframe><p>after</p>', {
          "/in": '<button id=b style="position: absolute; left: 10px; top: 20px">in</button>',
        });
        await until(() => ask("tree #b") !== "?");
        ask("set #b AXFocused 1");
        await hear("AXFocusedUIElementChanged #b");
        print(ask("tree root"), ...get("#b", "AXPosition"));`),
    ).toMatchInlineSnapshot(`
      "AXWebArea AXTitle="Title"
        AXGroup
          AXStaticText AXValue="before"
        AXGroup AXTitle="Inner" AXDescription="Inner"
          AXWebArea AXTitle="Title"
            AXButton AXTitle="in" AXFocused=true
        AXGroup
          AXStaticText AXValue="after"

      AXPosition = 65 85"
    `);
  });

  test("the next page, and the views of a window", async () => {
    expect(
      await run(`
        const page = await open("<h1>first</h1>", { "/next": "<h1 id=next>next</h1>", "/view": "<button id=v style=display:block>view</button>" });
        await page.loadURL("app://trusted/next");
        await until(() => ask("tree #next") !== "?");
        const view = new WebContentsView();
        view.setBounds({ x: 100, y: 50, width: 100, height: 100 });
        window.contentView.addChildView(view);
        await view.webContents.loadURL("app://trusted/view");
        await until(() => ask("tree #v") !== "?");
        print(...get("#v", "AXPosition"));
        view.setVisible(false);
        await until(() => ask("tree #v") === "?");`),
    ).toBe("AXPosition = 108 58");
  });

  test("custom elements", async () => {
    expect(
      await tree(`
        <label for=x>Label</label><x-box id=x></x-box><x-host><template shadowrootmode=open><h1><slot></slot></h1></template>slotted</x-host>
        <script>customElements.define("x-box", class extends HTMLElement {
          static formAssociated = true;
          constructor() { super(); Object.assign(this.attachInternals(), { role: "checkbox", ariaChecked: "mixed" }); }
        })</script>`),
    ).toMatchInlineSnapshot(`
      "AXWebArea AXTitle="Title" AXFocused=true
        AXGroup
          AXStaticText AXValue="Label"
        AXCheckBox AXTitle="Label" AXValue=2
        AXHeading AXTitle="slotted" AXValue=1
          AXStaticText AXValue="slotted""
    `);
  });

  test("what only scripts know", async () => {
    expect(
      await run(`
        const page = await open("<p id=p>text</p><input type=file id=f multiple><input type=range id=r><button id=b></button><i id=i>named</i>");
        print(ask("names #p").includes("AXPress"));
        await page.executeJavaScript(\`
          p.addEventListener("click", () => {});
          const data = new DataTransfer();
          for (const name of ["a.txt", "b.txt"]) data.items.add(new File([], name));
          f.files = data.files;
          r.value = 7;
          b.ariaLabelledByElements = [i];
          document.ariaNotify("done");\`);
        await hear("AXAnnouncementRequested");
        print(ask("names #p").includes("AXPress"), ask("tree #f"), ask("tree #r"), ask("tree #b"));`),
    ).toMatchInlineSnapshot(`
      "false
      true
      AXButton AXTitle="Choose File: 2 files" AXValue="a.txt, b.txt"

      AXSlider AXValue=7

      AXButton AXTitle="named""
    `);
  });

  test("the fields of a date", async () => {
    expect(
      await run(`
        const page = await open('<input type=time id=t aria-label=Start value=09:30><input type=date id=d value=2020-02-03><input type=week disabled>');
        print(ask("tree root"));
        ask("set #t AXFocused 1");
        await until(() => ask("get focus AXTitle") === '"Hours Start"');
        press("Right");
        await until(() => ask("get focus AXTitle") === '"Minutes Start"');
        press("Up");
        print(...(await hear("AXValueChanged AXIncrementor")));
        ask("do #d>0>0 AXIncrement");
        await until(async () => (await page.executeJavaScript("d.value")) === "2020-03-03");
        ask("set #d>0>4 AXFocused 1");
        await until(() => ask("get focus AXTitle") === '"Year"');
        ask("do #d>1 AXPress");
        await until(() => ask("tree #d").includes("Today"));
        print(ask("tree #d").split("\\n").filter(it => /AXToggle|Dialog|April 2020|Today|March 4/.test(it)).join("\\n"));`),
    ).toMatchInlineSnapshot(`
      "AXWebArea AXTitle="Title" AXFocused=true
        AXTimeField AXTitle="Start" AXDescription="Start" AXValue="09:30"
          AXGroup
            AXIncrementor AXTitle="Hours Start" AXDescription="Hours Start" AXValue=9 AXPlaceholderValue="--"
            AXStaticText AXValue=":"
            AXIncrementor AXTitle="Minutes Start" AXDescription="Minutes Start" AXValue=30 AXPlaceholderValue="--"
            AXStaticText AXValue=" "
            AXIncrementor AXTitle="AM/PM Start" AXDescription="AM/PM Start" AXValue=1 AXPlaceholderValue="--"
          AXPopUpButton AXTitle="Show time picker Start" AXDescription="Show time picker Start"
        AXDateField AXValue="2020-02-03"
          AXGroup
            AXIncrementor AXTitle="Month" AXDescription="Month" AXValue=2 AXPlaceholderValue="mm"
            AXStaticText AXValue="/"
            AXIncrementor AXTitle="Day" AXDescription="Day" AXValue=3 AXPlaceholderValue="dd"
            AXStaticText AXValue="/"
            AXIncrementor AXTitle="Year" AXDescription="Year" AXValue=2020 AXPlaceholderValue="yyyy"
          AXPopUpButton AXTitle="Show date picker" AXDescription="Show date picker"
        AXDateField
          AXGroup
            AXStaticText AXValue="Week "
            AXIncrementor AXTitle="Week" AXDescription="Week" AXValue=0 AXPlaceholderValue="--"
            AXStaticText AXValue=", "
            AXIncrementor AXTitle="Year" AXDescription="Year" AXValue=0 AXPlaceholderValue="----"
      AXFocusedUIElementChanged AXIncrementor
      AXFocusedUIElementChanged AXIncrementor
      AXValueChanged AXIncrementor
      AXValueChanged #t
        AXGroup AXApplicationDialog
          AXButton AXTitle="April 2020" AXDescription="April 2020"
          AXCheckBox AXToggleButton AXTitle="Tuesday, March 3, 2020" AXDescription="Tuesday, March 3, 2020" AXValue=1 AXFocused=true
          AXButton AXTitle="Wednesday, March 4, 2020" AXDescription="Wednesday, March 4, 2020"
          AXButton AXTitle="Today""
    `);
  });

  test("formulas", async () => {
    expect(
      await run(`
        await open(\`<math><semantics><mrow>
          <mfrac id=fraction><mi id=a>a</mi><mn id=b>2</mn></mfrac><mo>+</mo><mspace width=1em />
          <mroot id=root><mi id=c>c</mi><mn id=d>3</mn></mroot>
          <munderover id=sum><mo id=e>S</mo><mi id=f>f</mi><mi id=g>g</mi></munderover>
          <mmultiscripts id=scripts><mi>R</mi><mi id=h>h</mi><mi id=i>i</mi><mprescripts /><mi id=j>j</mi><mi id=k>k</mi></mmultiscripts>
        </mrow><annotation>TeX</annotation></semantics></math><mi>not a formula</mi>\`);
        print(
          ask("tree root"),
          ...get("#fraction", "AXMathFractionNumerator", "AXMathFractionDenominator", "AXMathBase"),
          ...get("#root", "AXMathRootRadicand", "AXMathRootIndex"),
          ...get("#sum", "AXMathBase", "AXMathUnder", "AXMathOver"),
          ...get("#scripts", "AXMathPostscripts", "AXMathPrescripts"),
        );`),
    ).toMatchInlineSnapshot(`
      "AXWebArea AXTitle="Title" AXFocused=true
        AXGroup
          AXGroup AXDocumentMath
            AXGroup AXMathRow
              AXGroup AXMathRow
                AXGroup AXMathFraction
                  AXGroup AXMathIdentifier
                    AXStaticText AXValue="𝑎"
                  AXGroup AXMathNumber
                    AXStaticText AXValue="2"
                AXGroup AXMathOperator
                  AXStaticText AXValue="+"
                AXGroup AXMathRoot
                  AXGroup AXMathIdentifier
                    AXStaticText AXValue="𝑐"
                  AXGroup AXMathNumber
                    AXStaticText AXValue="3"
                AXGroup AXMathUnderOver
                  AXGroup AXMathOperator
                    AXStaticText AXValue="S"
                  AXGroup AXMathIdentifier
                    AXStaticText AXValue="𝑓"
                  AXGroup AXMathIdentifier
                    AXStaticText AXValue="𝑔"
                AXGroup AXMathMultiscript
                  AXGroup AXMathIdentifier
                    AXStaticText AXValue="𝑅"
                  AXGroup AXMathIdentifier
                    AXStaticText AXValue="ℎ"
                  AXGroup AXMathIdentifier
                    AXStaticText AXValue="𝑖"
                  AXGroup AXMathRow
                  AXGroup AXMathIdentifier
                    AXStaticText AXValue="𝑗"
                  AXGroup AXMathIdentifier
                    AXStaticText AXValue="𝑘"
          AXStaticText AXValue="not a formula"

      AXMathFractionNumerator = #a
      AXMathFractionDenominator = #b
      AXMathBase = nil
      AXMathRootRadicand = [#c]
      AXMathRootIndex = #d
      AXMathBase = #e
      AXMathUnder = #f
      AXMathOver = #g
      AXMathPostscripts = [{AXMathSubscript: #h, AXMathSuperscript: #i}]
      AXMathPrescripts = [{AXMathSubscript: #j, AXMathSuperscript: #k}]"
    `);
  });

  test("the controls of a video", async () => {
    expect(
      await run(`
        const page = await open("<video id=v controls>fallback</video><video></video>");
        await until(() => ask("tree root").includes("mute"));
        print(ask("tree root"), ...get("#v>0", "AXEnabled"));
        await page.executeJavaScript("v.focus()");
        press("Down");
        await until(() => ask("tree #v").includes("AXValue=95"));
        await page.executeJavaScript("v.controls = false");
        await until(() => !ask("tree #v").includes("mute"));`),
    ).toMatchInlineSnapshot(`
      "AXWebArea AXTitle="Title" AXFocused=true
        AXGroup AXVideo AXTitle="Unable to play media." AXDescription="Unable to play media."
          AXButton AXTitle="play" AXDescription="play"
          AXSlider AXTitle="video time scrubber" AXDescription="video time scrubber" AXValue=0
          AXSlider AXTitle="volume" AXDescription="volume" AXValue=100
          AXButton AXTitle="mute" AXDescription="mute"
          AXButton AXTitle="enter full screen" AXDescription="enter full screen"
        AXGroup AXVideo AXTitle="Unable to play media." AXDescription="Unable to play media."

      AXEnabled = false"
    `);
  });

  test("a label says nothing by itself if it is only the name of a check box", async () => {
    expect(
      await tree(`
        <label><input type=checkbox> Only</label> <label><input type=radio> With <b>more</b></label>
        <label for=a>Hidden</label><input type=checkbox id=a hidden> <label for=b>Named</label><input type=checkbox id=b aria-label=Else>`),
    ).toMatchInlineSnapshot(`
      "AXWebArea AXTitle="Title" AXFocused=true
        AXGroup
          AXCheckBox AXTitle="Only" AXValue=0
          AXGroup
            AXRadioButton AXTitle="With more" AXValue=0
            AXStaticText AXValue=" With "
            AXStaticText AXValue="more"
          AXStaticText AXValue=" "
          AXGroup
            AXStaticText AXValue="Hidden"
          AXStaticText AXValue=" "
          AXGroup
            AXStaticText AXValue="Named"
          AXCheckBox AXTitle="Else" AXDescription="Else" AXValue=0"
    `);
  });

  test("the tree that follows the changes is the tree that is made from scratch", async () => {
    const changes = [
      `far.firstChild.data = "Other"`,
      `far.id = "gone"`,
      `document.body.insertAdjacentHTML("beforeend", "<p id=far>Late</p>")`,
      `far.className = "upper"`,
      `around.firstChild.data = "Changed "`,
      `document.body.insertAdjacentHTML("beforeend", "<label for=lonely id=late>Found</label>")`,
      `late.htmlFor = "inner"`,
      `late.remove()`,
      `list.setAttribute("role", "none")`,
      `group.setAttribute("aria-disabled", "true")`,
      `group.inert = true`,
      `group.inert = false`,
      `group.prepend(document.createElement("hr"))`,
      `form.append(one)`,
      `scroller.scrollTop = 30`,
      `clipped.scrollTop = 10`,
      `group.style.position = "static"`,
      `group.style.transform = "scale(2)"`,
      `owner.setAttribute("aria-owns", "owned")`,
      `owned.textContent = "moved"`,
      `row.append(document.createElement("td"))`,
      `combo.focus()`,
      `combo.setAttribute("aria-activedescendant", "second")`,
      `pop.showPopover()`,
      `pop.textContent = "more"`,
      `canvas.firstChild.textContent = "drawn"`,
      `picture.textContent = "titled"`,
      `veil.ariaHidden = "true"`,
    ];
    expect(
      await run(`
        const page = await open(\`
          <style>.upper { text-transform: uppercase } section { display: block }</style>
          <p id=far hidden>Name</p>
          <section aria-label=a><button aria-labelledby=far></button><a href=#far>to</a><input id=lonely><button popovertarget=pop>pop</button></section>
          <label id=around>Around <span role=group style=display:block><input id=inner></span></label>
          <section aria-label=b id=group style=position:relative><ul id=list><li><button>x</button></ul><article><b style="position: absolute; top: 3px">out</b></article></section>
          <article><input type=radio name=r id=one><input type=radio name=r></article><form id=form aria-label=f><input type=radio name=r></form>
          <article><div id=scroller style="height: 30px; overflow: auto"><h1 style="position: sticky; top: 0">sticky</h1><p>a<p>b<p>c</div></article>
          <article><div id=clipped style="height: 20px; overflow: hidden"><p>a<p>b</div></article>
          <article><div role=list id=owner></div></article><article><span role=listitem id=owned>item</span></article>
          <table><tr id=row><th>h</table>
          <article><button aria-labelledby=veiled></button></article><article id=veil><p id=veiled>shown <span hidden>hidden</span></p></article>
          <input role=combobox id=combo aria-activedescendant=first><article><div role=listbox><p role=option id=first>1<p role=option id=second>2</div></article>
          <article><div popover id=pop>up</div><canvas id=canvas><p>fallback</p></canvas><svg width=9 height=9><title id=picture>t</title></svg></article>\`);
        const settled = async () => {
          await page.executeJavaScript("new Promise(requestAnimationFrame).then(() => document.ariaNotify(''))");
          return ask("everything root");
        };
        for (const change of ${JSON.stringify(changes)}) {
          const before = await settled();
          await page.executeJavaScript(change + "; 0");
          const followed = await settled();
          ask("stop");
          await until(() => !app.accessibilitySupportEnabled);
          ask("listen");
          await until(() => ask("get root AXLoaded") === "true");
          if (followed === before || followed !== ask("everything root")) print(change);
        }`),
    ).toBe("");
  });

  test("an app can tell, and can ask for it", async () => {
    expect(
      await run(`
        new BrowserWindow();
        print(app.accessibilitySupportEnabled);
        for (const change of [() => ask("listen"), () => ask("stop"), () => (app.accessibilitySupportEnabled = true)]) {
          const changed = once(app, "accessibility-support-changed");
          change();
          print((await changed)[1] + " " + app.accessibilitySupportEnabled);
        }`),
    ).toBe("false\ntrue true\nfalse false\ntrue true");
  });

  test("a screen reader that comes back gets what is there now", async () => {
    expect(
      await run(`
        const page = await open("<p id=p>old</p>");
        ask("stop");
        await once(app, "accessibility-support-changed");
        print(ask("tree root"));
        await page.executeJavaScript("p.textContent = 'new'");
        ask("listen");
        await until(() => ask("tree #p") !== "?");
        print(ask("tree #p"));`),
    ).toMatchInlineSnapshot(`
      "?
      AXGroup
        AXStaticText AXValue="new""
    `);
  });

  test("Accessibility.getFullAXTree", async () => {
    expect(
      await run(`
        const page = await open("<button aria-expanded=true>x</button><input value=typed>");
        page.debugger.attach();
        const { nodes } = await page.debugger.sendCommand("Accessibility.getFullAXTree");
        print(...nodes.map(it => [it.role.value, it.name.value, it.value?.value, it.childIds.length, ...it.properties.map(it => it.name)].join(" ")));`),
    ).toMatchInlineSnapshot(`
      "RootWebArea Title  2 focusable focused url
      textbox  typed 1 focusable editable
      StaticText typed  0 editable
      button x  1 focusable expanded
      StaticText x  0"
    `);
  });

  test("the pop-up of a date, by keyboard", async () => {
    expect(
      await run(`
        const page = await open('<input type=date id=d value=2020-01-31 max=2020-03-10><input type=datetime-local id=l value=2020-05-06T07:08><input type=month id=m value=2020-05><button>end</button>');
        const step = async (title, ...key) => {
          press(...key);
          await until(() => ask("get focus AXTitle") === JSON.stringify(title));
          print(key.join("+") + ": " + title + ", " + (await page.executeJavaScript("(it => it.value + (it.matches(':open') ? ' open' : ''))(document.activeElement)")));
        };
        for (const title of ["Month", "Day", "Year", "Show date picker"]) await step(title, "Tab");
        await step("Friday, January 31, 2020", "Enter");
        await step("Saturday, February 29, 2020", "PageDown");
        await step("Saturday, March 7, 2020", "Down");
        press("Down");
        await step("Friday, March 6, 2020", "Left");
        await step("Show date picker", "Escape");
        await step("Friday, January 31, 2020", "Space");
        await step("Saturday, February 1, 2020", "Right");
        await step("Show date picker", "Enter");
        await step("Month", "Tab");
        await step("Wednesday, May 6, 2020", "F4");
        await step("Wednesday, April 29, 2020", "Up");
        await step("Hours", "Tab");
        press("Up");
        await step("Wednesday, April 29, 2020", "Tab", "shift");
        await step("Month", "Enter");
        ask("set #m AXFocused 1");
        await hear("AXFocusedUIElementChanged");
        await step("May 2020", "Down", "alt");
        await step("September 2020", "Down");
        await step("September 2019", "PageUp");
        await step("Year", "Tab");
        await step("Show month picker", "Tab");
        await step("end", "Tab");
        await step("Show month picker", "Tab", "shift");
        ask('set #d AXValue "2020-02-02"');
        await until(() => ask("get #d AXValue") === '"2020-02-02"');`),
    ).toMatchInlineSnapshot(`
      "Tab: Month, 2020-01-31
      Tab: Day, 2020-01-31
      Tab: Year, 2020-01-31
      Tab: Show date picker, 2020-01-31
      Enter: Friday, January 31, 2020, 2020-01-31 open
      PageDown: Saturday, February 29, 2020, 2020-02-29 open
      Down: Saturday, March 7, 2020, 2020-03-07 open
      Left: Friday, March 6, 2020, 2020-03-06 open
      Escape: Show date picker, 2020-01-31
      Space: Friday, January 31, 2020, 2020-01-31 open
      Right: Saturday, February 1, 2020, 2020-02-01 open
      Enter: Show date picker, 2020-02-01
      Tab: Month, 2020-05-06T07:08
      F4: Wednesday, May 6, 2020, 2020-05-06T07:08 open
      Up: Wednesday, April 29, 2020, 2020-04-29T07:08 open
      Tab: Hours, 2020-04-29T07:08 open
      Tab+shift: Wednesday, April 29, 2020, 2020-04-29T08:08 open
      Enter: Month, 2020-04-29T08:08
      Down+alt: May 2020, 2020-05 open
      Down: September 2020, 2020-09 open
      PageUp: September 2019, 2019-09 open
      Tab: Year, 2019-09
      Tab: Show month picker, 2019-09
      Tab: end,
      Tab+shift: Show month picker, 2019-09"
    `);
  });

  test("the pop-up of a color", async () => {
    expect(
      await run(`
        const page = await open('<input type=color id=c value=#ff0000 list=l><datalist id=l><option>#00ff00</datalist>');
        ask("do #c AXPress");
        await until(() => ask("get focus AXValueDescription") === '"X: 100, Y: 100"');
        print(ask("tree #c"));
        press("Left");
        await until(() => ask("get focus AXValueDescription") === '"X: 99, Y: 100"');
        press("Tab");
        await until(() => ask("get focus AXTitle") === '"Hue slider"');
        ask("do focus AXIncrement");
        await until(() => ask("get focus AXValue") === "1");
        print(await page.executeJavaScript("c.value"));
        press("Tab", "shift");
        press("Tab", "shift");
        await until(() => ask("get focus AXTitle") === '"#00ff00"');
        press("Enter");
        await until(async () => (await page.executeJavaScript("c.value")) === "#00ff00");`),
    ).toMatchInlineSnapshot(`
      "AXColorWell AXValue="rgb 1.00000 0.00000 0.00000 1"
        AXGroup AXApplicationDialog AXTitle="Color picker" AXDescription="Color picker"
          AXSlider AXTitle="Color well with two-dimensional slider for selecting saturation and lightness" AXDescription="Color well with two-dimensional slider for selecting saturation and lightness" AXValue=100 AXFocused=true
          AXSlider AXTitle="Hue slider" AXDescription="Hue slider" AXValue=0
          AXTextField AXTitle="Hex color value" AXDescription="Hex color value" AXValue="#ff0000"
            AXStaticText AXValue="#ff0000"
          AXButton AXTitle="#00ff00" AXDescription="#00ff00"
      #ff1203"
    `);
  });

  test("the suggestions of a datalist", async () => {
    expect(
      await run(`
        await open('<input id=i list=l><datalist id=l><option value=apple><option value=apricot label=orange></datalist><p>after</p>');
        ask("set #i AXFocused 1");
        await hear("AXFocusedUIElementChanged #i");
        press("Down");
        await hear("AXExpandedChanged #i");
        press("Down");
        press("Down");
        await until(() => ask("get focus AXValue") === '"apricot orange"');
        print(ask("tree root"), ...get("#i", "AXOwns"));
        press("Enter");
        await until(() => ask("get #i AXValue") === '"apricot"');
        print(ask("tree root"));`),
    ).toMatchInlineSnapshot(`
      "AXWebArea AXTitle="Title"
        AXComboBox AXExpanded=true
        AXList
          AXStaticText AXValue="apple"
          AXStaticText AXValue="apricot orange" AXFocused=true AXSelected=true
        AXGroup
          AXStaticText AXValue="after"

      AXOwns = [AXList]
      AXWebArea AXTitle="Title"
        AXComboBox AXValue="apricot" AXFocused=true AXExpanded=false
        AXGroup
          AXStaticText AXValue="after""
    `);
  });

  test("what VoiceOver counts, passes over and calls by another name", async () => {
    expect(
      await run(`
        await open(\`<div role=radiogroup><div role=radio id=a>a</div><div role=radio id=b>b</div></div><fieldset id=f>x</fieldset><div role=menu id=m>x</div>
          <nav id=n aria-label=none></nav><hr id=h><p role=doc-chapter id=c>x</p><input type=month id=d><progress id=p></progress><mark id=k>x</mark>\`);
        print(...get("#a", "AXLinkedUIElements"), ...get("#d>0>0", "AXValueDescription"), ask("names #p").includes("AXMaxValue"), ask("names #d").includes("AXPress"));
        for (const it of ["#f", "#m", "#n", "#h", "#c", "#d", "#k"]) print(get(it, "AXRole", "AXSubrole", "AXRoleDescription").join(", "));`),
    ).toMatchInlineSnapshot(`
      "AXLinkedUIElements = [#a, #b]
      AXValueDescription = "0"
      false
      true
      AXRole = "AXGroup", AXSubrole = "AXFieldset", AXRoleDescription = system
      AXRole = "AXGroup", AXSubrole = nil, AXRoleDescription = "menu"
      AXRole = "AXGroup", AXSubrole = "AXEmptyGroup", AXRoleDescription = "navigation"
      AXRole = "AXSplitter", AXSubrole = nil, AXRoleDescription = system
      AXRole = "AXGroup", AXSubrole = nil, AXRoleDescription = "chapter"
      AXRole = "AXDateField", AXSubrole = nil, AXRoleDescription = "month picker"
      AXRole = "AXGroup", AXSubrole = nil, AXRoleDescription = "highlight""
    `);
  });

  test("a name follows what it is taken from to where nothing is drawn", async () => {
    expect(
      await run(`
        const page = await open('<button id=b></button><button id=c></button><p id=o><b id=t style="text-transform: uppercase">x</b></p><input id=i type=file>');
        await page.executeJavaScript("i.innerHTML = '<div id=deep>z</div>'; b.ariaLabelledByElements = [t]; c.ariaLabelledByElements = [deep]; 0");
        await until(() => ask("get #b AXTitle") + ask("get #c AXTitle") === '"X""z"');
        await page.executeJavaScript("c.title = 'c'");
        await until(() => ask("get #c AXHelp") === '"c"');
        await page.executeJavaScript("deep.append(o)");
        await until(() => ask("get #b AXTitle") !== '"X"');
        print(ask("get #b AXTitle"));`),
    ).toBe('"x"');
  });

  test("what is typed after the selection has moved is undone by itself", async () => {
    expect(
      await run(`
        const page = await open("<div contenteditable id=e>second</div>");
        print(await page.executeJavaScript(\`
          e.focus();
          getSelection().collapse(e.firstChild, 0);
          document.execCommand("forwardDelete");
          document.execCommand("selectAll");
          document.execCommand("forwardDelete");
          document.execCommand("undo");
          e.textContent\`));`),
    ).toBe("econd");
  });

  test("redo puts the caret where the edit has left it", async () => {
    expect(
      await run(`
        const page = await open("<input id=i value=abc>");
        print(await page.executeJavaScript(\`
          i.focus();
          i.setSelectionRange(2, 2);
          for (const it of ["delete", "selectAll", "undo", "redo"]) document.execCommand(it);
          i.value + i.selectionStart + i.selectionEnd\`));`),
    ).toBe("ac11");
  });

  test("forced colors", async () => {
    expect(
      await run(`
        const page = await open(\`<style>body { margin: 0; background: pink; color: brown } p { margin: 0; height: 20px } :root { --x: GrayText }
          #a, #a::before { content: ""; color: red; background: #00800080; border: 1px solid red; box-shadow: 0 0 9px red } #b { color: var(--x); background: linear-gradient(red, blue) ButtonText }
          #c { forced-color-adjust: none; background: navy } #d { forced-color-adjust: auto } #e { color: color-mix(in srgb, CanvasText 10%, transparent) }</style>
          <p id=a></p><p id=b>&nbsp;&nbsp;&nbsp;</p><p id=c><b id=d></b></p><p id=e></p><p id=i style="forced-color-adjust: none; --y: teal; color: var(--y)"></p><a id=f href=x style="color: red"></a><svg><rect id=g fill=red /><rect id=h fill=red style="forced-color-adjust: auto" /></svg>\`);
        const emulate = (...features) => page.debugger.sendCommand("Emulation.setEmulatedMedia", { features: features.map(([name, value]) => ({ name, value })) });
        const show = async () => print(await page.executeJavaScript(\`[matchMedia("(forced-colors: active)").matches, ...[...document.querySelectorAll("[id]")].map(it => [it]).concat([[a, "::before"]]).map(it =>
          ["color", "backgroundColor", "backgroundImage", "borderTopColor", "boxShadow", "fill"].map(name => getComputedStyle(...it)[name].slice(0, 22)).join(" | "))].join("\\\\n")\`));
        page.debugger.attach();
        await emulate(["forced-colors", "active"], ["prefers-color-scheme", "dark"]);
        await page.executeJavaScript("a.style.color = 'lime'");
        await show();
        const pixel = async (x, y) => (await page.capturePage({ x, y, width: 1, height: 1 })).toBitmap().toString("hex");
        print(await pixel(4, 32), await pixel(100, 32), await pixel(100, 250));
        await emulate();
        await show();`),
    ).toMatchInlineSnapshot(`
      "true
      rgb(255, 255, 255) | rgba(0, 0, 0, 0.5) | none | rgb(255, 255, 255) | none | rgb(0, 0, 0)
      rgb(63, 242, 63) | rgb(255, 255, 255) | none | rgb(63, 242, 63) | none | rgb(0, 0, 0)
      rgb(165, 42, 42) | rgb(0, 0, 128) | none | rgb(165, 42, 42) | none | rgb(0, 0, 0)
      rgb(255, 255, 255) | rgba(0, 0, 0, 0) | none | rgb(255, 255, 255) | none | rgb(0, 0, 0)
      rgb(255, 255, 255) | rgba(0, 0, 0, 0) | none | rgb(255, 255, 255) | none | rgb(0, 0, 0)
      rgb(0, 128, 128) | rgba(0, 0, 0, 0) | none | rgb(0, 128, 128) | none | rgb(0, 0, 0)
      rgb(255, 255, 0) | rgba(0, 0, 0, 0) | none | rgb(255, 255, 0) | none | rgb(0, 0, 0)
      rgb(255, 255, 255) | rgba(0, 0, 0, 0) | none | rgb(255, 255, 255) | none | rgb(255, 0, 0)
      rgb(255, 255, 255) | rgba(0, 0, 0, 0) | none | rgb(255, 255, 255) | none | rgb(255, 255, 255)
      rgb(255, 255, 255) | rgba(0, 0, 0, 0.5) | none | rgb(255, 255, 255) | none | rgb(0, 0, 0)
      000000ff
      ffffffff
      000000ff
      false
      rgb(0, 255, 0) | rgba(0, 128, 0, 0.5) | none | rgb(255, 0, 0) | rgb(255, 0, 0) 0px 0px | rgb(0, 0, 0)
      rgb(128, 128, 128) | rgb(0, 0, 0) | linear-gradient(rgb(25 | rgb(128, 128, 128) | none | rgb(0, 0, 0)
      rgb(165, 42, 42) | rgb(0, 0, 128) | none | rgb(165, 42, 42) | none | rgb(0, 0, 0)
      rgb(165, 42, 42) | rgba(0, 0, 0, 0) | none | rgb(165, 42, 42) | none | rgb(0, 0, 0)
      color(srgb 0 0 0 / 0.1 | rgba(0, 0, 0, 0) | none | color(srgb 0 0 0 / 0.1 | none | rgb(0, 0, 0)
      rgb(0, 128, 128) | rgba(0, 0, 0, 0) | none | rgb(0, 128, 128) | none | rgb(0, 0, 0)
      rgb(255, 0, 0) | rgba(0, 0, 0, 0) | none | rgb(255, 0, 0) | none | rgb(0, 0, 0)
      rgb(165, 42, 42) | rgba(0, 0, 0, 0) | none | rgb(165, 42, 42) | none | rgb(255, 0, 0)
      rgb(165, 42, 42) | rgba(0, 0, 0, 0) | none | rgb(165, 42, 42) | none | rgb(255, 0, 0)
      rgb(255, 0, 0) | rgba(0, 128, 0, 0.5) | none | rgb(255, 0, 0) | rgb(255, 0, 0) 0px 0px | rgb(0, 0, 0)"
    `);
  });

  test("--force-high-contrast", async () => {
    expect(
      await run(`
        app.commandLine.appendSwitch("force-high-contrast");
        const page = await open("<p id=p style='color: red'>");
        const { inForcedColorsMode, shouldUseHighContrastColors } = require("electron").nativeTheme;
        print(inForcedColorsMode, shouldUseHighContrastColors, await page.executeJavaScript("matchMedia('(prefers-contrast: more)').matches + getComputedStyle(p).color"));`),
    ).toBe("true\ntrue\ntruergb(0, 0, 0)");
  });

  describe.skipIf(!engine.path)("of what another engine shows", () => {
    const form = `<h1>Sign in</h1><label>Name <input id=name value=ab></label><button id=go onclick="s.textContent = 'sent'">Go</button><p role=status id=s></p>`;
    const steps = `
      await until(() => ask("tree #go") !== "?");
      ask("set #name AXFocused 1");
      await hear("AXFocusedUIElementChanged #name");
      ask("set #name AXSelectedTextRange 1..1");
      await until(() => ask("get #name AXSelectedTextRange") === "1..1");
      press("x");
      print((await hear("AXValueChanged #name", /^AXValueChanged #name/))[0].match(/ChangeValue: [^,]+/)[0]);
      ask("do #go AXPress");
      await hear("AXLiveRegionChanged #s");
      print(ask("tree root"));`;
    const env = { ENGINE: JSON.stringify(engine) };

    test("the controls of a sound", async () => {
      expect(
        await run(
          `
          const header = Buffer.from("524946460000000057415645666d74201000000001000100401f0000401f00000100080064617461", "hex");
          const wave = Buffer.concat([header, Buffer.alloc(4), Buffer.alloc(800_000, 128)]);
          wave.writeUInt32LE(wave.length - 8, 4);
          wave.writeUInt32LE(800_000, 40);
          const page = await open("<audio id=a controls></audio>");
          await page.executeJavaScript("a.src = 'data:audio/wav;base64," + wave.toString("base64") + "'; 0");
          const sees = (expression, value) => until(async () => (await page.executeJavaScript(expression)) === value);
          await until(() => ask("get #a>0 AXEnabled") === "true");
          ask("do #a>3 AXPress");
          await until(() => ask("get #a>3 AXTitle") === '"unmute"');
          ask("do #a>0 AXPress");
          await until(() => ask("get #a>0 AXTitle") === '"pause"' && ask("get #a>1 AXMaxValue") === "100");
          press("Space");
          await sees("a.paused", true);
          press("Home");
          await sees("a.currentTime", 0);
          ask("do #a>1 AXIncrement");
          await until(() => ask("get #a>1 AXValueDescription") === '"elapsed time: 0:01"' && ask("get #a>0 AXTitle") === '"play"');
          print(ask("tree #a"));
          press("End");
          await sees("a.currentTime", 100);`,
          env,
        ),
      ).toMatchInlineSnapshot(`
        "AXGroup AXFocused=true
          AXButton AXTitle="play" AXDescription="play"
          AXSlider AXTitle="audio time scrubber" AXDescription="audio time scrubber" AXValue=1
          AXSlider AXTitle="volume" AXDescription="volume" AXValue=100
          AXButton AXTitle="unmute" AXDescription="unmute""
      `);
    }, 60_000);

    test("the fields of a time", async () => {
      expect(
        await run(
          `const page = await open(""); await page.loadURL(site("<input type=time id=t aria-label=Start>"));
          await until(() => ask("tree #t") !== "?");
          print(ask("tree #t").match(/AXTitle="[^"]+"/g).join("\\n"));`,
          env,
        ),
      ).toMatchInlineSnapshot(`
        "AXTitle="Start"
        AXTitle="Hours Start"
        AXTitle="Minutes Start"
        AXTitle="AM/PM Start"
        AXTitle="Show time picker Start""
      `);
    }, 60_000);

    test("forced colors", async () => {
      expect(
        await run(
          `app.commandLine.appendSwitch("force-high-contrast");
          const page = await open(""); await page.loadURL(site(""));
          print(await page.executeJavaScript("matchMedia('(forced-colors: active) and (prefers-contrast: more)').matches"));`,
          env,
        ),
      ).toBe("true");
    }, 60_000);

    test("a page", async () => {
      expect(await run(`const page = await open(""); await page.loadURL(site(${JSON.stringify(form)})); ${steps}`, env))
        .toMatchInlineSnapshot(`
        "ChangeValue: "x"
        AXWebArea AXTitle="Title"
          AXHeading AXTitle="Sign in" AXValue=1
            AXStaticText AXValue="Sign in"
          AXGroup
            AXStaticText AXValue="Name "
            AXTextField AXTitle="Name" AXValue="axb"
          AXButton AXTitle="Go" AXFocused=true
          AXGroup AXApplicationStatus
            AXStaticText AXValue="sent""
      `);
    }, 60_000);

    test("what changes without being painted", async () => {
      const hidden = `<p role=status id=s style="position: absolute; clip-path: inset(50%)"></p><script>onmessage = event => (s.textContent = event.data)</script>`;
      expect(
        await run(
          `const page = await open('<iframe src="' + site(${JSON.stringify(hidden)}) + '"></iframe>');
          await until(() => ask("tree #s") !== "?");
          await page.executeJavaScript("frames[0].postMessage('sent', '*')");
          await hear("AXLiveRegionChanged #s");
          print(ask("tree #s"));`,
          env,
        ),
      ).toMatchInlineSnapshot(`
        "AXGroup AXApplicationStatus
          AXStaticText AXValue="sent""
      `);
    }, 60_000);

    test("a frame", async () => {
      expect(await run(`await open('<iframe src="' + site(${JSON.stringify(form)}) + '"></iframe>'); ${steps}`, env))
        .toMatchInlineSnapshot(`
        "ChangeValue: "x"
        AXWebArea AXTitle="Title"
          AXGroup
            AXWebArea AXTitle="Title"
              AXHeading AXTitle="Sign in" AXValue=1
                AXStaticText AXValue="Sign in"
              AXGroup
                AXStaticText AXValue="Name "
                AXTextField AXTitle="Name" AXValue="axb"
              AXButton AXTitle="Go" AXFocused=true
              AXGroup AXApplicationStatus
                AXStaticText AXValue="sent""
      `);
    }, 60_000);
  });
});
