// these functions have access to node and are callable from the sandbox

const fs = require('fs');

// Example of a synchronous function
define('addNumbers', ([ value1, value2 ], { respond }) => {
  respond(value1 + value2);
});

// Example of a blocking function. It's a synchronous function for the sandbox, but asynchronous to the host
define('addNumbersBlocking', ([ value1, value2 ], { respond }) => {
  setTimeout(() => {
    respond(value1 + value2);
  }, 1);
});

// Example of an asynchronous function
defineAsync('addNumbersAsync', ([ value1, value2 ], { respond, callback }) => {
  setTimeout(() => {
    callback(null, value1 + value2);
  }, 20);

  respond();
});

defineAsync('errorAsync', ({ callback }) => {
  throw new Error('hi');
});
