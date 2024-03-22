// We use a relatively random string for the stderr flag.
// Just to avoid matching against something in the executable path.
const use_err = process.argv.includes("print_to_stderr_skmxctoznf");

const log_method = use_err ? console.error : console.log;

class MyMap extends Map {
  get size() {
    log_method("inside size");
    return 0;
  }
}

const map = new MyMap();

log_method("map:", map);
