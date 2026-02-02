import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

describe("Bun.TUIKeyReader", () => {
  test("constructor exists", () => {
    expect(Bun.TUIKeyReader).toBeDefined();
    expect(typeof Bun.TUIKeyReader).toBe("function");
  });

  test("parses printable ASCII characters", async () => {
    using dir = tempDir("tui-keyreader-ascii", {
      "test.ts": `
        const reader = new Bun.TUIKeyReader();
        const events: any[] = [];
        reader.onkeypress = (event: any) => {
          events.push({ name: event.name, ctrl: event.ctrl, shift: event.shift, alt: event.alt });
          if (events.length >= 3) {
            reader.close();
            console.log(JSON.stringify(events));
            process.exit(0);
          }
        };
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "test.ts")],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Send "abc" to stdin
    proc.stdin.write("abc");
    proc.stdin.end();

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    const events = JSON.parse(stdout.trim());
    expect(events).toEqual([
      { name: "a", ctrl: false, shift: false, alt: false },
      { name: "b", ctrl: false, shift: false, alt: false },
      { name: "c", ctrl: false, shift: false, alt: false },
    ]);
    expect(exitCode).toBe(0);
  });

  test("parses ctrl+c as ctrl key event", async () => {
    using dir = tempDir("tui-keyreader-ctrl", {
      "test.ts": `
        const reader = new Bun.TUIKeyReader();
        reader.onkeypress = (event: any) => {
          reader.close();
          console.log(JSON.stringify({ name: event.name, ctrl: event.ctrl }));
          process.exit(0);
        };
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "test.ts")],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Send ctrl+c (0x03)
    proc.stdin.write(new Uint8Array([0x03]));
    proc.stdin.end();

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    const event = JSON.parse(stdout.trim());
    expect(event.name).toBe("c");
    expect(event.ctrl).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("parses arrow keys (CSI sequences)", async () => {
    using dir = tempDir("tui-keyreader-arrows", {
      "test.ts": `
        const reader = new Bun.TUIKeyReader();
        const events: string[] = [];
        reader.onkeypress = (event: any) => {
          events.push(event.name);
          if (events.length >= 4) {
            reader.close();
            console.log(JSON.stringify(events));
            process.exit(0);
          }
        };
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "test.ts")],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Send arrow key sequences: up, down, right, left
    proc.stdin.write("\x1b[A\x1b[B\x1b[C\x1b[D");
    proc.stdin.end();

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    const events = JSON.parse(stdout.trim());
    expect(events).toEqual(["up", "down", "right", "left"]);
    expect(exitCode).toBe(0);
  });

  test("parses enter, tab, backspace", async () => {
    using dir = tempDir("tui-keyreader-special", {
      "test.ts": `
        const reader = new Bun.TUIKeyReader();
        const events: string[] = [];
        reader.onkeypress = (event: any) => {
          events.push(event.name);
          if (events.length >= 3) {
            reader.close();
            console.log(JSON.stringify(events));
            process.exit(0);
          }
        };
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "test.ts")],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Send enter (\r), tab (\t), backspace (0x7f)
    proc.stdin.write(new Uint8Array([0x0d, 0x09, 0x7f]));
    proc.stdin.end();

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    const events = JSON.parse(stdout.trim());
    expect(events).toEqual(["enter", "tab", "backspace"]);
    expect(exitCode).toBe(0);
  });

  test("parses SS3 function keys (f1-f4)", async () => {
    using dir = tempDir("tui-keyreader-ss3", {
      "test.ts": `
        const reader = new Bun.TUIKeyReader();
        const events: string[] = [];
        reader.onkeypress = (event: any) => {
          events.push(event.name);
          if (events.length >= 4) {
            reader.close();
            console.log(JSON.stringify(events));
            process.exit(0);
          }
        };
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "test.ts")],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Send SS3 f1-f4: \x1bOP, \x1bOQ, \x1bOR, \x1bOS
    proc.stdin.write("\x1bOP\x1bOQ\x1bOR\x1bOS");
    proc.stdin.end();

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    const events = JSON.parse(stdout.trim());
    expect(events).toEqual(["f1", "f2", "f3", "f4"]);
    expect(exitCode).toBe(0);
  });

  test("parses alt+letter (meta prefix)", async () => {
    using dir = tempDir("tui-keyreader-alt", {
      "test.ts": `
        const reader = new Bun.TUIKeyReader();
        reader.onkeypress = (event: any) => {
          reader.close();
          console.log(JSON.stringify({ name: event.name, alt: event.alt }));
          process.exit(0);
        };
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "test.ts")],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Send alt+a: \x1ba
    proc.stdin.write("\x1ba");
    proc.stdin.end();

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    const event = JSON.parse(stdout.trim());
    expect(event.name).toBe("a");
    expect(event.alt).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("parses bracketed paste", async () => {
    using dir = tempDir("tui-keyreader-paste", {
      "test.ts": `
        const reader = new Bun.TUIKeyReader();
        reader.onpaste = (text: string) => {
          reader.close();
          console.log(JSON.stringify({ text }));
          process.exit(0);
        };
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "test.ts")],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Send bracketed paste: \x1b[200~hello world\x1b[201~
    proc.stdin.write("\x1b[200~hello world\x1b[201~");
    proc.stdin.end();

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    const result = JSON.parse(stdout.trim());
    expect(result.text).toBe("hello world");
    expect(exitCode).toBe(0);
  });

  test("close() is idempotent", async () => {
    using dir = tempDir("tui-keyreader-close", {
      "test.ts": `
        const reader = new Bun.TUIKeyReader();
        reader.close();
        reader.close(); // should not throw
        console.log("ok");
        process.exit(0);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "test.ts")],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    proc.stdin.end();

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("ok");
    expect(exitCode).toBe(0);
  });

  test("CSI ~ sequences (delete, pageup, pagedown, f5-f12)", async () => {
    using dir = tempDir("tui-keyreader-tilde", {
      "test.ts": `
        const reader = new Bun.TUIKeyReader();
        const events: string[] = [];
        reader.onkeypress = (event: any) => {
          events.push(event.name);
          if (events.length >= 4) {
            reader.close();
            console.log(JSON.stringify(events));
            process.exit(0);
          }
        };
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "test.ts")],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Send delete (\x1b[3~), pageup (\x1b[5~), pagedown (\x1b[6~), f5 (\x1b[15~)
    proc.stdin.write("\x1b[3~\x1b[5~\x1b[6~\x1b[15~");
    proc.stdin.end();

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    const events = JSON.parse(stdout.trim());
    expect(events).toEqual(["delete", "pageup", "pagedown", "f5"]);
    expect(exitCode).toBe(0);
  });

  test("parses UTF-8 characters", async () => {
    using dir = tempDir("tui-keyreader-utf8", {
      "test.ts": `
        const reader = new Bun.TUIKeyReader();
        const events: string[] = [];
        reader.onkeypress = (event: any) => {
          events.push(event.name);
          if (events.length >= 3) {
            reader.close();
            console.log(JSON.stringify(events));
            process.exit(0);
          }
        };
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "test.ts")],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    proc.stdin.write("a世b");
    proc.stdin.end();

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    const events = JSON.parse(stdout.trim());
    expect(events).toEqual(["a", "世", "b"]);
    expect(exitCode).toBe(0);
  });

  test("parses CSI modifier keys (shift+up, ctrl+right)", async () => {
    using dir = tempDir("tui-keyreader-mods", {
      "test.ts": `
        const reader = new Bun.TUIKeyReader();
        const events: any[] = [];
        reader.onkeypress = (event: any) => {
          events.push({ name: event.name, shift: event.shift, ctrl: event.ctrl, alt: event.alt });
          if (events.length >= 2) {
            reader.close();
            console.log(JSON.stringify(events));
            process.exit(0);
          }
        };
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "test.ts")],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // shift+up = \x1b[1;2A, ctrl+right = \x1b[1;5C
    proc.stdin.write("\x1b[1;2A\x1b[1;5C");
    proc.stdin.end();

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    const events = JSON.parse(stdout.trim());
    expect(events).toEqual([
      { name: "up", shift: true, ctrl: false, alt: false },
      { name: "right", shift: false, ctrl: true, alt: false },
    ]);
    expect(exitCode).toBe(0);
  });

  test("parses kitty protocol CSI u", async () => {
    using dir = tempDir("tui-keyreader-kitty", {
      "test.ts": `
        const reader = new Bun.TUIKeyReader();
        reader.onkeypress = (event: any) => {
          reader.close();
          console.log(JSON.stringify({ name: event.name, ctrl: event.ctrl }));
          process.exit(0);
        };
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "test.ts")],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // kitty: ctrl+a = \x1b[97;5u (codepoint 97='a', modifier 5=ctrl)
    proc.stdin.write("\x1b[97;5u");
    proc.stdin.end();

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    const event = JSON.parse(stdout.trim());
    expect(event.name).toBe("a");
    expect(event.ctrl).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("onkeypress/onpaste setter/getter", async () => {
    using dir = tempDir("tui-keyreader-props", {
      "test.ts": `
        const reader = new Bun.TUIKeyReader();
        const results: boolean[] = [];

        // Initially undefined
        results.push(reader.onkeypress === undefined);
        results.push(reader.onpaste === undefined);

        // Set callback
        const cb = () => {};
        reader.onkeypress = cb;
        results.push(reader.onkeypress === cb);

        // Set to undefined clears it
        reader.onkeypress = undefined;
        results.push(reader.onkeypress === undefined);

        reader.close();
        console.log(JSON.stringify(results));
        process.exit(0);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "test.ts")],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    proc.stdin.end();

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    const results = JSON.parse(stdout.trim());
    expect(results).toEqual([true, true, true, true]);
    expect(exitCode).toBe(0);
  });

  // ─── onmouse callback ──────────────────────────────────────────

  describe("onmouse", () => {
    test("parses SGR mouse left button press", async () => {
      using dir = tempDir("tui-keyreader-mouse-down", {
        "test.ts": `
          const reader = new Bun.TUIKeyReader();
          reader.onmouse = (event: any) => {
            reader.close();
            console.log(JSON.stringify({
              type: event.type,
              button: event.button,
              x: event.x,
              y: event.y,
              shift: event.shift,
              alt: event.alt,
              ctrl: event.ctrl,
            }));
            process.exit(0);
          };
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), join(String(dir), "test.ts")],
        env: bunEnv,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });

      // SGR mouse: CSI < 0 ; 10 ; 5 M = left button press at (10,5)
      proc.stdin.write("\x1b[<0;10;5M");
      proc.stdin.end();

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      const event = JSON.parse(stdout.trim());
      expect(event).toEqual({
        type: "down",
        button: 0,
        x: 9, // 1-based to 0-based
        y: 4, // 1-based to 0-based
        shift: false,
        alt: false,
        ctrl: false,
      });
      expect(exitCode).toBe(0);
    });

    test("parses SGR mouse right button release", async () => {
      using dir = tempDir("tui-keyreader-mouse-up", {
        "test.ts": `
          const reader = new Bun.TUIKeyReader();
          reader.onmouse = (event: any) => {
            reader.close();
            console.log(JSON.stringify({
              type: event.type,
              button: event.button,
              x: event.x,
              y: event.y,
            }));
            process.exit(0);
          };
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), join(String(dir), "test.ts")],
        env: bunEnv,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });

      // SGR mouse: CSI < 2 ; 20 ; 15 m = right button (2) release at (20,15)
      proc.stdin.write("\x1b[<2;20;15m");
      proc.stdin.end();

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      const event = JSON.parse(stdout.trim());
      expect(event).toEqual({
        type: "up",
        button: 2,
        x: 19,
        y: 14,
      });
      expect(exitCode).toBe(0);
    });

    test("parses SGR mouse scroll up", async () => {
      using dir = tempDir("tui-keyreader-mouse-scroll", {
        "test.ts": `
          const reader = new Bun.TUIKeyReader();
          reader.onmouse = (event: any) => {
            reader.close();
            console.log(JSON.stringify({
              type: event.type,
              button: event.button,
              x: event.x,
              y: event.y,
            }));
            process.exit(0);
          };
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), join(String(dir), "test.ts")],
        env: bunEnv,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });

      // SGR mouse: CSI < 64 ; 5 ; 3 M = scroll up (64 = scroll flag + button 0) at (5,3)
      proc.stdin.write("\x1b[<64;5;3M");
      proc.stdin.end();

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      const event = JSON.parse(stdout.trim());
      expect(event).toEqual({
        type: "scrollUp",
        button: 4, // wheel up
        x: 4,
        y: 2,
      });
      expect(exitCode).toBe(0);
    });

    test("parses SGR mouse scroll down", async () => {
      using dir = tempDir("tui-keyreader-mouse-scrolldn", {
        "test.ts": `
          const reader = new Bun.TUIKeyReader();
          reader.onmouse = (event: any) => {
            reader.close();
            console.log(JSON.stringify({
              type: event.type,
              button: event.button,
            }));
            process.exit(0);
          };
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), join(String(dir), "test.ts")],
        env: bunEnv,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });

      // SGR mouse: CSI < 65 ; 5 ; 3 M = scroll down (64 + 1 = scroll flag + button 1)
      proc.stdin.write("\x1b[<65;5;3M");
      proc.stdin.end();

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      const event = JSON.parse(stdout.trim());
      expect(event).toEqual({
        type: "scrollDown",
        button: 5, // wheel down
      });
      expect(exitCode).toBe(0);
    });

    test("parses SGR mouse motion event (drag)", async () => {
      using dir = tempDir("tui-keyreader-mouse-drag", {
        "test.ts": `
          const reader = new Bun.TUIKeyReader();
          reader.onmouse = (event: any) => {
            reader.close();
            console.log(JSON.stringify({
              type: event.type,
              button: event.button,
              x: event.x,
              y: event.y,
            }));
            process.exit(0);
          };
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), join(String(dir), "test.ts")],
        env: bunEnv,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });

      // SGR mouse: CSI < 32 ; 10 ; 5 M = motion flag (32) + left button (0) = drag
      proc.stdin.write("\x1b[<32;10;5M");
      proc.stdin.end();

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      const event = JSON.parse(stdout.trim());
      expect(event).toEqual({
        type: "drag",
        button: 0,
        x: 9,
        y: 4,
      });
      expect(exitCode).toBe(0);
    });

    test("parses SGR mouse move (motion + no button)", async () => {
      using dir = tempDir("tui-keyreader-mouse-move", {
        "test.ts": `
          const reader = new Bun.TUIKeyReader();
          reader.onmouse = (event: any) => {
            reader.close();
            console.log(JSON.stringify({
              type: event.type,
              button: event.button,
              x: event.x,
              y: event.y,
            }));
            process.exit(0);
          };
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), join(String(dir), "test.ts")],
        env: bunEnv,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });

      // SGR mouse: CSI < 35 ; 10 ; 5 M = motion flag (32) + button 3 = move (no button)
      proc.stdin.write("\x1b[<35;10;5M");
      proc.stdin.end();

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      const event = JSON.parse(stdout.trim());
      expect(event).toEqual({
        type: "move",
        button: 3,
        x: 9,
        y: 4,
      });
      expect(exitCode).toBe(0);
    });

    test("parses SGR mouse with modifier keys", async () => {
      using dir = tempDir("tui-keyreader-mouse-mods", {
        "test.ts": `
          const reader = new Bun.TUIKeyReader();
          reader.onmouse = (event: any) => {
            reader.close();
            console.log(JSON.stringify({
              type: event.type,
              button: event.button,
              shift: event.shift,
              alt: event.alt,
              ctrl: event.ctrl,
            }));
            process.exit(0);
          };
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), join(String(dir), "test.ts")],
        env: bunEnv,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });

      // SGR mouse: CSI < 28 ; 10 ; 5 M = button 0 + shift(4) + alt(8) + ctrl(16) = 0+4+8+16=28
      proc.stdin.write("\x1b[<28;10;5M");
      proc.stdin.end();

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      const event = JSON.parse(stdout.trim());
      expect(event).toEqual({
        type: "down",
        button: 0,
        shift: true,
        alt: true,
        ctrl: true,
      });
      expect(exitCode).toBe(0);
    });

    test("onmouse setter/getter", async () => {
      using dir = tempDir("tui-keyreader-mouse-sg", {
        "test.ts": `
          const reader = new Bun.TUIKeyReader();
          const results: boolean[] = [];

          results.push(reader.onmouse === undefined);

          const cb = () => {};
          reader.onmouse = cb;
          results.push(reader.onmouse === cb);

          reader.onmouse = undefined;
          results.push(reader.onmouse === undefined);

          reader.close();
          console.log(JSON.stringify(results));
          process.exit(0);
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), join(String(dir), "test.ts")],
        env: bunEnv,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });

      proc.stdin.end();

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      const results = JSON.parse(stdout.trim());
      expect(results).toEqual([true, true, true]);
      expect(exitCode).toBe(0);
    });

    test("mouse event without onmouse callback is ignored", async () => {
      using dir = tempDir("tui-keyreader-mouse-nocb", {
        "test.ts": `
          const reader = new Bun.TUIKeyReader();
          let gotKeypress = false;
          reader.onkeypress = (event: any) => {
            if (event.name === "x") {
              gotKeypress = true;
              reader.close();
              console.log(JSON.stringify({ gotKeypress }));
              process.exit(0);
            }
          };
          // No onmouse set — mouse events should be silently dropped
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), join(String(dir), "test.ts")],
        env: bunEnv,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });

      // Send mouse event followed by a regular keypress
      proc.stdin.write("\x1b[<0;10;5Mx");
      proc.stdin.end();

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      const result = JSON.parse(stdout.trim());
      expect(result.gotKeypress).toBe(true);
      expect(exitCode).toBe(0);
    });
  });

  // ─── onfocus / onblur callbacks ─────────────────────────────────

  describe("onfocus / onblur", () => {
    test("parses focus in event (CSI I)", async () => {
      using dir = tempDir("tui-keyreader-focus-in", {
        "test.ts": `
          const reader = new Bun.TUIKeyReader();
          reader.onfocus = () => {
            reader.close();
            console.log(JSON.stringify({ focused: true }));
            process.exit(0);
          };
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), join(String(dir), "test.ts")],
        env: bunEnv,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });

      // Focus in: CSI I = \x1b[I
      proc.stdin.write("\x1b[I");
      proc.stdin.end();

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      const result = JSON.parse(stdout.trim());
      expect(result.focused).toBe(true);
      expect(exitCode).toBe(0);
    });

    test("parses focus out event (CSI O)", async () => {
      using dir = tempDir("tui-keyreader-focus-out", {
        "test.ts": `
          const reader = new Bun.TUIKeyReader();
          reader.onblur = () => {
            reader.close();
            console.log(JSON.stringify({ blurred: true }));
            process.exit(0);
          };
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), join(String(dir), "test.ts")],
        env: bunEnv,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });

      // Focus out: CSI O = \x1b[O
      proc.stdin.write("\x1b[O");
      proc.stdin.end();

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      const result = JSON.parse(stdout.trim());
      expect(result.blurred).toBe(true);
      expect(exitCode).toBe(0);
    });

    test("focus and blur events interleaved with keypresses", async () => {
      using dir = tempDir("tui-keyreader-focus-mixed", {
        "test.ts": `
          const reader = new Bun.TUIKeyReader();
          const events: string[] = [];
          reader.onfocus = () => {
            events.push("focus");
            if (events.length >= 4) finish();
          };
          reader.onblur = () => {
            events.push("blur");
            if (events.length >= 4) finish();
          };
          reader.onkeypress = (event: any) => {
            events.push("key:" + event.name);
            if (events.length >= 4) finish();
          };
          function finish() {
            reader.close();
            console.log(JSON.stringify(events));
            process.exit(0);
          }
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), join(String(dir), "test.ts")],
        env: bunEnv,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });

      // Send: focus-in, key 'a', focus-out, key 'b'
      proc.stdin.write("\x1b[Ia\x1b[Ob");
      proc.stdin.end();

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      const events = JSON.parse(stdout.trim());
      expect(events).toEqual(["focus", "key:a", "blur", "key:b"]);
      expect(exitCode).toBe(0);
    });

    test("onfocus/onblur setter/getter", async () => {
      using dir = tempDir("tui-keyreader-focus-sg", {
        "test.ts": `
          const reader = new Bun.TUIKeyReader();
          const results: boolean[] = [];

          results.push(reader.onfocus === undefined);
          results.push(reader.onblur === undefined);

          const focusCb = () => {};
          const blurCb = () => {};
          reader.onfocus = focusCb;
          reader.onblur = blurCb;
          results.push(reader.onfocus === focusCb);
          results.push(reader.onblur === blurCb);

          reader.onfocus = undefined;
          reader.onblur = undefined;
          results.push(reader.onfocus === undefined);
          results.push(reader.onblur === undefined);

          reader.close();
          console.log(JSON.stringify(results));
          process.exit(0);
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), join(String(dir), "test.ts")],
        env: bunEnv,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });

      proc.stdin.end();

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      const results = JSON.parse(stdout.trim());
      expect(results).toEqual([true, true, true, true, true, true]);
      expect(exitCode).toBe(0);
    });

    test("focus event without onfocus callback is ignored", async () => {
      using dir = tempDir("tui-keyreader-focus-nocb", {
        "test.ts": `
          const reader = new Bun.TUIKeyReader();
          reader.onkeypress = (event: any) => {
            if (event.name === "z") {
              reader.close();
              console.log("ok");
              process.exit(0);
            }
          };
          // No onfocus/onblur set — focus events should be silently dropped
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), join(String(dir), "test.ts")],
        env: bunEnv,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });

      // Send focus-in, focus-out, then 'z'
      proc.stdin.write("\x1b[I\x1b[Oz");
      proc.stdin.end();

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout.trim()).toBe("ok");
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });
  });
});
