// This script tests the contents of fs.Dirent for all of the methods that return it.
// Compare running with node vs. running with Bun for compatibility.

const fs = require('fs');

// From the working directory, create a collection of files and folders for testing.
const target = process.argv[2];

// pass arguments:
// /tmp/test
// ./test
// test
// .
// ../../test
// ..

// path is always identical to the argument except for recursive entries
// For recursed entries, a leading `./` is not included

fs.mkdirSync(target + '/subfolder/childfolder', { recursive: true });
fs.writeFileSync(target + '/file.txt', 'test');
fs.writeFileSync(target + '/subfolder/childfile.txt', 'test');

let results = {};
function mapFiles(files) {
  return files.map(f => ({ name: f.name, path: f.path }))
    .toSorted((a, b) => a.path+'/'+a.name < b.path+'/'+b.name);
}

results['fs.readdirSync'] = mapFiles(fs.readdirSync(target, { withFileTypes: true }));
results['fs.readdirSync recursive'] = mapFiles(fs.readdirSync(target, { withFileTypes: true, recursive: true }));
fs.promises.readdir(target, { withFileTypes: true, recursive: true })
  .then(files => {
    results['fs.promises.readdir recursive'] = mapFiles(files);
    console.log(results);
  });

