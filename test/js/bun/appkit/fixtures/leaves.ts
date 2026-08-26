// Text, TextField (and Secure/Search), Slider, Picker, Segmented, Progress,
// Image, Divider and Spacer are built through the objc bridge: `.native` is
// the object the class made, getters read it, enums take Apple's member
// names, a text field's events are its NSTextFieldDelegate methods and a
// control's are its target/action. Events are driven here by sending those
// very messages, the way AppKit does.
import {
  app,
  Button,
  Divider,
  HStack,
  Image,
  Picker,
  Progress,
  SearchField,
  SecureField,
  Segmented,
  Slider,
  Spacer,
  SplitView,
  Text,
  TextField,
  VStack,
  Window,
} from "bun:appkit";
import { appKitInternals } from "bun:internal-for-testing";
import { objc } from "bun:objc";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emit, run, tick } from "./_util";

await run(async () => {
  app.activationPolicy = "accessory";
  const { NSTextField, NSSecureTextField, NSSearchField, NSSlider, NSPopUpButton, NSSegmentedControl } = objc.classes;
  const { NSProgressIndicator, NSImageView, NSBox, NSNotificationCenter, NSFont, NSColor, NSApplication, NSEvent } =
    objc.classes;
  const uncaught: string[] = [];
  process.on("uncaughtException", e => uncaught.push(String((e as Error).message)));
  const attempt = (f: () => unknown) => {
    try {
      f();
      return null;
    } catch (e) {
      return {
        message: String((e as Error).message),
        code: (e as { code?: string }).code,
        isTypeError: e instanceof TypeError,
        path: (e as { path?: string }).path,
      };
    }
  };
  /** What AppKit sends a control's target when the user acts on it. */
  const act = (view: { native: any }) => view.native.sendAction_to_(view.native.action(), view.native.target());
  /** What NSTextField posts around the user's typing (its delegate hears the same through these). */
  const notify = (field: { native: any }, what: "BeginEditing" | "Change" | "EndEditing") => {
    NSNotificationCenter.defaultCenter().postNotificationName_object_(
      `NSControlTextDid${what}Notification`,
      field.native,
    );
  };
  const type = (field: { native: any }, text: string) => {
    field.native.setStringValue_(text);
    notify(field, "Change");
  };
  /**
   * What pressing Return does: a keyDown event, dequeued (so it is the
   * current event) and dispatched by NSApp to the window's field editor.
   */
  const pressReturn = (win: Window) => {
    const NSApp = NSApplication.sharedApplication();
    const made =
      NSEvent.keyEventWithType_location_modifierFlags_timestamp_windowNumber_context_characters_charactersIgnoringModifiers_isARepeat_keyCode_(
        objc.enums.NSEventType.keyDown,
        { x: 0, y: 0 },
        0,
        0,
        win.native.windowNumber(),
        null,
        "\r",
        "\r",
        false,
        36,
      );
    NSApp.postEvent_atStart_(made, true);
    const event = NSApp.nextEventMatchingMask_untilDate_inMode_dequeue_(
      objc.enums.NSEventMask.keyDown,
      null,
      objc.constants.NSDefaultRunLoopMode,
      true,
    );
    // To the window itself, as -[NSApplication sendEvent:] does once it has
    // found the key window: on a display with other apps up, that lookup can
    // land elsewhere, and the key goes nowhere or into a tracking loop.
    win.native.sendEvent_(event);
    return typeof event.type();
  };

  // Text: a label; everything reads the NSTextField.
  {
    const text = new Text({ text: "Hello" });
    text.native.setStringValue_("Native");
    const align: Record<string, unknown> = {};
    for (const name of ["center", "right", "justified", "left", "NSTextAlignmentCenter"]) {
      text.textAlign = name as never;
      align[name] = [text.textAlign, text.native.alignment() === objc.enums.NSTextAlignment[name]];
    }
    text.textAlign = objc.enums.NSTextAlignment.right;
    align.number = text.textAlign;
    (text as { textAlign: string | null }).textAlign = null;
    align.reset = text.textAlign;
    text.lineLimit = 3;
    const wrapped = [text.lineLimit, text.native.maximumNumberOfLines(), text.native.cell().truncatesLastVisibleLine()];
    text.lineLimit = 0;
    const unlimited = [text.lineLimit, text.native.usesSingleLineMode(), `${text.native.lineBreakMode()}`];
    text.font = { size: 20, weight: "semibold" };
    text.color = "red";
    text.selectable = true;
    emit({
      step: "text",
      isTextField: text.native.isKindOfClass_(NSTextField),
      editable: text.native.isEditable(),
      text: text.text,
      align,
      wrapped,
      unlimited,
      pointSize: text.native.font().pointSize(),
      colored: `${text.native.textColor()}` === `${NSColor.systemRedColor()}`,
      selectable: [text.selectable, text.native.isSelectable()],
      defaults: (({ text, font, color, textAlign, selectable, lineLimit }) => ({
        text,
        font,
        color,
        textAlign,
        selectable,
        lineLimit,
      }))(new Text()),
      cleared:
        ((text.color = null),
        (text.font = null),
        {
          label: `${text.native.textColor()}` === `${NSColor.labelColor()}`,
          pointSize: text.native.font().pointSize() === NSFont.systemFontSize(),
        }),
      badAlign: attempt(() => (text.textAlign = "middle" as never)),
      badLines: attempt(() => ((text as { lineLimit: unknown }).lineLimit = "3")),
      negativeLines: attempt(() => (text.lineLimit = -5)),
      fractionalLines: attempt(() => (text.lineLimit = 2.5)),
      shorthand: new Text("short").text,
    });
  }

  // Colours and fonts take Apple's names and NSColor / NSFont handles as
  // well, and read live: the value given while the control still shows it,
  // the handle it shows once something else (here `.native`) changed it.
  {
    const text = new Text({ text: "live", color: "systemIndigoColor", font: { size: 15 } });
    const byAppleName = {
      color: text.color,
      shows: `${text.native.textColor()}` === `${NSColor.systemIndigoColor()}`,
    };
    const orange = NSColor.systemOrangeColor();
    text.color = orange;
    const byHandle = { same: text.color === orange, shows: `${text.native.textColor()}` === `${orange}` };
    text.native.setTextColor_(NSColor.systemTealColor());
    const live = text.color as { isEqual_(c: unknown): boolean };
    const changedNatively = {
      isHandle: typeof live === "object" && live !== null && live.isEqual_(NSColor.systemTealColor()),
    };
    (text as { color: unknown }).color = null;
    const reset = { color: text.color, shows: `${text.native.textColor()}` === `${NSColor.labelColor()}` };
    const mono = NSFont.monospacedSystemFontOfSize_weight_(14, objc.constants.NSFontWeightRegular);
    const fontGiven = text.font;
    text.font = mono;
    const fontByHandle = { same: text.font === mono, pointSize: text.native.font().pointSize() };
    text.native.setFont_(NSFont.systemFontOfSize_(18));
    const fontChanged = (text.font as { pointSize(): number }).pointSize();
    (text as { font: unknown }).font = null;
    const image = new Image();
    const nsimage = objc.classes.NSImage.imageWithSystemSymbolName_accessibilityDescription_("circle", null);
    image.image = nsimage;
    const imageByHandle = image.image === nsimage && image.native.image() === nsimage;
    image.native.setImage_(objc.classes.NSImage.imageWithSystemSymbolName_accessibilityDescription_("square", null));
    const imageChanged = image.image !== nsimage && typeof image.image === "object";
    const win = new Window({ visible: false, background: NSColor.systemBrownColor() });
    const windowBackground = [
      typeof win.background === "object",
      `${(win.native as { backgroundColor(): unknown }).backgroundColor()}` === `${NSColor.systemBrownColor()}`,
    ];
    win.close();
    emit({
      step: "handles",
      byAppleName,
      byHandle,
      changedNatively,
      reset,
      fontGiven,
      fontByHandle,
      fontChanged,
      fontReset: text.font,
      imageByHandle,
      imageChanged,
      windowBackground,
      notAColor: attempt(() => (text.color = "noSuchColorEver" as never)),
      notAColorClass: attempt(() => (text.color = NSFont.systemFontOfSize_(12) as never)),
      wrongHandle: attempt(() => (text.font = NSColor.redColor() as never)),
    });
  }

  // TextField family: classes, live getters, the target the class
  // installed and the notifications it hears, and every event through them;
  // the delegate is left unset.
  {
    const log: unknown[] = [];
    const field = new TextField({
      placeholder: "name",
      onFocus: () => log.push("focus"),
      onChange: v => log.push(["change", v]),
      onSubmit: v => log.push(["submit", v]),
      onBlur: () => log.push("blur"),
    });
    const secure = new SecureField();
    const search = new SearchField();
    field.native.setPlaceholderString_("native");
    notify(field, "BeginEditing");
    type(field, "ab");
    type(field, "abc");
    act(field);
    notify(field, "EndEditing");
    // The value setter is not the user: no onChange, and the caret is left
    // alone when the text is already what is assigned.
    field.value = "from code";
    field.value = "from code";
    // continuous: false keeps onChange until editing ends or Return.
    const quiet = new TextField({ continuous: false, onChange: v => log.push(["quiet", v]) });
    type(quiet, "q1");
    type(quiet, "q2");
    notify(quiet, "EndEditing");
    type(quiet, "q3");
    act(quiet);
    act(quiet);
    // A replaced edit is not reported.
    type(quiet, "q4");
    quiet.value = "replaced";
    notify(quiet, "EndEditing");
    emit({
      step: "field",
      classes: [
        field.native.isMemberOfClass_(NSTextField),
        secure.native.isKindOfClass_(NSSecureTextField),
        search.native.isKindOfClass_(NSSearchField),
      ],
      searchWhole: search.native.sendsWholeSearchString(),
      bezeled: [field.native.isBezeled(), secure.native.isBezeled()],
      placeholder: field.placeholder,
      value: field.value,
      delegate: field.native.delegate(),
      action: `${field.native.action()}`,
      log,
      live: ((field.editable = false), (field.enabled = false), [field.native.isEditable(), field.native.isEnabled()]),
      defaults: (({ value, placeholder, editable, enabled, font, textAlign, continuous }) => ({
        value,
        placeholder,
        editable,
        enabled,
        font,
        textAlign,
        continuous,
      }))(new TextField()),
      badValue: attempt(() => ((field as { value: unknown }).value = 7)),
    });
  }

  // Editing that a setter or a container call ends is reported as that call
  // returns, never while the view is mid-change; a handler that throws is
  // reported and the next one still runs.
  {
    const log: string[] = [];
    const stack = new VStack();
    const field = new TextField({
      onBlur: () => {
        log.push(`blur hidden=${field.hidden} children=${stack.children.length}`);
        field.tooltip = "set from onBlur";
        stack.spacing = 2;
        throw new Error("from onBlur");
      },
      onChange: v => log.push(`change:${v}`),
      continuous: false,
    });
    stack.append(field, new Button({ title: "other" }));
    const win = new Window({ width: 300, height: 200, content: stack });
    win.show();
    await tick();
    type(field, "pending");
    field.hidden = true;
    log.push("hidden set");
    await tick();
    emit({ step: "held", log, uncaught: uncaught.splice(0), tooltip: field.tooltip, spacing: stack.spacing });
    win.close();
  }

  // Closing a window ends its focused field's editing first: onBlur runs
  // before onClose, while the field is still in the window and the window
  // still listed, and both before close() returns.
  {
    const log: string[] = [];
    let win: Window;
    const field = new TextField({
      onBlur: () => log.push(`blur inWindow=${field.window === win} listed=${app.windows.includes(win)}`),
    });
    win = new Window({
      width: 300,
      height: 120,
      content: new VStack({ children: [field, new Button({ title: "other" })] }),
      onClose: () => log.push(`close inWindow=${field.window === win} listed=${app.windows.includes(win)}`),
    });
    win.close();
    log.push("closed");
    emit({ step: "close while editing", log });
  }

  // Return with no onSubmit presses the window's default button, but only
  // for a key press: a search field's cancel button sends the same action.
  // A window's first field has focus from the start, so the key goes to it.
  {
    const log: string[] = [];
    const field = new SearchField();
    const button = new Button({ title: "OK", keyEquivalent: "\r", onClick: () => log.push("default") });
    const win = new Window({ width: 300, height: 120, content: new VStack({ children: [field, button] }) });
    act(field);
    const withoutKey = log.splice(0);
    const eventType = pressReturn(win);
    const withKey = log.splice(0);
    win.close();
    // With an onSubmit, Return is the field's alone.
    const submitting = new TextField({ onSubmit: v => log.push(`submit:${v}`) });
    const other = new Window({
      width: 300,
      height: 120,
      content: new VStack({
        children: [submitting, new Button({ title: "OK", keyEquivalent: "\r", onClick: () => log.push("default") })],
      }),
    });
    submitting.native.setStringValue_("typed");
    pressReturn(other);
    emit({
      step: "default button",
      withoutKey,
      withKey,
      eventType,
      withSubmit: log.splice(0),
      cell: other.native.defaultButtonCell() !== null,
    });
    other.close();
  }

  // Slider: value/min/max/continuous live, step snaps what the user drags to
  // and what code assigns, tick marks when the range is a whole number of steps.
  {
    const log: number[] = [];
    const slider = new Slider({ min: 0, max: 10, step: 2, value: 5.2, onChange: v => log.push(v) });
    const snappedValue = slider.value;
    slider.native.setDoubleValue_(7.1);
    act(slider);
    const dragged = [slider.value, slider.native.doubleValue()];
    slider.value = 3;
    const ticks = slider.native.numberOfTickMarks();
    slider.max = 9;
    const unevenTicks = slider.native.numberOfTickMarks();
    slider.step = 0;
    slider.native.setDoubleValue_(4.4);
    act(slider);
    slider.continuous = false;
    emit({
      step: "slider",
      isSlider: slider.native.isKindOfClass_(NSSlider),
      snappedValue,
      dragged,
      log,
      ticks,
      unevenTicks,
      live: [slider.min, slider.max, slider.native.maxValue(), slider.continuous, slider.native.isContinuous()],
      enabled: ((slider.enabled = false), [slider.enabled, slider.native.isEnabled()]),
      defaults: (({ value, min, max, step, continuous, enabled }) => ({ value, min, max, step, continuous, enabled }))(
        new Slider(),
      ),
      badStep: attempt(() => (slider.step = -1)),
      badValue: attempt(() => ((slider as { value: unknown }).value = "1")),
    });
  }

  // Picker and Segmented: the action reports the index; enabled is live.
  {
    const log: unknown[] = [];
    const picker = new Picker({ items: ["A", "B", "C"], onChange: i => log.push(["picker", i]) });
    const segmented = new Segmented({ items: ["x", "y"], onChange: i => log.push(["segmented", i]) });
    picker.native.selectItemAtIndex_(2);
    act(picker);
    segmented.native.setSelectedSegment_(1);
    act(segmented);
    picker.selectedIndex = 0;
    segmented.enabled = false;
    // items reads the control, so items added through .native are listed.
    const listed = new Picker({ items: ["a", "b"] });
    listed.native.addItemWithTitle_("c");
    listed.native.selectItemAtIndex_(2);
    const relabelled = new Segmented({ items: ["p"] });
    relabelled.native.setSegmentCount_(2);
    relabelled.native.setLabel_forSegment_("q", 1);
    emit({
      step: "choices",
      nativeItems: {
        picker: [listed.items, listed.selectedIndex],
        segmented: relabelled.items,
        none: new Picker().items,
      },
      classes: [picker.native.isKindOfClass_(NSPopUpButton), segmented.native.isKindOfClass_(NSSegmentedControl)],
      pullsDown: picker.native.pullsDown(),
      log,
      after: [picker.selectedIndex, picker.native.indexOfSelectedItem()],
      titles: [
        `${picker.native.itemTitles().componentsJoinedByString_(",")}`,
        `${segmented.native.labelForSegment_(1)}`,
      ],
      enabled: [segmented.enabled, segmented.native.isEnabled(), picker.enabled],
      badItems: attempt(() => ((picker as { items: unknown }).items = [{}])),
    });
  }

  // Progress: the value survives a later range; spinner/indeterminate reach the control.
  {
    const progress = new Progress({ value: 150, max: 200 });
    const bar = [progress.value, progress.native.doubleValue(), progress.indeterminate, progress.spinner];
    progress.spinner = true;
    progress.indeterminate = true;
    const spinning = [
      progress.native.style() === objc.enums.NSProgressIndicatorStyle.spinning,
      progress.native.isIndeterminate(),
      progress.spinner,
      progress.indeterminate,
    ];
    // A size set through .native survives the other props; only `spinner` sends setStyle:.
    progress.native.setControlSize_(objc.enums.NSControlSize.small);
    progress.running = false;
    progress.indeterminate = false;
    progress.spinner = false;
    emit({
      step: "progress",
      isProgress: progress.native.isKindOfClass_(NSProgressIndicator),
      bar,
      spinning,
      running: progress.running,
      keptSize: progress.native.controlSize() === objc.enums.NSControlSize.small,
      back: [progress.native.style() === objc.enums.NSProgressIndicatorStyle.bar, progress.native.isIndeterminate()],
      defaults: (({ value, min, max, indeterminate, running, spinner }) => ({
        value,
        min,
        max,
        indeterminate,
        running,
        spinner,
      }))(new Progress()),
    });
  }

  // Image: symbol, file and bytes sources; scaling by the curated names,
  // Apple's names or the number; size as a symbol configuration.
  {
    const image = new Image({ image: { symbol: "star.fill" }, size: 24, tint: "green" });
    const symbol = image.native.image() !== null;
    const png = join(tmpdir(), `bun-appkit-leaves-${process.pid}.png`);
    const label = new Text({ text: "png", width: 20, height: 10 });
    const shot = new Window({ width: 20, height: 10, content: label });
    const bytes = label.snapshot()!;
    shot.close();
    await Bun.write(png, bytes);
    image.image = { file: png };
    const fromFile = [image.native.image() !== null, (image.image as { file: string }).file === png];
    image.image = { data: bytes };
    const fromData = image.native.image() !== null;
    image.image = bytes.buffer;
    const fromBuffer = image.native.image() !== null;
    const scaling: Record<string, unknown> = {};
    for (const name of ["fit", "fill", "none", "down", "scaleAxesIndependently", "NSImageScaleNone"]) {
      image.scaling = name as never;
      scaling[name] = [image.scaling, image.native.imageScaling()];
    }
    image.scaling = objc.enums.NSImageScaling.scaleProportionallyUpOrDown;
    scaling.number = image.scaling;
    emit({
      step: "image",
      isImageView: image.native.isKindOfClass_(NSImageView),
      symbol,
      fromFile,
      fromData,
      fromBuffer,
      scaling,
      configured: image.native.symbolConfiguration() !== null,
      tinted: image.native.contentTintColor() !== null,
      enabled: ((image.enabled = false), [image.enabled, image.native.isEnabled(), new Image().enabled]),
      cleared: ((image.image = null), (image.size = 0), [image.native.image(), image.native.symbolConfiguration()]),
      defaults: (({ image, scaling, tint, size }) => ({ image, scaling, tint, size }))(new Image()),
      missing: attempt(() => (image.image = { file: "/definitely/missing.png" })),
      badData: attempt(() => (image.image = { data: new Uint8Array([1, 2, 3]) })),
      badSource: attempt(() => (image.image = { url: "x" } as never)),
      badScaling: attempt(() => (image.scaling = "stretch" as never)),
      badSymbol: attempt(() => (image.image = { symbol: "no.such.symbol.anywhere" })),
    });
    await Bun.file(png).delete();
  }

  // Divider and Spacer follow the container's axis: the box's one-pixel
  // side and the spacer's minLength swap when they move or the split turns.
  {
    const divider = new Divider();
    const spacer = new Spacer({ minLength: 40 });
    const row = new HStack({ height: 30, children: [new Text("L"), divider, spacer, new Text("R")] });
    const column = new VStack({ children: [row] });
    const win = new Window({ width: 240, height: 120, content: column });
    const inRow = { divider: divider.frame, spacer: spacer.frame };
    row.removeChild(divider);
    row.removeChild(spacer);
    column.append(divider, spacer);
    const inColumn = { divider: divider.frame, spacer: spacer.frame };
    const split = new SplitView({ children: [new Text("a"), new Spacer({ minLength: 50 }), new Text("b")] });
    column.append(split);
    const across = (split.children[1] as Spacer).frame;
    split.vertical = true;
    const down = (split.children[1] as Spacer).frame;
    emit({
      step: "axis",
      isBox: divider.native.isKindOfClass_(NSBox),
      boxType: divider.native.boxType() === objc.enums.NSBoxType.separator,
      spacerClass: `${spacer.native.class()}`,
      inRow: {
        dividerTall: inRow.divider.height >= 30 && inRow.divider.width <= 5,
        spacerWide: inRow.spacer.width >= 40,
      },
      inColumn: {
        dividerWide: inColumn.divider.width >= 100 && inColumn.divider.height <= 5,
        spacerTall: inColumn.spacer.height >= 40,
      },
      split: { across: across.width >= 50, down: down.height >= 50 },
      grow: [spacer.grow, new Spacer({ grow: 3 }).grow],
      defaults: { vertical: new Divider().vertical, minLength: new Spacer().minLength },
    });
    win.close();
  }

  // Views built here that nothing references are collected with their
  // targets and delegates, handlers and all.
  {
    const settled = async () => {
      let last = -1;
      for (let rounds = 0; rounds < 50; rounds++) {
        Bun.gc(true);
        await tick();
        const now = appKitInternals.liveViews();
        if (now === last) return now;
        last = now;
      }
      return last;
    };
    const before = await settled();
    (() => {
      for (let i = 0; i < 30; i++) {
        const field = new TextField({ onChange: () => field.value, onBlur: () => field });
        const slider = new Slider({ onChange: () => slider.value });
        new Picker({ items: ["a"], onChange: () => {} });
        new Divider();
        new Spacer({ minLength: 3 });
      }
    })();
    let left: number;
    const deadline = performance.now() + 5000;
    do left = (await settled()) - before;
    while (left > 0 && performance.now() < deadline);
    emit({ step: "collected", left, uncaught });
  }
});
