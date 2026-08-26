// "reopen" and "menu" listeners and a menu item's onClick: one that throws is
// reported as an uncaught error and the rest still run. The Dock click and the
// menu choice are driven through the application delegate the way AppKit does.
// Underneath, `objc.app`: the application lifecycle the curated `app` is
// written on, whose delegate is defined in JavaScript and is the script's to
// extend or forward from.
import { app, Window } from "bun:appkit";
import { objc } from "bun:objc";
import { emit, run, waitFor } from "./_util";

await run(async () => {
  const lifecycle = objc.app;
  // Nothing has started: reading never starts, a keep-alive token neither.
  const before = { running: lifecycle.isRunning, delegate: lifecycle.delegate, isDark: lifecycle.isDark };
  const early = lifecycle.retain();
  const stillNotRunning = !lifecycle.isRunning;
  early.release();
  early.release();
  // The delegate class can be subclassed before anything started the app,
  // and an instance set as the delegate then is what start() installs.
  const EarlySub = objc.defineClass({ superclass: "BunApplicationDelegate", methods: {} });
  const earlySub = EarlySub.new();
  lifecycle.delegate = earlySub;
  app.activationPolicy = "accessory";
  app.keepAlive = true;
  const nsappEarly = objc.classes.NSApplication.sharedApplication();
  const earlyInstalled = nsappEarly.delegate() === earlySub;
  lifecycle.delegate = null;
  const uncaught: string[] = [];
  process.on("uncaughtException", e => uncaught.push((e as Error).message));
  const boom = (what: string) => () => {
    throw new Error(`${what} boom`);
  };

  const nsapp = objc.classes.NSApplication.sharedApplication();
  const reopens: unknown[] = [];
  const throwingReopen = boom("reopen");
  app.on("reopen", throwingReopen);
  app.on("reopen", visible => reopens.push(visible));
  const handled = nsapp.delegate().applicationShouldHandleReopen_hasVisibleWindows_(nsapp, false);
  app.off("reopen", throwingReopen);
  nsapp.delegate().applicationShouldHandleReopen_hasVisibleWindows_(nsapp, true);
  emit({ step: "reopen", reopens, handled, uncaught: uncaught.splice(0) });

  const hello = { title: "Hello", onClick: boom("onClick") };
  const spec = [{ title: "Test", items: [hello] }];
  app.menu = spec;
  const chosen: unknown[] = [];
  app.on("menu", boom("menu"));
  app.on("menu", item => chosen.push(item === hello ? "same item" : item));
  nsapp.mainMenu().itemAtIndex_(0).submenu().performActionForItemAtIndex_(0);
  emit({ step: "menu", chosen, uncaught: uncaught.splice(0) });

  // The application delegate: this module's `BunApplicationDelegate`, one
  // object for both `app`s. A script's delegate is an instance of a subclass
  // of it, installed as is; anything else is refused. Start-up does not go
  // through it: a separate observer hears the launch notification.
  {
    const own = nsapp.delegate();
    const heard: string[] = [];
    const Sub = objc.defineClass({
      name: "FixtureAppDelegate",
      superclass: "BunApplicationDelegate",
      methods: {
        "applicationDidChangeScreenParameters:": () => void heard.push("screens"),
        "applicationShouldHandleReopen:hasVisibleWindows:"(sender: unknown, visible: boolean) {
          heard.push(`sub before ${visible}`);
          const verdict = this.super.applicationShouldHandleReopen_hasVisibleWindows_(sender, visible);
          heard.push(`sub after ${verdict}`);
          return false;
        },
        // Overriding the launch hook without calling up stalls nothing.
        "applicationDidFinishLaunching:": () => void heard.push("launched"),
        "applicationDockMenu:": () => null,
      },
    });
    const sub = Sub.new();
    lifecycle.delegate = sub;
    const subclassed = {
      installed: nsapp.delegate() === sub,
      reads: lifecycle.delegate === sub,
      responds: [
        nsapp.delegate().respondsToSelector_("applicationDidChangeScreenParameters:"),
        nsapp.delegate().respondsToSelector_("applicationDidHide:"),
        nsapp.delegate().respondsToSelector_("applicationShouldTerminate:"),
        own.respondsToSelector_("applicationDidChangeScreenParameters:"),
      ],
    };
    // AppKit's paths: a posted notification the delegate was registered for, and a direct send.
    const center = objc.classes.NSNotificationCenter.defaultCenter();
    center.postNotificationName_object_(objc.constants.NSApplicationDidChangeScreenParametersNotification, nsapp);
    const answered = nsapp.delegate().applicationShouldHandleReopen_hasVisibleWindows_(nsapp, false);
    nsapp.delegate().applicationDidFinishLaunching_(null);
    lifecycle.delegate = null;
    const restored = { installed: nsapp.delegate() === own, reads: lifecycle.delegate === own };
    const refused = (value: unknown) => {
      try {
        (lifecycle as { delegate: unknown }).delegate = value;
        return false;
      } catch (e) {
        return e instanceof TypeError && /BunApplicationDelegate/.test((e as Error).message);
      }
    };
    const Plain = objc.defineClass({ protocols: ["NSApplicationDelegate"], methods: {} });
    emit({
      step: "delegate",
      before,
      stillNotRunning,
      earlySuperclass: String(objc.functions.NSStringFromClass(EarlySub.superclass())),
      earlyInstalled,
      className: String(own.className()),
      conforms: own.conformsToProtocol_(objc.protocols.NSApplicationDelegate),
      ownMethods: [
        "applicationShouldTerminate:",
        "applicationWillTerminate:",
        "applicationShouldHandleReopen:hasVisibleWindows:",
        "applicationSupportsSecureRestorableState:",
        "applicationDidFinishLaunching:",
      ].map(sel => objc.classes.BunApplicationDelegate.instancesRespondToSelector_(sel)),
      // Neither forwarding hook is overridden: the class's IMP is NSObject's.
      inherited: ["respondsToSelector:", "forwardingTargetForSelector:", "methodSignatureForSelector:"].map(
        sel =>
          objc.classes.BunApplicationDelegate.instanceMethodForSelector_(sel) ===
          objc.classes.NSObject.instanceMethodForSelector_(sel),
      ),
      observer: objc.classes.BunApplicationObserver.instancesRespondToSelector_("launched:"),
      subclassed,
      answered,
      restored,
      heard,
      reopens: reopens.slice(2),
      notObject: refused("nope"),
      notSubclass: refused(Plain.new()),
      notInstance: refused(objc.classes.NSObject.new()),
      afterBad: nsapp.delegate() === own,
    });
  }

  // start() is idempotent and never activates; both `app`s see one application.
  {
    lifecycle.start();
    lifecycle.start("accessory");
    let policyRefused = false;
    try {
      lifecycle.activationPolicy = "bogus" as never;
    } catch (e) {
      policyRefused = e instanceof TypeError;
    }
    emit({
      step: "lifecycle",
      running: [lifecycle.isRunning, app.isRunning],
      policy: [lifecycle.activationPolicy, app.activationPolicy, Number(nsapp.activationPolicy())],
      policyRefused,
      badge: ((lifecycle.badge = 7), [lifecycle.badge, app.badge, String(nsapp.dockTile().badgeLabel())]),
      badgeCleared: ((app.badge = null), [lifecycle.badge, nsapp.dockTile().badgeLabel()]),
      isDark: typeof lifecycle.isDark,
      hasDisplay: lifecycle.hasDisplay === app.hasDisplay,
      events: (() => {
        try {
          lifecycle.on("menu" as never, () => {});
          return "accepted";
        } catch (e) {
          return (e as Error).message;
        }
      })(),
    });
  }

  // A subclass that defers the quit (NSTerminateLater) calls up first: the
  // listeners are asked there and then (a veto cancels), agreement lets the
  // deferral stand, and nothing is scheduled, so the process is still here.
  {
    const Deferring = objc.defineClass({
      superclass: "BunApplicationDelegate",
      methods: {
        "applicationShouldTerminate:"(sender: unknown) {
          const verdict = this.super.applicationShouldTerminate_(sender);
          return verdict === 0 ? verdict : 2;
        },
      },
    });
    lifecycle.delegate = Deferring.new();
    let asked = 0;
    let veto = true;
    const listener = (e: { preventDefault(): void }) => {
      asked++;
      if (veto) e.preventDefault();
    };
    lifecycle.on("beforequit", listener);
    const vetoed = Number(nsapp.delegate().applicationShouldTerminate_(nsapp));
    veto = false;
    const deferred = Number(nsapp.delegate().applicationShouldTerminate_(nsapp));
    lifecycle.off("beforequit", listener);
    lifecycle.delegate = null;
    await new Promise<void>(resolve => setImmediate(resolve));
    emit({ step: "deferred quit", vetoed, deferred, asked, running: lifecycle.isRunning });
  }

  // Two rounds: `beforequit` listeners (bun:appkit's and the bridge's alike)
  // decide first and nothing is touched meanwhile; only then does `willquit`
  // close bun:appkit's windows, and a `willquit` veto still cancels.
  {
    let shouldCloseCalls = 0;
    const win = new Window({ title: "two rounds", width: 120, height: 80, shouldClose: () => (shouldCloseCalls++, true) });
    const log: string[] = [];
    const veto = (e: { preventDefault(): void; defaultPrevented: boolean }) => {
      log.push(`before ${e.defaultPrevented}`);
      e.preventDefault();
    };
    lifecycle.on("beforequit", veto);
    const late = (e: { defaultPrevented: boolean }) => void log.push(`late ${e.defaultPrevented}`);
    lifecycle.on("beforequit", late);
    app.quit();
    const afterBefore = { closed: win.closed, shouldCloseCalls, log: log.splice(0) };
    lifecycle.off("beforequit", veto);
    lifecycle.off("beforequit", late);
    const will = (e: { preventDefault(): void }) => {
      log.push(`will closed=${win.closed}`);
      e.preventDefault();
    };
    lifecycle.on("willquit", will);
    app.quit();
    const afterWill = { closed: win.closed, shouldCloseCalls, log: log.splice(0), running: lifecycle.isRunning };
    lifecycle.off("willquit", will);
    await new Promise<void>(resolve => setImmediate(resolve));
    emit({ step: "two rounds", afterBefore, afterWill });
  }

  // An Objective-C exception raised while AppKit waits for or dispatches an
  // event (here a timer whose target does not take the message) is reported
  // as an uncaught ERR_OBJC_EXCEPTION and the loop carries on, the way
  // -[NSApplication run] reports and continues.
  {
    const thrown: { code?: string; name?: string }[] = [];
    const onError = (e: Error & { code?: string }) => thrown.push({ code: e.code, name: e.name });
    process.on("uncaughtException", onError);
    const target = objc.classes.NSArray.array();
    objc.classes.NSTimer.scheduledTimerWithTimeInterval_target_selector_userInfo_repeats_(
      0.001,
      target,
      "objectAtIndex:",
      null,
      false,
    );
    await waitFor(() => thrown.length > 0, "the timer's exception to be reported", 5_000);
    // Bun's own timers still run afterwards.
    const after = await new Promise<boolean>(resolve => setTimeout(() => resolve(true), 1));
    process.off("uncaughtException", onError);
    uncaught.splice(0);
    emit({ step: "exception in wait", thrown, after, running: lifecycle.isRunning });
  }

  // A keep-alive token holds the process like an open window; released (or
  // disposed), it lets go. keepAlive was this fixture's only other hold.
  {
    const token = lifecycle.retain();
    app.keepAlive = false;
    let fired = false;
    setTimeout(() => {
      fired = true;
      emit({ step: "held", keepAlive: app.keepAlive, released: token.released });
      {
        using scoped = lifecycle.retain();
        void scoped;
      }
      token.release();
      // Nothing holds the process now: this timer never fires.
      setTimeout(() => emit({ step: "unexpected" }), 200).unref();
    }, 20).unref();
    void fired;
  }
});
