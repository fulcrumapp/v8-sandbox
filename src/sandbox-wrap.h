#ifndef __SANDBOX_WRAP_H__
#define __SANDBOX_WRAP_H__

#include <nan.h>
#include <vector>
#include "sandbox.h"

class SandboxWrap : public Nan::ObjectWrap {
  friend class SandboxInitializeWorker;
  friend class SandboxExecuteWorker;
  friend class SandboxFinalizeWorker;

public:
  static void Init(v8::Local<v8::Object> exports);

  Nan::Persistent<v8::Function>& GetBridge() { return bridge_; }

  node::Environment *GetEnvironment() { return environment_; }

  Isolate *GetNodeIsolate() { return nodeIsolate_; }

  Nan::Global<Context>& GetNodeContext() { return nodeContext_; }

  void *GetContextTag() { return contextTag_; }

private:
  Sandbox *sandbox_;

  explicit SandboxWrap();

  ~SandboxWrap();

  static NAN_METHOD(New);

  static NAN_METHOD(Initialize);

  static NAN_METHOD(Execute);

  static NAN_METHOD(Finalize);

  Nan::Persistent<v8::Function> bridge_;

  node::Environment *environment_;

  Isolate *nodeIsolate_;

  Nan::Global<Context> nodeContext_;

  void *contextTag_;

  static Nan::Persistent<v8::Function> constructor;
};

#endif
