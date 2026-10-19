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

export class TeaChara extends HTMLElement {
  static observedAttributes = ['name', 'action', 'size', 'loop', 'flip'];

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

  _later(callback, delay) {
    const id = setTimeout(() => { this._timers.delete(id); callback(); }, delay);
    this._timers.add(id);
  }

  _clearTimers() {
    for (const id of this._timers) clearTimeout(id);
    this._timers.clear();
    cancelAnimationFrame(this._raf);
    this._raf = null;
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
      if (!this.isConnected || generation !== this._generation) return;
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
    const ratio = walk ? walk.naturalWidth / walk.naturalHeight : this._manifest ? this._manifest.canvas.width / this._manifest.canvas.height : .625;
    this.style.width = `${size * ratio}px`;
  }

  _setBlink(closed) {
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

  _applyAction() {
    this._clearTimers();
    if (!this._manifest || !this.isConnected) return;
    let action = this.getAttribute('action') || 'idle';
    if (!ACTIONS.has(action)) {
      warnOnce(`action:${action}`, `未知動作「${action}」，改用 idle。`); action = 'idle';
    }
    if (action === 'walk' && this._walkImages.length !== 4) {
      warnOnce(`walk:${this._manifest.name}`, `${this._manifest.name} 缺少 walk-1..4.png，改用 idle。`);
      action = 'idle';
    }
    const paused = this._motion.matches || document.hidden;
    if (paused) action = 'idle';
    this.dataset.action = action;
    this._stage.className = `stage ${paused ? 'static' : 'moving'} action-${action}`;
    this._rig.hidden = action === 'walk';
    this._walkWindow.hidden = action !== 'walk';
    this._walkWindow.classList.remove('blinking');
    this._stage.querySelector('.travel').style.transform = '';
    this._resize();
    for (const [key, visible] of Object.entries({
      'eye-open': true, 'eye-closed': false,
      'mouth-o': this._manifest.defaultMouth === 'mouth-o',
      'mouth-smile': this._manifest.defaultMouth !== 'mouth-o',
      'arm-l': action !== 'wave', 'arm-r': action !== 'wave',
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
    if (action === 'wave') {
      const arms = ['arm-l-wave', 'arm-r-wave'].map(key => this._rig.querySelector(`[data-part="${key}"]`));
      for (const arm of arms) arm.style.animation = 'none';
      void this._rig.offsetWidth;
      for (const arm of arms) arm.style.animation = '';
      if (!this.hasAttribute('loop')) this._later(() => this.play('idle'), 1800);
    }
    if (action === 'blink') this._blink();
    if (action === 'walk') this._beginWalk();
    this._scheduleBlink();
  }
}

if (!customElements.get('tea-chara')) customElements.define('tea-chara', TeaChara);
