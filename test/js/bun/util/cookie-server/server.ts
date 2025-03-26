import { CookieMap } from "bun";

function mainHTML(cookies: CookieMap) {
  return `
    <html>
      <body>
        Hello World. Your cookies are:
        <ul>
          ${Array.from(cookies.entries())
            .map(
              ([, cookie]) =>
                `<li>${Bun.escapeHTML(cookie.name)}: ${Bun.escapeHTML(cookie.value)} <button onclick="fetch('/delete-cookie?key=${encodeURIComponent(cookie.name)}', {method: 'POST'}).then(() => window.location.reload())">Delete</button></li>`,
            )
            .join("\n")}
            <li>
              <form onsubmit="event.preventDefault(); fetch('/set-cookie', {method: 'POST', body: new FormData(event.target)}).then(() => window.location.reload())">
                <input type="text" name="key" placeholder="Key"><input type="text" name="value" placeholder="Value"><button type="submit">Set Cookie</button>
              </form>
            </li>
        </ul>
      </body>
    </html>
  `;
}

Bun.serve({
  port: 3000,
  routes: {
    "/": req => new Response(mainHTML(req.cookies), { headers: { "content-type": "text/html" } }),
    "/update-cookies": req => {
      const cookies = req.cookies;
      cookies.set("test", "test");
      // return new Response("Cookies updated");
      return Response.redirect("/");
    },
  },
});
