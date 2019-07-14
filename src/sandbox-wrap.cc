#include "sandbox-wrap.h"
#include "sandbox-initialize-worker.h"
#include "sandbox-execute-worker.h"
#include "sandbox-finalize-worker.h"
#include "common.h"

#include <iostream>
#include <memory>
#include <v8.h>

#include "sandbox.h"

using namespace v8;

Nan::Persistent<v8::Function> SandboxWrap::constructor;

SandboxWrap::SandboxWrap()
  : sandbox_(new Sandbox())
{
}

SandboxWrap::~SandboxWrap() {
  delete sandbox_;
}

void SandboxWrap::Init(v8::Local<v8::Object> exports) {
  Nan::HandleScope scope;

  v8::Local<v8::FunctionTemplate> tpl = Nan::New<v8::FunctionTemplate>(New);
  tpl->SetClassName(Nan::New("Sandbox").ToLocalChecked());
  tpl->InstanceTemplate()->SetInternalFieldCount(1);

  Nan::SetPrototypeMethod(tpl, "initialize", Initialize);
  Nan::SetPrototypeMethod(tpl, "execute", Execute);
  Nan::SetPrototypeMethod(tpl, "finalize", Finalize);

  auto function = Nan::GetFunction(tpl).ToLocalChecked();

  constructor.Reset(function);

  Nan::Set(exports, Nan::New("Sandbox").ToLocalChecked(), function);
}

NAN_METHOD(SandboxWrap::New) {
  if (info.IsConstructCall()) {
    SandboxWrap *obj = new SandboxWrap();
    obj->Wrap(info.This());
    info.GetReturnValue().Set(info.This());
  } else {
    const int argc = 1;
    v8::Local<v8::Value> argv[argc] = { info[0] };
    v8::Local<v8::Function> cons = Nan::New<v8::Function>(constructor);
    info.GetReturnValue().Set(Nan::NewInstance(cons, argc, argv).ToLocalChecked());
  }
}

NAN_METHOD(SandboxWrap::Initialize) {
  NODE_ARG_STRING(0, "runtime");
  NODE_ARG_FUNCTION(1, "callback");

  Nan::Utf8String runtime(info[0]);

  SandboxWrap* sandbox = ObjectWrap::Unwrap<SandboxWrap>(info.Holder());

  Nan::Callback *callback = new Nan::Callback(info[1].As<v8::Function>());

  sandbox->bridge_.Reset(info[2].As<v8::Function>());

  Nan::AsyncQueueWorker(new SandboxInitializeWorker(callback, sandbox, *runtime));

  info.GetReturnValue().Set(info.This());
}

NAN_METHOD(SandboxWrap::Execute) {
  NODE_ARG_STRING(0, "code");
  NODE_ARG_FUNCTION(1, "callback");

  Nan::Utf8String code(info[0]);

  SandboxWrap* sandbox = ObjectWrap::Unwrap<SandboxWrap>(info.Holder());

  Nan::Callback *callback = new Nan::Callback(info[1].As<v8::Function>());

  sandbox->bridge_.Reset(info[2].As<v8::Function>());

  Nan::AsyncQueueWorker(new SandboxExecuteWorker(callback, sandbox, *code));

  info.GetReturnValue().Set(info.This());
}

NAN_METHOD(SandboxWrap::Finalize) {
  NODE_ARG_FUNCTION(0, "callback");

  SandboxWrap* sandbox = ObjectWrap::Unwrap<SandboxWrap>(info.Holder());

  Nan::Callback *callback = new Nan::Callback(info[0].As<v8::Function>());

  sandbox->bridge_.Reset(info[1].As<v8::Function>());

  Nan::AsyncQueueWorker(new SandboxFinalizeWorker(callback, sandbox));

  info.GetReturnValue().Set(info.This());
}
