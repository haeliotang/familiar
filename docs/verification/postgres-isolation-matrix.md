# 20 组用户隔离矩阵

2026-09-30。本地 Docker postgres:17，临时数据库只绑定 127.0.0.1:55432，不挂载持久卷。测试后 --rm 容器已移除，按名称查询无残留。本轮不改业务代码，只增加集成回归。

当前源码 `TEST_DATABASE_URL=... pnpm test:pg`：32 项通过、0 跳过；包含原 12 项及新增 20 组。每组创建两个独立匿名会话与各自人物，上传相同合成 JPEG。检查数据库哈希相等而 object_key 不同；第二用户的资料列表仅含自己的资产。

每组第二用户对第一用户的以下有效 ID 请求全部返回 404/not_found：

| 对象 | 请求 |
| --- | --- |
| 人物 | GET assets、GET episodes、POST memories、POST episodes、DELETE person |
| 相遇 | GET episode、GET voice、GET feedback、POST feedback、POST hide |
| 证据 | POST retract |
| 媒体 | POST upload-intents、PUT content、POST complete |
| 转写 | GET transcript、POST transcript、POST confirm、POST skip |
| 删除任务 | 第一用户正常删除后，第二用户 GET deletionJob |

合计每组 19 次越权请求，20 组共 380 次，全部拒绝。第二用户删除任务列表没有第一用户任务。越权尝试后第一用户声音仍可读取、证据仍 usable、人物 revision 保持 2、反馈未写入。第一用户正常删除后仅清除其文件，第二用户同哈希文件与 ready 状态保留；第二用户正常删除后目录为空。

素材为 16×16 合成色块及通用本地合成声音，无真实资料或外部调用。构建通过，既有场景大包警告保留。

边界：这是当前本地 API 的 20 对用户样本和已列路由，未证明生产代理/CDN/对象存储配置、匿名 token 窃取威胁、所有编码绕过、真实部署及生产安全审查。媒体转写越权使用 photo ID，证明先校验所有权，但不代替跨用户真实录音转写对象的完整组合测试。尚未声明全产品发布门槛完成。
