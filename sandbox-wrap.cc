#include "sandbox-wrap.h"

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

  Nan::SetPrototypeMethod(tpl, "run", Run);

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

NAN_METHOD(SandboxWrap::Run) {
  const char *code = *Nan::Utf8String(info[0]);

  auto sandbox = std::unique_ptr<Sandbox>(new Sandbox);

  std::string result = sandbox->RunInSandbox(code);

  info.GetReturnValue().Set(Nan::New(result.c_str()).ToLocalChecked());

  /* return */
  /* std::string code = *Nan::Utf8String(info[0]); */

  /* /1* if (info.Length() >= 1 && info[1]->IsInt32()) { *1/ */
  /* /1*   flags = Nan::To<int>(info[1]).FromJust(); *1/ */
  /* /1* } *1/ */

  /* SandboxWrap* database = ObjectWrap::Unwrap<SandboxWrap>(info.Holder()); */

  /* Isolate::CreateParams create_params; */

  /* create_params.array_buffer_allocator = */
  /*     v8::ArrayBuffer::Allocator::NewDefaultAllocator(); */

  /* Isolate* isolate = Isolate::New(create_params); */

  /* Locker locker(isolate); */

  /* std::string data; */

  /* { */
  /*   Isolate::Scope isolate_scope(isolate); */
  /*   // Create a stack-allocated handle scope. */
  /*   HandleScope handle_scope(isolate); */
  /*   // Create a new context. */
  /*   Local<Context> context = Context::New(isolate); */
  /*   // Enter the context for compiling and running the hello world script. */
  /*   Context::Scope context_scope(context); */
  /*   // Create a string containing the JavaScript source code. */
  /*   Local<String> source = */
  /*       String::NewFromUtf8(isolate, "'Hello' + ', World!'", */
  /*                           NewStringType::kNormal).ToLocalChecked(); */
  /*   // Compile the source code. */
  /*   Local<Script> script = Script::Compile(context, source).ToLocalChecked(); */
  /*   // Run the script to get the result. */
  /*   Local<Value> result = script->Run(context).ToLocalChecked(); */
  /*   // Convert the result to an UTF8 string and print it. */
  /*   String::Utf8Value utf8(result); */

  /*   data = *utf8; */
  /* } */

  /* /1* isolate->Dispose(); *1/ */

  /* delete create_params.array_buffer_allocator; */

  /* info.GetReturnValue().Set(Nan::New(data.c_str()).ToLocalChecked()); */
}
