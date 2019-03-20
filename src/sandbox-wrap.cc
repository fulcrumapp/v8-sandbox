#include "sandbox-wrap.h"
#include "sandbox-execute-worker.h"
#include "sandbox-terminate-worker.h"
#include "common.h"

#include <iostream>
#include <memory>
#include <v8.h>

#include "sandbox.h"

using namespace v8;

Nan::Persistent<v8::Function> SandboxWrap::constructor;

SandboxWrap::SandboxWrap() {
}

SandboxWrap::~SandboxWrap() {
}

void SandboxWrap::Init(v8::Local<v8::Object> exports) {
  Nan::HandleScope scope;

  v8::Local<v8::FunctionTemplate> tpl = Nan::New<v8::FunctionTemplate>(New);
  tpl->SetClassName(Nan::New("Sandbox").ToLocalChecked());
  tpl->InstanceTemplate()->SetInternalFieldCount(1);

  Nan::SetPrototypeMethod(tpl, "execute", Execute);
  Nan::SetPrototypeMethod(tpl, "terminate", Terminate);

  constructor.Reset(tpl->GetFunction());

  exports->Set(Nan::New("Sandbox").ToLocalChecked(), tpl->GetFunction());
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

NAN_METHOD(SandboxWrap::Terminate) {
  NODE_ARG_FUNCTION(0, "callback");

  SandboxWrap* sandbox = ObjectWrap::Unwrap<SandboxWrap>(info.Holder());

  Nan::Callback *callback = new Nan::Callback(info[0].As<v8::Function>());

  Nan::AsyncQueueWorker(new SandboxTerminateWorker(callback, sandbox));

  info.GetReturnValue().Set(info.This());
}
