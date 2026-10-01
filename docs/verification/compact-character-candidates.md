# 1024 纹理人物候选与首批文件体积

2026-10-01。此前八动作男性标准首批文件约 25.4 MB，女性约 20.9 MB，超过产品文档的 12 MB 目标。本轮建立 compact-v4 版本候选，仅减小纹理采样，不修改已记录的旧资源。

## 制作与复现

```
node --import tsx scripts/optimize-character.ts --mobile-candidate
node --import tsx scripts/optimize-character.ts --mobile-candidate --female
pnpm exec vitest run src/optimized-character.test.ts src/avatar-catalog.test.ts --maxWorkers=2
pnpm build
node --import tsx scripts/measure-encounter-download.ts
```

原始 GLB 的纹理最长边压至 1024 像素，不放大小图，再以无损 WebP 编码。编码后解码像素与缩小后的纹理完全一致，不与原始高分辨率纹理相同。代价是近处细节减少。非图像 buffer 字节、网格、骨骼、访问器、场景与材质参数保持原样；所有模型含有效的 EXT_texture_webp 引用。

生成文件以 `-mobile-v2.glb` 命名，来源与输出 SHA-256 见 public/assets/quaternius/optimization-mobile.json 和 optimization-female-mobile.json。保留原版和旧无损版本。compact-v4 复用既有八动作、步速和对应性别的声音。

## 文件测量

按当前生产构建，累加 HTML、全部构建 JS/CSS、选定人物的头/衣物/八动作/步速、单条标准语音文件的未压缩字节：

| 人物包 | 三种标准语音对应范围 | 最大值低于 12,000,000 字节 |
| --- | --- | --- |
| 男性 pickup-v3 | 25,406,836–25,447,158 | 否 |
| 女性 pickup-v3 | 20,867,548–20,907,920 | 否 |
| 男性 compact-v4 候选 | 11,717,164–11,757,486 | 是 |
| 女性 compact-v4 候选 | 10,690,448–10,730,820 | 是 |

明细见 encounter-download-bytes.json。这是文件体积，不是实测网络传输或首访速度；不含 HTTP 开销、API JSON、私人上传及现场生成的节奏语音。不能据此宣称所有个性化首访都满足 12 MB。构建更新后须重新测量。

## 验证与状态

角色资源哈希和新旧 GLB 检查共 21 项通过；构建通过，仍有场景大包警告。实际浏览器在同一河岸种子、同一 32.3 秒放回姿态下加载男女 compact-v4，材质、人物与物件可见，警告/错误日志查询为空。截图 compact-male-replaced.jpg / compact-female-replaced.jpg。未做所有动作与近距离头部观感评价。

本轮 compact-v4 只供显式审核页 `scripts/verify-scenes.html?actions=pickup&close=1&textures=mobile` 选择，女性再加 `&character=female`；新相遇默认仍为 pickup-v3。下一步核对节奏语音的实际首批体积、进一步画面质量和目标手机表现，再决定切换默认。文件体积检查不替代手机真机性能或网络条件验收。

## 后续：节奏语音测量与默认切换

在上述候选审核之后，通过实际节奏语音生成路径测量两个人物、三种台词、0.8 / 1.2 倍语速与 0 / 0.25 / 0.65 秒参考停顿，共 36 组合成边界样本。全部首批文件体积低于 12,000,000 字节，最大 11,817,110 字节。一般台词不插入句间停顿；等待、修补台词按实际生成逻辑处理。明细见 cadence-download-bytes.json。

复现：先构建并运行 `scripts/measure-encounter-download.ts`，再运行 `node --import tsx scripts/measure-cadence-download.ts`。后者核对基线文件大小和 SHA-256，基线不匹配时拒绝沿用测量。上述结果仅覆盖 36 个采样组合，不证明连续参数空间、实际网络传输或手机首访速度。

本地新相遇默认已切换为 compact-v4，表演保持 character-timeline-v4。原四动作、七动作和完整纹理八动作资源继续保留；女性旧八动作版本继续绑定女性音色与对应木箱高度。

默认切换相关的资源、载入、API、准备任务、声音和木箱检查共 67 项通过；随后扩展语音覆盖到 compact-v4 后，语音文件检查 20 项通过（与前述检查有重叠，不相加）。构建与本地依赖检查通过。场景构建仍有大包警告。手机真机性能、近距离纹理观感与公网部署尚未验证。
