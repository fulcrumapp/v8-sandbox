#ifndef __SANDBOX_WRAP_H__
#define __SANDBOX_WRAP_H__

#include <nan.h>
#include <vector>
#include "sandbox.h"

class SandboxWrap : public Nan::ObjectWrap {
  friend class SandboxExecuteWorker;
  friend class SandboxTerminateWorker;

public:
  static void Init(v8::Local<v8::Object> exports);

  Nan::Persistent<v8::Function>& GetBridge() { return bridge_; }
private:
  Sandbox *sandbox_;

  explicit SandboxWrap();

  ~SandboxWrap();

  static NAN_METHOD(New);

  static NAN_METHOD(Execute);

  static NAN_METHOD(Terminate);

  Nan::Persistent<v8::Function> bridge_;

  static Nan::Persistent<v8::Function> constructor;
};

#endif
