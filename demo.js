import { createCrtRenderer, CRT_DEFAULTS } from './src/renderer.js';

const $ = id => document.getElementById(id);
const canvas = $('screen');
const settings = {};
const { effects: defaults } = CRT_DEFAULTS;
const fields = [
  ['phosphor', '荧光粉强度', Math.round(defaults.phosphor * 100), 250],
  ['curvature', '屏幕弧度', Math.round(defaults.curvature / 0.33 * 100), 250],
  ['scanlines', '扫描线', Math.round(defaults.scanlines * 100), 220],
  ['bloom', '辉光', defaults.bloom * 100, 400], ['spread', '光晕扩散', defaults.spread * 100, 300],
  ['flicker', '辉光闪烁', defaults.flicker * 100, 100],
  ['flickerHz', '脉冲速度', defaults.flickerHz, 30, { min: 0.5, step: 0.1, unit: ' Hz' }],
  ['chroma', 'RGB 错位', defaults.chroma * 100, 350], ['noise', '噪声与闪烁', Math.round(defaults.noise * 100), 300],
  ['vignette', '边缘暗角', defaults.vignette * 100, 50], ['persistence', '视频残影', 107, 150]
];
const defaultPatterns = [CRT_DEFAULTS.pattern, [12, 90, 91]];
const patterns = defaultPatterns.map(values => [...values]);
const smallTextReduction = { bloom: 0.86, chroma: 0.96, phosphor: 0.85, scanlines: 0.75, noise: 0.70 };
let tintColor = [1, 1, 1];
let original = false;
let paused = matchMedia('(prefers-reduced-motion: reduce)').matches;
let dirty = true;
let effectTime = 0;
let lastTick = null;
let lastRegularTick = 0;
let selection = 0;
let cssWidth = canvas.width;
let media = null;
let demoCanvas;
let textCanvas;
let textFontSize = 0;
let activeUrl;
let renderer;

function showMessage(message) {
  $('message').textContent = message;
  $('message').hidden = !message;
}

function imageFrom(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

function setFrame(source, resetHistory) {
  renderer.setFrame(source, { resetHistory });
  dirty = true;
}

function drawFrame() {
  const mask = Number($('mask-type').value);
  const effects = { ...settings };
  effects.curvature *= 0.33;
  effects.persistence = media ? Math.min(1, effects.persistence * 0.65) : 0;
  if (!$('text-editor').hidden && $('text-clarity').checked) {
    const displayedSize = textFontSize * cssWidth / textCanvas.width;
    const amount = Math.max(0, Math.min(1, (52 - displayedSize) / 24));
    for (const [effect, reduction] of Object.entries(smallTextReduction)) {
      effects[effect] *= 1 - amount * reduction;
    }
  }
  renderer.draw({
    time: effectTime,
    cssWidth,
    original,
    mask: ['stripes', 'dots', 'off'][mask],
    pattern: patterns[mask] ?? defaultPatterns[1],
    tintColor,
    effects,
  });
}

function createTestCard() {
  const card = document.createElement('canvas');
  card.width = 1920;
  card.height = 1080;
  const ctx = card.getContext('2d');

  ctx.fillStyle = '#0a0b0b';
  ctx.fillRect(0, 0, card.width, card.height);
  ctx.strokeStyle = '#333f34';
  ctx.lineWidth = 2;
  for (let x = 240; x <= 1680; x += 120) {
    ctx.beginPath();
    ctx.moveTo(x, 168);
    ctx.lineTo(x, 912);
    ctx.stroke();
  }
  for (let y = 192; y <= 912; y += 120) {
    ctx.beginPath();
    ctx.moveTo(240, y);
    ctx.lineTo(1680, y);
    ctx.stroke();
  }

  ctx.fillStyle = '#f4f5ef';
  ctx.font = '800 122px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillText('CRT TEST', 960, 440);

  const bars = ['#eee', '#e8dc38', '#47d8d9', '#53db49', '#d84ac9', '#e94e50', '#4457dc'];
  bars.forEach((color, index) => {
    ctx.fillStyle = color;
    ctx.fillRect(400 + index * 160, 510, 160, 176);
  });

  const grey = ctx.createLinearGradient(400, 0, 1520, 0);
  grey.addColorStop(0, '#000');
  grey.addColorStop(1, '#fff');
  ctx.fillStyle = grey;
  ctx.fillRect(400, 717, 1120, 54);
  ctx.strokeStyle = '#818981';
  ctx.strokeRect(400, 717, 1120, 54);
  return card;
}

function initControls() {
  const panel = $('controls-title').closest('section');
  const maskSelect = $('mask-type');
  const defaultMask = Array.from(maskSelect.options).find(option => option.defaultSelected).value;
  maskSelect.value = defaultMask;
  function heading(text) {
    const title = document.createElement('h3');
    title.className = 'subhead';
    title.textContent = text;
    panel.append(title);
  }
  function sliderControl(name, label, min, max, initial, unit, onChange, step = 1) {
    const row = document.createElement('label');
    row.className = 'control';
    const readout = document.createElement('output');
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.id = 'param-' + name;
    slider.setAttribute('aria-label', label);
    slider.min = min;
    slider.max = max;
    slider.step = step;
    readout.htmlFor = slider.id;
    row.append(label, readout, slider);
    panel.append(row);
    function set(value) {
      slider.value = value;
      readout.value = value + unit;
    }
    const sync = () => {
      const value = Number(slider.value);
      readout.value = value + unit;
      onChange(value);
      dirty = true;
    };
    set(initial);
    slider.addEventListener('input', sync);
    return { slider, set };
  }
  const shapeFields = [
    ['Pitch', '点阵间距', 4, 96, ' px'],
    ['Width', '单点／条宽', 3, 100, '%'],
    ['Height', '单点／条高', 3, 100, '%']
  ];
  const shapeSliders = shapeFields.map(([name, label, min, max, unit], index) =>
    sliderControl(name, label, min, max, patterns[Number(defaultMask)][index], unit, value => {
      patterns[Number(maskSelect.value)][index] = value;
    })
  );
  function effectField([name, label, initial, max, { min = 0, step = 1, unit = '%' } = {}]) {
    const scale = unit === '%' ? 100 : 1;
    function update(value) {
      settings[name] = value / scale;
    }
    update(initial);
    const control = sliderControl(name, label, min, max, initial, unit, update, step);
    return {
      ...control,
      reset() {
        update(initial);
        control.set(initial);
      }
    };
  }
  const strength = effectField(fields[0]);
  function syncShape() {
    const pattern = patterns[Number(maskSelect.value)];
    shapeSliders.forEach(({ slider, set }, index) => {
      slider.disabled = !pattern;
      if (pattern) set(pattern[index]);
    });
    strength.slider.disabled = !pattern;
    dirty = true;
  }
  maskSelect.addEventListener('change', syncShape);

  heading('颜色滤镜');
  const tintRow = document.createElement('label');
  tintRow.className = 'control';
  const picker = document.createElement('input');
  picker.type = 'color';
  picker.id = 'tint-color';
  const defaultTint = '#9befa4';
  tintRow.append('滤镜颜色', picker);
  panel.append(tintRow);
  const tintStrength = effectField(['tint', '滤镜强度', defaults.tint * 100, 200]);
  function setTintColor(hex) {
    picker.value = hex;
    tintColor = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
    dirty = true;
  }
  setTintColor(defaultTint);
  picker.addEventListener('input', () => {
    setTintColor(picker.value);
    if (settings.tint === 0) {
      settings.tint = 0.65;
      tintStrength.set(65);
    }
  });

  heading('画面效果');
  const effectSliders = fields.slice(1).map(effectField);
  $('reset').addEventListener('click', () => {
    maskSelect.value = defaultMask;
    defaultPatterns.forEach((values, index) => { patterns[index] = [...values]; });
    [strength, ...effectSliders, tintStrength].forEach(control => control.reset());
    setTintColor(defaultTint);
    syncShape();
  });
}

function updatePause() {
  $('pause').setAttribute('aria-pressed', paused);
  $('pause').textContent = paused ? '继续播放' : '暂停动态';
  if (!media) return;
  const video = media.video;
  if (paused) video.pause();
  else video.play().catch(() => {
    if (paused || media?.video !== video) return;
    paused = true;
    $('source').textContent = '视频已载入，点击「继续播放」启动。';
    updatePause();
  });
}

function releaseMedia() {
  if (media) {
    media.video.pause();
    media.video.removeAttribute('src');
    media.video.load();
    media = null;
  }
  if (activeUrl) URL.revokeObjectURL(activeUrl);
  activeUrl = null;
}

function setTextMode(active) {
  $('text-editor').hidden = !active;
  $('text-mode').setAttribute('aria-pressed', active);
  $('original').textContent = active ? '原文' : '原图';
}

function drawTextFrame(isNew) {
  const context = textCanvas.getContext('2d');
  const text = $('text-input').value.trim();
  const maxWidth = textCanvas.width * 0.76;
  const maxHeight = textCanvas.height * 0.68;
  const requestedSize = Number($('text-size').value);
  let fontSize = requestedSize;
  context.fillStyle = '#0a0b0b';
  context.fillRect(0, 0, textCanvas.width, textCanvas.height);
  if (text) {
    const words = new Intl.Segmenter(undefined, { granularity: 'word' });
    const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const paragraphs = text.split('\n').map(paragraph => Array.from(words.segment(paragraph), part => part.segment));
    function layout(fontSize) {
      context.font = '800 ' + fontSize + 'px system-ui, "Microsoft YaHei", sans-serif';
      const lines = [];
      for (const paragraph of paragraphs) {
        let line = '';
        for (const token of paragraph) {
          if (context.measureText(line + token).width <= maxWidth) {
            line += token;
            continue;
          }
          if (line.trim()) lines.push(line.trimEnd());
          line = token.trimStart();
          if (context.measureText(line).width > maxWidth) {
            const oversized = line;
            line = '';
            for (const { segment } of graphemes.segment(oversized)) {
              if (line && context.measureText(line + segment).width > maxWidth) {
                lines.push(line);
                line = '';
              }
              line += segment;
            }
          }
        }
        lines.push(line.trim());
      }
      return lines;
    }
    let minSize = 1;
    let maxSize = requestedSize;
    while (minSize < maxSize) {
      const size = Math.ceil((minSize + maxSize) / 2);
      if (layout(size).length * size * 1.18 <= maxHeight) minSize = size;
      else maxSize = size - 1;
    }
    fontSize = minSize;
    const lines = layout(fontSize);
    const lineHeight = fontSize * 1.18;
    context.fillStyle = '#f4f5ef';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const firstLine = (textCanvas.height - (lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, index) => context.fillText(line, textCanvas.width / 2, firstLine + index * lineHeight));
  }
  textFontSize = fontSize;
  $('text-size-value').value = fontSize === requestedSize
    ? fontSize + ' px'
    : fontSize + ' px（自动适配）';
  setFrame(textCanvas, isNew);
}

function loadVideo(url) {
  const video = document.createElement('video');
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = 'auto';
  return new Promise((resolve, reject) => {
    video.addEventListener('loadeddata', () => resolve(video), { once: true });
    video.addEventListener('error', reject, { once: true });
    video.src = url;
  });
}

async function loadFile(file) {
  if (!renderer || !file) return;
  const request = ++selection;
  const url = URL.createObjectURL(file);
  const isVideo = file.type.startsWith('video/') || /\.(mp4|webm|mov|m4v|ogv)$/i.test(file.name);
  $('source').textContent = '正在加载 ' + file.name + '…';
  let input;
  try {
    input = await (isVideo ? loadVideo(url) : imageFrom(url));
    if (request !== selection) return;
    setFrame(input, true);
    releaseMedia();
    setTextMode(false);
    if (isVideo) {
      media = { video: input, time: input.currentTime };
      activeUrl = url;
      input.addEventListener('error', () => {
        if (media?.video === input) $('source').textContent = '无法继续解码 ' + file.name;
      });
      updatePause();
    }
    $('source').textContent = file.name + (isVideo ? ' · 静音循环' : '');
  } catch {
    if (request === selection) $('source').textContent = '无法读取 ' + file.name + '，请试试 PNG、JPEG、MP4 或 WebM。';
  } finally {
    if (activeUrl !== url) {
      if (isVideo && input) {
        input.pause();
        input.removeAttribute('src');
        input.load();
      }
      URL.revokeObjectURL(url);
    }
  }
}

function tick(now) {
  if (!renderer || renderer.contextLost()) return;
  if (!paused && lastTick !== null) {
    effectTime = (effectTime + Math.min(now - lastTick, 50) / 1000) % 600;
  }
  lastTick = now;
  const regularFrame = now - lastRegularTick >= 29;
  if (regularFrame) {
    lastRegularTick = now;
    if (media && !paused && media.video.readyState >= 2 && Math.abs(media.video.currentTime - media.time) > 0.015) {
      const time = media.video.currentTime;
      setFrame(media.video, time < media.time || time - media.time > 0.25);
      media.time = time;
    }
  }
  const animate = !paused && !original;
  const animatedGlow = animate && settings.bloom > 0 && settings.flicker > 0;
  const fullRateGlow = animatedGlow && settings.flickerHz > 6;
  if (fullRateGlow || (regularFrame && (dirty || animatedGlow || (animate && settings.noise > 0)))) {
    drawFrame();
    dirty = false;
  }
  requestAnimationFrame(tick);
}

function sizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  cssWidth = rect.width;
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.min(1920, Math.max(1, Math.round(rect.width * scale)));
  const height = Math.max(1, Math.round(width * 9 / 16));
  if (canvas.width === width && canvas.height === height) return;
  canvas.width = width;
  canvas.height = height;
  if (!renderer.contextLost()) {
    drawFrame();
    dirty = false;
  }
}

function start() {
  initControls();
  updatePause();
  renderer = createCrtRenderer(canvas);
  demoCanvas = createTestCard();
  textCanvas = document.createElement('canvas');
  textCanvas.width = demoCanvas.width;
  textCanvas.height = demoCanvas.height;
  setTextMode(true);
  drawTextFrame(true);
  $('source').textContent = '自定义文字';
  new ResizeObserver(sizeCanvas).observe(canvas);
  sizeCanvas();
  $('open').addEventListener('click', () => $('file').click());
  $('file').addEventListener('change', event => {
    loadFile(event.target.files[0]);
    event.target.value = '';
  });
  $('text-mode').addEventListener('click', () => {
    if ($('text-editor').hidden) {
      selection++;
      releaseMedia();
      setTextMode(true);
      drawTextFrame(true);
      $('source').textContent = '自定义文字';
    }
    $('text-input').focus();
  });
  const updateText = () => {
    selection++;
    drawTextFrame(false);
    $('source').textContent = '自定义文字';
  };
  $('text-input').addEventListener('input', updateText);
  $('text-size').addEventListener('input', updateText);
  $('text-clarity').addEventListener('input', () => { dirty = true; });
  $('demo').addEventListener('click', () => {
    selection++;
    releaseMedia();
    setTextMode(false);
    setFrame(demoCanvas, true);
    $('source').textContent = '测试图';
  });
  $('pause').addEventListener('click', () => {
    paused = !paused;
    updatePause();
  });
  $('original').addEventListener('click', () => {
    original = !original;
    $('original').setAttribute('aria-pressed', original);
    dirty = true;
  });
  canvas.addEventListener('webglcontextlost', () => {
    if (media) media.video.pause();
    showMessage('图形上下文已中断，请刷新页面。');
  });
  showMessage('');
  requestAnimationFrame(tick);
}

try {
  start();
} catch (error) {
  console.error(error);
  showMessage('CRT 效果初始化失败，请检查浏览器的图形加速设置。');
}
