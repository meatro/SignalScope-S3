#pragma once

#include <cstddef>
#include <cstdint>

#include "types.hpp"

namespace bored::signalscope {

class MutationEngine {
public:
    static constexpr size_t kMaxMutations = 128;

    void init();
    bool stageMutation(const SignalMutation& mutation);
    void clearStaging();
    void revertStagingToActive();
    bool applyCommit();

    size_t stagingCount() const;
    size_t activeCount() const;

    const SignalMutation* lookup(
        uint32_t can_id,
        Direction direction,
        uint16_t start_bit,
        uint8_t length) const;

    const SignalMutation* activeAt(size_t index) const;
    bool setMutationEnabled(
        uint32_t can_id,
        Direction direction,
        uint16_t start_bit,
        uint8_t length,
        bool enabled);

    size_t applyFrameMutations(CanFrame& frame) const;

private:
    static constexpr size_t kBucketCount = 64;

    static uint32_t keyHash(uint32_t can_id, Direction direction);
    void rebuildIndex();

    SignalMutation staging_[kMaxMutations];
    size_t staging_count_ = 0;

    SignalMutation active_[kMaxMutations];
    size_t active_count_ = 0;

    int16_t bucket_head_[kBucketCount];
    int16_t next_[kMaxMutations];
};

}  // namespace bored::signalscope
