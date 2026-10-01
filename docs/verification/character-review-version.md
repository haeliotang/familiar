# 旧人物审核页的版本绑定

2026-10-01。scripts/verify-character.html 固定加载 peasant-male-v1 / peasant-female-v1 的四动作包，却使用 currentPerformanceVersion；当前默认升级到含坐姿和拿取的 v4 后，两种人物的完整样片均因 missing_character_clip:Sitting_Enter 失败。

回归测试读取审核页实际两个 timeline 调用，并使用其素材路径对应的实际动画轨道建立表演，先复现男女两项失败。将无声及有声样片固定为 character-timeline-v2，移除当前版本导入，页面说明该页属于旧四动作审核。新版八动作仍使用 verify-scenes.html 的显式 pickup 审核路径。

修复后两项审核绑定检查和十项编排测试通过。测试覆盖实际轨道的三种线索与定位姿态；尚未在浏览器中重新播放这个旧审核页，不声称声音、画面或完整 75 秒观感验收通过。
