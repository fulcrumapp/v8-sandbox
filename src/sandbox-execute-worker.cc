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
  result_ = sandbox_->sandbox_->RunInSandbox(code_.c_str());
}

void SandboxExecuteWorker::HandleOKCallback() {
  Nan::HandleScope scope;

  v8::Local<v8::Value> argv[] = {
    Nan::New(result_.c_str()).ToLocalChecked()
  };

  if (!callback->IsEmpty()) {
    Nan::Call(*callback, 1, argv);
  }
}
