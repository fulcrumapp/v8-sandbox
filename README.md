# v8-sandbox [![Build Status](https://travis-ci.org/fulcrumapp/v8-sandbox.svg?branch=master)](https://travis-ci.org/fulcrumapp/v8-sandbox)

Safely execute arbitrary untrusted Javascript. This module implements a hermetically sealed Javascript environment that can be used to run any Javascript code without being able to escape the sandbox. V8 is initialized and executed entirely from C++ so it's impossible for the JS stack frames to lead back to the nodejs environment. It's usable from a nodejs process, but the JS environment is pure V8 ECMA-262.

## Installation

```sh
npm install v8-sandbox
```

## API

```js
import Sandbox from 'v8-sandbox';

const sandbox = new Sandbox();

const js = `
setResult({value: 1});
`;

sandbox.execute(js, 3000, (err, value) => {
  console.log(value);
});
```
