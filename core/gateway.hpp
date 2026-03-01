#pragma once

#include <cstddef>
#include <cstdint>

#include "types.hpp"

namespace bored::signalscope {

class MutationEngine;
class ReplayEngine;

struct GatewayStats {
    uint32_t forwarded_frames = 0;
    uint32_t replay_injected_frames = 0;
    uint32_t mutation_applied_frames = 0;
    uint32_t dropped_frames = 0;
    uint16_t rx_queue_depth = 0;
};

class GatewayCore {
public:
    using TxDriver = bool (*)(Direction tx_direction, const CanFrame& frame);

    static constexpr size_t kRxQueueSize = 128;

    void init();
    void setMutationEngine(MutationEngine* engine);
    void setReplayEngine(ReplayEngine* engine);
    void setTxDriver(TxDriver driver);

    bool onFrameReceivedFromIsr(const CanFrame& frame);
    bool injectReplayFrame(const CanFrame& frame);

    void pollRx(uint32_t now_us);

    const GatewayStats& stats() const;

private:
    void forwardFrame(CanFrame& frame, bool from_replay);
    static uint16_t nextIndex(uint16_t index);

    CanFrame rx_queue_[kRxQueueSize];
    volatile uint16_t queue_head_ = 0;
    volatile uint16_t queue_tail_ = 0;

    MutationEngine* mutation_engine_ = nullptr;
    ReplayEngine* replay_engine_ = nullptr;
    TxDriver tx_driver_ = nullptr;

    GatewayStats stats_{};
};

}  // namespace bored::signalscope
