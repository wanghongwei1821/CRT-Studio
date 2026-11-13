# CRT Studio

A CRT screen effect for web

一个基于 WebGL 2 的实时显像管模拟器。用文字、图片、视频或 Canvas 作为信号源，实时调整屏幕弧度、荧光粉排列、扫描线、辉光和色偏。

## 网页美学 Skill

[王宏威的网页美学](.agents/skills/narci-web-aesthetics/SKILL.md) 记录了把 CRT 用于网页作品时的设计与实现规则，包括固定屏幕坐标、Logo 和 Hollow 控件的频闪、明暗模式，以及网页预设与验收方法。模拟器的 API 默认值见下文。

## 运行演示

在本目录运行以下命令，然后用支持 WebGL 2 的浏览器打开 `http://127.0.0.1:8080/`。

```bash
python -m http.server 8080 --bind 127.0.0.1
```

演示是静态网页，没有第三方运行依赖。文件选择器通过浏览器读取本机媒体，视频以静音循环播放。测试图由 Canvas 生成，包含色条、网格和灰阶。文字输入提供小字清晰度开关，也可以切换原始画面作对照。

## 接入自己的项目

把 `src/` 复制到站点中，通过 ES module 导入。为输出 Canvas 设定像素尺寸，再将已加载的图片、Canvas 或可播放的视频交给渲染器。

```js
import { createCrtRenderer } from './src/renderer.js';

const screen = document.querySelector('#screen');
const input = document.querySelector('#input');
await input.decode(); // input 是 HTMLImageElement

const crt = createCrtRenderer(screen);
crt.setFrame(input, { resetHistory: true });
crt.draw({
  mask: 'dots',
  pattern: [12, 90, 91],
  effects: { bloom: 1.2, spread: 1.4, scanlines: 0.35, flicker: 0 },
});
```

| 接口 | 说明 |
| --- | --- |
| `setFrame(source, { resetHistory })` | 上传一个已加载的源帧。切换素材、视频跳转或循环时设 `resetHistory: true`，清掉上一帧残影。 |
| `draw(options)` | 绘制一次。动态效果由调用方每帧传入 `time`（秒）。视频只需在出现新帧时重新调用 `setFrame`。 |
| `dispose()` | 释放纹理、帧缓冲和着色程序。在卸载画布或创建新的渲染器前调用。 |

`draw` 的 `mask` 可选 `stripes`、`dots`、`off`。 `pattern` 依次是点阵间距（CSS px）、单点宽度与高度（百分比）。 `cssWidth` 默认取画布的 CSS 宽度，以便不同像素密度下维持点阵尺寸。 `tintColor` 是三个 0 到 1 的 sRGB 通道值，`original: true` 可查看原始信号。

`effects` 可以只传需要覆盖的参数。强度与缩放使用倍率，`1` 对应演示面板的 100%，`flickerHz` 使用 Hz。默认值见 [renderer.js](src/renderer.js) 的 `CRT_DEFAULTS`。

## 渲染管线

1. **输入信号**。当前帧和上一帧存为两张纹理，按输出比例留边。RGB 错位独立采样红蓝通道，视频残影混合上一帧。
2. **辉光**。在四分之一尺寸的纹理中提取高亮，做两组可分离模糊，得到贴近字形的窄辉光和扩散更远的宽辉光。输入帧或扩散半径变化时重新计算。
3. **显像管**。逆向映射屏幕弧度，按屏幕坐标采样 RGB 荧光粉。前景移动时，点阵仍固定在屏幕上。
4. **合成**。在线性光中混合辉光、脉冲、暗角、噪声与亮度染色，转回显示色后应用扫描线。

GLSL 在 [src/shaders.js](src/shaders.js)，WebGL 资源和对外接口在 [src/renderer.js](src/renderer.js)，文字排版和交互控件在 [demo.js](demo.js)。
