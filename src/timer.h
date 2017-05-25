#ifndef __TIMER_H__
#define __TIMER_H__

#include <nan.h>

class Timer;

typedef void (*TimerCallback)(Timer* timer);

class Timer {
public:
  Timer(uv_loop_t *loop, void *data);

  int Start(TimerCallback callback, uint64_t timeout, uint64_t repeat);

  int Stop(TimerCallback callback);

  ~Timer();

  void *GetData();

private:
  static void OnTimer(uv_timer_t *handle);

  static void OnTimerClose(uv_handle_t *handle);

  uv_timer_t timer_;
  void *data_;
  TimerCallback callback_;
  TimerCallback closeCallback_;
  bool closing_;
};

#endif
