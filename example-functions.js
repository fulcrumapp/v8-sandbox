// these functions have access to node and are callable from the sandbox

$exports.testSync = function(v1, v2) {
  return [20 + v1, 20 + v2];
}

$exports.testAsync = function(v1, v2, callback) {
  setTimeout(() => {
    callback(null, [20 + v1, 20 + v2]);
  }, 500);
}
