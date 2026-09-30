# 合成媒体回归素材

全部为合成素材，不含私人资料。

- synthetic.heic：256×192 纯色 PNG（#739a56）用 macOS sips 编码为 HEIC。
- synthetic-stream.webm：ffmpeg 的 440Hz 两秒合成音，以 libopus 写入不可寻址的 pipe:1，保留缺失容器总时长的流式 WebM 结构。
- synthetic-stream-too-long.webm：ffmpeg anullsrc 16kHz 单声道静音、181 秒、libopus 6kbps，以 pipe:1 输出的 WebM；验证缺少容器总时长时仍拒绝过长录音。

生成命令：

```sh
ffmpeg -nostdin -v error -f lavfi -i sine=frequency=440:duration=2 -c:a libopus -f webm pipe:1 > server/fixtures/synthetic-stream.webm
ffmpeg -nostdin -v error -f lavfi -i anullsrc=r=16000:cl=mono -t 181 -c:a libopus -b:a 6k -f webm pipe:1 > server/fixtures/synthetic-stream-too-long.webm
```
