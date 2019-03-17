import Sandbox from './dist';
import path from 'path';

const sandbox = new Sandbox({require: path.join(process.cwd(), 'example-functions.js')});

const run = (code, callback) => {
  sandbox.execute(code, 1000, callback);
};

const example1 = `
setResult({value: [21, 22]});
`;

// call a custom synchronous host function
const example2 = `
setResult({value: dispatchSync('testSync', [1, 2])});
`;

// call a custom asynchronous host function
const example3 = `
dispatchAsync('testAsync', [1, 2], function(error, value) {
  setResult({error, value});
});
`;

run(example1, (err, result) => {
  console.log('example 1:', result);

  run(example2, (err, result) => {
    console.log('example 2:', result);

    run(example3, (err, result) => {
      console.log('example 3:', result);

      sandbox.shutdown();
    });
  });
});
