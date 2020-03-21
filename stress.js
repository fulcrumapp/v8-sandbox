const Sandbox = require('./dist').default;
const assert = require('assert');
const path = require('path');

const REQUIRE = path.join(__dirname, 'test', 'test-functions.js');

const sandbox = new Sandbox({ require: REQUIRE });

const code = `
let counter = 0;

const randomTimeout = () => Math.floor(Math.random() * 5) + 1;

for (let i = 0; i < 50000; ++i) {
  setTimeout(() => {
    counter++;

    if (counter === 50000) {
      setResult({ value: { result: addNumbers(1, 2), count: counter } });
    }
  }, randomTimeout());
}
`;

(async function() {
  const { value, error, output } = await sandbox.execute({ code, timeout: 300000 });

  if (error) {
    console.log('ERROR', error);
  }

  assert.equal(value.result, 3);
  assert.equal(value.count, 50000);

  sandbox.shutdown();
}());

