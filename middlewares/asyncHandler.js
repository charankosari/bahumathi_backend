// Wraps async controllers to avoid try/catch in every function
module.exports = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
