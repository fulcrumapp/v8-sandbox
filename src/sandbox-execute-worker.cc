#include "sandbox-execute-worker.h"
#include "sandbox.h"
#include <iostream>

SandboxExecuteWorker::SandboxExecuteWorker(Nan::Callback *callback, SandboxWrap *sandbox, const char *code)
    : AsyncWorker(callback),
      sandbox_(sandbox),
      code_(code),
      result_()
{}

SandboxExecuteWorker::~SandboxExecuteWorker()
{}

void SandboxExecuteWorker::Execute() {
  Sandbox box;

  sandbox_->sandbox_ = &box;

  result_ = box.RunInSandbox(code_.c_str(), sandbox_);
}

void SandboxExecuteWorker::HandleOKCallback() {
  Nan::HandleScope scope;

  v8::Local<v8::Value> argv[] = {
    Nan::Null(),
    Nan::New(result_.c_str()).ToLocalChecked()
  };

  callback->Call(2, argv);
}
