#ifndef __SANDBOX_TERMINATE_WORKER_H__
#define __SANDBOX_TERMINATE_WORKER_H__

#include <nan.h>
#include "sandbox-wrap.h"

class SandboxTerminateWorker : public Nan::AsyncWorker {
public:
  SandboxTerminateWorker(Nan::Callback *callback, SandboxWrap *sandbox);

  virtual ~SandboxTerminateWorker();

  void Execute() override;

  void HandleOKCallback() override;

private:
  SandboxWrap *sandbox_;
};

#endif
