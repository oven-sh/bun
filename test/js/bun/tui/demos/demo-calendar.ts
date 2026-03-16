/**
 * demo-calendar.ts — Renders the current month as a calendar grid with
 * today highlighted. Uses drawBox for the border, styled day numbers.
 */

const writer = new Bun.TUITerminalWriter(Bun.stdout);
const width = 30;
const height = 12;
const screen = new Bun.TUIScreen(width, height);

// Styles
const borderStyle = screen.style({ fg: 0x3e4452 });
const titleStyle = screen.style({ fg: 0x61afef, bold: true });
const headerStyle = screen.style({ fg: 0xe5c07b, bold: true });
const dayStyle = screen.style({ fg: 0xabb2bf });
const todayStyle = screen.style({ fg: 0x282c34, bg: 0x98c379, bold: true });
const weekendStyle = screen.style({ fg: 0x5c6370 });
const dimStyle = screen.style({ fg: 0x3e4452 });

const now = new Date();
const year = now.getFullYear();
const month = now.getMonth();
const today = now.getDate();

const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// First day of month (0=Sun, 6=Sat)
const firstDay = new Date(year, month, 1).getDay();
// Days in month
const daysInMonth = new Date(year, month + 1, 0).getDate();

// Draw border
screen.drawBox(0, 0, width, height, { style: "rounded", styleId: borderStyle });

// Month + Year title
const title = `${monthNames[month]} ${year}`;
screen.setText(Math.floor((width - title.length) / 2), 1, title, titleStyle);

// Day headers
const dayHeaders = "Su Mo Tu We Th Fr Sa";
screen.setText(2, 3, dayHeaders, headerStyle);

// Separator
screen.setText(2, 4, "\u2500".repeat(width - 4), dimStyle);

// Render days
let row = 5;
let col = firstDay;

for (let d = 1; d <= daysInMonth; d++) {
  const x = 2 + col * 3;
  const str = String(d).padStart(2, " ");

  let style = dayStyle;
  if (d === today) {
    style = todayStyle;
  } else if (col === 0 || col === 6) {
    style = weekendStyle;
  }

  screen.setText(x, row, str, style);
  col++;
  if (col > 6) {
    col = 0;
    row++;
  }
}

writer.render(screen);
writer.clear();
writer.write("\r\n");
writer.close();
