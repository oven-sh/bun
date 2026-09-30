#!/usr/bin/env bash
set -euo pipefail
# Rebuilds the vendored corpus beside this script from two local clones, at the commits UPSTREAM pins or at the ones given.
export LC_ALL=C GIT_NO_LAZY_FETCH=1 GIT_TERMINAL_PROMPT=0 GIT_ALLOW_PROTOCOL=
unset $(git rev-parse --local-env-vars)

usage() {
  cat <<'EOF'
usage: sync.sh [--check | --verify[=<rev>]] <typescript-go clone> <TypeScript clone> [<typescript-go commit> [<TypeScript commit>]]

  (default)       make the vendored files equal to upstream, print what changed, update the commits in UPSTREAM
  --check         print what would change, write nothing, exit 1 if anything differs
  --verify[=rev]  compare the tree of a commit of this repository (default HEAD) with upstream, exit 1 if it differs

The clones are read through git plumbing only: nothing is fetched, nothing is written into a clone and nothing is
staged in this repository. A commit or a file that a clone does not hold stops the run.

The commits default to the ones UPSTREAM pins: for each repository, the first full commit id after its name. With a
typescript-go commit alone, the TypeScript commit is the one that it records for _submodules/TypeScript. Any other
TypeScript commit is refused.

Written below the directory of this script, byte for byte and with upstream's file mode, whatever the content:
  corpus/cases/<suite>/             every file of tests/cases/<suite> of TypeScript (suites: compiler, conformance)
  corpus/lib/                       every file of tests/lib of TypeScript
  corpus/baselines/typescript/      <case>.errors.txt and <case>(<options>).errors.txt of tests/baselines/reference,
                                    <case> being the name of a .ts or .tsx file of a suite without that ending
  corpus/baselines/typescript-go/<suite>/
                                    the same names of typescript-go's testdata/baselines/reference/submodule/<suite>,
                                    only where the bytes differ from TypeScript's file or TypeScript has none
  corpus/baselines/typescript-go/NO_ERRORS.txt
                                    a line <suite>/<name>.errors.txt for each baseline of TypeScript where
                                    typescript-go ran the case and reported no error: it has <name>.errors.txt.diff
                                    and no <name>.errors.txt
  corpus/submoduleAccepted.txt, corpus/submoduleTriaged.txt
                                    the two lists of typescript-go's testdata
  LICENSE, NOTICE.txt               of typescript-go
  LICENSE.txt, ThirdPartyNoticeText.txt
                                    of TypeScript
Every other file below corpus/ is removed, except a file directly in corpus/ whose name starts with a dot.

Output, with paths relative to the directory of this script:
  A, D, M <path>  added, removed, changed (content or file mode; UPSTREAM when its commits change)
  X <path>        executable upstream
  I <path>        matched by an ignore rule of this repository: staging it needs --force

The run stops before it writes anything when an upstream name is unsafe here: a name that git has to quote, that is
no regular file, that Windows refuses, that differs from another one only by case, that starts with a dot or
configures a tool, that a test runner of this repository takes for a test, or that makes a path longer than 200
characters.
EOF
}
die() { echo "sync.sh: $*" >&2; exit 2; }

mode=sync
rev=HEAD
args=()
while [ $# -gt 0 ]; do
  case "$1" in
    --check) mode=check ;;
    --verify) mode=verify ;;
    --verify=*) mode=verify; rev=${1#--verify=} ;;
    -h | --help) usage; exit 0 ;;
    -*) usage >&2; exit 2 ;;
    *) args+=("$1") ;;
  esac
  shift
done
if [ ${#args[@]} -lt 2 ] || [ ${#args[@]} -gt 4 ]; then usage >&2; exit 2; fi
go_rev=${args[2]:-}
ts_rev=${args[3]:-}

here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
upstream=$here/UPSTREAM
[ -f "$upstream" ] || die "missing $upstream"
tab=$(printf '\t')
submodule=_submodules/TypeScript
no_errors=corpus/baselines/typescript-go/NO_ERRORS.txt
diff_roots="testdata/baselines/reference/submodule testdata/baselines/reference/submoduleAccepted testdata/baselines/reference/submoduleTriaged"
# A checkout on Windows without core.longpaths ends at 259 characters: this leaves 58 for the directory of the clone.
max_path=200

# One record per line: repository, kind, path at the upstream commit, path below the directory of this script.
layout() {
  cat <<'EOF'
TypeScript cases tests/cases/compiler corpus/cases/compiler
TypeScript cases tests/cases/conformance corpus/cases/conformance
TypeScript tree tests/lib corpus/lib
TypeScript errors tests/baselines/reference corpus/baselines/typescript
typescript-go overlay testdata/baselines/reference/submodule corpus/baselines/typescript-go
typescript-go file testdata/submoduleAccepted.txt corpus/submoduleAccepted.txt
typescript-go file testdata/submoduleTriaged.txt corpus/submoduleTriaged.txt
typescript-go file LICENSE LICENSE
typescript-go file NOTICE.txt NOTICE.txt
TypeScript file LICENSE.txt LICENSE.txt
TypeScript file ThirdPartyNoticeText.txt ThirdPartyNoticeText.txt
EOF
}

# The pin of a repository is the first full commit id after its name in the text on standard input.
pin() {
  { grep -owE '[Tt]ype[Ss]cript(-[Gg]o)?|[0-9a-f]{40}' || true; } | awk -v want="$1" '
    length($0) == 40 && $0 !~ /[^0-9a-f]/ { if (repo == want && found == "") found = $0; next }
    { repo = ($0 ~ /-[Gg]o$/) ? "go" : "ts" }
    END { print found }'
}
go_pin=$(pin go < "$upstream")
ts_pin=$(pin ts < "$upstream")
[ -n "$go_pin" ] && [ -n "$ts_pin" ] || die "UPSTREAM has to name typescript-go and TypeScript, each followed by its full commit id"

abs() { (cd -- "$1" 2> /dev/null && pwd) || die "$1 is not a directory"; }
go_clone=$(abs "${args[0]}")
ts_clone=$(abs "${args[1]}")
for clone in "$go_clone" "$ts_clone"; do
  git -C "$clone" rev-parse --git-dir > /dev/null || die "$clone is not a git repository that can be read"
done
resolve() { git -C "$1" rev-parse --verify --quiet "$2^{commit}" || die "commit $2 is not in $1: fetch it yourself, this script uses no network"; }
go_commit=$(resolve "$go_clone" "${go_rev:-$go_pin}")

in_tree=false
rel=
filemode=true
if [ "$(git -C "$here" rev-parse --is-inside-work-tree 2> /dev/null || true)" = true ]; then
  in_tree=true
  rel=$(git -C "$here" rev-parse --show-prefix)
  filemode=$(git -C "$here" config --bool --get core.filemode || echo true)
fi
if [ "$mode" = verify ] && [ "$in_tree" = false ]; then die "--verify needs this directory to be in a git work tree"; fi

tmp=$(mktemp -d)
trap 'cd / && rm -rf "$tmp"' EXIT
cd "$tmp"
tmp=$PWD

# A scratch repository borrows the objects of both clones, so that no object is written into a clone.
git init -q repo
mkdir -p repo/.git/info repo/.git/objects/info
for clone in "$go_clone" "$ts_clone"; do
  objects=$(git -C "$clone" rev-parse --path-format=absolute --git-path objects)
  [ -d "$objects" ] || die "cannot find the object store of $clone (git 2.31 or later is needed)"
  echo "$objects"
done > repo/.git/objects/info/alternates
echo '* -text -eol -ident -filter -working-tree-encoding' > repo/.git/info/attributes
G() { git --git-dir="$tmp/repo/.git" --work-tree="$tmp/repo" -c core.quotePath=false -c core.autocrlf=false "$@"; }
G cat-file -e "$go_commit^{commit}" || die "cannot read $go_commit through the object store of $go_clone"

gitlink=$(G ls-tree "$go_commit" -- "$submodule" | awk '$1 == "160000" { print $3 }')
[ -n "$gitlink" ] || die "typescript-go $go_commit has no submodule at $submodule"
if [ -n "$ts_rev" ]; then want=$ts_rev; elif [ -n "$go_rev" ]; then want=$gitlink; else want=$ts_pin; fi
ts_commit=$(resolve "$ts_clone" "$want")
[ "$ts_commit" = "$gitlink" ] || die "typescript-go $go_commit records TypeScript $gitlink at $submodule, not $ts_commit"
G cat-file -e "$ts_commit^{commit}" || die "cannot read $ts_commit through the object store of $ts_clone"
commit_of() { if [ "$1" = TypeScript ]; then echo "$ts_commit"; else echo "$go_commit"; fi; }

count() { awk 'END { print NR }' "$1"; }
stop() { if [ -s "$1" ]; then die "$2: $(awk 'NR <= 5' "$1" | tr '\n' ' ')"; fi; }

# Writes a tree listing of an upstream commit to the file l and stops on a name that git has to quote.
list() {
  G ls-tree "$@" < /dev/null > l
  awk -F'\t' '$2 ~ /^"/ { print $2 }' l > bad
  stop bad "upstream names with a control character, a quote or a backslash"
}

# Marks each <name>.errors.txt of l with + when <name> is <case> or <case>(<options>) for a case of the suite $1, or of any suite when $1 is empty.
select_errors() {
  awk -F'\t' -v OFS='\t' -v suite="$1" '
    FILENAME == "cases" { if (suite == "" || $1 == suite) stem[$2] = 1; next }
    {
      n = split($2, seg, "/"); b = seg[n]
      if (b !~ /\.errors\.txt$/) next
      core = substr(b, 1, length(b) - 11); hit = (core in stem)
      if (!hit && substr(core, length(core)) == ")")
        for (i = 2; i < length(core) && !hit; i++) if (substr(core, i, 1) == "(" && (substr(core, 1, i - 1) in stem)) hit = 1
      mark = hit ? "+" : "-"
      print mark, $1, b
    }' cases l
}

layout > layout.txt
awk '$2 != "file" && index($4, "corpus/") != 1 { print $4 }' layout.txt > bad
stop bad "only single files may be written outside corpus/"
awk '$2 == "file" && index($4, "corpus/") != 1 { print $4 }' layout.txt > files
: > target; : > cases; : > suites; : > ts.errors; : > go.errors; : > go.all; : > go.overlay; : > unmatched

while read -r repo kind src dest; do
  c=$(commit_of "$repo")
  case "$kind" in
    cases | tree)
      list -r "$c" -- "$src"
      awk -F'\t' -v OFS='\t' -v s="$src/" -v d="$dest/" 'index($2, s) == 1 { print $1, d substr($2, length(s) + 1) }' l > m
      [ -s m ] || die "$repo $c has nothing below $src"
      ;;
    file)
      list "$c" -- "$src"
      awk -F'\t' -v OFS='\t' -v s="$src" -v d="$dest" '$2 == s { print $1, d }' l > m
      [ -s m ] || die "$repo $c has no file $src"
      ;;
    *) continue ;;
  esac
  cat m >> target
  if [ "$kind" = cases ]; then
    suite=${src##*/}
    echo "$suite" >> suites
    awk -F'\t' -v OFS='\t' -v s="$suite" '$2 ~ /\.tsx?$/ { n = split($2, seg, "/"); b = seg[n]; sub(/\.tsx?$/, "", b); print s, b }' l >> cases
  fi
done < layout.txt
cut -f2 cases | sort | uniq -d > bad
stop bad "cases that share a baseline name"

while read -r repo kind src dest; do
  [ "$kind" = errors ] || continue
  c=$(commit_of "$repo")
  list "$c" -- "$src/"
  select_errors "" > marked
  awk -F'\t' -v OFS='\t' '$1 == "+" { print $2, $3 }' marked >> ts.errors
  [ -s ts.errors ] || die "$repo $c has no error baseline of a case in $src"
  awk -F'\t' -v OFS='\t' -v d="$dest/" '$1 == "+" { print $2, d $3 }' marked >> target
  awk -F'\t' -v s="$src/" '$1 == "-" { print s $3 }' marked >> unmatched
done < layout.txt

# Equal blob ids mean equal bytes, so a baseline of typescript-go is kept when TypeScript has no blob of that name or another one.
while read -r repo kind src dest; do
  [ "$kind" = overlay ] || continue
  c=$(commit_of "$repo")
  while read -r suite; do
    list "$c" -- "$src/$suite/"
    awk -F'\t' -v s="$suite" '$2 ~ /\.errors\.txt$/ { n = split($2, seg, "/"); print s "/" seg[n] }' l >> go.all
    select_errors "$suite" > marked
    awk -F'\t' -v OFS='\t' -v s="$suite" '$1 == "+" { print $2, s "/" $3, $3 }' marked >> go.errors
    awk -F'\t' -v s="$src/$suite/" '$1 == "-" { print s $3 }' marked >> unmatched
  done < suites
  [ -s go.errors ] || die "$repo $c has no error baseline of a case below $src"
  awk -F'\t' -v OFS='\t' -v d="$dest/" '
    FILENAME == "ts.errors" { split($1, m, " "); ts[$2] = m[3]; next }
    { split($1, m, " "); if (!($3 in ts) || ts[$3] != m[3]) print $1, d $2 }' ts.errors go.errors > go.overlay
  cat go.overlay >> target
done < layout.txt

for d in $diff_roots; do
  while read -r suite; do
    list "$go_commit" -- "$d/$suite/"
    awk -F'\t' -v s="$suite" '$2 ~ /\.errors\.txt\.diff$/ { n = split($2, seg, "/"); b = seg[n]; print s "/" substr(b, 1, length(b) - 5) }' l
  done < suites
done > diffs
awk -F'\t' '
  FILENAME == "go.all" { go[$1] = 1; next }
  FILENAME == "ts.errors" { ts[$2] = 1; next }
  { n = split($1, seg, "/"); if (!($1 in go) && (seg[n] in ts)) print $1 }' go.all ts.errors diffs | sort -u > no_errors.txt
printf '100644 blob %s\t%s\n' "$(G hash-object -w --stdin < no_errors.txt)" "$no_errors" >> target

sort -t"$tab" -k2 -o target target
cut -f2 target > paths
awk -F'\t' '$1 !~ /^100(644|755) blob [0-9a-f]+$/ { print $2 }' target > bad
stop bad "upstream entries that are no regular file"
uniq -d paths > bad
stop bad "two upstream files for one path"
awk '{ n = split($0, seg, "/"); p = ""; for (i = 1; i <= n; i++) { p = (i == 1 ? "" : p "/") seg[i]; l = tolower(p); if (!(l in seen)) seen[l] = p; else if (seen[l] != p) print seen[l] "=" p } }' paths | sort -u > bad
stop bad "paths that differ only by case"
awk '{ n = split($0, seg, "/"); for (i = 1; i <= n; i++) { s = tolower(seg[i]); if (s ~ /[<>:"|?*\\]/ || s ~ /[ .]$/ || s ~ /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/) { print; next } } }' paths > bad
stop bad "names that Windows refuses"
awk '{ n = split($0, seg, "/"); for (i = 1; i <= n; i++) if (seg[i] ~ /^\./) { print; next } if (seg[n] ~ /^(package\.json|tsconfig.*\.json|jsconfig\.json|bunfig\.toml)$/) print }' paths > bad
stop bad "names that start with a dot or configure a tool"
awk -F/ '$NF ~ /\.[cm]?[jt]sx?$/ && ($NF ~ /\.test/ || $NF ~ /spec\./ || $NF ~ /_test\./)' paths > bad
stop bad "names that a test runner of this repository takes for a test"
awk -v p="$rel" -v m="$max_path" 'length(p $0) > m { print p $0 }' paths > bad
stop bad "paths longer than $max_path characters"
longest=$(awk -v p="$rel" '{ n = length(p $0); if (n > m) m = n } END { print m + 0 }' paths)

awk -F'\t' '{ split($1, m, " "); print m[3] }' target | G cat-file --batch-check='%(objectname) %(objecttype) %(objectsize)' > sizes
awk '$2 != "blob" { print $1 }' sizes > bad
stop bad "blobs that the clones do not hold (fetch them yourself, this script uses no network)"
awk '{ print $3 }' sizes | paste - paths > sized

echo "typescript-go $go_commit"
echo "TypeScript    $ts_commit"
echo "cases $(count cases), TypeScript error baselines $(count ts.errors), typescript-go error baselines $(count go.errors) of which $(count go.overlay) are copied, names in NO_ERRORS.txt $(count no_errors.txt)"
while read -r repo kind src dest; do
  awk -F'\t' -v d="$dest" '$2 == d || index($2, d "/") == 1 { n++; s += $1 } END { printf "%s\t%d files\t%.0f bytes\n", d, n, s }' sized
done < layout.txt
awk -F'\t' -v l="$longest" '{ s += $1 } END { printf "total\t%d files\t%.0f bytes, longest path %d\n", NR, s, l }' sized
if [ -s unmatched ]; then echo "not copied, no case has this name ($(count unmatched)):"; sed 's/^/  /' unmatched; fi

# Lists "<mode> blob <id><tab><path>" for the files on disk that this script owns.
current() {
  (
    cd "$here"
    set --
    if [ -e corpus ] || [ -L corpus ]; then set -- corpus; fi
    while read -r f; do if [ -e "$f" ] || [ -L "$f" ]; then set -- "$@" "$f"; fi; done < "$tmp/files"
    : > "$tmp/odd"; : > "$tmp/cur.paths"; : > "$tmp/cur.exec"
    if [ $# -gt 0 ]; then
      find "$@" ! -type f ! -type d > "$tmp/odd"
      find "$@" -type f | awk -F/ '!(NF == 2 && $1 == "corpus" && $2 ~ /^\./)' | sort > "$tmp/cur.paths"
      find "$@" -type f -perm -100 > "$tmp/cur.exec"
    fi
    git --git-dir="$tmp/repo/.git" hash-object --no-filters --stdin-paths < "$tmp/cur.paths" > "$tmp/cur.ids"
  )
  stop odd "neither a file nor a directory"
  if [ "$filemode" = false ]; then
    awk -F'\t' 'FILENAME == "target" { split($1, m, " "); mode[$2] = m[1]; next } { v = ($0 in mode) ? mode[$0] : "100644"; print v }' target cur.paths > cur.modes
  else
    awk 'FILENAME == "cur.exec" { x[$0] = 1; next } { v = ($0 in x) ? "100755" : "100644"; print v }' cur.exec cur.paths > cur.modes
  fi
  paste -d ' ' cur.modes cur.ids | sed 's/ / blob /' | paste - cur.paths
}

# Prints A, D or M and the path for every difference between the listing $1 and what $2 holds.
compare() {
  awk -F'\t' -v OFS='\t' -v first="$1" '
    FILENAME == first { t[$2] = $1; next }
    { c[$2] = $1 }
    END {
      for (k in t) if (!(k in c)) print "A", k; else if (t[k] != c[k]) print "M", k
      for (k in c) if (!(k in t)) print "D", k
    }' "$1" "$2" | sort -t"$tab" -k2
}

if [ "$mode" = verify ]; then
  git -C "$here" rev-parse --verify --quiet "$rev^{commit}" > /dev/null || die "$rev is not a commit of this repository"
  git -C "$here" -c core.quotePath=false ls-tree -r "$rev" -- corpus $(cat files) |
    awk -F'\t' '{ n = split($2, seg, "/"); if (!(n == 2 && seg[1] == "corpus" && seg[2] ~ /^\./)) print }' > ours
  compare target ours > changes
  if ! git -C "$here" cat-file -e "$rev:./UPSTREAM" 2> /dev/null; then printf 'A\tUPSTREAM\n' >> changes
  else
    git -C "$here" show "$rev:./UPSTREAM" > theirs
    if [ "$(pin go < theirs)" != "$go_commit" ] || [ "$(pin ts < theirs)" != "$ts_commit" ]; then printf 'M\tUPSTREAM\n' >> changes; fi
  fi
else
  current > ours
  compare target ours > changes
  if [ "$go_commit" != "$go_pin" ] || [ "$ts_commit" != "$ts_pin" ]; then printf 'M\tUPSTREAM\n' >> changes; fi
fi
sort -t"$tab" -k2 -o changes changes
cat changes
awk -F'\t' '$1 == "A" { a++ } $1 == "D" { d++ } $1 == "M" { m++ } END { printf "added %d, removed %d, changed %d\n", a, d, m }' changes

if [ "$mode" != verify ]; then
  awk -F'\t' -v OFS='\t' '$1 ~ /^100755 / { print "X", $2 }' target > notes
  if [ "$in_tree" = true ]; then
    { git -C "$here" -c core.quotePath=false check-ignore --no-index --stdin < paths || true; } | sed "s/^/I$tab/" >> notes
    git -C "$here" -c core.quotePath=false check-attr --stdin text < paths | awk '!/: text: unset$/' > loose
    if [ -s loose ]; then
      echo "sync.sh: warning: $(count loose) paths lack the attribute -text, so staging them can rewrite their line endings, first: $(awk 'NR == 1' loose)" >&2
    fi
  fi
  cat notes
  awk -F'\t' '$1 == "X" { x++ } $1 == "I" { i++ } END { printf "executable %d, ignored %d\n", x, i }' notes
fi

if [ "$mode" != sync ]; then
  if [ -s changes ]; then exit 1; fi
  exit 0
fi

awk -F'\t' '$1 == "D" { print $2 }' changes > gone
awk -F'\t' 'FILENAME == "changes" { if ($1 != "D") want[$2] = 1; next } $2 in want' changes target > write
if [ -s gone ]; then
  (cd "$here" && tr '\n' '\0' < "$tmp/gone" | xargs -0 rm -f -- && { find corpus -depth -type d -exec rmdir {} + 2> /dev/null || true; })
fi
if [ -s write ]; then
  GIT_INDEX_FILE=$tmp/index G update-index --index-info < write
  GIT_INDEX_FILE=$tmp/index G checkout-index -a -f --prefix="$here/"
fi
if [ -s gone ] || [ -s write ]; then
  current > ours
  compare target ours > bad
  stop bad "files that still differ from upstream after the rewrite"
fi
if [ "$go_commit" != "$go_pin" ] || [ "$ts_commit" != "$ts_pin" ]; then
  sed -e "s/$go_pin/$go_commit/g" -e "s/$ts_pin/$ts_commit/g" "$upstream" > UPSTREAM.new
  cat UPSTREAM.new > "$upstream"
  echo "UPSTREAM now pins typescript-go $go_commit and TypeScript $ts_commit"
fi
