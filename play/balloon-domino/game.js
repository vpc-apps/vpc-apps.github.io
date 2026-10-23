/* Balloon Domino – browser demo. Plain JS + canvas, no external requests.
 * Rules are a straight port of the Android game (lib/game/sky.dart and
 * lib/game/game_state.dart); levels.js is exported from the real level data
 * by p5_pop_chain/tool/export_web_demo.dart. */
'use strict';

// ---------------------------------------------------------------- config
const CONFIG = {
  // Set to false to remove every Google Play link and mention (e.g. for
  // YouTube Playables, which may not allow external links). ?noplay=1 also works.
  SHOW_PLAY_LINKS: true,
  PLAY_URL: 'https://play.google.com/store/apps/details?id=in.vpconsulting.balloondomino',
  FULL_GAME: '400 skies',
};
const Q = new URLSearchParams(location.search);
if (Q.get('noplay') === '1') CONFIG.SHOW_PLAY_LINKS = false;
const DEMO = Q.get('demo');
const SELFTEST = Q.get('selftest') === '1';

// ---------------------------------------------------------------- rules (port of sky.dart)
const COLS = 6, ROWS = 8;
/** Up, up-right, right, down-right, down, down-left, left, up-left. */
const DIRS = [[-1, 0], [-1, 1], [0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1]];
const inside = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;

/** `r,c,arrows[,a][,b]` separated by `;` (Balloon.decode). */
function decodeSky(sky) {
  return sky.split(';').map((s) => {
    const p = s.split(',');
    return { r: +p[0], c: +p[1], arrows: p[2].split('').filter((x) => x !== '').map(Number), armour: p.includes('a'), bomb: p.includes('b') };
  });
}
const freshHits = (balloons) => balloons.map((b) => (b.armour ? 2 : 1));

/** Chain reaction from tapping [starts] with remaining hit counts [hits0].
 *  Tick 0 holds the tapped pop (and bomb blasts); each later tick moves every
 *  dart one cell and lists what it hit. */
function simulate(balloons, starts, hits0) {
  const hits = hits0.slice();
  const at = new Map();
  balloons.forEach((b, i) => at.set(b.r * COLS + b.c, i));
  const ticks = [];
  let darts = []; // [r, c, dr, dc]

  function pop(i, events) {
    if (hits[i] === 0 && events.some((e) => e.i === i && e.k === 'pop')) return;
    hits[i] = 0;
    events.push({ i, k: 'pop' });
    const b = balloons[i];
    for (const d of b.arrows) darts.push([b.r, b.c, DIRS[d][0], DIRS[d][1]]);
    if (b.bomb) {
      for (const [dr, dc] of DIRS) {
        const j = at.get((b.r + dr) * COLS + (b.c + dc));
        if (inside(b.r + dr, b.c + dc) && j !== undefined && hits[j] > 0) pop(j, events);
      }
    }
  }

  const first = [];
  for (const s of starts) if (hits[s] > 0) pop(s, first);
  ticks.push({ darts: [], events: first });

  let guard = 0;
  while (darts.length && guard++ < 200) {
    const moves = [], events = [], current = darts, next = [];
    darts = [];
    for (const [r, c, dr, dc] of current) {
      const nr = r + dr, nc = c + dc;
      moves.push([r, c, nr, nc]);
      if (!inside(nr, nc)) continue;
      const j = at.get(nr * COLS + nc);
      if (j !== undefined && hits[j] > 0) {
        hits[j]--;
        if (hits[j] === 0) {
          hits[j] = 1; // let pop() run its effects
          pop(j, events);
        } else {
          events.push({ i: j, k: 'crack' });
        }
        continue;
      }
      next.push([nr, nc, dr, dc]);
    }
    darts = darts.concat(next);
    ticks.push({ darts: moves, events });
  }
  return { ticks, hits, cleared: hits.every((h) => h === 0) };
}

/** Every first tap (or ordered tap pair on 2-tap skies) that clears the sky. */
function winningStarts(balloons, taps) {
  const fresh = freshHits(balloons), wins = [];
  for (let i = 0; i < balloons.length; i++) {
    const first = simulate(balloons, [i], fresh);
    if (first.cleared) { wins.push([i]); continue; }
    if (taps < 2) continue;
    for (let j = 0; j < balloons.length; j++) {
      if (first.hits[j] > 0 && simulate(balloons, [j], first.hits).cleared) wins.push([i, j]);
    }
  }
  return wins;
}

/** A tap that still leads to a clear sky within [tapsLeft], or null. */
function bestTap(balloons, hits, tapsLeft) {
  for (let i = 0; i < balloons.length; i++) {
    if (hits[i] === 0) continue;
    const a = simulate(balloons, [i], hits);
    if (a.cleared) return i;
    if (tapsLeft >= 2) {
      for (let j = 0; j < balloons.length; j++) if (a.hits[j] > 0 && simulate(balloons, [j], a.hits).cleared) return i;
    }
  }
  return null;
}

/** One play of a level (port of GameState, without the ad-only bonus tap). */
class Game {
  constructor(level) {
    this.level = level;
    this.balloons = decodeSky(level.sky);
    this.hits = freshHits(this.balloons);
    this.tapsLeft = level.taps;
    this.tapsUsed = 0;
    this.status = 'playing';
    this.attempt = 1;
  }
  get remaining() { return this.hits.filter((h) => h > 0).length; }
  /** 3 stars first try, 2 after retries. */
  get stars() { return this.status !== 'won' ? 0 : this.attempt === 1 ? 3 : 2; }
  tap(i) {
    if (this.status !== 'playing' || this.tapsLeft <= 0 || this.hits[i] === 0) return null;
    const chain = simulate(this.balloons, [i], this.hits);
    this.hits = chain.hits;
    this.tapsLeft--;
    this.tapsUsed++;
    if (chain.cleared) this.status = 'won';
    else if (this.tapsLeft === 0) this.status = 'lost';
    return chain;
  }
  retry() {
    this.hits = freshHits(this.balloons);
    this.tapsLeft = this.level.taps;
    this.tapsUsed = 0;
    this.status = 'playing';
    this.attempt++;
  }
  hint() { return bestTap(this.balloons, this.hits, this.tapsLeft); }
}

// ---------------------------------------------------------------- progress (localStorage, optional)
const KEY = 'balloondomino.demo.v1';
const store = (() => {
  let s = { unlocked: 1, stars: [], tutorialDone: false, muted: false };
  const live = !DEMO && !SELFTEST;
  try { if (live) Object.assign(s, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* private mode */ }
  return {
    get: () => s,
    save() { try { if (live) localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* ignore */ } },
  };
})();

// ---------------------------------------------------------------- sound (WebAudio, synthesised)
const Sfx = (() => {
  let ctx = null;
  const on = () => !store.get().muted;
  function ac() {
    if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; ctx = new C(); }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function pop(volume = 1) {
    if (!on()) return; const a = ac(); if (!a) return;
    const t = a.currentTime, g = a.createGain();
    g.connect(a.destination);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5 * volume, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    const o = a.createOscillator();
    o.type = 'triangle';
    const f = 520 + Math.random() * 160;
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.35, t + 0.1);
    o.connect(g); o.start(t); o.stop(t + 0.13);
    // a short burst of filtered noise for the "snap"
    const n = a.createBufferSource(), len = Math.floor(a.sampleRate * 0.05), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    n.buffer = buf;
    const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 0.8;
    const ng = a.createGain(); ng.gain.value = 0.35 * volume;
    n.connect(bp); bp.connect(ng); ng.connect(a.destination); n.start(t);
  }
  function win() {
    if (!on()) return; const a = ac(); if (!a) return;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, k) => {
      const t = a.currentTime + k * 0.09, o = a.createOscillator(), g = a.createGain();
      o.type = 'triangle'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.28, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (k === 3 ? 0.5 : 0.18));
      o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + 0.55);
    });
  }
  return { pop, win, unlock: () => { if (on()) ac(); } };
})();

// ---------------------------------------------------------------- painting (port of sky_view.dart, day theme)
const BALLOON_COLORS = ['#FF2E7E', '#1FA8FF', '#FFC800', '#14D99A', '#FF7A1A', '#9B4DFF'];
const DART_TICK = 125; // ms per cell
const INK = '#4A1738';

function mix(hex, to, t) {
  const a = parseInt(hex.slice(1), 16), b = parseInt(to.slice(1), 16);
  const ch = (x, s) => (x >> s) & 255;
  const m = (s) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t);
  return `rgb(${m(16)},${m(8)},${m(0)})`;
}

function paintSky(ctx, w, h, t) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#8FD3FF'); g.addColorStop(1, '#FFE3C9');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  for (const [cx, cy, s] of [[0.2, 0.12, 1.0], [0.75, 0.32, 0.8], [0.35, 0.78, 1.1]]) {
    const ww = w + 140, x = ((cx * w + t * 9 * s) % ww) - 70, y = cy * h;
    ctx.beginPath();
    for (const [dx, dy, r] of [[0, 0, 22], [24, -8, 26], [50, 0, 20]]) {
      ctx.moveTo(x + dx * s + r * s, y + dy * s);
      ctx.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2);
    }
    ctx.fill();
  }
}

function star(ctx, cx, cy, r, color) {
  ctx.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5, rr = k % 2 ? r * 0.45 : r;
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
    k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.closePath(); ctx.fillStyle = color; ctx.fill();
}

/** A shiny balloon with string, arrows, armour ring (2 intact / 1 cracked)
 *  or bomb star, an optional pulsing hint ring, and an optional squash. */
function paintBalloon(ctx, cx, cy, r, { color, arrows = [], bomb = false, armour = 0, highlight = null, scale = 1 }) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  const base = bomb ? '#3A2D4F' : color, dark = mix(base, '#000000', 0.16);
  // string
  ctx.beginPath();
  ctx.moveTo(0, r * 1.12);
  ctx.quadraticCurveTo(r * 0.25, r * 1.6, 0, r * 2.0);
  ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(74,23,56,0.4)'; ctx.stroke();
  // body
  const gx = -0.35 * r, gy = -0.45 * r * 1.12;
  const grad = ctx.createRadialGradient(gx, gy, 0, gx, gy, 0.9 * 2 * r);
  grad.addColorStop(0, bomb ? '#7A6A92' : '#FFFFFF'); grad.addColorStop(0.3, base); grad.addColorStop(1, dark);
  ctx.beginPath(); ctx.ellipse(0, 0, r, r * 1.12, 0, 0, Math.PI * 2); ctx.fillStyle = grad; ctx.fill();
  // knot
  ctx.beginPath(); ctx.moveTo(-r * 0.13, r * 1.12); ctx.lineTo(r * 0.13, r * 1.12); ctx.lineTo(0, r * 1.27); ctx.closePath();
  ctx.fillStyle = dark; ctx.fill();
  if (bomb) star(ctx, 0, 0, r * 0.45, '#FFC23D');
  if (armour > 0) {
    const rx = r + 3.5, ry = r * 1.12 + 3.5;
    if (armour === 2) {
      ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.lineWidth = 4.5; ctx.strokeStyle = '#C9D3E0'; ctx.stroke();
      ctx.lineWidth = 1.5; ctx.strokeStyle = '#8E9BB0'; ctx.stroke();
    } else {
      ctx.lineWidth = 3; ctx.strokeStyle = '#8E9BB0';
      for (let k = 0; k < 8; k++) { ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, (k * Math.PI) / 4, (k * Math.PI) / 4 + Math.PI / 7); ctx.stroke(); }
    }
  }
  // arrows radiating from the centre
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const d of arrows) {
    const [dr, dc] = DIRS[d], len = Math.hypot(dr, dc), ux = dc / len, uy = dr / len, nx = -uy, ny = ux;
    const fx = ux * r * 0.12, fy = uy * r * 0.12, tx = ux * r * 0.86, ty = uy * r * 0.86, bx = tx - ux * r * 0.3, by = ty - uy * r * 0.3;
    ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(bx, by);
    ctx.lineWidth = Math.max(3.4, r * 0.11 + 2.4); ctx.strokeStyle = 'rgba(58,18,48,0.55)'; ctx.stroke();
    ctx.lineWidth = Math.max(2, r * 0.11); ctx.strokeStyle = '#FFFFFF'; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(tx, ty);
    ctx.lineTo(bx + nx * r * 0.2, by + ny * r * 0.2); ctx.lineTo(bx - nx * r * 0.2, by - ny * r * 0.2); ctx.closePath();
    ctx.fillStyle = '#FFFFFF'; ctx.fill();
    ctx.lineWidth = Math.max(1.2, r * 0.045); ctx.strokeStyle = 'rgba(58,18,48,0.55)'; ctx.stroke();
  }
  if (arrows.length) { ctx.beginPath(); ctx.arc(0, 0, r * 0.1, 0, Math.PI * 2); ctx.fillStyle = '#FFFFFF'; ctx.fill(); }
  if (highlight != null) {
    ctx.beginPath(); ctx.arc(0, 0, r * 1.6, 0, Math.PI * 2);
    ctx.lineWidth = 5; ctx.strokeStyle = `rgba(255,194,61,${Math.max(0, Math.min(1, highlight))})`; ctx.stroke();
  }
  ctx.restore();
}

function paintDart(ctx, x, y, angle, cell) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
  ctx.fillStyle = INK;
  ctx.fillRect(-cell * 0.22, -1.5, cell * 0.3, 3);
  ctx.beginPath(); ctx.moveTo(cell * 0.14, 0); ctx.lineTo(cell * 0.04, -5); ctx.lineTo(cell * 0.04, 5); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#FF4F87'; ctx.fillRect(-cell * 0.24, -4, 6, 8);
  ctx.restore();
}

// ---------------------------------------------------------------- clock (pausable, so ?demo can freeze a frame)
let clock = 0;
const waiters = [];
const wait = (ms) => new Promise((res) => waiters.push({ at: clock + ms, res }));
// Screenshot modes drive the clock themselves (fastForward), so a headless
// browser captures the same frame every time whatever its frame rate.
const MANUAL_CLOCK = !!DEMO && DEMO !== 'play';
function advance(dt) {
  clock += dt;
  for (let k = waiters.length - 1; k >= 0; k--) if (waiters[k].at <= clock) waiters.splice(k, 1)[0].res();
  sky.step(dt / 1000);
}
async function fastForward(ms) {
  const end = clock + ms;
  while (clock < end) {
    advance(Math.min(16, end - clock));
    for (let j = 0; j < 8; j++) await 0; // let promise chains continue
  }
}

// ---------------------------------------------------------------- sky view (display state; rules live in Game)
const sky = {
  canvas: document.getElementById('sky'), cell: 50, balloons: [], hits: [], darts: [], particles: [], rings: [], highlight: null, busy: false,
  reset(balloons, hits) { this.balloons = balloons; this.hits = hits.slice(); this.darts = []; this.particles = []; this.rings = []; this.highlight = null; this.busy = false; },
  /** Centre of balloon i in cell units, with the game's stable jitter. */
  centre(i) {
    const b = this.balloons[i], jx = ((i * 37 + 11) % 13) / 13 - 0.5, jy = ((i * 53 + 7) % 11) / 11 - 0.5;
    return [b.c + 0.5 + jx * 0.16, b.r + 0.5 + jy * 0.16];
  },
  burst(i) {
    const b = this.balloons[i], [x, y] = this.centre(i), color = b.bomb ? '#FFC23D' : BALLOON_COLORS[i % BALLOON_COLORS.length];
    for (let k = 0; k < 16; k++) {
      const a = Math.random() * Math.PI * 2, sp = 1.2 + Math.random() * 2.2;
      this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.8, life: 0.65, color });
    }
    this.rings.push({ x, y, start: clock, color });
  },
  async play(chain, onEvent) {
    this.busy = true; this.highlight = null;
    for (let k = 0; k < chain.ticks.length; k++) {
      const t = chain.ticks[k];
      this.darts = t.darts.map((m) => ({ m, start: clock }));
      if (k > 0) await wait(DART_TICK);
      for (const e of t.events) {
        if (e.k === 'pop') { this.hits[e.i] = 0; this.burst(e.i); } else this.hits[e.i] = 1;
        onEvent(e);
      }
    }
    this.darts = []; this.busy = false;
  },
  step(dt) {
    for (const p of this.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 4.5 * dt; p.life -= dt; }
    this.particles = this.particles.filter((p) => p.life > 0);
    this.rings = this.rings.filter((r) => clock - r.start < 320);
  },
  draw() {
    const cv = this.canvas, ctx = cv.getContext('2d'), cell = this.cell, w = cell * COLS, h = cell * ROWS, t = clock / 1000;
    const dpr = cv.width / w;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintSky(ctx, w, h, t);
    for (const rg of this.rings) {
      const p = (clock - rg.start) / 320;
      ctx.beginPath(); ctx.arc(rg.x * cell, rg.y * cell, cell * (0.3 + 0.55 * p), 0, Math.PI * 2);
      ctx.lineWidth = 4 * (1 - p) + 0.5; ctx.strokeStyle = rg.color; ctx.globalAlpha = 1 - p; ctx.stroke(); ctx.globalAlpha = 1;
    }
    for (let i = 0; i < this.balloons.length; i++) {
      if (this.hits[i] === 0) continue;
      const b = this.balloons[i], [x, y] = this.centre(i), bob = Math.sin(t * 1.7 + i) * cell * 0.04;
      paintBalloon(ctx, x * cell, y * cell + bob, cell * 0.4, {
        color: BALLOON_COLORS[i % BALLOON_COLORS.length], arrows: b.arrows, bomb: b.bomb,
        armour: b.armour ? this.hits[i] : 0,
        highlight: this.highlight === i ? 0.6 + 0.4 * Math.sin(t * 7) : null,
        scale: this.highlight === i ? 1 + 0.04 * Math.sin(t * 7) : 1,
      });
    }
    for (const d of this.darts) {
      const p = Math.min(1, (clock - d.start) / DART_TICK), [r0, c0, r1, c1] = d.m;
      paintDart(ctx, (c0 + 0.5 + (c1 - c0) * p) * cell, (r0 + 0.5 + (r1 - r0) * p) * cell, Math.atan2(r1 - r0, c1 - c0), cell);
    }
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / 0.65)); ctx.fillStyle = p.color;
      ctx.fillRect(p.x * cell - 3, p.y * cell - 3, 6, 6);
    }
    ctx.globalAlpha = 1;
  },
  layout() {
    const stage = document.getElementById('stage'), sw = stage.clientWidth, sh = stage.clientHeight;
    if (!sw || !sh) return;
    const cell = Math.floor(Math.min(sw / COLS, (sh - 8) / ROWS));
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    this.cell = cell;
    this.canvas.style.width = cell * COLS + 'px'; this.canvas.style.height = cell * ROWS + 'px';
    this.canvas.width = Math.round(cell * COLS * dpr); this.canvas.height = Math.round(cell * ROWS * dpr);
  },
  hitTest(px, py) {
    let best = null, bestD = Infinity;
    for (let i = 0; i < this.balloons.length; i++) {
      if (this.hits[i] === 0) continue;
      const [x, y] = this.centre(i), d = Math.hypot(x * this.cell - px, y * this.cell - py);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best !== null && bestD < this.cell * 0.6 ? best : null;
  },
};

// ---------------------------------------------------------------- home backdrop: balloons drifting upward
const backdrop = (() => {
  let seed = 5;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const floaters = Array.from({ length: 11 }, (_, i) => ({ x: rnd(), y: rnd(), r: 18 + rnd() * 16, laps: 1 + Math.floor(rnd() * 2), i, arrows: [Math.floor(rnd() * 8)] }));
  const cv = document.getElementById('backdrop');
  return {
    draw() {
      const w = cv.clientWidth, h = cv.clientHeight; if (!w) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      const t = (clock / 40000) % 1;
      ctx.globalAlpha = 0.85;
      for (const f of floaters) {
        const y = (((f.y - t * f.laps) % 1) + 1) % 1 * (h + 120) - 60;
        const x = f.x * w + Math.sin((t * f.laps + f.i / 11) * Math.PI * 2 * 3) * 14;
        paintBalloon(ctx, x, y, f.r, { color: BALLOON_COLORS[f.i % 6], arrows: f.arrows });
      }
      ctx.globalAlpha = 1;
    },
  };
})();

// ---------------------------------------------------------------- icons (inline SVG)
const ICON = {
  back: 'M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z',
  help: 'M11 18h2v-2h-2v2zm1-14C9.8 4 8 5.8 8 8h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.2-1.8-4-4-4z',
  retry: 'M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
  play: 'M8 5v14l11-7z',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  next: 'M4 11h12.2l-5.6-5.6L12 4l8 8-8 8-1.4-1.4 5.6-5.6H4z',
  check: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z',
  star: 'M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
  tap: 'M9 11.24V7.5a2.5 2.5 0 0 1 5 0v3.74c1.21-.81 2-2.18 2-3.74a4.5 4.5 0 0 0-9 0c0 1.56.79 2.93 2 3.74zm9.84 4.63-4.54-2.26c-.17-.07-.35-.11-.54-.11H13v-6a1.5 1.5 0 0 0-3 0v10.74l-3.43-.72a1.12 1.12 0 0 0-1.03 1.9l4.01 4.01c.27.27.65.44 1.06.44h6.79c.75 0 1.33-.55 1.44-1.28l.75-5.27c.01-.07.02-.14.02-.2 0-.62-.38-1.16-.91-1.38z',
  split: 'M14 4l2.29 2.29-2.88 2.88 1.42 1.42 2.88-2.88L20 10V4zm-4 0H4v6l2.29-2.29 4.71 4.7V20h2v-8.41l-5.29-5.3z',
  flag: 'M14.4 6 14 4H5v17h2v-7h5.6l.4 2h7V6z',
  soundOn: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.5 4.5 0 0 0 16.5 12zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06A9 9 0 0 0 14 3.23z',
  soundOff: 'M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0 0 21 12a9 9 0 0 0-7-8.77v2.06A7 7 0 0 1 19 12zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a9 9 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z',
};
const svg = (name, cls = '') => `<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true"><path d="${ICON[name]}"/></svg>`;
const PLAY_LOGO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#00D7FE" d="M3.6 2.2 13.5 12 3.6 21.8c-.3-.2-.5-.6-.5-1.1V3.3c0-.5.2-.9.5-1.1z"/><path fill="#FFCE00" d="m17 15.5-3.5-3.5L17 8.5l4 2.3c1.1.6 1.1 1.7 0 2.4z"/><path fill="#FF3A44" d="M17 15.5 13.5 12 3.6 21.8c.4.3 1 .3 1.6 0z"/><path fill="#00F076" d="M17 8.5 5.2 2.2c-.6-.3-1.2-.3-1.6 0L13.5 12z"/></svg>';
const gpInner = '<span><small>GET IT ON</small>Google Play</span>';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------------------------------------------------------------- UI
const $ = (id) => document.getElementById(id);
const frame = $('frame'), overlay = $('overlay'), card = $('card');
let screen = 'home', game = null, levelIdx = 0, tutorial = false, cardOpen = false, leaving = false;

function show(name) {
  screen = name;
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('on', s.id === name);
  if (name === 'game') requestAnimationFrame(() => sky.layout());
  if (name === 'levels') renderGrid();
  if (name === 'home') renderHome();
}

function renderHome() {
  const s = store.get(), next = Math.min(s.unlocked, LEVELS.length), allDone = s.stars.filter(Boolean).length >= LEVELS.length;
  $('playBtn').innerHTML = svg('play') + (allDone ? 'Play again' : `Play  ·  Level ${next}`);
}

function renderGrid() {
  const s = store.get();
  $('grid').innerHTML = LEVELS.map((l, i) => {
    const st = s.stars[i] || 0, locked = i + 1 > s.unlocked, next = i + 1 === s.unlocked && !st;
    const stars = '★★★'.split('').map((c, k) => (k < st ? c : `<span class="off">${c}</span>`)).join('');
    return `<button class="lvl${locked ? ' locked' : ''}${next ? ' next' : ''}" data-level="${i}" aria-label="Level ${l.number}${locked ? ', locked' : ''}">${l.number}<i>${stars}</i></button>`;
  }).join('');
}

function updateHud() {
  $('lvlNo').textContent = game.level.number;
  $('left').textContent = `${game.remaining} to pop`;
  $('taps').textContent = game.tapsLeft;
  $('banner').classList.toggle('on', tutorial);
}

function openLevel(idx, { rules } = {}) {
  levelIdx = idx; leaving = false;
  game = new Game(LEVELS[idx]);
  sky.reset(game.balloons, game.hits);
  tutorial = false;
  show('game');
  updateHud();
  closeCard();
  const s = store.get();
  if (rules ?? (idx === 0 && !s.tutorialDone)) showRules(idx === 0 && !s.tutorialDone);
}

function openCard(html, cls = '') {
  card.className = 'card ' + cls;
  card.innerHTML = html;
  overlay.classList.add('on');
  cardOpen = true;
}
function closeCard() { overlay.classList.remove('on'); cardOpen = false; }

function showRules(firstTime) {
  const line = (icon, text) => `<div class="line">${svg(icon)}<span>${text}</span></div>`;
  openCard(`<h3>How to play</h3>
    ${line('tap', 'Tap a balloon. It pops and fires a dart along each of its arrows.')}
    ${line('split', 'A dart pops the first balloon in its way, which fires its own darts.')}
    ${line('flag', 'Clear the whole sky with your taps. The trick is choosing where to start.')}
    ${line('star', 'First try = 3 stars. Retries = 2.')}
    <button class="chunky primary" data-act="${firstTime ? 'showme' : 'gotit'}">${svg(firstTime ? 'play' : 'check')}${firstTime ? 'Show me' : 'Got it'}</button>`);
}

function startTutorial() {
  closeCard();
  tutorial = true;
  sky.highlight = game.hint();
  updateHud();
}

function skipTutorial() {
  tutorial = false; sky.highlight = null;
  store.get().tutorialDone = true; store.save();
  updateHud();
}

async function tapBalloon(i) {
  if (sky.busy || cardOpen || game.status !== 'playing') return;
  const chain = game.tap(i);
  if (!chain) return;
  if (navigator.vibrate) try { navigator.vibrate(8); } catch (e) { /* ignore */ }
  const g = game;
  await sky.play(chain, (e) => (e.k === 'pop' ? Sfx.pop() : Sfx.pop(0.3)));
  if (g !== game) return;
  updateHud();
  if (game.status === 'playing') { if (tutorial) sky.highlight = game.hint(); return; }
  if (game.status === 'won') {
    const s = store.get();
    s.stars[levelIdx] = Math.max(s.stars[levelIdx] || 0, game.stars);
    s.unlocked = Math.max(s.unlocked, Math.min(LEVELS.length, levelIdx + 2));
    if (tutorial) { s.tutorialDone = true; tutorial = false; updateHud(); }
    store.save();
    Sfx.win();
  }
  await wait(450);
  if (g === game) showResult();
}

function showResult() {
  const won = game.status === 'won', last = levelIdx === LEVELS.length - 1;
  if (won) {
    const stars = [0, 1, 2].map((k) => svg('star', k < game.stars ? 'on' : '')).join('');
    const body = game.attempt === 1 ? 'First try. Brilliant!' : `Solved on try ${game.attempt}. First-try clears earn 3 stars.`;
    openCard(`<div class="stars">${stars}</div><h3>Sky cleared!</h3><p class="body">${body}</p>
      <div class="row"><button class="chunky" data-act="replay">${svg('retry')}Replay</button>
      <button class="chunky primary" data-act="${last ? 'end' : 'next'}">${svg('next')}${last ? 'Finish' : 'Next'}</button></div>`, 'center');
  } else {
    openCard(`<h3>${game.remaining} left!</h3><p class="body">So close. Try a different starting balloon.</p>
      <div class="row"><button class="chunky" data-act="levels">${svg('grid')}Levels</button>
      <button class="chunky primary" data-act="retry">${svg('retry')}Retry</button></div>`, 'center');
  }
}

function showEnd() {
  const s = store.get(), total = s.stars.reduce((a, b) => a + (b || 0), 0);
  const gp = CONFIG.SHOW_PLAY_LINKS
    ? `<p class="body">Get all ${CONFIG.FULL_GAME} free on Google Play: armoured balloons, bombs, two-tap skies and a Daily Challenge.</p>
       <a class="gp big" href="${CONFIG.PLAY_URL}" target="_blank" rel="noopener">${PLAY_LOGO}${gpInner}</a>`
    : `<p class="body">You cleared all ${LEVELS.length} demo skies. The full game has ${CONFIG.FULL_GAME}, armoured balloons, bombs and two-tap skies.</p>`;
  openCard(`<div class="stars">${[0, 1, 2].map(() => svg('star', 'on')).join('')}</div>
    <h3>You finished the demo!</h3><p class="body" style="margin-bottom:8px">${total} of ${LEVELS.length * 3} stars collected.</p>${gp}
    <div class="row" style="margin-top:14px"><button class="chunky" data-act="levels">${svg('grid')}Levels</button>
    <button class="chunky" data-act="restart">${svg('retry')}Play again</button></div>`, 'center');
}

function retry() {
  if (sky.busy) return;
  game.retry();
  sky.reset(game.balloons, game.hits);
  if (tutorial) sky.highlight = game.hint();
  closeCard();
  updateHud();
}

// one delegated click handler for every button
document.addEventListener('click', (ev) => {
  Sfx.unlock();
  const lv = ev.target.closest('[data-level]');
  if (lv) { openLevel(+lv.dataset.level); return; }
  const b = ev.target.closest('[data-act]');
  if (!b) return;
  switch (b.dataset.act) {
    case 'home': show('home'); break;
    case 'levels': if (!sky.busy) { closeCard(); show('levels'); } break;
    case 'rules': if (!sky.busy && !cardOpen) showRules(false); break;
    case 'gotit': closeCard(); break;
    case 'showme': startTutorial(); break;
    case 'skip': skipTutorial(); break;
    case 'retry': retry(); break;
    case 'replay': openLevel(levelIdx, { rules: false }); break;
    case 'next': if (!leaving) { leaving = true; openLevel(levelIdx + 1); } break;
    case 'end': showEnd(); break;
    case 'restart': openLevel(0, { rules: false }); break;
  }
});
$('playBtn').addEventListener('click', () => {
  const s = store.get(), allDone = s.stars.filter(Boolean).length >= LEVELS.length;
  openLevel(allDone ? 0 : Math.min(s.unlocked, LEVELS.length) - 1);
});
$('levelsBtn').addEventListener('click', () => show('levels'));
sky.canvas.addEventListener('pointerdown', (ev) => {
  Sfx.unlock();
  const rect = sky.canvas.getBoundingClientRect(), i = sky.hitTest(ev.clientX - rect.left, ev.clientY - rect.top);
  if (i !== null) tapBalloon(i);
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && cardOpen && card.querySelector('[data-act="gotit"]')) closeCard();
  if ((ev.key === 'Enter' || ev.key === ' ') && cardOpen) { const p = card.querySelector('.chunky.primary'); if (p) { ev.preventDefault(); p.click(); } }
});
const muteBtn = $('mute');
function renderMute() { muteBtn.innerHTML = svg(store.get().muted ? 'soundOff' : 'soundOn'); }
muteBtn.addEventListener('click', () => { const s = store.get(); s.muted = !s.muted; store.save(); renderMute(); });
window.addEventListener('resize', () => { if (screen === 'game') sky.layout(); });

// static button labels/icons
for (const b of document.querySelectorAll('[data-act="home"],[data-act="levels"].icon')) b.innerHTML = svg('back');
for (const b of document.querySelectorAll('.hud [data-act="rules"]')) b.innerHTML = svg('help');
document.querySelector('.row [data-act="retry"]').innerHTML = svg('retry') + 'Retry';
$('lvlsBtn2').innerHTML = svg('grid') + 'Levels';
$('levelsBtn').innerHTML = svg('grid') + 'Levels';
for (const a of document.querySelectorAll('a.gp')) { a.href = CONFIG.PLAY_URL; a.innerHTML = PLAY_LOGO + gpInner; }
if (!CONFIG.SHOW_PLAY_LINKS) { frame.classList.add('no-play'); for (const a of document.querySelectorAll('a.gp')) a.remove(); }
renderMute();

// ---------------------------------------------------------------- main loop
let last = performance.now();
function frameLoop(now) {
  const dt = Math.min(50, now - last); last = now;
  if (!MANUAL_CLOCK) advance(dt);
  if (screen === 'game') sky.draw();
  else if (screen === 'home') backdrop.draw();
  requestAnimationFrame(frameLoop);
}

// ---------------------------------------------------------------- self-test and demo modes
function selfTest() {
  const out = [];
  let pass = 0;
  for (const l of LEVELS) {
    const g = new Game(l);
    for (const i of l.solution) g.tap(i);
    const wins = winningStarts(g.balloons, l.taps).length;
    const ok = g.status === 'won' && g.tapsUsed <= l.taps && wins === l.wins;
    if (ok) pass++;
    out.push(`L${l.number}: ${ok ? 'PASS' : 'FAIL'} status=${g.status} taps=${g.tapsUsed}/${l.taps} winningStarts=${wins} (game data says ${l.wins})`);
  }
  const summary = `SELFTEST ${pass === LEVELS.length ? 'PASS' : 'FAIL'} ${pass}/${LEVELS.length}`;
  document.title = summary;
  const pre = document.createElement('pre');
  pre.id = 'selftest'; pre.textContent = summary + '\n' + out.join('\n');
  pre.style.cssText = 'position:fixed;inset:0;margin:0;padding:12px;background:#fff;z-index:99;font:12px monospace;white-space:pre-wrap';
  document.body.appendChild(pre);
  console.log(pre.textContent);
}

async function runDemo() {
  const lvl = Math.max(1, Math.min(LEVELS.length, +(Q.get('level') || 1))) - 1;
  const s = store.get();
  if (DEMO === 'home') return show('home');
  if (DEMO === 'levels') { s.unlocked = 4; s.stars = [3, 3, 2]; return show('levels'); }
  if (DEMO === 'rules') { s.tutorialDone = false; return openLevel(0); }
  if (DEMO === 'tutorial') { s.tutorialDone = false; openLevel(0); return startTutorial(); }
  if (DEMO === 'end') { s.stars = LEVELS.map((_, i) => (i % 4 === 1 ? 2 : 3)); s.unlocked = LEVELS.length; openLevel(LEVELS.length - 1, { rules: false }); return showEnd(); }
  s.tutorialDone = true;
  if (DEMO === 'chain' || DEMO === 'win') { // ?demo=chain&level=N&freeze=ms : frame `ms` after the tap
    openLevel(lvl, { rules: false });
    await fastForward(400);
    tapBalloon(LEVELS[lvl].solution[0]);
    await fastForward(DEMO === 'chain' ? +(Q.get('freeze') || 300) : 4000);
    return;
  }
  if (DEMO === 'play') { // attract mode: plays every level's stored solution
    for (let k = lvl; ; k = (k + 1) % LEVELS.length) {
      openLevel(k, { rules: false });
      await wait(900);
      sky.highlight = LEVELS[k].solution[0];
      await wait(700);
      for (const i of LEVELS[k].solution) await tapBalloon(i);
      await wait(1400);
    }
  }
}

if (SELFTEST) selfTest();
show('home');
requestAnimationFrame(frameLoop);
if (DEMO) { document.documentElement.classList.add('shot'); runDemo(); }
