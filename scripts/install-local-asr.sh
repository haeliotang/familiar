#!/bin/sh
set -eu

mkdir -p .models
archive=.models/sherpa-onnx-whisper-tiny.tar.bz2
curl -fL --retry 2 -o "$archive" https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-tiny.tar.bz2
printf '%s  %s\n' 'c46116994e539aa165266d96b325252728429c12535eb9d8b6a2b10f129e66b1' "$archive" | shasum -a 256 -c
tar xjf "$archive" -C .models
