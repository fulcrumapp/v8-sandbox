#ifndef __SANDBOX_EXECUTE_WORKER_H__
#define __SANDBOX_EXECUTE_WORKER_H__

#include <nan.h>
#include "sandbox-wrap.h"

class SandboxExecuteWorker : public Nan::AsyncWorker {
 public:
  SandboxExecuteWorker(Nan::Callback *callback, SandboxWrap *sandbox, const char *code);

  virtual ~SandboxExecuteWorker();

  void Execute() override;

  void HandleOKCallback() override;

 private:
  SandboxWrap *sandbox_;

  std::string code_;

  std::string result_;
};

#endif
