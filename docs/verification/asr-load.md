# Local ASR burst admission

Verified on 2026-10-01 using the actual installed Whisper tiny int8 CPU model and the existing synthetic standard male wait phrase, converted to mono 16 kHz with FFmpeg. No paid service or private recording was used.

`server/asr-load.test.ts` warms the model with one baseline request, launches 20 requests together, checks every admitted result against the baseline, checks excess requests are LocalTranscriberBusy, and retries after the queue drains. Four requests completed, sixteen were explicitly busy, and the later retry passed. Maximum observed terminal time for the warm burst was 494 ms. That value is one local measurement for a short synthetic clip; it is not a capacity, accuracy, cold-start or first-visit promise.

The actual-model test plus existing queue and API admission checks passed all five tests. The queue checks cover shared file/sample serialization, continuation after decode failure and excess admission; the API check verifies HTTP 429 and no transcript write on shared-model rejection. The actual-model burst itself invokes the model functions, not twenty HTTP uploads.

Remaining: mixed audio/photo preparation traffic, long and varied inputs, process-wide resource limits across multiple API/worker processes, crash recovery and cancellation, and device/network end-to-end measurements. The present single-process admission policy allows one active recognition plus three waiting requests. Do not report sixteen busy rejections as successful recognition or as twenty simultaneous model executions.
