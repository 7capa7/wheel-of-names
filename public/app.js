(() => {
  'use strict';

  // Zawsze wygrywa pozycja wpisana jako druga (indeks 1).
  const WINNER_INDEX = 1;
  const MIN_ENTRIES = 2;
  const SPIN_MS = 8000;
  const IDLE_SPEED = 0.12; // rad/s – powolny obrót koła przed pierwszym losowaniem
  const COLORS = ['#6DA9E0', '#8EDBAA', '#F3D46C', '#EE8A8F'];
  const DEFAULT_ENTRIES = ['Ali', 'Beatriz', 'Charles', 'Diya', 'Eric', 'Fatima', 'Gabriel', 'Hanna'];
  const STORAGE_KEY = 'wheel-entries';
  const TAU = Math.PI * 2;

  const $ = (id) => document.getElementById(id);
  const wrap = $('wheelWrap');
  const canvas = $('wheel');
  const ctx = canvas.getContext('2d');
  const textarea = $('entries');
  const hint = $('spinHint');
  const pointerFill = $('pointerFill');
  const backdrop = $('backdrop');

  const wheelLayer = document.createElement('canvas');
  const shadeLayer = document.createElement('canvas');

  let entries = [];
  let size = 0;
  let rotation = 0;
  let idle = true;
  let spin = null;
  let busy = false; // od kliknięcia do zamknięcia okienka
  let lastIndex = -1;
  let results = 0;

  const mod = (a, b) => ((a % b) + b) % b;

  function colorFor(i, n) {
    // ostatni segment nie może mieć tego samego koloru co pierwszy
    if (n > 1 && i === n - 1 && i % COLORS.length === 0) return COLORS[1];
    return COLORS[i % COLORS.length];
  }

  /* ---------- entries ---------- */

  function loadEntries() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved !== null) return saved;
    } catch (e) { /* brak dostępu do localStorage */ }
    return DEFAULT_ENTRIES.join('\n');
  }

  function onEntriesChange() {
    entries = textarea.value.split('\n').map((s) => s.trim()).filter(Boolean);
    $('entriesCount').textContent = entries.length;
    try { localStorage.setItem(STORAGE_KEY, textarea.value); } catch (e) { /* ignore */ }
    renderWheelLayer();
    lastIndex = -1;
  }

  /* ---------- drawing ---------- */

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    size = Math.max(1, Math.round(wrap.clientWidth * dpr));
    for (const c of [canvas, wheelLayer, shadeLayer]) c.width = c.height = size;
    renderWheelLayer();
    renderShadeLayer();
  }

  function renderWheelLayer() {
    const c = wheelLayer.getContext('2d');
    const R = size / 2;
    const n = entries.length;
    c.clearRect(0, 0, size, size);
    c.save();
    c.translate(R, R);

    if (n === 0) {
      c.fillStyle = '#4b5057';
      c.beginPath();
      c.arc(0, 0, R, 0, TAU);
      c.fill();
      c.restore();
      return;
    }

    const seg = TAU / n;
    for (let i = 0; i < n; i++) {
      const color = colorFor(i, n);
      c.beginPath();
      c.moveTo(0, 0);
      c.arc(0, 0, R, i * seg, (i + 1) * seg);
      c.closePath();
      c.fillStyle = color;
      c.strokeStyle = color;
      c.lineWidth = 1;
      c.fill();
      c.stroke();
    }

    const outer = R * 0.94;
    const maxLen = outer - R * 0.25;
    const maxByArc = 2 * R * 0.55 * Math.sin(Math.min(seg / 2, Math.PI / 2)) * 0.75;
    c.fillStyle = '#000';
    c.textAlign = 'right';
    c.textBaseline = 'middle';
    for (let i = 0; i < n; i++) {
      let font = Math.min(R * 0.13, maxByArc);
      c.font = `600 ${font}px Quicksand, sans-serif`;
      const w = c.measureText(entries[i]).width;
      if (w > maxLen) {
        font *= maxLen / w;
        c.font = `600 ${font}px Quicksand, sans-serif`;
      }
      c.save();
      c.rotate((i + 0.5) * seg);
      c.fillText(entries[i], outer, 0);
      c.restore();
    }
    c.restore();
  }

  function renderShadeLayer() {
    const c = shadeLayer.getContext('2d');
    const R = size / 2;
    c.clearRect(0, 0, size, size);
    c.save();
    c.beginPath();
    c.arc(R, R, R, 0, TAU);
    c.clip();

    const light = c.createRadialGradient(R * 0.7, R * 0.62, 0, R, R, R * 1.08);
    light.addColorStop(0, 'rgba(255,255,255,0.12)');
    light.addColorStop(0.55, 'rgba(255,255,255,0)');
    light.addColorStop(1, 'rgba(0,0,0,0.26)');
    c.fillStyle = light;
    c.fillRect(0, 0, size, size);

    const rim = c.createRadialGradient(R, R, R * 0.9, R, R, R);
    rim.addColorStop(0, 'rgba(0,0,0,0)');
    rim.addColorStop(1, 'rgba(0,0,0,0.14)');
    c.fillStyle = rim;
    c.fillRect(0, 0, size, size);

    const lw = Math.max(1, R * 0.006);
    c.lineWidth = lw;
    c.strokeStyle = 'rgba(255,255,255,0.16)';
    c.beginPath();
    c.arc(R, R, R - lw / 2, 0, TAU);
    c.stroke();
    c.restore();

    c.fillStyle = '#fff';
    c.beginPath();
    c.arc(R, R, R * 0.2, 0, TAU);
    c.fill();
  }

  function draw() {
    const R = size / 2;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate(R, R);
    ctx.rotate(rotation);
    ctx.drawImage(wheelLayer, -R, -R);
    ctx.restore();
    ctx.drawImage(shadeLayer, 0, 0);
  }

  // Wskaźnik stoi po prawej stronie (kąt 0), więc pod nim jest segment o kącie -rotation.
  function indexAtPointer() {
    const n = entries.length;
    if (!n) return -1;
    return Math.floor(mod(-rotation, TAU) / (TAU / n)) % n;
  }

  /* ---------- sound ---------- */

  let audio = null;
  let tickBuffer = null;

  function ensureAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!audio) {
      audio = new AC();
      const len = Math.floor(audio.sampleRate * 0.025);
      tickBuffer = audio.createBuffer(1, len, audio.sampleRate);
      const data = tickBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
    }
    if (audio.state === 'suspended') audio.resume();
  }

  function tick() {
    if (!audio) return;
    const src = audio.createBufferSource();
    src.buffer = tickBuffer;
    const filter = audio.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2400;
    filter.Q.value = 1.2;
    const gain = audio.createGain();
    gain.gain.value = 0.6;
    src.connect(filter).connect(gain).connect(audio.destination);
    src.start();
  }

  /* ---------- spinning ---------- */

  function startSpin() {
    if (busy || entries.length < MIN_ENTRIES) return;
    busy = true;
    ensureAudio();
    idle = false;
    hint.classList.add('hidden');
    textarea.readOnly = true;

    const n = entries.length;
    const seg = TAU / n;
    // losowe miejsce wewnątrz segmentu zwycięzcy, żeby nie wyglądało podejrzanie
    const offset = 0.12 + Math.random() * 0.76;
    const target = mod(-seg * (WINNER_INDEX + offset), TAU);
    const turns = 7 + Math.floor(Math.random() * 3);
    const from = rotation;
    const to = from + turns * TAU + mod(target - mod(from, TAU), TAU);

    spin = {
      from,
      to,
      start: performance.now(),
      winner: entries[WINNER_INDEX],
      color: colorFor(WINNER_INDEX, n),
    };
  }

  function finishSpin(done) {
    textarea.readOnly = false;
    results += 1;
    $('resultsCount').textContent = results;
    setTimeout(() => showWinner(done.winner, done.color), 350);
  }

  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  let lastFrame = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;

    if (spin) {
      const t = Math.min(1, (now - spin.start) / SPIN_MS);
      rotation = spin.from + (spin.to - spin.from) * easeOut(t);
      if (t >= 1) {
        const done = spin;
        spin = null;
        finishSpin(done);
      }
    } else if (idle) {
      rotation += IDLE_SPEED * dt;
    }

    const idx = indexAtPointer();
    if (idx !== lastIndex) {
      if (spin && lastIndex !== -1) tick();
      lastIndex = idx;
      pointerFill.setAttribute('fill', idx === -1 ? '#4b5057' : colorFor(idx, entries.length));
    }

    draw();
    requestAnimationFrame(frame);
  }

  /* ---------- winner dialog + confetti ---------- */

  function showWinner(name, color) {
    $('dialogHead').style.background = color;
    $('winnerName').textContent = name;
    backdrop.hidden = false;
    startConfetti();
  }

  function closeDialog() {
    backdrop.hidden = true;
    busy = false;
    stopConfetti();
  }

  const confettiCanvas = $('confetti');
  const cctx = confettiCanvas.getContext('2d');
  const CONFETTI_COLORS = ['#6DA9E0', '#8EDBAA', '#F3D46C', '#EE8A8F', '#B39DDB', '#FF7043', '#4DD0E1', '#F06292', '#FFF176'];
  let particles = [];
  let confettiRaf = 0;
  let confettiLast = 0;

  function makeParticle(x, y, vx, vy) {
    return {
      x, y, vx, vy,
      w: 6 + Math.random() * 6,
      h: 9 + Math.random() * 8,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      rot: Math.random() * TAU,
      vrot: (Math.random() - 0.5) * 10,
      flip: Math.random() * TAU,
      vflip: 5 + Math.random() * 8,
      wobble: Math.random() * TAU,
      vwobble: 2 + Math.random() * 3,
      drag: 2.4 + Math.random() * 1.2,
    };
  }

  function startConfetti() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    confettiCanvas.width = w * dpr;
    confettiCanvas.height = h * dpr;
    cctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    particles = [];
    // dwie "armatki" z dolnych rogów
    for (const [x, dir] of [[0, 1], [w, -1]]) {
      for (let i = 0; i < 120; i++) {
        const angle = -Math.PI / 2 + dir * (0.12 + Math.random() * 0.6);
        const speed = h * (1.5 + Math.random() * 1.7);
        particles.push(makeParticle(x, h + 10, Math.cos(angle) * speed, Math.sin(angle) * speed));
      }
    }
    // i trochę deszczu z góry
    for (let i = 0; i < 90; i++) {
      particles.push(makeParticle(Math.random() * w, -20 - Math.random() * h * 0.6, (Math.random() - 0.5) * 80, 120 + Math.random() * 120));
    }

    cancelAnimationFrame(confettiRaf);
    confettiLast = performance.now();
    confettiRaf = requestAnimationFrame(stepConfetti);
  }

  function stepConfetti(now) {
    const dt = Math.min(0.033, (now - confettiLast) / 1000);
    confettiLast = now;
    const w = window.innerWidth;
    const h = window.innerHeight;
    cctx.clearRect(0, 0, w, h);

    let alive = 0;
    for (const p of particles) {
      const drag = Math.exp(-p.drag * dt);
      p.vx *= drag;
      p.vy = p.vy * drag + 620 * dt;
      p.wobble += p.vwobble * dt;
      p.x += (p.vx + Math.sin(p.wobble) * 40) * dt;
      p.y += p.vy * dt;
      p.rot += p.vrot * dt;
      p.flip += p.vflip * dt;
      if (p.y > h + 40) continue;
      alive++;
      cctx.save();
      cctx.translate(p.x, p.y);
      cctx.rotate(p.rot);
      cctx.scale(1, Math.cos(p.flip));
      cctx.fillStyle = p.color;
      cctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      cctx.restore();
    }

    if (alive) confettiRaf = requestAnimationFrame(stepConfetti);
  }

  function stopConfetti() {
    cancelAnimationFrame(confettiRaf);
    particles = [];
    cctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
  }

  /* ---------- init ---------- */

  if (window.matchMedia('(hover: none) and (pointer: coarse)').matches) {
    $('hintTop').textContent = 'Tap to spin';
    $('hintBottomText').style.display = 'none';
  }

  textarea.value = loadEntries();
  textarea.addEventListener('input', onEntriesChange);
  onEntriesChange();

  // pierwsza pozycja na górze koła
  rotation = -Math.PI / 2 - Math.PI / Math.max(entries.length, 1);

  canvas.addEventListener('click', startSpin);
  $('closeBtn').addEventListener('click', closeDialog);
  $('removeBtn').addEventListener('click', closeDialog);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeDialog();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      startSpin();
    } else if (e.key === 'Escape' && !backdrop.hidden) {
      closeDialog();
    }
  });

  new ResizeObserver(resize).observe(wrap);
  resize();
  if (document.fonts) {
    document.fonts.load('600 40px Quicksand').then(renderWheelLayer, () => {});
    document.fonts.ready.then(renderWheelLayer);
  }
  requestAnimationFrame(frame);
})();
