import { dlopen, ptr } from "bun:ffi";
import { isLinux, libcPathForDlopen, tempDir } from "harness";
import { closeSync, openSync, readSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hasLibrary } from "./library";

function canLoad(name: string, symbol: string) {
  try {
    return dlopen(name, { [symbol]: { args: ["i32"], returns: "ptr" } }).close() === undefined;
  } catch {
    return false;
  }
}

export const hasWayland = hasLibrary && isLinux && canLoad("libxkbcommon.so.0", "xkb_context_new");

/** name:arguments:what it creates, as in the XML files of the protocols. */
const requests: Record<string, string> = {
  wl_display: "sync:n:wl_callback get_registry:n:wl_registry",
  wl_registry: "bind:usun",
  wl_compositor: "create_surface:n:wl_surface create_region:n:wl_region",
  wl_shm_pool: "create_buffer:niiiiu:wl_buffer destroy resize:i",
  wl_shm: "create_pool:nhi:wl_shm_pool",
  wl_buffer: "destroy",
  wl_data_offer: "accept:us receive:sh destroy finish set_actions:uu",
  wl_data_source: "offer:s destroy set_actions:u",
  wl_data_device: "start_drag:ooou set_selection:ou release",
  wl_data_device_manager: "create_data_source:n:wl_data_source get_data_device:no:wl_data_device",
  wl_surface:
    "destroy attach:oii damage:iiii frame:n:wl_callback set_opaque_region:o set_input_region:o commit set_buffer_transform:i set_buffer_scale:i damage_buffer:iiii offset:ii",
  wl_seat: "get_pointer:n:wl_pointer get_keyboard:n:wl_keyboard get_touch:n:wl_touch release",
  wl_pointer: "set_cursor:uoii release",
  wl_keyboard: "release",
  wl_touch: "release",
  wl_output: "release",
  wl_region: "destroy add:iiii subtract:iiii",
  wp_presentation: "destroy feedback:on:wp_presentation_feedback",
  wp_viewporter: "destroy get_viewport:no:wp_viewport",
  wp_viewport: "destroy set_source:ffff set_destination:ii",
  xdg_wm_base: "destroy create_positioner:n:xdg_positioner get_xdg_surface:no:xdg_surface pong:u",
  xdg_positioner:
    "destroy set_size:ii set_anchor_rect:iiii set_anchor:u set_gravity:u set_constraint_adjustment:u set_offset:ii set_reactive set_parent_size:ii set_parent_configure:u",
  xdg_surface: "destroy get_toplevel:n:xdg_toplevel get_popup:noo:xdg_popup set_window_geometry:iiii ack_configure:u",
  xdg_toplevel:
    "destroy set_parent:o set_title:s set_app_id:s show_window_menu:ouii move:ou resize:ouu set_max_size:ii set_min_size:ii set_maximized unset_maximized set_fullscreen:o unset_fullscreen set_minimized",
  xdg_popup: "destroy grab:ou reposition:ou",
  wp_alpha_modifier_v1: "destroy get_surface:no:wp_alpha_modifier_surface_v1",
  wp_alpha_modifier_surface_v1: "destroy set_multiplier:u",
  wp_cursor_shape_manager_v1: "destroy get_pointer:no:wp_cursor_shape_device_v1",
  wp_cursor_shape_device_v1: "destroy set_shape:uu",
  ext_idle_notifier_v1:
    "destroy get_idle_notification:nuo:ext_idle_notification_v1 get_input_idle_notification:nuo:ext_idle_notification_v1",
  ext_idle_notification_v1: "destroy",
  wp_fractional_scale_manager_v1: "destroy get_fractional_scale:no:wp_fractional_scale_v1",
  wp_fractional_scale_v1: "destroy",
  xdg_activation_v1: "destroy get_activation_token:n:xdg_activation_token_v1 activate:so",
  xdg_activation_token_v1: "set_serial:uo set_app_id:s set_surface:o commit destroy",
  xdg_wm_dialog_v1: "destroy get_xdg_dialog:no:xdg_dialog_v1",
  xdg_dialog_v1: "destroy set_modal unset_modal",
  xdg_system_bell_v1: "destroy ring:o",
  xdg_toplevel_icon_manager_v1: "destroy create_icon:n:xdg_toplevel_icon_v1 set_icon:oo",
  xdg_toplevel_icon_v1: "destroy set_name:s add_buffer:oi",
  zwp_pointer_gestures_v1:
    "get_swipe_gesture:no:zwp_pointer_gesture_swipe_v1 get_pinch_gesture:no:zwp_pointer_gesture_pinch_v1 release get_hold_gesture:no:zwp_pointer_gesture_hold_v1",
  zwp_pointer_gesture_pinch_v1: "destroy",
  zwp_pointer_gesture_hold_v1: "destroy",
  zwp_primary_selection_device_manager_v1:
    "create_source:n:zwp_primary_selection_source_v1 get_device:no:zwp_primary_selection_device_v1 destroy",
  zwp_primary_selection_device_v1: "set_selection:ou destroy",
  zwp_primary_selection_offer_v1: "receive:sh destroy",
  zwp_primary_selection_source_v1: "offer:s destroy",
  zwp_text_input_v3:
    "destroy enable disable set_surrounding_text:sii set_text_change_cause:u set_content_type:uu set_cursor_rectangle:iiii commit",
  zwp_text_input_manager_v3: "destroy get_text_input:no:zwp_text_input_v3",
  zxdg_decoration_manager_v1: "destroy get_toplevel_decoration:no:zxdg_toplevel_decoration_v1",
  zxdg_toplevel_decoration_v1: "destroy set_mode:u unset_mode",
  zxdg_exporter_v2: "destroy export_toplevel:no:zxdg_exported_v2",
  zxdg_exported_v2: "destroy",
  zxdg_output_manager_v1: "destroy get_xdg_output:no:zxdg_output_v1",
  zxdg_output_v1: "destroy",
};

const events: Record<string, string> = {
  wl_display: "error:ous delete_id:u",
  wl_registry: "global:usu global_remove:u",
  wl_callback: "done:u",
  wl_shm: "format:u",
  wl_buffer: "release",
  wl_data_offer: "offer:s source_actions:u action:u",
  wl_data_source: "target:s send:sh cancelled dnd_drop_performed dnd_finished action:u",
  wl_data_device: "data_offer:n enter:uoffo leave motion:uff drop selection:o",
  wl_surface: "enter:o leave:o preferred_buffer_scale:i preferred_buffer_transform:u",
  wl_seat: "capabilities:u name:s",
  wl_pointer:
    "enter:uoff leave:uo motion:uff button:uuuu axis:uuf frame axis_source:u axis_stop:uu axis_discrete:ui axis_value120:ui axis_relative_direction:uu",
  wl_keyboard: "keymap:uhu enter:uoa leave:uo key:uuuu modifiers:uuuuu repeat_info:ii",
  wl_touch: "down:uuoiff up:uui motion:uiff frame cancel shape:iff orientation:if",
  wl_output: "geometry:iiiiissi mode:uiii done scale:i name:s description:s",
  wp_presentation: "clock_id:u",
  wp_presentation_feedback: "sync_output:o presented:uuuuuuu discarded",
  xdg_wm_base: "ping:u",
  xdg_surface: "configure:u",
  xdg_toplevel: "configure:iia close configure_bounds:ii wm_capabilities:a",
  xdg_popup: "configure:iiii popup_done repositioned:u",
  ext_idle_notification_v1: "idled resumed",
  wp_fractional_scale_v1: "preferred_scale:u",
  xdg_activation_token_v1: "done:s",
  xdg_toplevel_icon_manager_v1: "icon_size:i done",
  zwp_pointer_gesture_pinch_v1: "begin:uuou update:uffff end:uui",
  zwp_pointer_gesture_hold_v1: "begin:uuou end:uui",
  zwp_primary_selection_device_v1: "data_offer:n selection:o",
  zwp_primary_selection_offer_v1: "offer:s",
  zwp_primary_selection_source_v1: "send:sh cancelled",
  zwp_text_input_v3: "enter:o leave:o preedit_string:sii commit_string:s delete_surrounding_text:uu done:u",
  zxdg_toplevel_decoration_v1: "configure:u",
  zxdg_exported_v2: "handle:s",
  zxdg_output_v1: "logical_position:ii logical_size:ii done name:s description:s",
};

const allGlobals: Record<string, number> = {
  wl_compositor: 6,
  wl_shm: 1,
  wl_seat: 8,
  wl_output: 4,
  wl_data_device_manager: 3,
  xdg_wm_base: 6,
  wp_viewporter: 1,
  wp_presentation: 1,
  wp_fractional_scale_manager_v1: 1,
  wp_cursor_shape_manager_v1: 1,
  wp_alpha_modifier_v1: 1,
  xdg_activation_v1: 1,
  xdg_wm_dialog_v1: 1,
  xdg_system_bell_v1: 1,
  xdg_toplevel_icon_manager_v1: 1,
  ext_idle_notifier_v1: 2,
  zxdg_decoration_manager_v1: 1,
  zxdg_exporter_v2: 1,
  zxdg_output_manager_v1: 3,
  zwp_pointer_gestures_v1: 3,
  zwp_primary_selection_device_manager_v1: 1,
  zwp_text_input_manager_v3: 1,
};

const keymap = `xkb_keymap {
  xkb_keycodes { <ESC> = 9; <LCTL> = 37; <A> = 38; <S> = 39; <QUOT> = 48; <LFSH> = 50; <C> = 54; <V> = 55; <LEFT> = 113; };
  xkb_types {
    type "ONE_LEVEL" { modifiers = none; };
    type "TWO_LEVEL" { modifiers = Shift; map[Shift] = Level2; };
    type "ALPHABETIC" { modifiers = Shift + Lock; map[Shift] = Level2; map[Lock] = Level2; };
  };
  xkb_compat { interpret Any { repeat = True; }; interpret Control_L { repeat = False; }; interpret Shift_L { repeat = False; }; };
  xkb_symbols {
    key <ESC> { [Escape] }; key <LCTL> { [Control_L] }; key <LFSH> { [Shift_L] }; key <LEFT> { [Left] }; key <QUOT> { [dead_acute] };
    key <A> { [a, A], [Cyrillic_ef, Cyrillic_EF] }; key <S> { [s, S] }; key <C> { [c, C], [Cyrillic_es, Cyrillic_ES] }; key <V> { [v, V] };
  };
};\0`;

export const [ESCAPE, CONTROL, A, S, ACUTE, SHIFT, C, V, LEFT] = [1, 29, 30, 31, 40, 42, 46, 47, 105];
export const [MAXIMIZED, FULLSCREEN, RESIZING, ACTIVATED, SUSPENDED] = [1, 2, 3, 4, 9];

const libc = hasWayland
  ? dlopen(libcPathForDlopen(), {
      socket: { args: ["i32", "i32", "i32"], returns: "i32" },
      bind: { args: ["i32", "ptr", "u32"], returns: "i32" },
      listen: { args: ["i32", "i32"], returns: "i32" },
      accept4: { args: ["i32", "ptr", "ptr", "i32"], returns: "i32" },
      recvmsg: { args: ["i32", "ptr", "i32"], returns: "i64_fast" },
      sendmsg: { args: ["i32", "ptr", "i32"], returns: "i64_fast" },
      pipe2: { args: ["ptr", "i32"], returns: "i32" },
    }).symbols
  : null!;
const [NONBLOCK, CLOEXEC] = [0o4000, 0o2000000];

/** A `msghdr`, with its `iovec` behind it. */
function header(bytes: Uint8Array, control?: Uint8Array) {
  const all = new BigUint64Array(9);
  all.set(
    [0, 0, ptr(all) + 56, 1, control ? ptr(control) : 0, control?.length ?? 0, 0, ptr(bytes), bytes.length].map(BigInt),
  );
  return all;
}

type Contents = Record<string, string>;
type Thing = { id: number; type: string; client: Client; [state: string]: any };
type Client = {
  fd: number;
  things: Map<number, Thing>;
  unread: Buffer;
  files: number[];
  next: number;
  nextOwn: number;
};
type Selection = { serial: number; source?: Thing; contents?: Contents };

export async function until(condition: () => unknown) {
  for (const end = Date.now() + 10_000; !(await condition()); await Bun.sleep(1)) {
    if (Date.now() > end) throw new Error("gave up on " + condition);
  }
}

/** Shows the last window that has appeared in the top left corner of its screen. It is as strict as the strictest of the real ones. */
export function openCompositor({ without = [] as string[], scale = 1, width = 500, height = 400 } = {}) {
  const dir = tempDir("wl", { keymap });
  const globals = Object.entries(allGlobals).filter(([name]) => !without.includes(name));
  const HEADER = 100;
  writeFileSync(join(String(dir), "screen"), Buffer.alloc(HEADER + width * height * 4));
  const screen = Buffer.from(Bun.mmap(join(String(dir), "screen"), { shared: true }).buffer);
  screen.writeUInt32BE(HEADER, 0);
  screen.writeUInt32BE(width * 4, 48);

  const address = Buffer.alloc(110);
  address.writeUInt16LE(1);
  address.write(join(String(dir), "socket"), 2);
  const server = libc.socket(1, 1 | NONBLOCK | CLOEXEC, 0);
  if (libc.bind(server, address, 110) || libc.listen(server, 8)) throw new Error("could not listen in " + dir);

  const [clients, errors, log, shown] = [new Set<Client>(), [] as string[], [] as string[], [] as Thing[]];
  const selections: Record<string, Selection> = { wl_data: { serial: 0 }, zwp_primary_selection: { serial: 0 } };
  const named = (family: string, part: string) => `${family}_${part}${family === "wl_data" ? "" : "_v1"}`;
  const familyOf = (thing: Thing) => (thing.type.startsWith("wl_") ? "wl_data" : "zwp_primary_selection");
  let [serial, commits, lastFrame] = [100, 0, 0];
  let focus: Thing | undefined, pointed: Thing | undefined, drag: Selection | undefined, dragged: Thing | undefined;

  function send(to: Thing | undefined, name: string, ...values: any[]) {
    if (!to || to.isDestroyed) return;
    const all = events[to.type].split(" ").map(it => it.split(":"));
    const opcode = all.findIndex(it => it[0] === name);
    const words = (...numbers: number[]) => Buffer.from(new Uint32Array(numbers).buffer);
    let control: Buffer | undefined;
    const parts = [...(all[opcode][1] ?? "")].map((kind, index) => {
      const value = values[index];
      if (kind === "h") return ((control = words(20, 0, 1, 1, value, 0)), words());
      if (kind === "s" && value === null) return words(0);
      if (kind !== "s" && kind !== "a")
        return words(kind === "f" ? value * 256 : "on".includes(kind) ? (value?.id ?? 0) : value);
      const bytes = kind === "s" ? Buffer.from(value + "\0") : words(...value);
      return Buffer.concat([words(bytes.length), bytes, Buffer.alloc(-bytes.length & 3)]);
    });
    const body = Buffer.concat(parts);
    const message = Buffer.concat([words(to.id, ((body.length + 8) << 16) | opcode), body]);
    libc.sendmsg(to.client.fd, header(message, control), 0x4000);
  }

  const all = (type: string, client?: Client) =>
    [...(client?.things.values() ?? [])].filter(it => it.type === type && !it.isDestroyed);
  const sendAll = (type: string, client: Client | undefined, name: string, ...values: any[]) =>
    all(type, client).forEach(it => send(it, name, ...values));

  function destroy(thing: Thing) {
    thing.isDestroyed = true;
    if (thing.id < 0xff000000) send(thing.client.things.get(1), "delete_id", thing.id);
  }

  function offer(family: string, client: Client, from: Selection) {
    const types: string[] | undefined = from.source?.types ?? (from.contents && Object.keys(from.contents));
    if (!types) return;
    const thing: Thing = { id: client.nextOwn++, type: named(family, "offer"), client, from };
    client.things.set(thing.id, thing);
    sendAll(named(family, "device"), client, "data_offer", thing);
    types.forEach(it => send(thing, "offer", it));
    return thing;
  }

  function select(family: string, selection: Selection) {
    if (selections[family].source !== selection.source) send(selections[family].source, "cancelled");
    selections[family] = selection;
    if (focus) sendAll(named(family, "device"), focus.client, "selection", offer(family, focus.client, selection));
  }

  function moveFocus(to?: Thing) {
    if (focus && !focus.isDestroyed) {
      sendAll("zwp_text_input_v3", focus.client, "leave", focus);
      sendAll("wl_keyboard", focus.client, "leave", ++serial, focus);
      configure(
        focus,
        focus.size,
        focus.states.filter((it: number) => it !== ACTIVATED),
      );
    }
    focus = to;
    if (!to) return;
    Object.keys(selections).forEach(it => select(it, selections[it]));
    sendAll("wl_keyboard", to.client, "enter", ++serial, to, []);
    sendAll("wl_keyboard", to.client, "modifiers", ++serial, 0, 0, 0, 0);
    sendAll("zwp_text_input_v3", to.client, "enter", to);
    if (!to.states.includes(ACTIVATED)) configure(to, to.size, [...to.states, ACTIVATED]);
  }

  function configure(surface: Thing, size: number[], states: number[]) {
    Object.assign(surface, { size, states });
    send(surface.toplevel, "configure", ...size, states);
    send(surface.popup, "configure", ...(surface.popup?.place ?? []));
    send(surface.role, "configure", ++serial);
    return serial;
  }

  function show() {
    const picture = shown.findLast(it => it.toplevel)?.picture;
    for (let y = 0; y < height; y++) {
      const row = screen.subarray(HEADER + y * width * 4).subarray(0, width * 4);
      row.fill(0, y < picture?.height ? picture.rows[y].copy(row) : 0);
    }
  }

  function hide(surface: Thing) {
    if (!shown.includes(surface)) return;
    shown.splice(shown.indexOf(surface), 1);
    surface.picture = surface.held = undefined;
    if (pointed === surface) pointed = undefined;
    if (focus === surface) moveFocus(shown.at(-1));
    show();
  }

  const rowsOf = (buffer: Thing) =>
    Array.from({ length: buffer.height }, (_, y) =>
      buffer.memory.subarray(buffer.offset + y * buffer.stride).subarray(0, buffer.width * 4),
    );
  const isShown = (surface: Thing, buffer: Thing) =>
    rowsOf(buffer).every((row, y) => row.equals(surface.picture.rows[y]));

  function commit(surface: Thing) {
    const { attached: buffer, damage } = surface;
    Object.assign(surface, { attached: undefined, damage: [] });
    surface.frames.push(...surface.nextFrames.splice(0));
    if (buffer === null) return hide(surface);
    if (surface.role && !surface.role.wasConfigured) {
      if (buffer) errors.push("a buffer in the first commit");
      surface.role.wasConfigured = true;
      send(surface.fractions, "preferred_scale", scale * 120);
      send(surface.toplevel?.decoration, "configure", surface.toplevel?.decoration?.mode);
      const isLarge = surface.states.some((it: number) => it <= FULLSCREEN);
      return configure(surface, isLarge ? [width / scale, height / scale] : [0, 0], surface.states);
    }
    if (!buffer) return;
    if (surface.role && !surface.role.hasAnswered) errors.push("a buffer before ack_configure");
    if (buffer.width % surface.scale || buffer.height % surface.scale)
      errors.push("a buffer that does not fit its scale");
    if (surface.held) {
      if (!surface.held.isDestroyed && !isShown(surface, surface.held))
        errors.push("a buffer has changed before it was released");
      if (surface.held !== buffer) send(surface.held, "release");
    }
    if (surface.picture?.width !== buffer.width || surface.picture?.height !== buffer.height) {
      surface.picture = {
        width: buffer.width,
        height: buffer.height,
        rows: rowsOf(buffer).map(it => Buffer.alloc(it.length)),
      };
    }
    const rows = rowsOf(buffer);
    for (const [left, top, width, height] of damage) {
      rows
        .slice(top, top + height)
        .forEach((row, y) => row.copy(surface.picture.rows[top + y], left * 4, left * 4, (left + width) * 4));
    }
    if (!isShown(surface, buffer)) errors.push("more has changed than was said");
    surface.held = ++commits % 3 ? buffer : void send(buffer, "release");
    if (surface.role && !shown.includes(surface)) {
      shown.push(surface);
      send(surface, "enter", all("wl_output", surface.client)[0]);
      if (surface.toplevel || surface.popup.grabs) moveFocus(surface);
    }
    show();
  }

  function setState(toplevel: Thing, state: number, isOn: boolean) {
    const surface = toplevel.surface;
    surface.states = [...surface.states.filter((it: number) => it !== state), ...(isOn ? [state] : [])];
    if (surface.role.wasConfigured) configure(surface, isOn ? [width / scale, height / scale] : [0, 0], surface.states);
  }

  function receive(offer: Thing, type: string, file: number) {
    if (offer.from.source) send(offer.from.source, "send", type, file);
    Bun.write(Bun.file(file), offer.from.contents?.[type] ?? "").finally(() => closeSync(file));
  }

  function setSelection(device: Thing, source: Thing | null, serial: number) {
    const now = selections[familyOf(device)];
    if (!(now.source || now.contents) || serial > now.serial)
      select(familyOf(device), { serial, source: source ?? undefined });
  }

  function forgetSource(source: Thing) {
    if (selections[familyOf(source)].source === source) select(familyOf(source), { serial: 0 });
  }

  const handlers: Record<string, (self: Thing, ...values: any[]) => unknown> = {
    "wl_display.sync": (_, done) => (send(done, "done", serial), destroy(done)),
    "wl_display.get_registry": (_, registry) =>
      globals.forEach((it, index) => send(registry, "global", index + 1, ...it)),
    "wl_registry.bind"(_, name, type, version, thing) {
      if (globals[name - 1][0] !== type || globals[name - 1][1] < version)
        errors.push(`there is no ${type} ${version}`);
      thing.type = type;
      if (type === "wl_seat") send(thing, "capabilities", 7);
      if (type !== "wl_output") return;
      send(thing, "geometry", 0, 0, 300, 200, 0, "make", "model", 0);
      send(thing, "mode", 1, width, height, 60000);
      send(thing, "scale", Math.ceil(scale));
      send(thing, "name", "A-1");
      send(thing, "done");
    },
    "zxdg_output_manager_v1.get_xdg_output"(_, logical, output) {
      send(logical, "logical_position", 0, 0);
      send(logical, "logical_size", width / scale, height / scale);
      send(output, "done");
    },
    "wl_seat.get_keyboard"(_, keyboard) {
      const file = openSync(join(String(dir), "keymap"), "r");
      send(keyboard, "keymap", 1, file, keymap.length);
      closeSync(file);
      send(keyboard, "repeat_info", 0, 0);
    },
    "wl_shm.create_pool"(_, pool, file) {
      pool.memory = Buffer.from(Bun.mmap(`/proc/self/fd/${file}`, { shared: true }).buffer);
      closeSync(file);
    },
    "wl_shm_pool.create_buffer"({ memory }, buffer, offset, width, height, stride) {
      if (offset + stride * height > memory.length || width * 4 > stride)
        errors.push("a buffer that is larger than its pool");
      Object.assign(buffer, { memory, offset, width, height, stride });
    },
    "wl_compositor.create_surface": (_, it) => Object.assign(it, { damage: [], frames: [], nextFrames: [], scale: 1 }),
    "wl_surface.attach": (surface, buffer) => (surface.attached = buffer),
    "wl_surface.damage_buffer": (surface, ...area) => surface.damage.push(area),
    "wl_surface.frame": (surface, done) => surface.nextFrames.push(done),
    "wl_surface.set_buffer_scale": (surface, scale) => (surface.scale = scale),
    "wl_surface.commit": commit,
    "wl_surface.destroy": surface => surface.role && errors.push("a surface was destroyed before its role"),
    "wp_presentation.feedback": (_, __, feedback) => (
      send(feedback, "presented", 0, 0, 0, 16_666_666, 0, 0, 0),
      destroy(feedback)
    ),
    "wp_fractional_scale_manager_v1.get_fractional_scale": (_, fractions, surface) => (surface.fractions = fractions),
    "xdg_wm_base.get_xdg_surface"(_, role, surface) {
      if (surface.picture || surface.role) errors.push("the surface is in use");
      Object.assign(surface, { role: Object.assign(role, { surface }), states: [], size: [0, 0] });
    },
    "xdg_surface.get_toplevel": ({ surface }, toplevel) => (surface.toplevel = Object.assign(toplevel, { surface })),
    "xdg_surface.get_popup": ({ surface }, popup, parent, { place }) =>
      (surface.popup = Object.assign(popup, { surface, parent, place })),
    "xdg_surface.ack_configure": role => (role.hasAnswered = true),
    "xdg_surface.destroy"({ surface }) {
      if (surface.toplevel || surface.popup) errors.push("an xdg_surface was destroyed before its role");
      surface.role = undefined;
    },
    "xdg_positioner.set_size": (self, width, height) => (self.place = [0, 0, width, height]),
    "xdg_positioner.set_anchor_rect": (self, x, y) => self.place.splice(0, 2, x, y),
    "xdg_popup.grab"(popup) {
      if (shown.some(it => it.popup?.grabs) && !popup.parent.surface.popup?.grabs)
        errors.push("a popup that grabs is not on top of the others");
      popup.grabs = true;
    },
    "xdg_popup.destroy": ({ surface }) => ((surface.popup = undefined), hide(surface)),
    "xdg_toplevel.destroy"({ surface, decoration }) {
      if (decoration && !decoration.isDestroyed) errors.push("a toplevel was destroyed before its decoration");
      surface.toplevel = undefined;
      hide(surface);
    },
    "xdg_toplevel.set_parent"(toplevel, parent) {
      for (let it = parent; it; it = it.parent) if (it === toplevel) return errors.push("a window is its own ancestor");
      toplevel.parent = parent;
    },
    "xdg_toplevel.set_maximized": it => setState(it, MAXIMIZED, true),
    "xdg_toplevel.unset_maximized": it => setState(it, MAXIMIZED, false),
    "xdg_toplevel.set_fullscreen": it => setState(it, FULLSCREEN, true),
    "xdg_toplevel.unset_fullscreen": it => setState(it, FULLSCREEN, false),
    "xdg_toplevel.set_minimized": it => focus === it.surface && moveFocus(),
    "zxdg_decoration_manager_v1.get_toplevel_decoration": (_, decoration, toplevel) =>
      (toplevel.decoration = decoration),
    "zxdg_toplevel_decoration_v1.set_mode": (decoration, mode) => (decoration.mode = mode),
    "zxdg_exporter_v2.export_toplevel": (_, exported) => send(exported, "handle", "exported"),
    "xdg_activation_token_v1.set_serial": token => (token.isProven = true),
    "xdg_activation_token_v1.commit": token => send(token, "done", token.isProven ? "proven" : "unproven"),
    "xdg_activation_v1.activate": (_, token, surface) =>
      token !== "unproven" && shown.includes(surface) && moveFocus(surface),
    "zwp_text_input_v3.commit": input => (input.commits = (input.commits ?? 0) + 1),
    "wl_data_source.offer": (source, type) => (source.types ??= []).push(type),
    "wl_data_source.destroy": forgetSource,
    "wl_data_device.set_selection": setSelection,
    "wl_data_device.start_drag"(_, source, surface) {
      drag = { serial, source };
      sendAll("wl_pointer", surface.client, "leave", ++serial, surface);
      sendAll("wl_pointer", surface.client, "frame");
      pointed = undefined;
    },
    "wl_data_offer.accept": (offer, _, type) => (offer.accepted = type),
    "wl_data_offer.receive": receive,
    "wl_data_offer.finish": offer =>
      offer.accepted ? send(offer.from.source, "dnd_finished") : errors.push("nothing was accepted"),
    "zwp_primary_selection_source_v1.offer": (source, type) => (source.types ??= []).push(type),
    "zwp_primary_selection_source_v1.destroy": forgetSource,
    "zwp_primary_selection_device_v1.set_selection": setSelection,
    "zwp_primary_selection_offer_v1.receive": receive,
  };

  function handle(client: Client, message: Buffer) {
    const self = client.things.get(message.readUInt32LE(0));
    const [name, kinds = "", created] = requests[self?.type!]?.split(" ")[message.readUInt16LE(4)]?.split(":") ?? [];
    if (!self || self.isDestroyed || !name)
      return errors.push(`no request ${message.readUInt16LE(4)} for ${self?.type}`);
    let at = 8;
    const values = [...kinds].map(kind => {
      if (kind === "h") return client.files.shift();
      const word = kind === "i" || kind === "f" ? message.readInt32LE(at) : message.readUInt32LE(at);
      at += 4;
      if (kind === "s")
        return word ? message.toString("utf8", at, ((at += (word + 3) & ~3), at - ((word + 3) & ~3) + word - 1)) : null;
      if (kind === "o" && word && client.things.get(word)?.isDestroyed !== undefined)
        errors.push(`${name} with what was destroyed`);
      if (kind === "o") return client.things.get(word) ?? null;
      if (kind !== "n") return kind === "f" ? word / 256 : word;
      if (word === client.next) client.next++;
      else if (!client.things.get(word)?.isDestroyed) errors.push(`${word} is not a new id`);
      client.things.set(word, { id: word, type: created, client });
      return client.things.get(word);
    });
    if (at !== message.length) errors.push(`${self.type}.${name} has another length`);
    log.push([`${self.type}.${name}`, ...values.map(it => it?.type ?? JSON.stringify(it))].join(" "));
    handlers[`${self.type}.${name}`]?.(self, ...values);
    if (name === "destroy" || name === "release") destroy(self);
  }

  const [received, control] = [Buffer.alloc(1 << 16), Buffer.alloc(256)];
  function read(client: Client) {
    for (;;) {
      const how = header(received, control);
      const count = Number(libc.recvmsg(client.fd, how, 0x40000000));
      if (count < 0) return;
      if (count === 0) {
        clients.delete(client);
        closeSync(client.fd);
        client.things.forEach(it => (it.isDestroyed = true));
        return shown.filter(it => it.client === client).forEach(hide);
      }
      for (let at = 16; how[5] && at < control.readUInt32LE(0); at += 4) client.files.push(control.readInt32LE(at));
      let unread = Buffer.concat([client.unread, received.subarray(0, count)]);
      for (
        let length;
        unread.length >= 8 && unread.length >= (length = unread.readUInt16LE(6));
        unread = unread.subarray(length)
      ) {
        handle(client, unread.subarray(0, length));
      }
      client.unread = unread;
    }
  }

  const timer = setInterval(() => {
    for (let fd; (fd = libc.accept4(server, null, null, CLOEXEC | NONBLOCK)) >= 0;) {
      const client: Client = {
        fd,
        things: new Map(),
        unread: Buffer.alloc(0),
        files: [],
        next: 2,
        nextOwn: 0xff000000,
      };
      client.things.set(1, { id: 1, type: "wl_display", client });
      clients.add(client);
    }
    clients.forEach(read);
    if (performance.now() - lastFrame < 1000 / 60) return;
    lastFrame += Math.floor((performance.now() - lastFrame) / (1000 / 60)) * (1000 / 60);
    for (const surface of shown.filter(it => !it.states.includes(SUSPENDED))) {
      surface.frames.splice(0).forEach((done: Thing) => (send(done, "done", lastFrame), destroy(done)));
    }
  }, 1);

  const top = () => shown.at(-1)!;
  /** To the app that is in front. */
  const emit = (type: string, name: string, ...values: any[]) => sendAll(type, top().client, name, ...values);
  const point = (name: string, ...values: any[]) => (emit("wl_pointer", name, ...values), emit("wl_pointer", "frame"));

  async function readFrom(source: Thing, type: string) {
    const [ends, parts, part] = [new Int32Array(2), [] as Buffer[], Buffer.alloc(1 << 16)];
    libc.pipe2(ends, CLOEXEC | NONBLOCK);
    send(source, "send", type, ends[1]);
    closeSync(ends[1]);
    await until(() => {
      try {
        for (let count; (count = readSync(ends[0], part));) parts.push(Buffer.from(part.subarray(0, count)));
        return true;
      } catch {}
    });
    closeSync(ends[0]);
    return Buffer.concat(parts).toString();
  }

  return {
    env: {
      BUN_DESKTOP_HEADLESS: "0",
      DISPLAY: undefined,
      WAYLAND_DISPLAY: "socket",
      XDG_RUNTIME_DIR: String(dir),
      XDG_SESSION_TYPE: "wayland",
      SCREEN: join(String(dir), "screen"),
    },
    emit,
    top,
    /** The requests since the last time that start with one of these. */
    take: (...starts: string[]) => log.splice(0).filter(it => starts.some(start => it.startsWith(start))),
    hasSeen: (start: string) => log.some(it => it.startsWith(start)),
    /** Until the thread of the windows has handled what was sent. */
    async ping() {
      emit("xdg_wm_base", "ping", ++serial);
      const pong = `xdg_wm_base.pong ${serial}`;
      await until(() => log.includes(pong));
    },
    serial: () => ++serial,
    configure: (size: number[], ...states: number[]) => configure(top(), size, states),
    focus: (isOn: boolean) => moveFocus(isOn ? top() : undefined),
    colorAt: (x: number, y: number) =>
      Buffer.from(top().picture.rows[y].subarray(x * 4, x * 4 + 3))
        .reverse()
        .toString("hex"),
    move(x: number, y: number) {
      if (pointed === top()) return point("motion", 0, x, y);
      point("enter", ++serial, (pointed = top()), x, y);
    },
    point,
    button: (button: number, isDown: boolean, time = 0) => point("button", ++serial, time, 0x110 + button, +isDown),
    key: (code: number, isDown: boolean) => emit("wl_keyboard", "key", ++serial, 0, code, +isDown),
    type(...codes: number[]) {
      for (const code of codes) for (const isDown of [true, false]) this.key(code, isDown);
    },
    modifiers: (mask: number, group = 0) => emit("wl_keyboard", "modifiers", ++serial, mask, 0, 0, group),
    /** What an input method does. */
    edit({ typed = "", composed = "", before = 0 }) {
      if (before) emit("zwp_text_input_v3", "delete_surrounding_text", before, 0);
      if (typed) emit("zwp_text_input_v3", "commit_string", typed);
      if (composed)
        emit("zwp_text_input_v3", "preedit_string", composed, ...Array(2).fill(Buffer.byteLength(composed)));
      emit("zwp_text_input_v3", "done", all("zwp_text_input_v3", top().client)[0].commits);
    },
    /** What another app does. */
    copy: (contents: Contents, family = "wl_data") => select(family, { serial: ++serial, contents }),
    copied: (family = "wl_data"): string[] | undefined => selections[family].source?.types,
    paste: (type: string, family = "wl_data") => readFrom(selections[family].source!, type),
    drag: {
      start: (contents: Contents) => (drag = { serial, contents }),
      types: (): string[] | undefined => drag?.source?.types,
      accepted: () => dragged?.accepted,
      enter: (x: number, y: number) =>
        emit("wl_data_device", "enter", ++serial, top(), x, y, (dragged = offer("wl_data", top().client, drag!))),
      move: (x: number, y: number) => emit("wl_data_device", "motion", 0, x, y),
      leave: () => emit("wl_data_device", "leave"),
      drop: () => (emit("wl_data_device", "drop"), send(drag!.source, "dnd_drop_performed")),
      read: (type: string) => readFrom(drag!.source!, type),
      end: (how: "cancelled" | "dnd_finished") => send(drag!.source, how),
    },
    [Symbol.dispose]() {
      clearInterval(timer);
      [server, ...[...clients].map(it => it.fd)].forEach(closeSync);
      dir[Symbol.dispose]();
      if (errors.length) throw new Error([...new Set(errors)].join("\n"));
    },
  };
}
