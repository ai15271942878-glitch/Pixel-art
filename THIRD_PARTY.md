# 第三方资料

## MARD 色表

`js/palettes-mard.js` 中 MARD 221 / 144 / 24 色的色号、名称和色值整理自
<https://beiyapd.com/zh-CN/bead-tools#mard> 的 MARD 部分，
取自 [PixelDraw](https://github.com/HHpetra/PixelDraw)（MIT 许可，Copyright (c) 2026 HHpetra）的收录。
144 色与 24 色是 221 色的子集，同一色号使用相同的名称和色值。

这里只记录色表数据的来源，并不表示上游色表、颜色名称或 MARD 品牌归本项目所有。
屏幕色值仅供参考，实物颜色以豆子为准。

## 图纸样式

导出图纸的序号带和“从中心向外每 10 格”的计数线参考了 PixelDraw 的拼豆图纸设计，代码为本项目重新实现。

## AI 抠图模型

`models/isnet-anime-int8.onnx` 来自 [SkyTNT/anime-segmentation](https://github.com/SkyTNT/anime-segmentation)
（Apache License 2.0）训练的 ISNet 动漫人物分割模型，
ONNX 文件取自 [rembg](https://github.com/danielgatis/rembg)（MIT）发布的 `isnet-anime.onnx`。
为了缩小体积，本项目把卷积权重按输出通道量化为 int8（加载时用 Cast + Mul 还原成浮点），
模型结构和推理结果基本不变（在测试图片上与原模型的蒙版重合度为 99.7%）。

## onnxruntime-web

`vendor/onnxruntime-web/` 是 [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) 1.30.0 的 WASM 版本，
MIT 许可，Copyright (c) Microsoft Corporation，许可全文见该目录下的 `LICENSE`。
