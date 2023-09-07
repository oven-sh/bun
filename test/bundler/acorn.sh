set -e
cd $(dirname $(realpath $0))

if [ -z "$BUN_EXE" ]; then
  BUN_EXE=$(which bun-debug 2>/dev/null || which bun 2>/dev/null)
fi
export BUN_EXE

commit=96c721dbf89d0ccc3a8c7f39e69ef2a6a3c04dfa

if [ ! -d "github/acorn" ]; then
  mkdir -p github/acorn
  cd github/acorn
  git init
  git remote add origin https://github.com/acornjs/acorn.git
  git fetch --depth 1 origin $commit
  git -c advice.detachedHead=false checkout FETCH_HEAD
else 
  cd github/acorn
  git reset --hard $commit
fi

patch -p1 < ../../acorn.patch

rm -rf node_modules
BUN_DEBUG_QUIET_LOGS=1 bun i

# test 1: bundle and minify
bun build acorn/src/index.js --target=node --minify > acorn/dist/acorn.mjs
bun build acorn-loose/src/index.js --target=node --minify > acorn-loose/dist/acorn-loose.mjs
node test/run.js

# test 2: minify every source file
minify_in_place() {
  for file in $(find $1 -name '*.js'); do
    echo "minifying $file"
    bun build $file --target=node --minify --external '*' > $file.min.js
    bun build $file.min.js > /dev/null
    mv $file.min.js $file
  done
}
minify_in_place acorn/src
minify_in_place acorn-loose/src
# oddity, the minified stuff here wont be handled by rollup for syntax error, but theres no syntax errors in the files
bun build acorn/src/index.js --target=node --minify > acorn/dist/acorn.mjs
bun build acorn-loose/src/index.js --target=node --minify > acorn-loose/dist/acorn-loose.mjs
node test/run.js
