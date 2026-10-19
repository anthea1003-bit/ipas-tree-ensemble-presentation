import { advanceWalk } from './walk-motion.js';

/** Portable, dependency-free tea character. All assets resolve beside this module. */
const BASE = new URL('./characters/', import.meta.url);
const CSS = new URL('./tea-characters.css', import.meta.url);
const ACTIONS = new Set(['idle', 'blink', 'wave', 'float', 'walk']);
const REQUIRED = ['head-blank', 'body', 'arm-l', 'arm-r', 'arm-l-wave', 'arm-r-wave', 'eye-open', 'eye-closed', 'mouth-smile', 'mouth-o'];
const manifests = new Map();
const warnings = new Set();

function warnOnce(key, text) {
  if (!warnings.has(key)) {
    warnings.add(key);
    console.warn(`[tea-chara] ${text}`);
  }
}

async function getManifest(name) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error('角色名稱只能使用小寫英文字母、數字與連字號。');
  const url = new URL(`${name}/manifest.json`, BASE);
  if (!manifests.has(name)) {
    const promise = fetch(url).then(async response => {
      if (!response.ok) throw new Error(`找不到角色 ${name}（HTTP ${response.status}）。`);
      const manifest = await response.json();
      if (manifest.schemaVersion !== 1 || !(manifest.canvas?.width > 0) || !(manifest.canvas?.height > 0)) {
        throw new Error('manifest 畫布或版本不正確。');
      }
      for (const key of REQUIRED) {
        if (!manifest.parts?.[key]) throw new Error(`manifest 缺少 ${key}。`);
      }
      for (const part of Object.values(manifest.parts)) {
        if (!/^[a-z0-9-]+\.png$/.test(part.file) ||
            !['x', 'y', 'width', 'height', 'z'].every(k => Number.isFinite(part[k])) ||
            part.width <= 0 || part.height <= 0 ||
            ![part.pivot?.x, part.pivot?.y].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) {
          throw new Error('manifest 零件座標、檔名或軸心不正確。');
        }
      }
      manifest.name = name;
      return manifest;
    }).catch(error => { manifests.delete(name); throw error; });
    manifests.set(name, promise);
  }
  return manifests.get(name);
}

const FRAME_FILE = /^(?:[a-z0-9-]+\/)*[a-z0-9-]+\.png$/;

function validateFrames(config) {
  if (!config || !Number.isInteger(config.count) || config.count < 1 ||
      !Array.isArray(config.files) || config.files.length !== config.count ||
      !config.files.every(file => FRAME_FILE.test(file)) ||
      ![config.canvas?.width, config.canvas?.height, config.frameMs].every(n => Number.isFinite(n) && n > 0) ||
      !Array.isArray(config.order) || !config.order.length ||
      !config.order.every(n => Number.isInteger(n) && n >= 1 && n <= config.count) ||
      !Object.entries(config.durationOverrides || {}).every(([key, ms]) => /^[1-9]\d*$/.test(key) && Number(key) <= config.count && Number.isFinite(ms) && ms > 0)) {
    throw new Error('分格檔名、畫布、順序或時間不正確。');
  }
}

async function loadFrameModes(manifest, directory) {
  const documents = new Map();
  const result = {};
  await Promise.all(Object.entries(manifest.frames || {}).map(async ([action, entry]) => {
    if (!['idle', 'wave', 'walk'].includes(action)) return;
    try {
      let config = entry;
      if (typeof entry === 'string') {
        if (!/^(?:[a-z0-9-]+\/)*[a-z0-9-]+\.json$/.test(entry)) throw new Error('分格 metadata 路徑不正確。');
        if (!documents.has(entry)) documents.set(entry, fetch(new URL(entry, directory)).then(async response => {
          if (!response.ok) throw new Error('找不到分格 metadata。');
          return response.json();
        }));
        config = (await documents.get(entry)).frames?.[action];
      }
      validateFrames(config);
      const window = document.createElement('div'); window.className = 'frame-window'; window.hidden = true;
      const track = document.createElement('div'); track.className = 'frame-track';
      track.style.width = `${config.count * 100}%`;
      window.append(track);
      const makeImage = file => {
        const image = new Image(); image.alt = ''; image.draggable = false;
        image.src = new URL(file, directory).href; return image;
      };
      const images = config.files.map(file => {
        const image = makeImage(file);
        image.style.width = `${100 / config.count}%`;
        image.style.flex = `0 0 ${100 / config.count}%`;
        track.append(image); return image;
      });
      await Promise.all(images.map(image => image.decode()));
      const mode = {config, window, track};
      if (action === 'idle' && config.blink) {
        try {
          const b = config.blink;
          if (!FRAME_FILE.test(b.base) || !FRAME_FILE.test(b.file) ||
              !['x','y','width','height'].every(k => Number.isFinite(b[k])) || b.width <= 0 || b.height <= 0) throw new Error('眨眼座標不正確。');
          const layer = document.createElement('div'); layer.className = 'frame-blink'; layer.hidden = true;
          const base = makeImage(b.base); base.className = 'frame-blink-base';
          const eyelids = makeImage(b.file); eyelids.className = 'frame-eyelids';
          Object.assign(eyelids.style, {
            left: `${b.x / config.canvas.width * 100}%`, top: `${b.y / config.canvas.height * 100}%`,
            width: `${b.width / config.canvas.width * 100}%`, height: `${b.height / config.canvas.height * 100}%`,
          });
          await Promise.all([base.decode(), eyelids.decode()]);
          layer.append(base, eyelids); window.append(layer); mode.blinkLayer = layer;
        } catch (error) { warnOnce(`frame-blink:${manifest.name}`, `${manifest.name} 分格眨眼停用：${error.message}`); }
      }
      result[action] = mode;
    } catch (error) {
      warnOnce(`frames:${manifest.name}:${action}`, `${manifest.name}/${action} 分格不可用，保留零件式 fallback：${error.message}`);
    }
  }));
  return result;
}

export class TeaChara extends HTMLElement {
  static observedAttributes = ['name', 'action', 'size', 'loop', 'flip', 'mode', 'frames', 'frame', 'breathe'];

  constructor() {
    super();
    this.attachShadow({mode: 'open'});
    this._generation = 0;
    this._timers = new Set();
    this._motion = matchMedia('(prefers-reduced-motion: reduce)');
    this._onMotion = () => this._applyAction();
    this._onVisibility = () => this._applyAction();
  }

  connectedCallback() {
    this._motion.addEventListener('change', this._onMotion);
    document.addEventListener('visibilitychange', this._onVisibility);
    this._load();
  }

  disconnectedCallback() {
    ++this._generation;
    this._clearTimers();
    this._motion.removeEventListener('change', this._onMotion);
    document.removeEventListener('visibilitychange', this._onVisibility);
  }

  attributeChangedCallback(name, oldValue, value) {
    if (!this.isConnected || oldValue === value) return;
    if (name === 'name') this._load();
    else if (name === 'size') this._resize();
    else this._applyAction();
  }

  /** Replay an action, including a second one-shot wave with the same attribute. */
  play(action = 'idle') {
    if (this.getAttribute('action') === action) this._applyAction();
    else this.setAttribute('action', action);
  }

  /** Select a 1-based source frame; flipbook wraps it to the loaded frame count. */
  setFrame(n) {
    this.setAttribute('frame', String(n));
  }

  _later(callback, delay) {
    const id = setTimeout(() => { this._timers.delete(id); callback(); }, delay);
    this._timers.add(id);
  }

  _clearTimers() {
    for (const id of this._timers) clearTimeout(id);
    this._timers.clear();
    cancelAnimationFrame(this._raf);
    this._raf = null;
    this._frameAnimation?.cancel();
    this._frameAnimation = null;
  }

  async _load() {
    const generation = ++this._generation;
    this._clearTimers();
    this._manifest = null;
    this.dataset.state = 'loading';
    this.shadowRoot.replaceChildren();
    this.setAttribute('role', 'img');
    const name = this.getAttribute('name') || 'xiaoye';
    this.setAttribute('aria-label', `${name} 載入中`);
    try {
      const manifest = await getManifest(name);
      if (!this.isConnected || generation !== this._generation) return;
      const sheet = document.createElement('link');
      sheet.rel = 'stylesheet'; sheet.href = CSS.href;
      const stage = document.createElement('div'); stage.className = 'stage';
      stage.setAttribute('aria-hidden', 'true');
      stage.innerHTML = '<div class="shadow"></div><div class="travel"><div class="mirror"><div class="float"><div class="breath"><div class="rig"></div></div></div></div></div>';
      const rig = stage.querySelector('.rig');
      const images = [];
      const directory = new URL(`${name}/`, BASE);
      for (const [key, part] of Object.entries(manifest.parts)) {
        // Only waving arms have authored baselines; resting parts stay neutral.
        const wavingArm = key === 'arm-l-wave' || key === 'arm-r-wave';
        const baseAngle = wavingArm && Number.isFinite(part.rotation) ? part.rotation : 0;
        const element = document.createElement('div');
        element.className = 'part'; element.dataset.part = key;
        Object.assign(element.style, {
          left: `${part.x / manifest.canvas.width * 100}%`, top: `${part.y / manifest.canvas.height * 100}%`,
          width: `${part.width / manifest.canvas.width * 100}%`, height: `${part.height / manifest.canvas.height * 100}%`,
          zIndex: String(part.z), transform: `rotate(${baseAngle}deg)`, transformOrigin: `${part.pivot.x * 100}% ${part.pivot.y * 100}%`,
        });
        const img = new Image(); img.alt = ''; img.draggable = false;
        if (wavingArm) element.style.setProperty('--base-angle', `${baseAngle}deg`);
        img.src = new URL(part.file, directory).href;
        element.append(img); images.push(img);
        if (key.startsWith('arm-')) {
          const pivot = document.createElement('span'); pivot.className = 'pivot';
          pivot.dataset.pivot = key;
          pivot.style.left = `${(part.x + part.width * part.pivot.x) / manifest.canvas.width * 100}%`;
          pivot.style.top = `${(part.y + part.height * part.pivot.y) / manifest.canvas.height * 100}%`;
          rig.append(pivot);
          if (wavingArm) {
            const guide = document.createElement('span'); guide.className = 'wave-guide';
            guide.dataset.guide = key;
            guide.style.left = pivot.style.left; guide.style.top = pivot.style.top;
            guide.style.setProperty('--base-angle', `${baseAngle}deg`);
            const ray = document.createElement('i');
            const label = document.createElement('b'); label.textContent = `基準 ${baseAngle}°`;
            guide.append(ray, label); rig.append(guide);
          }
        }
        rig.append(element);
      }
      const walkWindow = document.createElement('div'); walkWindow.className = 'walk-window'; walkWindow.hidden = true;
      const openTrack = document.createElement('div'); openTrack.className = 'walk-track open';
      const closedTrack = document.createElement('div'); closedTrack.className = 'walk-track closed';
      walkWindow.append(openTrack, closedTrack); stage.querySelector('.breath').append(walkWindow);
      const walkImages = []; const blinkImages = [];
      const validFrames = (files, prefix) => Array.isArray(files) && files.length === 4 && files.every((file,i) => file === `${prefix}${i+1}.png`);
      const addFrames = (files, track, list) => {
        for (const file of files) {
          const frame = new Image(); frame.alt = ''; frame.draggable = false;
          frame.src = new URL(file, directory).href; track.append(frame); list.push(frame);
        }
      };
      if (validFrames(manifest.walkFrames, 'walk-')) addFrames(manifest.walkFrames, openTrack, walkImages);
      if (validFrames(manifest.walkBlinkFrames, 'walk-blink-')) addFrames(manifest.walkBlinkFrames, closedTrack, blinkImages);
      await Promise.all(images.map(img => img.decode()));
      const frames = await Promise.allSettled(walkImages.map(img => img.decode()));
      const blinkFrames = await Promise.allSettled(blinkImages.map(img => img.decode()));
      const frameModes = await loadFrameModes(manifest, directory);
      if (!this.isConnected || generation !== this._generation) return;
      this._frameModes = frameModes;
      for (const mode of Object.values(frameModes)) stage.querySelector('.breath').append(mode.window);
      this._walkImages = frames.some(result => result.status === 'rejected') ? [] : walkImages;
      this._walkBlinkReady = blinkImages.length === 4 && blinkFrames.every(result => result.status === 'fulfilled');
      this._walkWindow = walkWindow;
      this._manifest = manifest; this._stage = stage; this._rig = rig;
      this.shadowRoot.replaceChildren(sheet, stage);
      this._resize(); this._applyAction();
      this.dataset.state = 'ready';
      this.setAttribute('aria-label', manifest.label || name);
      this.dispatchEvent(new CustomEvent('tea-ready', {bubbles: true}));
    } catch (error) {
      if (generation !== this._generation || !this.isConnected) return;
      this.dataset.state = 'error';
      this.shadowRoot.textContent = '角色載入失敗';
      this.setAttribute('aria-label', `${name} 載入失敗`);
      console.error('[tea-chara]', error.message);
      this.dispatchEvent(new CustomEvent('tea-error', {detail: error.message, bubbles: true}));
    }
  }

  _resize() {
    const requested = Number(this.getAttribute('size') || 220);
    const size = Number.isFinite(requested) && requested > 0 ? requested : 220;
    this.style.height = `${size}px`;
    const walk = this.dataset.action === 'walk' && this._walkImages?.[0];
    const canvas = this._activeFrames?.config.canvas;
    const ratio = canvas ? canvas.width / canvas.height : walk ? walk.naturalWidth / walk.naturalHeight : this._manifest ? this._manifest.canvas.width / this._manifest.canvas.height : .625;
    this.style.width = `${size * ratio}px`;
  }

  _setBlink(closed) {
    if (this._activeFrames) {
      const {track, blinkLayer} = this._activeFrames;
      if (blinkLayer) { blinkLayer.hidden = !closed; track.hidden = closed; }
      return;
    }
    this._walkWindow?.classList.toggle('blinking', closed && this._walkBlinkReady);
    this._rig.querySelector('[data-part="eye-open"]').hidden = closed;
    this._rig.querySelector('[data-part="eye-closed"]').hidden = !closed;
  }

  _blink() {
    this._setBlink(true);
    this._later(() => this._setBlink(false), 120);
  }

  _scheduleBlink() {
    this._later(() => { this._blink(); this._scheduleBlink(); }, 3000 + Math.random() * 2000);
  }

  _beginWalk() {
    let x = 0; let direction = this.hasAttribute('flip') ? -1 : 1; let last;
    const travel = this._stage.querySelector('.travel');
    const animate = time => {
      const dt = last === undefined ? 0 : Math.min((time - last) / 1000, .1); last = time;
      const parent = this.parentElement;
      if (!parent) return;
      const container = parent.getBoundingClientRect(); const box = this.getBoundingClientRect();
      const style = getComputedStyle(parent);
      const min = container.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth) - box.left;
      const max = container.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth) - box.right;
      ({x, direction} = advanceWalk(x, direction, dt * 42 * box.height / 220, min, max));
      travel.style.transform = `translateX(${x}px)`;
      this._stage.style.setProperty('--walk-facing', direction);
      this.dataset.direction = direction > 0 ? 'right' : 'left';
      this._raf = requestAnimationFrame(animate);
    };
    this._raf = requestAnimationFrame(animate);
  }

  _showFrames(action, paused) {
    for (const mode of Object.values(this._frameModes || {})) {
      mode.window.hidden = true; mode.track.hidden = false;
      if (mode.blinkLayer) mode.blinkLayer.hidden = true;
    }
    const key = ['idle', 'blink', 'float'].includes(action) ? 'idle' : action;
    const mode = this._frameModes?.[key];
    this._activeFrames = mode;
    this.dataset.mode = mode ? 'frames' : 'parts';
    if (!mode) return false;
    this._stage.className += ' frame-mode';
    mode.window.hidden = false;
    const {config, track} = mode;
    const position = n => `translateX(${-(n - 1) * 100 / config.count}%)`;
    track.style.transform = position(config.order[0]);
    if (!paused) {
      const durations = config.order.map(n => config.durationOverrides?.[n] ?? config.frameMs);
      const duration = durations.reduce((sum, ms) => sum + ms, 0);
      let elapsed = 0;
      const keyframes = config.order.map((n, i) => {
        const keyframe = {transform: position(n), offset: elapsed / duration, easing: 'steps(1, end)'};
        elapsed += durations[i]; return keyframe;
      });
      keyframes.push({transform: position(config.order.at(-1)), offset: 1, easing: 'steps(1, end)'});
      const loop = action !== 'wave' || this.hasAttribute('loop');
      if (config.order.length > 1) this._frameAnimation = track.animate(keyframes, {duration, iterations: loop ? Infinity : 1, fill: 'forwards'});
      if (action === 'wave' && !loop) this._later(() => this.play('idle'), duration);
    }
    return true;
  }

  _applyFlipbook(paused) {
    const requested = this.getAttribute('frames') || 'walk';
    const key = ['idle', 'wave', 'walk'].includes(requested) && this._frameModes?.[requested] ? requested : 'idle';
    if (key !== requested) warnOnce(`flipbook:${this._manifest.name}:${requested}`, `翻頁書 ${requested} 不可用，顯示靜態 idle。`);
    this.dataset.action = 'flipbook';
    this._stage.className = 'stage static flipbook';
    const useFrames = this._showFrames(key, true);
    this.dataset.mode = 'flipbook';
    this._rig.hidden = useFrames;
    this._walkWindow.hidden = true;
    this._stage.querySelector('.travel').style.transform = '';
    if (useFrames) {
      const {config, track} = this._activeFrames;
      const value = Number(this.getAttribute('frame') ?? 1);
      const index = ((Number.isFinite(value) ? Math.trunc(value) - 1 : 0) % config.count + config.count) % config.count;
      track.style.transform = `translateX(${-index * 100 / config.count}%)`;
    } else {
      // Missing frame assets still get a neutral, non-animated legacy pose.
      for (const key of ['arm-l', 'arm-r', 'eye-open']) this._rig.querySelector(`[data-part="${key}"]`).hidden = false;
      for (const key of ['arm-l-wave', 'arm-r-wave', 'eye-closed']) this._rig.querySelector(`[data-part="${key}"]`).hidden = true;
      this._rig.querySelector('[data-part="mouth-o"]').hidden = this._manifest.defaultMouth !== 'mouth-o';
      this._rig.querySelector('[data-part="mouth-smile"]').hidden = this._manifest.defaultMouth === 'mouth-o';
    }
    this._resize();
    if (!paused && this.hasAttribute('breathe')) {
      this._later(() => { this._stage.className += ' flipbook-breathing'; }, 2000);
    }
  }

  _applyAction() {
    this._clearTimers();
    if (!this._manifest || !this.isConnected) return;
    if (this.getAttribute('mode') === 'flipbook') {
      this._applyFlipbook(this._motion.matches || document.hidden);
      return;
    }
    let action = this.getAttribute('action') || 'idle';
    if (!ACTIONS.has(action)) {
      warnOnce(`action:${action}`, `未知動作「${action}」，改用 idle。`); action = 'idle';
    }
    if (action === 'walk' && !this._frameModes?.walk && this._walkImages.length !== 4) {
      warnOnce(`walk:${this._manifest.name}`, `${this._manifest.name} 缺少 walk-1..4.png，改用 idle。`);
      action = 'idle';
    }
    const paused = this._motion.matches || document.hidden;
    if (paused) action = 'idle';
    this.dataset.action = action;
    this._stage.className = `stage ${paused ? 'static' : 'moving'} action-${action}`;
    const useFrames = this._showFrames(action, paused);
    this._rig.hidden = useFrames || action === 'walk';
    this._walkWindow.hidden = useFrames || action !== 'walk';
    this._walkWindow.classList.remove('blinking');
    this._stage.querySelector('.travel').style.transform = '';
    this._resize();
    for (const [key, visible] of Object.entries({
      'eye-open': true, 'eye-closed': false,
      'mouth-o': this._manifest.defaultMouth === 'mouth-o',
      'mouth-smile': this._manifest.defaultMouth !== 'mouth-o',
      'arm-l': true, 'arm-r': true,
      'arm-l-wave': action === 'wave', 'arm-r-wave': action === 'wave',
    })) {
      const part = this._rig.querySelector(`[data-part="${key}"]`);
      if (part) part.hidden = !visible;
      const pivot = this._rig.querySelector(`[data-pivot="${key}"]`);
      if (pivot) pivot.hidden = !visible;
      const guide = this._rig.querySelector(`[data-guide="${key}"]`);
      if (guide) guide.hidden = !visible;
    }
    if (paused) return;
    if (action === 'wave' && !useFrames) {
      const arms = ['arm-l', 'arm-r', 'arm-l-wave', 'arm-r-wave'].map(key => this._rig.querySelector(`[data-part="${key}"]`));
      for (const arm of arms) arm.style.animation = 'none';
      void this._rig.offsetWidth;
      for (const arm of arms) arm.style.animation = '';
      // Match the CSS timeline: .2s raise + 3 × .6s swing + .35s lower.
      if (!this.hasAttribute('loop')) this._later(() => this.play('idle'), 2350);
    }
    if (action === 'blink') this._blink();
    if (action === 'walk') this._beginWalk();
    if (!useFrames || this._activeFrames.blinkLayer) this._scheduleBlink();
  }
}

if (!customElements.get('tea-chara')) customElements.define('tea-chara', TeaChara);
