#include "sandbox-worker.h"
#include "sandbox.h"
#include <iostream>

SandboxWorker::SandboxWorker(Nan::Callback *callback, SandboxWrap *sandbox, const char *code)
    : AsyncWorker(callback),
      sandbox_(sandbox),
      code_(code),
      result_()
{}

SandboxWorker::~SandboxWorker()
{}

void SandboxWorker::Execute() {
  Sandbox box;

  result_ = box.RunInSandbox(code_.c_str(), sandbox_);
}

void SandboxWorker::HandleOKCallback() {
  Nan::HandleScope scope;

  v8::Local<v8::Value> argv[] = {
    Nan::Null(),
    Nan::New(result_.c_str()).ToLocalChecked()
  };

  callback->Call(2, argv);
}
