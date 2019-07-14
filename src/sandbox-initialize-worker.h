#ifndef __SANDBOX_INITIALIZE_WORKER_H__
#define __SANDBOX_INITIALIZE_WORKER_H__

#include <nan.h>
#include "sandbox-wrap.h"

class SandboxInitializeWorker : public Nan::AsyncWorker {
public:
  SandboxInitializeWorker(Nan::Callback *callback, SandboxWrap *sandbox, const char *runtime);

  virtual ~SandboxInitializeWorker();

  void Execute() override;

  void HandleOKCallback() override;

private:
  SandboxWrap *sandbox_;

  std::string runtime_;

  std::string result_;
};

#endif
