#include "sandbox.h"

std::string RunIsolate(Isolate* isolate, const char *code) {
  Locker locker(isolate);

  Isolate::Scope isolate_scope(isolate);

  HandleScope handle_scope(isolate);

  Local<Context> context = Context::New(isolate);

  Context::Scope context_scope(context);

  Local<String> source = Nan::New(code).ToLocalChecked();

  Local<Script> script = Script::Compile(context, source).ToLocalChecked();

  Local<Value> result = script->Run(context).ToLocalChecked();

  String::Utf8Value utf8(result);

  return std::string(*utf8);
}

Sandbox::Sandbox() : params_() {
  params_.array_buffer_allocator = ArrayBuffer::Allocator::NewDefaultAllocator();

  isolate_ = Isolate::New(params_);
}

Sandbox::~Sandbox() {
  if (isolate_) {
    isolate_->Dispose();
  }

  delete params_.array_buffer_allocator;
}

std::string Sandbox::RunInSandbox(const char *code) {
  return RunIsolate(isolate_, code);
}
