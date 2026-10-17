#!/bin/bash
set -u
if [ "${1:-}" != --inside ]; then
  P=$(realpath "$1"); S=$(realpath -m "$2"); shift 2; mkdir -p "$S/upper" "$S/work"
  exec unshare -Urmpfn --kill-child --mount-proc bash "$(realpath "$0")" --inside "$P" "$S" "$@" < /dev/null
fi
shift; P=$1; S=$2; shift 2; die() { echo "JAIL: $*"; exit 97; }
PATH="$PATH:/usr/sbin:/sbin" ip link set lo up || die "no loopback"
mount -t tmpfs -o size=${JAIL_TMP:-16g} tmpfs /tmp || die "no /tmp"
mkdir -p /tmp/.keep/project; mount -t overlay overlay -o "lowerdir=${LOWER:+$LOWER:}$P,upperdir=$S/upper,workdir=$S/work" /tmp/.keep/project || die "no overlay"
n=0; IFS=: read -r -a see <<< "${SEE:-}"; for s in "${see[@]}"; do n=$((n + 1)); if [ -d "$s" ]; then mkdir /tmp/.keep/$n; else touch /tmp/.keep/$n; fi; mount --bind "$s" /tmp/.keep/$n || die "cannot keep $s"; done
mount -t tmpfs -o size=64m tmpfs "$HOME" || die "the home folder cannot be hidden"
n=0; for s in "${see[@]}"; do n=$((n + 1)); if [ -d /tmp/.keep/$n ]; then mkdir -p "$s"; else mkdir -p "$(dirname "$s")"; touch "$s"; fi; mount --move /tmp/.keep/$n "$s" && mount -o remount,bind,ro "$s" || die "cannot show $s"; done
mkdir -p "$P"; mount --move /tmp/.keep/project "$P" || die "cannot show the project"; rm -rf /tmp/.keep
while read -r _ _ _ _ mp opts _; do
  case "$mp" in "$P" | /tmp | /proc | /proc/* | /dev | /dev/* | /sys | /sys/*) continue;; esac
  mount -o "remount,bind,$(echo "$opts" | sed 's/^rw/ro/')" "$mp" 2> /dev/null
done < /proc/self/mountinfo
for p in "$HOME" / /var/tmp /usr/local "${see[@]}"; do [ -d "$p" ] || continue; if touch "$p/.jail-probe" 2> /dev/null; then die "$p can be written"; fi; done
[ -z "$(ls -A "$HOME" | grep -v -x "$(echo "${P#$HOME/}" | cut -d/ -f1)")" ] || [ -n "${SEE:-}" ] || die "the home folder is in sight"
mkdir -p /tmp/home /tmp/tmp; cd "$P" || exit 97
exec "$@"
