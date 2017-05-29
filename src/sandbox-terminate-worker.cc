#include "sandbox-terminate-worker.h"
#include "sandbox.h"
#include <iostream>

SandboxTerminateWorker::SandboxTerminateWorker(Nan::Callback *callback, SandboxWrap *sandbox)
    : AsyncWorker(callback),
      sandbox_(sandbox)
{}

SandboxTerminateWorker::~SandboxTerminateWorker()
{}

void SandboxTerminateWorker::Execute() {
  sandbox_->sandbox_->Terminate();
}

void SandboxTerminateWorker::HandleOKCallback() {
  Nan::HandleScope scope;

  v8::Local<v8::Value> argv[] = {
    Nan::Null()
  };

  if (!callback->IsEmpty()) {
    callback->Call(1, argv);
  }
}
