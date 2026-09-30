#!/bin/sh
set -eu

root=.models/sherpa-onnx-paraformer-zh-2023-09-14
base=https://huggingface.co/csukuangfj/sherpa-onnx-paraformer-zh-2023-09-14/resolve/def027084691107096b5ebba69785756d63de6c5
mkdir -p "$root"
curl -fL --retry 2 -o "$root/model.int8.onnx" "$base/model.int8.onnx"
curl -fL --retry 2 -o "$root/tokens.txt" "$base/tokens.txt"
printf '%s  %s\n' 'f36a0433bcf096bd6d6f11b80a3ac8bed110bdca632fe0d731df8d1a84475945' "$root/model.int8.onnx" '59aba8873a2ed1e122c25fee421e25f283b63290efbde85c1f01a853d83cb6e6' "$root/tokens.txt" | shasum -a 256 -c
