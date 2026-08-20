// Temporary diagnostic for the darwin tart fleet's intermittent
// "Permission denied" ssh failures (something else answering the guest's IP).
// Runs only inside a tart guest (detected via DOCKER_HOST pointing at the
// vmnet gateway). Collects: guest ARP/interface state, an ssh banner census
// of the subnet (macOS vs Linux sshd), DHCP lease info, and the sidecar VM's
// network state via its Docker API. Always passes; output is the deliverable.
// Do not merge.
import { expect, test } from "bun:test";

const DOCKER_HOST = process.env.DOCKER_HOST || "";
const gw = DOCKER_HOST.match(/^tcp:\/\/(192\.168\.64\.1):(\d+)$/);
const isTartGuest = process.platform === "darwin" && process.arch === "arm64" && gw !== null;

const log = (...args: unknown[]) => console.log("[tart-probe]", ...args);

async function run(cmd: string[], timeoutMs = 10_000): Promise<string> {
  try {
    const proc = Bun.spawn({ cmd, stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => proc.kill(), timeoutMs);
    const [out, err] = await Promise.all([proc.stdout.text(), proc.stderr.text()]);
    clearTimeout(timer);
    return out + (err ? `\n[stderr] ${err}` : "");
  } catch (e) {
    return `[spawn error] ${e}`;
  }
}

async function ping(ip: string): Promise<boolean> {
  const out = await run(["ping", "-c", "1", "-W", "700", "-t", "1", ip], 2_000);
  return out.includes("1 packets received");
}

async function sshBanner(ip: string): Promise<string | null> {
  return await new Promise(resolve => {
    let settled = false;
    const done = (v: string | null) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    const timer = setTimeout(() => done(null), 2_500);
    Bun.connect({
      hostname: ip,
      port: 22,
      socket: {
        data(socket, data) {
          clearTimeout(timer);
          socket.end();
          done(Buffer.from(data).toString("utf8").split("\n")[0].trim());
        },
        error() {
          clearTimeout(timer);
          done(null);
        },
        connectError() {
          clearTimeout(timer);
          done(null);
        },
        close() {
          clearTimeout(timer);
          done(null);
        },
      },
    }).catch(() => {
      clearTimeout(timer);
      done(null);
    });
  });
}

async function docker(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`http://${gw![1]}:${gw![2]}${path}`, init);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

test.skipIf(!isTartGuest)(
  "darwin tart subnet diagnostics",
  async () => {
    log("=== guest identity ===");
    log("hostname:", (await run(["hostname"])).trim());
    log("ifconfig en0:\n" + (await run(["ifconfig", "en0"])));
    log("dhcp packet:\n" + (await run(["ipconfig", "getpacket", "en0"])));
    log("routes:\n" + (await run(["netstat", "-rn", "-f", "inet"])));

    log("=== subnet sweep (ping to populate arp, then banner census) ===");
    const ips: string[] = [];
    for (let i = 1; i <= 40; i++) ips.push(`192.168.64.${i}`);
    for (let i = 240; i <= 254; i++) ips.push(`192.168.64.${i}`);
    const alive = new Set<string>();
    // bounded concurrency to keep this quick but not noisy
    for (let i = 0; i < ips.length; i += 16) {
      const batch = ips.slice(i, i + 16);
      const results = await Promise.all(batch.map(ip => ping(ip)));
      batch.forEach((ip, k) => {
        if (results[k]) alive.add(ip);
      });
    }
    log("alive:", [...alive].join(" "));
    log("arp table after sweep:\n" + (await run(["arp", "-an"])));
    for (const ip of alive) {
      const banner = await sshBanner(ip);
      log(`ssh banner ${ip}: ${banner ?? "(no banner/closed)"}`);
    }

    log("=== sidecar via docker api ===");
    try {
      const version = await docker("/version");
      log("docker version:", JSON.stringify(version));
      const info = await docker("/info");
      log("docker info: name=%s kernel=%s os=%s", info?.Name, info?.KernelVersion, info?.OperatingSystem);
      const images = (await docker("/images/json")) as any[];
      const tags = images.flatMap(i => i.RepoTags ?? []).filter(t => t && !t.startsWith("<none>"));
      log("sidecar images:", JSON.stringify(tags));

      let image = tags.find(t => /alpine|busybox/i.test(t)) ?? tags[0] ?? images[0]?.Id;
      if (!image) {
        log("no local images; attempting pull busybox:latest");
        await docker("/images/create?fromImage=busybox&tag=latest", { method: "POST" });
        image = "busybox:latest";
      }
      const script = [
        "echo HOSTNAME $(cat /proc/sys/kernel/hostname)",
        "echo UPTIME $(cat /proc/uptime)",
        "for d in /sys/class/net/*; do echo IFACE $(basename $d) mac=$(cat $d/address 2>/dev/null) state=$(cat $d/operstate 2>/dev/null); done",
        'echo PROXY_ARP; for f in /proc/sys/net/ipv4/conf/*/proxy_arp; do echo "  $f=$(cat $f)"; done',
        "echo IP_FORWARD $(cat /proc/sys/net/ipv4/ip_forward)",
        "echo ADDRS; ip -4 addr show 2>/dev/null || cat /proc/net/fib_trie | head -80",
        "echo NEIGH; ip -4 neigh show 2>/dev/null || true",
        "echo ARPTABLE; cat /proc/net/arp",
      ].join("; ");
      const create = await docker("/containers/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Image: image,
          Entrypoint: ["/bin/sh", "-c"],
          Cmd: [script],
          HostConfig: { Privileged: true, NetworkMode: "host", AutoRemove: false },
        }),
      });
      const id = create?.Id;
      log("probe container:", id ?? JSON.stringify(create));
      if (id) {
        await docker(`/containers/${id}/start`, { method: "POST" });
        await docker(`/containers/${id}/wait`, { method: "POST" });
        const res = await fetch(`http://${gw![1]}:${gw![2]}/containers/${id}/logs?stdout=1&stderr=1`);
        const raw = Buffer.from(await res.arrayBuffer());
        // strip docker stream multiplexing headers
        let text = "";
        let off = 0;
        while (off + 8 <= raw.length) {
          const len = raw.readUInt32BE(off + 4);
          text += raw.subarray(off + 8, off + 8 + len).toString("utf8");
          off += 8 + len;
        }
        log("sidecar state:\n" + (text || raw.toString("utf8")));
        await docker(`/containers/${id}?force=true`, { method: "DELETE" });
      }
    } catch (e) {
      log("docker probe failed:", e);
    }

    expect(true).toBe(true);
  },
  180_000,
);
