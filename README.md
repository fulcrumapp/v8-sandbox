# v8-sandbox

[![Build Status](https://travis-ci.org/fulcrumapp/v8-sandbox.svg?branch=master)](https://travis-ci.org/fulcrumapp/v8-sandbox)
[![Build status](https://ci.appveyor.com/api/projects/status/1drnn1nksas414gr?svg=true)](https://ci.appveyor.com/project/Fulcrum/v8-sandbox)


Safely execute arbitrary untrusted JavaScript. This module implements an isolated JavaScript environment that can be used to run any code without being able to escape the sandbox. The V8 context is initialized and executed entirely from C++ so it's impossible for the JS stack frames to lead back to the nodejs environment. It's usable from a nodejs process, but the JS environment is pure V8. The sandboxed V8 context is executed from a separate nodejs process to enable full support for script timeouts.

It's intentionally not possible to expose any nodejs objects or functions directly to the sandbox. This makes it slightly harder to integrate into a project, but has the benefit of guaranteed isolation. There is however a mechanism to invoke host functions from the sandbox using the `require` constructor option of the Sandbox. The host dispatch feature uses JSON serialization over IPC for all parameters and return values so it's not possible to pass any object references between the environments. All communication between the sandbox instance of V8 and the nodejs instance of V8 is done through JSON serialization to completely prevent leaking any references into the sandbox. See `example.js` and `example-functions.js` for a sample of how to expose nodejs functions to the sandbox.

## Features

* Isolated sandbox for executing arbitrary JS
* Asynchronous function support (e.g. `setTimeout` and `httpRequest`). The built-in `setResult` function defines the final result of the sandbox execution
* Optional worker cluster for parallel execution of multiple scripts
* Timeout support
* Expose nodejs functionality selectively using `require` parameter `new Sandbox({require: 'path-to-file.js'})`. This file will be required by the workers and define both synchronous and asynchronous functions that can be called from the sandbox. See `example.js` and `example-functions.js` for a sample of how to expose native functions to the sandbox.
* Support for a `template` script that gets executed upon initialization of each sandbox instance. This is useful if you have large libraries or setup code before calling the user code. When using this library in a web app, this feature can massively improve performance since a worker will be "pre-warmed" with your setup code by the time you execute the actual user code.

## Installation

```sh
npm install v8-sandbox
```

## API

```js
import Sandbox from 'v8-sandbox';

const sandbox = new Sandbox();

const code = `
let numberValue = 1;

setTimeout(() => {
  // call setResult to set the final result of the script to accommodate async code
  setResult({value: numberValue + 1});
}, 20);
`;

(async () => {
  const {error, value} = await sandbox.execute({code, timeout: 3000});

  sandbox.shutdown();

  console.log(value);
  //=> 2
})();
```

```js
import Sandbox from 'v8-sandbox';

const sandbox = new Sandbox();

const code = 'while (true) {}';

(async () => {
  const {error, value} = await sandbox.execute({code, timeout: 3000});

  console.log(error.isTimeout);
  //=> true
})();
```
