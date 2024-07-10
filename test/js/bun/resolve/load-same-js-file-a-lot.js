// make sure an import.meta is available
export default {
  url: import.meta.url.toLocaleLowerCase(),
  dir: import.meta.dir.toLocaleLowerCase(),
  file: import.meta.file.toLocaleLowerCase(),
  path: import.meta.path.toLocaleLowerCase(),
  dirname: import.meta.dirname.toLocaleLowerCase(),
  filename: import.meta.filename.toLocaleLowerCase(),
};
