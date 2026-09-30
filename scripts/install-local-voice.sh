#!/bin/sh
set -eu

mkdir -p .models
archive=.models/kokoro-int8-multi-lang-v1_1.tar.bz2
curl -fL --retry 2 -o "$archive" https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-multi-lang-v1_1.tar.bz2
printf '%s  %s\n' 'a1e94694776049035c4f2c6529f003aaece993c76aae9a78995831c3c4dcafc6' "$archive" | shasum -a 256 -c
tar xjf "$archive" -C .models
