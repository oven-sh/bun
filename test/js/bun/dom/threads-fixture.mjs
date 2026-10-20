// The main thread and four Workers use the DOM at the same time. dom.test.ts runs this in a process of its own.
// Arguments: the number of rounds in each of the four generations, then the parts to run (default: all).
import { DOMParser, Window } from "bun:dom";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

const parts = {
  parse(window, seed, round) {
    const html = `<!doctype html><title>t${seed}</title><body><div id=d${round} data-x${round}=1><p>text &amp; ${seed}<svg viewBox="0 0 1 1"><path d=""/></svg><table><tr><td>${round}</table>`;
    return new DOMParser().parseFromString(html, "text/html").body.childNodes.length + new window.DOMParser().parseFromString(html, "text/html").title.length;
  },
  innerHTML(window, seed, round) {
    const div = window.document.createElement("div");
    div.innerHTML = `<ul><li a${seed}${round}="1">x</li><li>y</li></ul><custom-${seed}${round & 7}></custom-${seed}${round & 7}><input value=${round}>`;
    return div.innerHTML.length + div.outerHTML.length;
  },
  attributes(window, seed, round) {
    const div = window.document.createElement("div");
    for (let i = 0; i < 8; i++) div.setAttribute(`n${seed}-${round}-${i}`, `v${i}`);
    div.setAttributeNS("urn:x" + (round & 15), `p${round & 15}:q${round}`, "1");
    div.id = "i" + round;
    div.title = "t" + round;
    div.toggleAttribute("hidden");
    return div.attributes.length + div.getAttributeNames().length;
  },
  classes(window, seed, round) {
    const div = window.document.createElement("div");
    div.className = `a${seed}-${round} b${round & 255} c`;
    div.classList.add("d" + round, "e");
    div.classList.toggle("c");
    return div.classList.length + div.className.length;
  },
  style(window, seed, round) {
    const { document } = window;
    const div = document.body.appendChild(document.createElement("div"));
    div.style.cssText = `color: rgb(${round & 255}, 0, 0); margin: ${round & 31}px; --v${seed}${round & 63}: ${round}`;
    div.style.setProperty("width", (round & 127) + "px");
    const sheet = document.head.appendChild(document.createElement("style"));
    sheet.textContent = `.k${round & 31} { padding: ${round & 15}px } div { display: block }`;
    const computed = window.getComputedStyle(div);
    const n = computed.color.length + computed.marginTop.length + computed.display.length + div.style.length + sheet.sheet.cssRules.length;
    div.remove();
    sheet.remove();
    return n;
  },
  selectors(window, seed, round) {
    const { document } = window;
    if (!document.body.firstChild) document.body.innerHTML = `<section><p id=a title=t><span lang=en>x</span></p><p><b>y</b></p></section>`;
    return (
      document.querySelectorAll(`p:nth-child(${(round & 7) + 1}), [data-${seed}${round}], span:not(.z${round})`).length +
      document.querySelectorAll(`section > p:has(b, i${round & 63}) , #a${round & 1 ? "" : "x"}`).length +
      (document.body.firstChild.matches(`:is(section, t${seed}${round & 127})`) ? 1 : 0) +
      (document.querySelector("span").closest(`p[title^=t], q${round}`) ? 1 : 0)
    );
  },
  customElements(window, seed, round) {
    const name = `x-${seed}-${round}`;
    let connected = 0;
    window.customElements.define(name, class extends window.HTMLElement {
      static observedAttributes = ["a"];
      connectedCallback() { connected++; }
      attributeChangedCallback() { connected++; }
    });
    const host = window.document.createElement("div");
    host.innerHTML = `<${name} a=1></${name}>`;
    window.document.body.appendChild(host).remove();
    return connected + (window.customElements.get(name) ? 1 : 0);
  },
  events(window, seed, round) {
    const { document } = window;
    const outer = document.body.appendChild(document.createElement("div"));
    const inner = outer.appendChild(document.createElement("button"));
    let heard = 0;
    outer.addEventListener("e" + seed + (round & 63), () => heard++);
    outer.onclick = () => heard++;
    inner.addEventListener("click", () => heard++, { once: true });
    inner.dispatchEvent(new window.CustomEvent("e" + seed + (round & 63), { bubbles: true }));
    inner.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    inner.click();
    outer.remove();
    return heard;
  },
  observers(window, seed, round) {
    const { document } = window;
    const div = document.createElement("div");
    const observer = new window.MutationObserver(() => {});
    observer.observe(div, { childList: true, attributes: true, subtree: true });
    div.appendChild(document.createTextNode("x")).data = "y" + round;
    div.setAttribute("a", round);
    const range = document.createRange();
    range.selectNodeContents(div);
    const n = observer.takeRecords().length + range.toString().length + div.children.length + div.getElementsByTagName("t" + (round & 31)).length;
    observer.disconnect();
    return n;
  },
};

function work(seed, rounds, names) {
  let total = 0;
  for (let generation = 0; generation < 4; generation++) {
    // A new window for each generation, so that whole documents die while the other threads work.
    let window = new Window({ url: "https://example.com/" + seed });
    for (let round = 0; round < rounds; round++) for (const name of names) total += parts[name](window, seed, generation * rounds + round);
    window = null;
    Bun.gc(true);
  }
  return total;
}

if (isMainThread) {
  const rounds = Number(process.argv[2] ?? 250);
  const names = process.argv.length > 3 ? process.argv.slice(3) : Object.keys(parts);
  const workers = Array.from({ length: 4 }, (_, i) =>
    new Promise((resolve, reject) => {
      const worker = new Worker(new URL(import.meta.url), { workerData: { seed: "w" + i, rounds, names } });
      worker.on("message", resolve);
      worker.on("error", reject);
      worker.on("exit", code => code && reject(new Error("a Worker exited with " + code)));
    }),
  );
  const own = work("m", rounds, names);
  const others = await Promise.all(workers);
  console.log(others.every(total => total === others[0]) && own > 0 ? "ok" : `different totals: ${own} ${others}`);
} else {
  parentPort.postMessage(work(workerData.seed, workerData.rounds, workerData.names));
}
