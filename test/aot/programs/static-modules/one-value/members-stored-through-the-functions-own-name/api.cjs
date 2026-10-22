function api() {
  return api.count;
}
api.count = 0;
module.exports = api;
api.bump = () => ++api.count;
module.exports.reset = () => {
  api.count = 0;
};
