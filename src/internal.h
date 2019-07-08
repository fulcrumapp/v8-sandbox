#ifndef __INTERNAL_H__
#define __INTERNAL_H__

#if NODE_MAJOR_VERSION <= 9
namespace v8 {
  namespace internal {
    class V8 {
     public:
       static Platform* GetCurrentPlatform();
    };
  }
}
#endif

#if NODE_MAJOR_VERSION <= 8 && NODE_MINOR_VERSION <= 11
namespace node {
  class NodePlatform {
  public:
    void DrainBackgroundTasks();
  };
}
#endif

#endif
