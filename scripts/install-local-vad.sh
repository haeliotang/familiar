#!/bin/sh
set -eu

mkdir -p .models
model=.models/silero-vad-v4.onnx
curl -fL --retry 2 -o "$model" https://raw.githubusercontent.com/snakers4/silero-vad/v4.0/files/silero_vad.onnx
printf '%s  %s\n' 'a35ebf52fd3ce5f1469b2a36158dba761bc47b973ea3382b3186ca15b1f5af28' "$model" | shasum -a 256 -c
