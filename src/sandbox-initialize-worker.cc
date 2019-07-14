#include "sandbox-initialize-worker.h"
#include "sandbox.h"
#include <iostream>

SandboxInitializeWorker::SandboxInitializeWorker(Nan::Callback *callback, SandboxWrap *sandbox, const char *runtime)
    : AsyncWorker(callback),
      sandbox_(sandbox),
      runtime_(runtime),
      result_()
{}

SandboxInitializeWorker::~SandboxInitializeWorker()
{}

void SandboxInitializeWorker::Execute() {
  if (sandbox_->sandbox_) {
    result_ = sandbox_->sandbox_->Initialize(sandbox_, runtime_.c_str());
  }
}

void SandboxInitializeWorker::HandleOKCallback() {
  Nan::HandleScope scope;

  v8::Local<v8::Value> argv[] = {
    Nan::New(result_.c_str()).ToLocalChecked()
  };

  if (!callback->IsEmpty()) {
    Nan::Call(*callback, 1, argv);
  }
}
