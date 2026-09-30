# 本地依赖与模型记录

记录日期：2026-09-30。此文件记录当前本地原型，不代表 M0 真机、供应商或兼容性门槛通过。

| 项目 | 实际版本 |
| --- | --- |
| Node | 24.11.0 |
| pnpm | 10.32.1 |
| React / React DOM | 19.3.0 |
| Three.js | 0.180.0 |
| Vite | 7.3.6 |
| TypeScript | 5.9.3 |
| sherpa-onnx-node | 1.13.8 |
| Fastify | 5.12.5 |
| pg | 8.23.0 |
| PGlite | 0.5.8 |
| sharp | 0.35.5 |
| Vitest | 3.2.7 |
| Spark | 尚未接入 |
| 浏览器 | Codex 内置浏览器；引擎版本尚未记录，不能作为目标设备版本 |

安装使用 `pnpm install --frozen-lockfile`，完整解析结果保存在 `pnpm-lock.yaml`。

锁文件 SHA-256：`8713d0c48db9d01132c386b2a2ae4f4513fe2a2ee38390167ad7debba9e52d1f`。

## 本地模型

无远程模型 API 或浮动模型别名。下载来源及压缩包校验值见两个模型安装脚本。

| 文件 | SHA-256 |
| --- | --- |
| Kokoro multilingual v1.1 int8 model | bda15858163726a492d02a9a727bc263551b86ac77f90812c4b30ff41d380e26 |
| Whisper tiny int8 encoder | d24fb083ae3b1041fc24e97971d60e280c9342201fbb67b0ab428a8b4a51a434 |
| Whisper tiny int8 decoder | d2fece8dd42771f1df975c6c0445770d0c292bf7547c2cae04a6c0cc57540925 |

## 角色素材候选

Quaternius Universal Base Characters Standard：CC0-1.0；导入模型、压缩包与 GLB 校验值、纹理修正记录见 `public/assets/quaternius/base-character-v1/provenance.json`。该基础模型有骨骼但无内嵌动作；其头部与独立衣物、重定向动作已组成当前本地场景候选，尚未通过正式发布审核。


新增女性候选：来源同一 CC0 官方 Standard ZIP；基础模型与衣物导入记录见 `public/assets/quaternius/base-female-v1/provenance.json` 和 `peasant-female-v1/provenance.json`。压缩记录见 `optimization-female.json`，运行时组合清单见 `female-candidate-package.json`，固定角色资源指纹在 `src/avatar-catalog.ts`。新增声音版本 `kokoro-zh-zf001-v1` 使用已有 Kokoro 模型与运行库的 speaker 3，本地保留 WAV 与指纹，没有新增代码依赖。当前未通过完整角色、声音或设备验收。

## 本地 HEIC 解码

新增运行工具要求：`heif-convert`，本机实际报告 libheif 1.23.2；由现有运行环境提供，未新增 npm 依赖。部署需要自行提供该工具并复验。合成 HEIC 验证范围与限制见 `docs/verification/heic-normalization.md`。

## 本地语音活动检测

Silero VAD v4.0，MIT，官方权重来源 https://raw.githubusercontent.com/snakers4/silero-vad/v4.0/files/silero_vad.onnx ，SHA-256 `a35ebf52fd3ce5f1469b2a36158dba761bc47b973ea3382b3186ca15b1f5af28`，约 1.72 MiB。安装入口 `sh scripts/install-local-vad.sh`，路径 `.models/silero-vad-v4.onnx`。复用 sherpa-onnx-node，无新增 npm 依赖；每次推理前核对模型指纹。源码与许可证：https://github.com/snakers4/silero-vad/tree/v4.0 。

## 可选独立语音诊断模型

2026-10-01，Paraformer 中文/英文 2023-09-14 int8，用途为合成语音样片的独立识别诊断。来源为 [sherpa 官方模型文档](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/offline-paraformer/paraformer-models.html) 指向的发布者模型；[模型卡](https://huggingface.co/csukuangfj/sherpa-onnx-paraformer-zh-2023-09-14) 标注 Apache-2.0。固定仓库 revision `def027084691107096b5ebba69785756d63de6c5`，模型大小 243371218 字节，下载后本地复核 SHA。复用 sherpa-onnx-node，无新增 npm 依赖。

| 文件 | SHA-256 |
| --- | --- |
| model.int8.onnx | f36a0433bcf096bd6d6f11b80a3ac8bed110bdca632fe0d731df8d1a84475945 |
| tokens.txt | 59aba8873a2ed1e122c25fee421e25f283b63290efbde85c1f01a853d83cb6e6 |

安装入口 `sh scripts/install-diagnostic-asr.sh`，检查入口 `node --import tsx scripts/inspect-phrases-independent-asr.ts`。模型与字典保存在被忽略的 `.models/sherpa-onnx-paraformer-zh-2023-09-14`；诊断脚本加载前验证两份指纹。当前应用的识别路径仍由 server/asr.ts 定义，诊断脚本没有修改其选择。
