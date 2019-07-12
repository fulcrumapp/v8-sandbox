#ifndef __SANDBOX_FINALIZE_WORKER_H__
#define __SANDBOX_FINALIZE_WORKER_H__

#include <nan.h>
#include "sandbox-wrap.h"

class SandboxFinalizeWorker : public Nan::AsyncWorker {
public:
  SandboxFinalizeWorker(Nan::Callback *callback, SandboxWrap *sandbox);

  virtual ~SandboxFinalizeWorker();

  void Execute() override;

  void HandleOKCallback() override;

private:
  SandboxWrap *sandbox_;
};

#endif

