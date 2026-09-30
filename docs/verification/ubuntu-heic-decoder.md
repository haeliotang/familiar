# Ubuntu HEIC 解码依赖修复

2026-10-01。公开提交 6d605bae 的 GitHub Actions 运行 36779171431：331 项通过、6 项失败，失败涉及 HEIC 正常处理、重试、删除竞态和准备输入组合。后续 d5878fbc 的运行 36781760333 也已失败；不能将此前 macOS 本地通过视为 Linux 通过。

在可删除的 Ubuntu 24.04 Docker 容器中，仅安装 libheif-examples，执行项目实际命令 `heif-convert --quiet /fixtures/synthetic.heic /tmp/decoded.png`，退出 1，报错 `Unsupported feature: Unsupported codec`。只读挂载项目的合成测试图片，没有私人资料。

再以同一 Ubuntu 镜像、同一图片和命令安装 libheif-examples 与 libheif-plugin-libde265，转换退出 0。两次容器均以 --rm 运行，结束后移除。由此确认仅安装转换工具不足，HEIC 解码插件也必须安装。

自动检查和 README 的 Ubuntu 安装命令补入该插件。没有放宽接口验证、跳过 HEIC 用例或扩大测试超时。修复尚待推送后由完整 Linux 自动检查验证；本次容器转换成功不证明六个接口用例全部通过。
