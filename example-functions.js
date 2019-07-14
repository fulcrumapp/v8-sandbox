// these functions have access to node and are callable from the sandbox

// Example of a synchronous function
define('addNumbers', (value1, value2) => {
  return value1 + value2;
});

// Example of an asynchronous function
defineAsync('addNumbersAsync', (value1, value2, callback) => {
  setTimeout(() => {
    callback(null, value1 + value2);
  }, 20);
});
