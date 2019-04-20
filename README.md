# v8-sandbox

[![Build Status](https://travis-ci.org/fulcrumapp/v8-sandbox.svg?branch=master)](https://travis-ci.org/fulcrumapp/v8-sandbox)
[![Build status](https://ci.appveyor.com/api/projects/status/1drnn1nksas414gr?svg=true)](https://ci.appveyor.com/project/Fulcrum/v8-sandbox)


Safely execute arbitrary untrusted Javascript. This module implements a hermetically sealed Javascript environment that can be used to run any Javascript code without being able to escape the sandbox. V8 is initialized and executed entirely from C++ so it's impossible for the JS stack frames to lead back to the nodejs environment. It's usable from a nodejs process, but the JS environment is pure V8 ECMA-262.

## Installation

```sh
npm install v8-sandbox
```

## API

```js
import Sandbox from 'v8-sandbox';

const sandbox = new Sandbox();

const code = `

// arbitrary JS, call setResult to set the final result of the script to accommodate async code
setResult({value: 1});

`;

sandbox.execute({code, timeout: 3000}, (err, value) => {
  console.log(value);
});
```

```js
import Sandbox from 'v8-sandbox';

const sandbox = new Sandbox();

const code = `

while (true) {}

`;

sandbox.execute({code, timeout: 3000}, (err, value) => {
  // timeout
  console.log(err.isTimeout);
});
```
