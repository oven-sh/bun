function publish() {
  module.exports = () => "in a function";
}
publish();
module.exports.member = 1;
