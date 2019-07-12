#include "sandbox-initialize-worker.h"
#include "sandbox.h"
#include <iostream>

SandboxInitializeWorker::SandboxInitializeWorker(Nan::Callback *callback, SandboxWrap *sandbox)
    : AsyncWorker(callback),
      sandbox_(sandbox)
{}

SandboxInitializeWorker::~SandboxInitializeWorker()
{}

void SandboxInitializeWorker::Execute() {
  if (sandbox_->sandbox_) {
    sandbox_->sandbox_->Initialize(sandbox_);
  }
}

void SandboxInitializeWorker::HandleOKCallback() {
  Nan::HandleScope scope;

  v8::Local<v8::Value> argv[] = {};

  if (!callback->IsEmpty()) {
    Nan::Call(*callback, 0, argv);
  }
}
