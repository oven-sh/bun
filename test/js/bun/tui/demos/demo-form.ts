/**
 * demo-form.ts — Interactive Form
 *
 * A multi-field form with text inputs, radio buttons, checkboxes,
 * a dropdown select, and form validation/submission.
 *
 * Demonstrates: multiple input types, field focus management, cursor in text
 * fields, toggle states, dropdown menus, validation feedback, setText, fill,
 * style (fg/bg/bold/italic/underline/inverse), drawBox, TUITerminalWriter,
 * TUIKeyReader, alt screen, resize.
 *
 * Run: bun run test/js/bun/tui/demos/demo-form.ts
 * Controls: Tab/Shift+Tab between fields, Space toggle, Enter submit/select,
 *           type in text fields, Q quit (when not in text field)
 */

const writer = new Bun.TUITerminalWriter(Bun.stdout);
const reader = new Bun.TUIKeyReader();
let cols = writer.columns || 80;
let rows = writer.rows || 24;
let screen = new Bun.TUIScreen(cols, rows);

writer.enterAltScreen();

// --- Styles ---
const st = {
  titleBar: screen.style({ fg: 0x000000, bg: 0xc678dd, bold: true }),
  fieldLabel: screen.style({ fg: 0xabb2bf, bold: true }),
  fieldLabelFocused: screen.style({ fg: 0x61afef, bold: true }),
  inputBg: screen.style({ fg: 0xffffff, bg: 0x2c313a }),
  inputFocused: screen.style({ fg: 0xffffff, bg: 0x3e4451 }),
  inputBorder: screen.style({ fg: 0x5c6370 }),
  inputBorderFocused: screen.style({ fg: 0x61afef }),
  placeholder: screen.style({ fg: 0x5c6370, bg: 0x2c313a, italic: true }),
  radio: screen.style({ fg: 0xabb2bf }),
  radioSelected: screen.style({ fg: 0x98c379, bold: true }),
  radioFocused: screen.style({ fg: 0x61afef }),
  radioSelectedFocused: screen.style({ fg: 0x98c379, bg: 0x2c313a, bold: true }),
  checkbox: screen.style({ fg: 0xabb2bf }),
  checkboxChecked: screen.style({ fg: 0x98c379, bold: true }),
  checkboxFocused: screen.style({ fg: 0x61afef }),
  checkboxCheckedFocused: screen.style({ fg: 0x98c379, bg: 0x2c313a, bold: true }),
  dropdown: screen.style({ fg: 0xabb2bf, bg: 0x2c313a }),
  dropdownFocused: screen.style({ fg: 0xffffff, bg: 0x3e4451 }),
  dropdownOpen: screen.style({ fg: 0xffffff, bg: 0x3e4451 }),
  dropdownItem: screen.style({ fg: 0xabb2bf, bg: 0x2c313a }),
  dropdownItemSelected: screen.style({ fg: 0x000000, bg: 0x61afef, bold: true }),
  button: screen.style({ fg: 0xabb2bf, bg: 0x3e4451, bold: true }),
  buttonFocused: screen.style({ fg: 0x000000, bg: 0x61afef, bold: true }),
  buttonSubmit: screen.style({ fg: 0x000000, bg: 0x98c379, bold: true }),
  error: screen.style({ fg: 0xe06c75, italic: true }),
  success: screen.style({ fg: 0x98c379, bold: true }),
  dim: screen.style({ fg: 0x5c6370 }),
  footer: screen.style({ fg: 0x5c6370, italic: true }),
  required: screen.style({ fg: 0xe06c75, bold: true }),
  sectionHeader: screen.style({ fg: 0xc678dd, bold: true }),
  border: screen.style({ fg: 0x5c6370 }),
};

// --- Field types ---
type FieldType = "text" | "radio" | "checkbox" | "dropdown" | "button";

interface TextField {
  type: "text";
  label: string;
  value: string;
  placeholder: string;
  required: boolean;
  cursor: number;
  error: string;
}
interface RadioField {
  type: "radio";
  label: string;
  options: string[];
  selected: number;
}
interface CheckboxField {
  type: "checkbox";
  label: string;
  options: { label: string; checked: boolean }[];
}
interface DropdownField {
  type: "dropdown";
  label: string;
  options: string[];
  selected: number;
  open: boolean;
  highlightIdx: number;
}
interface ButtonField {
  type: "button";
  label: string;
  action: string;
}

type Field = TextField | RadioField | CheckboxField | DropdownField | ButtonField;

// --- Form fields ---
const fields: Field[] = [
  { type: "text", label: "Name", value: "", placeholder: "Enter your name", required: true, cursor: 0, error: "" },
  { type: "text", label: "Email", value: "", placeholder: "you@example.com", required: true, cursor: 0, error: "" },
  {
    type: "radio",
    label: "Role",
    options: ["Developer", "Designer", "Manager", "Other"],
    selected: 0,
  },
  {
    type: "checkbox",
    label: "Interests",
    options: [
      { label: "Frontend", checked: false },
      { label: "Backend", checked: true },
      { label: "DevOps", checked: false },
      { label: "Mobile", checked: false },
    ],
  },
  {
    type: "dropdown",
    label: "Experience",
    options: ["< 1 year", "1-3 years", "3-5 years", "5-10 years", "10+ years"],
    selected: 0,
    open: false,
    highlightIdx: 0,
  },
  {
    type: "text",
    label: "Message",
    value: "",
    placeholder: "Optional message...",
    required: false,
    cursor: 0,
    error: "",
  },
  { type: "button", label: "Submit", action: "submit" },
  { type: "button", label: "Reset", action: "reset" },
];

// --- State ---
let focusedField = 0;
let submitted = false;
let submitResult = "";
let scrollY = 0;

// --- Validation ---
function validate(): boolean {
  let valid = true;
  for (const field of fields) {
    if (field.type === "text") {
      field.error = "";
      if (field.required && field.value.trim().length === 0) {
        field.error = `${field.label} is required`;
        valid = false;
      }
      if (field.label === "Email" && field.value.length > 0 && !field.value.includes("@")) {
        field.error = "Invalid email address";
        valid = false;
      }
    }
  }
  return valid;
}

function resetForm() {
  for (const field of fields) {
    if (field.type === "text") {
      field.value = "";
      field.cursor = 0;
      field.error = "";
    } else if (field.type === "radio") {
      field.selected = 0;
    } else if (field.type === "checkbox") {
      for (const opt of field.options) opt.checked = false;
    } else if (field.type === "dropdown") {
      field.selected = 0;
      field.open = false;
    }
  }
  submitted = false;
  submitResult = "";
  focusedField = 0;
}

// --- Render ---
function render() {
  screen.clear();

  // Title
  screen.fill(0, 0, cols, 1, " ", st.titleBar);
  screen.setText(2, 0, " Registration Form ", st.titleBar);

  const formX = 3;
  const formW = Math.min(70, cols - 6);
  let y = 2 - scrollY;

  for (let fi = 0; fi < fields.length; fi++) {
    const field = fields[fi];
    const isFocused = fi === focusedField;

    if (y < 1 || y >= rows - 2) {
      y += fieldHeight(field);
      continue;
    }

    switch (field.type) {
      case "text": {
        const labelStyle = isFocused ? st.fieldLabelFocused : st.fieldLabel;
        screen.setText(formX, y, field.label, labelStyle);
        if (field.required) screen.setText(formX + field.label.length + 1, y, "*", st.required);
        y++;

        const inputW = Math.min(formW, 50);
        const borderStyle = isFocused ? st.inputBorderFocused : st.inputBorder;
        const inputStyle = isFocused ? st.inputFocused : st.inputBg;

        // Input box
        screen.fill(formX, y, inputW, 1, " ", inputStyle);

        if (field.value.length > 0) {
          screen.setText(formX + 1, y, field.value.slice(0, inputW - 2), inputStyle);
        } else if (!isFocused) {
          screen.setText(formX + 1, y, field.placeholder.slice(0, inputW - 2), st.placeholder);
        }

        // Borders
        screen.setText(formX - 1, y, "[", borderStyle);
        screen.setText(formX + inputW, y, "]", borderStyle);
        y++;

        // Error
        if (field.error) {
          screen.setText(formX, y, field.error, st.error);
        }
        y += 2;
        break;
      }

      case "radio": {
        const labelStyle = isFocused ? st.fieldLabelFocused : st.fieldLabel;
        screen.setText(formX, y, field.label, labelStyle);
        y++;

        for (let oi = 0; oi < field.options.length; oi++) {
          const opt = field.options[oi];
          const isSelected = oi === field.selected;
          const bullet = isSelected ? "(\u25cf)" : "(\u25cb)";
          const optStyle = isFocused
            ? isSelected
              ? st.radioSelectedFocused
              : st.radioFocused
            : isSelected
              ? st.radioSelected
              : st.radio;
          screen.setText(formX + 2, y, `${bullet} ${opt}`, optStyle);
          y++;
        }
        y++;
        break;
      }

      case "checkbox": {
        const labelStyle = isFocused ? st.fieldLabelFocused : st.fieldLabel;
        screen.setText(formX, y, field.label, labelStyle);
        y++;

        for (let oi = 0; oi < field.options.length; oi++) {
          const opt = field.options[oi];
          const box = opt.checked ? "[\u2713]" : "[ ]";
          const optStyle = isFocused
            ? opt.checked
              ? st.checkboxCheckedFocused
              : st.checkboxFocused
            : opt.checked
              ? st.checkboxChecked
              : st.checkbox;
          screen.setText(formX + 2, y, `${box} ${opt.label}`, optStyle);
          y++;
        }
        y++;
        break;
      }

      case "dropdown": {
        const labelStyle = isFocused ? st.fieldLabelFocused : st.fieldLabel;
        screen.setText(formX, y, field.label, labelStyle);
        y++;

        const ddW = 30;
        const ddStyle = isFocused ? st.dropdownFocused : st.dropdown;
        screen.fill(formX, y, ddW, 1, " ", ddStyle);
        const selected = field.options[field.selected];
        screen.setText(formX + 1, y, selected.slice(0, ddW - 4), ddStyle);
        screen.setText(formX + ddW - 2, y, field.open ? "\u25b2" : "\u25bc", ddStyle);
        y++;

        // Dropdown items (when open)
        if (field.open) {
          for (let oi = 0; oi < field.options.length; oi++) {
            const itemStyle = oi === field.highlightIdx ? st.dropdownItemSelected : st.dropdownItem;
            screen.fill(formX, y, ddW, 1, " ", itemStyle);
            screen.setText(formX + 1, y, field.options[oi].slice(0, ddW - 2), itemStyle);
            y++;
          }
        }
        y++;
        break;
      }

      case "button": {
        const btnStyle = isFocused ? (field.action === "submit" ? st.buttonSubmit : st.buttonFocused) : st.button;
        const btnText = ` ${field.label} `;
        screen.setText(formX, y, btnText, btnStyle);
        // Put reset button next to submit
        if (field.action === "submit" && fi + 1 < fields.length && fields[fi + 1].type === "button") {
          // Skip — render both buttons on same line
        }
        if (field.action === "reset") {
          // Already rendered alongside submit
        }
        y += 2;
        break;
      }
    }
  }

  // Submit result
  if (submitted) {
    const resY = Math.min(y + 1, rows - 4);
    if (submitResult.startsWith("Error")) {
      screen.setText(formX, resY, submitResult, st.error);
    } else {
      screen.drawBox(formX - 1, resY - 1, formW, 4, { style: "rounded", styleId: st.border, fill: true });
      screen.setText(formX, resY, "\u2713 " + submitResult, st.success);
    }
  }

  // Footer
  const footerText = " Tab:Next field | Shift+Tab:Prev | Space:Toggle | Enter:Submit/Select | Ctrl+C:Quit ";
  screen.setText(0, rows - 1, footerText.slice(0, cols), st.footer);

  // Cursor for text fields
  const focused = fields[focusedField];
  if (focused.type === "text") {
    writer.render(screen, {
      cursorVisible: true,
      cursorX: 3 + 1 + focused.cursor,
      cursorY: fieldY(focusedField) + 1 - scrollY,
      cursorStyle: "line",
      cursorBlinking: true,
    });
  } else {
    writer.render(screen, { cursorVisible: false });
  }
}

function fieldHeight(field: Field): number {
  switch (field.type) {
    case "text":
      return 4;
    case "radio":
      return field.options.length + 2;
    case "checkbox":
      return field.options.length + 2;
    case "dropdown": {
      const base = 3;
      return field.open ? base + field.options.length : base;
    }
    case "button":
      return 2;
  }
}

function fieldY(idx: number): number {
  let y = 2;
  for (let i = 0; i < idx; i++) {
    y += fieldHeight(fields[i]);
  }
  return y;
}

// --- Input ---
reader.onkeypress = (event: { name: string; ctrl: boolean; shift: boolean; alt: boolean }) => {
  const { name, ctrl, shift } = event;

  if (ctrl && name === "c") {
    cleanup();
    return;
  }

  const focused = fields[focusedField];

  // Close any open dropdown when leaving
  const closeDropdowns = () => {
    for (const f of fields) {
      if (f.type === "dropdown") f.open = false;
    }
  };

  // Handle open dropdown
  if (focused.type === "dropdown" && focused.open) {
    switch (name) {
      case "up":
      case "k":
        focused.highlightIdx = Math.max(0, focused.highlightIdx - 1);
        break;
      case "down":
      case "j":
        focused.highlightIdx = Math.min(focused.options.length - 1, focused.highlightIdx + 1);
        break;
      case "enter":
      case " ":
        focused.selected = focused.highlightIdx;
        focused.open = false;
        break;
      case "escape":
        focused.open = false;
        break;
    }
    render();
    return;
  }

  // Text field input
  if (focused.type === "text") {
    switch (name) {
      case "tab":
        closeDropdowns();
        if (shift) {
          focusedField = (focusedField - 1 + fields.length) % fields.length;
        } else {
          focusedField = (focusedField + 1) % fields.length;
        }
        ensureVisible();
        break;
      case "backspace":
        if (focused.cursor > 0) {
          focused.value = focused.value.slice(0, focused.cursor - 1) + focused.value.slice(focused.cursor);
          focused.cursor--;
        }
        break;
      case "delete":
        if (focused.cursor < focused.value.length) {
          focused.value = focused.value.slice(0, focused.cursor) + focused.value.slice(focused.cursor + 1);
        }
        break;
      case "left":
        if (focused.cursor > 0) focused.cursor--;
        break;
      case "right":
        if (focused.cursor < focused.value.length) focused.cursor++;
        break;
      case "home":
        focused.cursor = 0;
        break;
      case "end":
        focused.cursor = focused.value.length;
        break;
      case "enter":
        closeDropdowns();
        focusedField = (focusedField + 1) % fields.length;
        ensureVisible();
        break;
      default:
        if (!ctrl && !event.alt && name.length === 1) {
          focused.value = focused.value.slice(0, focused.cursor) + name + focused.value.slice(focused.cursor);
          focused.cursor++;
        }
        break;
    }
    render();
    return;
  }

  // Non-text field input
  switch (name) {
    case "q":
      cleanup();
      return;
    case "tab":
      closeDropdowns();
      if (shift) {
        focusedField = (focusedField - 1 + fields.length) % fields.length;
      } else {
        focusedField = (focusedField + 1) % fields.length;
      }
      ensureVisible();
      break;
    case "up":
    case "k":
      if (focused.type === "radio") {
        focused.selected = Math.max(0, focused.selected - 1);
      }
      break;
    case "down":
    case "j":
      if (focused.type === "radio") {
        focused.selected = Math.min(focused.options.length - 1, focused.selected + 1);
      }
      break;
    case " ":
      if (focused.type === "checkbox") {
        // Toggle the first unchecked, or cycle through
        const allChecked = focused.options.every(o => o.checked);
        if (allChecked) {
          for (const o of focused.options) o.checked = false;
        } else {
          // Toggle next unchecked
          const nextUnchecked = focused.options.findIndex(o => !o.checked);
          if (nextUnchecked >= 0) focused.options[nextUnchecked].checked = true;
        }
      } else if (focused.type === "dropdown") {
        focused.open = !focused.open;
        focused.highlightIdx = focused.selected;
      }
      break;
    case "enter":
      if (focused.type === "dropdown") {
        focused.open = !focused.open;
        focused.highlightIdx = focused.selected;
      } else if (focused.type === "button") {
        if (focused.action === "submit") {
          submitted = true;
          if (validate()) {
            const textFields = fields.filter((f): f is TextField => f.type === "text");
            submitResult = `Form submitted! Name: ${textFields[0].value}, Email: ${textFields[1].value}`;
          } else {
            submitResult = "Error: Please fix the highlighted fields";
          }
        } else if (focused.action === "reset") {
          resetForm();
        }
      }
      break;
  }

  render();
};

function ensureVisible() {
  const fy = fieldY(focusedField);
  const fh = fieldHeight(fields[focusedField]);
  if (fy - scrollY < 2) {
    scrollY = Math.max(0, fy - 2);
  } else if (fy + fh - scrollY > rows - 2) {
    scrollY = fy + fh - rows + 2;
  }
}

// --- Paste ---
reader.onpaste = (text: string) => {
  const focused = fields[focusedField];
  if (focused.type === "text") {
    const line = text.split("\n")[0];
    focused.value = focused.value.slice(0, focused.cursor) + line + focused.value.slice(focused.cursor);
    focused.cursor += line.length;
    render();
  }
};

// --- Resize ---
writer.onresize = (newCols: number, newRows: number) => {
  cols = newCols;
  rows = newRows;
  screen.resize(cols, rows);
  render();
};

// --- Cleanup ---
let cleanedUp = false;
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  reader.close();
  writer.exitAltScreen();
  writer.close();
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

// --- Start ---
render();
