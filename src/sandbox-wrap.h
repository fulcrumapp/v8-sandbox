#ifndef __SANDBOX_WRAP_H__
#define __SANDBOX_WRAP_H__

#include <nan.h>
#include <vector>

class SandboxWrap : public Nan::ObjectWrap {
public:
  static void Init(v8::Local<v8::Object> exports);

  Nan::Persistent<v8::Function>& GetBridge() { return bridge_; }
private:
  explicit SandboxWrap();

  ~SandboxWrap();

  static NAN_METHOD(New);

  static NAN_METHOD(Run);

  Nan::Persistent<v8::Function> bridge_;

  static Nan::Persistent<v8::Function> constructor;
};

#endif
