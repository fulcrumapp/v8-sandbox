#include "sandbox-finalize-worker.h"
#include "sandbox.h"
#include <iostream>

SandboxFinalizeWorker::SandboxFinalizeWorker(Nan::Callback *callback, SandboxWrap *sandbox)
    : AsyncWorker(callback),
      sandbox_(sandbox)
{}

SandboxFinalizeWorker::~SandboxFinalizeWorker()
{}

void SandboxFinalizeWorker::Execute() {
  if (sandbox_->sandbox_) {
    sandbox_->sandbox_->Finalize();
  }
}

void SandboxFinalizeWorker::HandleOKCallback() {
  Nan::HandleScope scope;

  v8::Local<v8::Value> argv[] = {};

  if (!callback->IsEmpty()) {
    Nan::Call(*callback, 0, argv);
  }
}
