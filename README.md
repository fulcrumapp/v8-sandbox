# v8-sandbox

[![Build Status](https://travis-ci.org/fulcrumapp/v8-sandbox.svg?branch=master)](https://travis-ci.org/fulcrumapp/v8-sandbox)
[![Build status](https://ci.appveyor.com/api/projects/status/1drnn1nksas414gr?svg=true)](https://ci.appveyor.com/project/Fulcrum/v8-sandbox)


Safely execute arbitrary untrusted Javascript. This module implements a hermetically sealed Javascript environment that can be used to run any Javascript code without being able to escape the sandbox. V8 is initialized and executed entirely from C++ so it's impossible for the JS stack frames to lead back to the nodejs environment. It's usable from a nodejs process, but the JS environment is pure V8 ECMA-262.

It's intentionally not possible to expose any nodejs objects or functions directly to the sandbox. There is a mechanism to invoke host functions via `dispatchSync` and `dispatchAsync` functions in the sandbox. Those must correlate with functions defined in a file passed to the `require` constructor option of the Sandbox. The dispatch feature uses JSON serialization for all parameters so it's not possible to pass any object references between the environments. All communication between the sandbox instance of V8 and the nodejs instance of V8 is done through JSON serialization.

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

const {error, value} = await sandbox.execute({code, timeout: 3000});

console.log(value);
//=> 2
```

```js
import Sandbox from 'v8-sandbox';

const sandbox = new Sandbox();

const code = 'while (true) {}';

const {error, value} = await sandbox.execute({code, timeout: 3000});

console.log(error.isTimeout);
//=> true
```
