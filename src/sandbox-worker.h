#ifndef __SANDBOX_WORKER_H__
#define __SANDBOX_WORKER_H__

#include <nan.h>
#include "sandbox-wrap.h"

class SandboxWorker : public Nan::AsyncWorker {
 public:
  SandboxWorker(Nan::Callback *callback, SandboxWrap *sandbox, const char *code);

  virtual ~SandboxWorker();

  void Execute() override;

  void HandleOKCallback() override;

 private:
  SandboxWrap *sandbox_;

  std::string code_;

  std::string result_;
};

#endif
