// The menu bar is built through the bridge from `app.menu`: the standard
// menus, a custom bar with every item shape, dispatch through
// `-[NSMenu performActionForItemAtIndex:]`, and the rebuilds `app.name` and
// `app.menu` cause. Read back with `objc` from `-[NSApplication mainMenu]`.
// AppKit adds items of its own to some menus (Dictation and Emoji after the
// one holding copy:/paste:, its own Enter Full Screen in "View"), so only
// the items this module builds are compared.
import { app } from "bun:appkit";
import { objc } from "bun:objc";
import { emit, run } from "./_util";

type Item = {
  title: string;
  separator?: boolean;
  key?: string;
  mask?: number;
  action?: string | null;
  target?: string | null;
  enabled?: boolean;
  state?: number;
  tag?: number;
  submenu?: Item[];
};

function describe(menu: any): Item[] {
  const out: Item[] = [];
  for (const item of menu.itemArray()) {
    if (item.isSeparatorItem()) {
      out.push({ title: "", separator: true });
      continue;
    }
    const entry: Item = {
      title: item.title().UTF8String(),
      key: item.keyEquivalent().UTF8String(),
      mask: item.keyEquivalentModifierMask(),
      action: item.action() === null ? null : String(item.action()),
      target: item.target() === null ? null : String(item.target().class()),
      enabled: item.isEnabled(),
      state: item.state(),
      tag: item.tag(),
    };
    const submenu = item.submenu();
    if (submenu !== null) entry.submenu = describe(submenu);
    out.push(entry);
  }
  return out;
}

function attempt(f: () => unknown) {
  try {
    f();
    return { threw: false };
  } catch (e) {
    const err = e as Error;
    return { threw: true, isTypeError: err instanceof TypeError, message: String(err?.message) };
  }
}

await run(() => {
  app.activationPolicy = "accessory";
  const uncaught: string[] = [];
  process.on("uncaughtException", e => uncaught.push((e as Error).message));
  const nsapp = objc.classes.NSApplication.sharedApplication();
  const { shift, option, control, command } = objc.enums.NSEventModifierFlags as unknown as Record<string, number>;

  // Assigned before the application starts: installed when it does.
  const early = [{ title: "Early", items: [{ title: "One", onClick() {} }] }];
  app.menu = early;
  const beforeStart = {
    running: app.isRunning,
    menu: app.menu === early,
    mainMenu: nsapp.mainMenu(),
    item: app.menuItem(early[0].items[0]),
  };
  app.keepAlive = true;
  emit({
    step: "before start",
    ...beforeStart,
    mainMenu: beforeStart.mainMenu === null,
    after: describe(nsapp.mainMenu()).map(i => i.title),
    itemAfter: app.menuItem(early[0].items[0]) === nsapp.mainMenu().itemAtIndex_(0).submenu().itemAtIndex_(0),
  });

  app.menu = null;
  const earlyGone = app.menuItem(early[0].items[0]);
  const standard = describe(nsapp.mainMenu());
  const windowMenu = nsapp.mainMenu().itemAtIndex_(3).submenu();
  const services = nsapp.mainMenu().itemAtIndex_(0).submenu().itemAtIndex_(2).submenu();
  emit({
    step: "standard",
    earlyGone,
    name: app.name,
    titles: standard.map(i => i.title),
    appItems: standard[0].submenu!.map(i => (i.separator ? "-" : `${i.title}|${i.action}|${i.key}`)),
    edit: standard[1].submenu!.slice(0, 8).map(i => (i.separator ? "-" : `${i.title}|${i.action}|${i.key}`)),
    view: standard[2].submenu!.filter(i => i.mask === (command | control)).map(i => `${i.title}|${i.action}|${i.key}`),
    window: standard[3].submenu!.map(i => (i.separator ? "-" : `${i.title}|${i.action}|${i.key}`)),
    hideOthersMask: standard[0].submenu![5].mask === (command | option),
    // A submenu holder's target is its menu (AppKit's doing); every action item goes down the responder chain.
    targets: [...standard[0].submenu!, ...standard[1].submenu!.slice(0, 8), ...standard[3].submenu!].every(
      i => i.separator || i.submenu !== undefined || i.target === null,
    ),
    windowsMenu: nsapp.windowsMenu() === windowMenu,
    servicesMenu: nsapp.servicesMenu() === services,
    // A standard action resolves down the responder chain to the application itself.
    terminateTarget: nsapp.targetForAction_("terminate:") === nsapp,
  });

  app.name = "Renamed";
  const renamed = describe(nsapp.mainMenu());
  app.name = null;
  emit({
    step: "renamed",
    title: renamed[0].title,
    quit: renamed[0].submenu!.at(-1)!.title,
    back: describe(nsapp.mainMenu())[0].title,
  });

  const calls: string[] = [];
  const chosen: string[] = [];
  app.on("menu", item => chosen.push((item as { title: string }).title));
  const doItem = { title: "Do", onClick: () => calls.push("do") };
  const spec = [
    {
      title: "Main",
      items: [
        doItem,
        "separator" as const,
        { title: "Copy", action: "copy:", key: "c" },
        { title: "Custom", action: "customAction:" },
        { title: "Fn", action: () => calls.push("fn") },
        { title: "Off", enabled: false, onClick: () => calls.push("off") },
        { title: "Checked", checked: true },
        {
          title: "Sub",
          submenu: [{ title: "Inner", onClick: () => calls.push("inner"), key: "i", shift: true, option: true }],
        },
        { title: "Held", enabled: false, submenu: [{ title: "Deep", action: "copy:" }] },
        { title: "Bare", key: "b", command: false, control: true },
        { title: "Upper", key: "S" },
      ],
    },
    { title: "Second", items: [] },
  ];
  app.menu = spec;
  const custom = describe(nsapp.mainMenu());
  const main = nsapp.mainMenu().itemAtIndex_(0).submenu();
  main.performActionForItemAtIndex_(0); // Do
  main.performActionForItemAtIndex_(4); // Fn
  main.performActionForItemAtIndex_(5); // Off: disabled, nothing
  main.performActionForItemAtIndex_(6); // Checked: no function, "menu" event only
  main.itemAtIndex_(7).submenu().performActionForItemAtIndex_(0); // Inner
  const items = custom[0].submenu!;
  // menuItem(): the NSMenuItem built for an item object (any depth), a submenu holder or a top-level menu; live setters, no rebuild.
  const mainItems = spec[0].items as { title: string }[];
  const doNative = app.menuItem(doItem);
  doNative!.setEnabled_(false);
  doNative!.setTitle_("Done");
  app.menuItem(mainItems[6] as never)!.setState_(0);
  const menuItem = {
    doIs: doNative === main.itemAtIndex_(0),
    twice: app.menuItem(doItem) === doNative,
    inner:
      app.menuItem((mainItems[7] as { submenu: object[] }).submenu[0] as never) ===
      main.itemAtIndex_(7).submenu().itemAtIndex_(0),
    holder: app.menuItem(mainItems[7] as never) === main.itemAtIndex_(7),
    top: app.menuItem(spec[1] as never) === nsapp.mainMenu().itemAtIndex_(1),
    separator: attempt(() => app.menuItem("separator" as never)),
    copy: app.menuItem({ title: "Copy", action: "copy:", key: "c" }),
    after: describe(main)
      .slice(0, 1)
      .map(i => `${i.title}|${i.enabled}`)[0],
    checked: main.itemAtIndex_(6).state(),
    sameBar: nsapp.mainMenu().itemAtIndex_(0).submenu() === main,
    spec: doItem.title,
  };
  emit({
    step: "custom",
    menuItem,
    titles: custom.map(i => i.title),
    second: custom[1].submenu,
    items: items.slice(0, 11).map(i => (i.separator ? "-" : `${i.title}|${i.action}|${i.key}|${i.enabled}|${i.state}`)),
    oneTarget:
      items[0].target === items[4].target &&
      items[0].target === items[7].submenu![0].target &&
      /^BunScriptObject\d+$/.test(items[0].target!),
    selectorTargets: [items[2].target, items[3].target],
    offTarget: items[5].target,
    tags: [items[0].tag, items[4].tag, items[6].tag, items[7].submenu![0].tag],
    masks: {
      copy: items[2].mask === command,
      inner: items[7].submenu![0].mask === (command | shift | option),
      bare: items[9].mask === control,
      upper: items[10].mask === command,
    },
    held: { enabled: items[8].enabled, deep: items[8].submenu!.map(i => `${i.title}|${i.action}`) },
    calls,
    chosen,
    getter: app.menu === spec,
    uncaught: uncaught.splice(0),
  });

  emit({
    step: "refused",
    both: attempt(() => (app.menu = [{ title: "X", items: [{ title: "a", onClick() {}, action: "copy:" }] }])),
    twoColons: attempt(() => (app.menu = [{ title: "X", items: [{ title: "a", action: "insert:at:" }] }])),
    noColon: attempt(() => (app.menu = [{ title: "X", items: [{ title: "a", action: "copy" }] }])),
    badClick: attempt(() => (app.menu = [{ title: "X", items: [{ title: "a", onClick: "yes" as never }] }])),
    submenuAndAction: attempt(
      () => (app.menu = [{ title: "X", items: [{ title: "a", action: "copy:", submenu: [] }] }]),
    ),
    notArray: attempt(() => (app.menu = {} as never)),
    badMenu: attempt(() => (app.menu = [{ items: [] }] as never)),
    badItem: attempt(() => (app.menu = [{ title: "X", items: [3 as never] }])),
    // A refused spec leaves the installed one alone.
    still: app.menu === spec && describe(nsapp.mainMenu())[0].title,
  });

  // A held NSMenuItem of the bar being replaced: choosing it afterwards reaches nothing.
  const stale = app.menuItem(doItem)!;
  stale.setEnabled_(true);
  app.menu = null;
  stale.menu().performActionForItemAtIndex_(0);
  emit({
    step: "restored",
    titles: describe(nsapp.mainMenu()).map(i => i.title),
    getter: app.menu,
    doItem: app.menuItem(doItem),
    staleCalls: calls.length,
    windowsMenu: nsapp.windowsMenu() === nsapp.mainMenu().itemAtIndex_(3).submenu(),
  });
  app.keepAlive = false;
});
