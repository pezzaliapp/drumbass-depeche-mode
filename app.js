// OFFICIUM
// =========================================================================
// Una macchina da liturgia industriale.
//
// Sezioni:
//   STATE         lo stato globale dell'applicazione
//   AUDIO ENGINE  la sintesi e il bus master (Web Audio nativo)
//   VOICES        le sei voci sintetizzate
//   HARMONY       l'armonia statica (Am/Dm in ciclo lento)
//   RITUSES       i quattro RITUS con pattern e default
//   SEQUENCER     scheduler look-ahead a 16 step
//   TRANSPORT     play/pause, cambio RITUS, BPM, voci
//   INPUT         tastiera + mouse Y per TENEBRAE
//
// Visualizzazione (rota) e' nel commit successivo.
// =========================================================================

(() => {
  "use strict";

  // === STATE =============================================================

  const state = {
    started: false,
    playing: false,
    bpm: 170,
    ritus: "MATUTINUM",
    tenebrae: 0.18,
    masterGain: 0.9,
    voices: { KICK: true, PERC: true, BASSO: true, FERRUM: false, CAMPANA: true, VOCE: false },
    currentStep: 0,
    bar: 0,
  };

  // === AUDIO ENGINE ======================================================

  /** @type {AudioContext|null} */
  let ctx = null;

  let voiceBus = null;
  let dryBus = null;
  let wetGain = null;
  let masterLP = null;
  let master = null;
  let noiseBuffer = null;

  function audioReady() { return ctx !== null && ctx.state !== "closed"; }

  function initAudio() {
    if (ctx) return;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) {
      console.warn("Web Audio non supportata in questo browser.");
      return;
    }
    ctx = new Ctor({ latencyHint: "interactive" });

    voiceBus = ctx.createGain();
    voiceBus.gain.value = 1.0;

    dryBus = ctx.createGain();
    dryBus.gain.value = 0.88;
    voiceBus.connect(dryBus);

    const wetIn = ctx.createGain();
    wetIn.gain.value = 0.55;
    voiceBus.connect(wetIn);

    const distortion = ctx.createWaveShaper();
    distortion.curve = makeDistortionCurve(0.45);
    distortion.oversample = "2x";

    const wetEQ = ctx.createBiquadFilter();
    wetEQ.type = "highpass";
    wetEQ.frequency.value = 90;

    const reverb = ctx.createConvolver();
    reverb.buffer = makeImpulseResponse(3.6, 2.4);

    wetGain = ctx.createGain();
    wetGain.gain.value = 0.0;

    wetIn.connect(distortion);
    distortion.connect(wetEQ);
    wetEQ.connect(reverb);
    reverb.connect(wetGain);

    master = ctx.createGain();
    master.gain.value = state.masterGain;
    dryBus.connect(master);
    wetGain.connect(master);

    masterLP = ctx.createBiquadFilter();
    masterLP.type = "lowpass";
    masterLP.frequency.value = 18000;
    masterLP.Q.value = 0.7;
    master.connect(masterLP);

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 8;
    comp.ratio.value = 4;
    comp.attack.value = 0.005;
    comp.release.value = 0.12;
    masterLP.connect(comp);
    comp.connect(ctx.destination);

    applyTenebrae();
  }

  function applyTenebrae() {
    if (!audioReady()) return;
    const t = state.tenebrae;
    const now = ctx.currentTime;
    wetGain.gain.setTargetAtTime(t * 0.65, now, 0.04);
    const cutoff = 18000 / Math.pow(36, t);
    masterLP.frequency.setTargetAtTime(cutoff, now, 0.04);
  }

  function setTenebrae(t) {
    state.tenebrae = Math.max(0, Math.min(1, t));
    applyTenebrae();
  }

  function getNoiseBuffer() {
    if (noiseBuffer) return noiseBuffer;
    const length = ctx.sampleRate * 2;
    noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return noiseBuffer;
  }

  function noiseSource() {
    const src = ctx.createBufferSource();
    src.buffer = getNoiseBuffer();
    src.loop = true;
    src.playbackRate.value = 1 + (Math.random() - 0.5) * 0.04;
    return src;
  }

  function makeDistortionCurve(amount) {
    const samples = 2048;
    const curve = new Float32Array(samples);
    const k = amount * 60;
    const deg = Math.PI / 180;
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  function makeImpulseResponse(duration = 3.5, decay = 2.4) {
    const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const ir = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const t = i / length;
        let n = Math.random() * 2 - 1;
        if (i > 0) n = n * 0.7 + data[i - 1] * 0.3;
        data[i] = n * Math.pow(1 - t, decay);
      }
    }
    return ir;
  }

  // === VOICES ============================================================

  function vKick(time, accent = 1) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(190, time);
    osc.frequency.exponentialRampToValueAtTime(46, time + 0.09);
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(1.05 * accent, time + 0.002);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.36);
    osc.connect(g).connect(voiceBus);
    osc.start(time);
    osc.stop(time + 0.4);

    const click = ctx.createOscillator();
    const cg = ctx.createGain();
    click.type = "square";
    click.frequency.value = 1600;
    cg.gain.setValueAtTime(0.16 * accent, time);
    cg.gain.exponentialRampToValueAtTime(0.001, time + 0.006);
    click.connect(cg).connect(voiceBus);
    click.start(time);
    click.stop(time + 0.012);
  }

  function vSnare(time, accent = 1) {
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(220, time);
    o.frequency.exponentialRampToValueAtTime(110, time + 0.07);
    og.gain.setValueAtTime(0.45 * accent, time);
    og.gain.exponentialRampToValueAtTime(0.001, time + 0.13);
    o.connect(og).connect(voiceBus);
    o.start(time);
    o.stop(time + 0.16);

    const n = noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1900;
    bp.Q.value = 1.4;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.75 * accent, time);
    ng.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
    n.connect(bp).connect(ng).connect(voiceBus);
    n.start(time);
    n.stop(time + 0.2);
  }

  function vHat(time, open = false, accent = 1) {
    const n = noiseSource();
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7200;
    const peak = ctx.createBiquadFilter();
    peak.type = "peaking";
    peak.frequency.value = 9500;
    peak.Q.value = 4;
    peak.gain.value = 6;
    const g = ctx.createGain();
    const dur = open ? 0.20 : 0.038;
    g.gain.setValueAtTime(0.32 * accent, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    n.connect(hp).connect(peak).connect(g).connect(voiceBus);
    n.start(time);
    n.stop(time + dur + 0.02);
  }

  function vFerrum(time, accent = 1) {
    const partials = [383, 752, 1163, 1735, 2197];
    const out = ctx.createGain();
    out.gain.value = 0.42 * accent;
    out.connect(voiceBus);
    partials.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f * (1 + (Math.random() - 0.5) * 0.004);
      const g = ctx.createGain();
      const dur = 0.18 + 0.06 * (4 - i);
      g.gain.setValueAtTime(0.55 / (i + 1), time);
      g.gain.exponentialRampToValueAtTime(0.001, time + dur);
      o.connect(g).connect(out);
      o.start(time);
      o.stop(time + dur + 0.02);
    });
    const n = noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 3200;
    bp.Q.value = 2.5;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.55 * accent, time);
    ng.gain.exponentialRampToValueAtTime(0.001, time + 0.045);
    n.connect(bp).connect(ng).connect(out);
    n.start(time);
    n.stop(time + 0.06);
  }

  function vBasso(time, freq, dur) {
    const sub = ctx.createOscillator();
    const sg = ctx.createGain();
    sub.type = "sine";
    sub.frequency.value = freq;
    sg.gain.setValueAtTime(0, time);
    sg.gain.linearRampToValueAtTime(0.78, time + 0.012);
    sg.gain.setValueAtTime(0.78, time + Math.max(0.02, dur - 0.06));
    sg.gain.exponentialRampToValueAtTime(0.001, time + dur);
    sub.connect(sg).connect(voiceBus);
    sub.start(time);
    sub.stop(time + dur + 0.05);

    [-9, 9].forEach((det) => {
      const saw = ctx.createOscillator();
      saw.type = "sawtooth";
      saw.frequency.value = freq * 2;
      saw.detune.value = det;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 320;
      lp.Q.value = 5;
      const rg = ctx.createGain();
      rg.gain.setValueAtTime(0, time);
      rg.gain.linearRampToValueAtTime(0.18, time + 0.04);
      rg.gain.setValueAtTime(0.18, time + Math.max(0.05, dur - 0.08));
      rg.gain.exponentialRampToValueAtTime(0.001, time + dur);
      saw.connect(lp).connect(rg).connect(voiceBus);
      saw.start(time);
      saw.stop(time + dur + 0.05);
    });
  }

  function vCampana(time, freqs, dur) {
    const ratios = [1, 2.001, 3.012, 4.99];
    freqs.forEach((f) => {
      ratios.forEach((mult, m) => {
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = f * mult;
        const g = ctx.createGain();
        const peak = 0.07 / (m + 1);
        const decay = dur * Math.max(0.4, 1 - m * 0.16);
        g.gain.setValueAtTime(0, time);
        g.gain.linearRampToValueAtTime(peak, time + 0.015);
        g.gain.exponentialRampToValueAtTime(0.001, time + decay);
        o.connect(g).connect(voiceBus);
        o.start(time);
        o.stop(time + decay + 0.03);
      });
    });
  }

  function vVoce(time, freqs, dur) {
    const formants = [
      { f: 700, q: 9, gain: 1.0 },
      { f: 1220, q: 10, gain: 0.62 },
      { f: 2600, q: 12, gain: 0.38 },
    ];
    freqs.forEach((f, idx) => {
      const saw = ctx.createOscillator();
      saw.type = "sawtooth";
      saw.frequency.value = f;
      if (idx > 0) {
        const lfo = ctx.createOscillator();
        const lfoGain = ctx.createGain();
        lfo.frequency.value = 4.7 + idx * 0.7;
        lfoGain.gain.value = 1.6;
        lfo.connect(lfoGain).connect(saw.frequency);
        lfo.start(time);
        lfo.stop(time + dur + 0.05);
      }
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, time);
      env.gain.linearRampToValueAtTime(0.05, time + 0.4);
      env.gain.setValueAtTime(0.05, time + Math.max(0.5, dur - 0.6));
      env.gain.linearRampToValueAtTime(0, time + dur);

      formants.forEach((fm) => {
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = fm.f;
        bp.Q.value = fm.q;
        const fg = ctx.createGain();
        fg.gain.value = fm.gain * 0.9;
        saw.connect(bp).connect(fg).connect(env);
      });

      env.connect(voiceBus);
      saw.start(time);
      saw.stop(time + dur + 0.05);
    });
  }

  // === HARMONY ===========================================================
  // L'armonia ruota lenta. Quattro bar in A minor, quattro in D minor,
  // poi si ripete. Il sub bass segue, l'accordo della campana segue,
  // la voce abita la stanza piu' larga.

  const HARMONIES = {
    AM: { sub: 55, chord: [220, 261.63, 329.63], voce: [220, 329.63] },
    DM: { sub: 73.42, chord: [146.83, 174.61, 220], voce: [146.83, 220] },
  };

  // Ciclo da 8 bar: 4 Am, 4 Dm. Lentissimo, monastico.
  const HARMONY_CYCLE = ["AM", "AM", "AM", "AM", "DM", "DM", "DM", "DM"];

  function currentHarmony() {
    return HARMONIES[HARMONY_CYCLE[state.bar % HARMONY_CYCLE.length]];
  }

  // === RITUSES ===========================================================
  // Ogni RITUS e' una piccola "ora" liturgica: BPM, pattern, voci attive.
  // I pattern KICK/PERC/FERRUM sono array da 16 step. PERC ha grammatica
  // propria: 0=silenzio, 1=hat chiuso, 2=hat aperto, 3=rullante,
  // 4=ghost (rullante quieto). KICK e FERRUM: 0/1.

  const RITUSES = {
    MATUTINUM: {
      bpm: 170,
      patterns: {
        KICK:   [1,0,0,0,0,0,1,0,0,0,1,0,0,0,0,0],
        PERC:   [0,0,1,0,3,0,1,1,2,0,1,0,3,0,1,1],
        FERRUM: [0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0],
      },
      voicesOn: ["KICK", "PERC", "BASSO", "CAMPANA"],
      tenebrae: 0.18,
    },
    LAUDES: {
      bpm: 174,
      patterns: {
        KICK:   [1,0,0,0,0,0,1,0,1,0,0,0,0,0,1,0],
        PERC:   [0,1,1,0,3,1,1,1,2,1,1,1,3,1,2,1],
        FERRUM: [0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,1],
      },
      voicesOn: ["KICK", "PERC", "BASSO", "FERRUM"],
      tenebrae: 0.32,
    },
    VESPERAE: {
      bpm: 160,
      patterns: {
        KICK:   [1,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0],
        PERC:   [0,0,1,0,3,0,0,0,1,0,0,0,3,0,0,4],
        FERRUM: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
      },
      voicesOn: ["KICK", "PERC", "BASSO", "CAMPANA", "VOCE"],
      tenebrae: 0.46,
    },
    NOX: {
      bpm: 178,
      patterns: {
        KICK:   [1,0,1,0,0,1,1,0,1,0,1,0,0,1,1,0],
        PERC:   [3,1,2,1,3,1,1,2,3,1,2,1,3,1,1,2],
        FERRUM: [1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,1],
      },
      voicesOn: ["KICK", "PERC", "BASSO", "FERRUM", "CAMPANA", "VOCE"],
      tenebrae: 0.72,
    },
  };

  function applyRitus(name) {
    if (!RITUSES[name]) return;
    state.ritus = name;
    const r = RITUSES[name];
    state.bpm = r.bpm;
    for (const v of Object.keys(state.voices)) {
      state.voices[v] = r.voicesOn.includes(v);
    }
    // tenebrae: il livello del RITUS e' un suggerimento, non scavalca
    // l'utente che ha gia' mosso il mouse. Il prossimo mousemove lo
    // sostituira'. Imposto solo se non e' ancora stato toccato.
    if (!state.tenebraeTouched) setTenebrae(r.tenebrae);
  }

  // === SEQUENCER =========================================================

  const LOOKAHEAD_MS = 25;
  const SCHEDULE_AHEAD_S = 0.10;
  const STEPS_PER_BAR = 16;

  let nextStepTime = 0;
  let schedulerHandle = null;

  function stepDuration() {
    return 60 / state.bpm / 4; // sedicesimi
  }

  // Coda di step gia' programmati: ci serve in ambito visivo per
  // sincronizzare il playhead a cio' che e' realmente udibile e per
  // accendere ripples/LED quando una voce scatta.
  const fireQueue = []; // {step, time, fired:{...}, bar}
  const FIRE_QUEUE_MAX = 128;

  function scheduleStep(step, time) {
    const ritus = RITUSES[state.ritus];
    const v = state.voices;
    const harmony = currentHarmony();
    const sd = stepDuration();
    const fired = { KICK:false, PERC:false, FERRUM:false, BASSO:false, CAMPANA:false, VOCE:false };

    if (v.KICK) {
      const k = ritus.patterns.KICK[step];
      if (k > 0) { vKick(time, k === 2 ? 1.18 : 1.0); fired.KICK = true; }
    }

    if (v.PERC) {
      const p = ritus.patterns.PERC[step];
      if (p === 1) { vHat(time, false, 1.0); fired.PERC = true; }
      else if (p === 2) { vHat(time, true, 0.9); fired.PERC = true; }
      else if (p === 3) { vSnare(time, 1.0); fired.PERC = true; }
      else if (p === 4) { vSnare(time, 0.5); fired.PERC = true; }
    }

    if (v.FERRUM) {
      const f = ritus.patterns.FERRUM[step];
      if (f > 0) { vFerrum(time, f === 2 ? 1.15 : 0.85); fired.FERRUM = true; }
    }

    // Voci sostenute: scattano sul battere della battuta.
    if (step === 0) {
      if (v.BASSO) {
        vBasso(time, harmony.sub, STEPS_PER_BAR * sd);
        fired.BASSO = true;
      }
      if (v.CAMPANA) {
        // dura poco piu' di una battuta per code che si sovrappongono
        vCampana(time, harmony.chord, STEPS_PER_BAR * sd * 1.25);
        fired.CAMPANA = true;
      }
      if (v.VOCE && state.bar % 2 === 0) {
        // la voce respira piu' lenta: ogni due battute
        vVoce(time, harmony.voce, STEPS_PER_BAR * 2 * sd);
        fired.VOCE = true;
      }
    }

    fireQueue.push({ step, time, fired, bar: state.bar });
    while (fireQueue.length > FIRE_QUEUE_MAX) fireQueue.shift();
  }

  function advanceStep() {
    nextStepTime += stepDuration();
    state.currentStep = (state.currentStep + 1) % STEPS_PER_BAR;
    if (state.currentStep === 0) state.bar = (state.bar + 1) % 1024;
  }

  function schedulerTick() {
    if (!audioReady() || !state.playing) return;
    while (nextStepTime < ctx.currentTime + SCHEDULE_AHEAD_S) {
      scheduleStep(state.currentStep, nextStepTime);
      advanceStep();
    }
  }

  // === TRANSPORT =========================================================

  function play() {
    if (!audioReady()) initAudio();
    if (ctx.state === "suspended") ctx.resume();
    if (!state.playing) {
      // riaggancio il clock: il prossimo step parte fra una manciata di ms.
      // currentStep e bar rimangono dove erano (continuita' attraverso il pause).
      nextStepTime = ctx.currentTime + 0.05;
      state.playing = true;
    }
    if (schedulerHandle === null) {
      schedulerHandle = setInterval(schedulerTick, LOOKAHEAD_MS);
    }
  }

  function pause() {
    state.playing = false;
    if (schedulerHandle !== null) {
      clearInterval(schedulerHandle);
      schedulerHandle = null;
    }
  }

  function togglePlay() {
    if (state.playing) pause();
    else play();
  }

  function setRitus(name) {
    applyRitus(name);
  }

  function setBpm(bpm) {
    state.bpm = Math.max(60, Math.min(220, Math.round(bpm)));
  }

  function toggleVoice(name) {
    if (!(name in state.voices)) return;
    state.voices[name] = !state.voices[name];
  }

  // === BOOT ==============================================================

  const boot = document.getElementById("boot");

  function awaken() {
    if (state.started) return;
    state.started = true;
    initAudio();
    if (audioReady() && ctx.state === "suspended") ctx.resume();
    applyRitus(state.ritus);
    boot.style.transition = "opacity 700ms ease";
    boot.style.opacity = "0";
    setTimeout(() => boot.remove(), 750);
    play();
  }

  // === INPUT =============================================================

  window.addEventListener("keydown", (ev) => {
    if (ev.code === "Space") {
      ev.preventDefault();
      if (!state.started) awaken();
      else togglePlay();
      return;
    }
    if (!state.started) return;
    if (ev.code === "Digit1") setRitus("MATUTINUM");
    else if (ev.code === "Digit2") setRitus("LAUDES");
    else if (ev.code === "Digit3") setRitus("VESPERAE");
    else if (ev.code === "Digit4") setRitus("NOX");
    else if (ev.code === "ArrowUp") { ev.preventDefault(); setBpm(state.bpm + 1); }
    else if (ev.code === "ArrowDown") { ev.preventDefault(); setBpm(state.bpm - 1); }
    else if (ev.code === "KeyQ") toggleVoice("KICK");
    else if (ev.code === "KeyW") toggleVoice("PERC");
    else if (ev.code === "KeyE") toggleVoice("BASSO");
    else if (ev.code === "KeyR") toggleVoice("FERRUM");
    else if (ev.code === "KeyT") toggleVoice("CAMPANA");
    else if (ev.code === "KeyY") toggleVoice("VOCE");
  });

  window.addEventListener("pointermove", (ev) => {
    if (!state.started) return;
    state.tenebraeTouched = true;
    setTenebrae(ev.clientY / window.innerHeight);
  });

  // === VISUAL ============================================================
  // Tutto cio' che si muove sullo schermo: la rota disegnata su canvas,
  // l'HUD, gli stati dei pulsanti voci, la parola latina al centro che
  // cambia ogni quattro battute.

  /** @type {HTMLCanvasElement} */
  const canvas = document.getElementById("rota");
  const cctx = canvas.getContext("2d");
  let dpr = Math.max(1, window.devicePixelRatio || 1);

  function resizeCanvas() {
    dpr = Math.max(1, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  }
  window.addEventListener("resize", resizeCanvas);

  // ---- elementi HUD/parola ----
  const hudBpm     = document.getElementById("hud-bpm");
  const hudRitus   = document.getElementById("hud-ritus");
  const hudTen     = document.getElementById("hud-tenebrae");
  const wordEl     = document.getElementById("word");
  const wordTrans  = document.getElementById("word-trans");

  // ---- voci: pulsanti cliccabili ----
  /** @type {Object<string, HTMLButtonElement>} */
  const voceButtons = {};
  document.querySelectorAll(".voce").forEach((btn) => {
    const v = btn.dataset.voce;
    voceButtons[v] = btn;
    btn.addEventListener("click", () => {
      if (!state.started) { awaken(); return; }
      toggleVoice(v);
      btn.blur(); // evita che SPACE riattivi il bottone
    });
  });

  // ---- LED firing per ogni voce ----
  const voceLitUntil = { KICK:0, PERC:0, FERRUM:0, BASSO:0, CAMPANA:0, VOCE:0 };

  // ---- lessico latino ----
  const LEXICON = [
    ["LUX",     "luce"],
    ["TENEBRAE","tenebra"],
    ["FERRUM",  "ferro"],
    ["CINIS",   "cenere"],
    ["AEVUM",   "eternita"],
    ["COR",     "cuore"],
    ["IGNIS",   "fuoco"],
    ["PULVIS",  "polvere"],
    ["VOX",     "voce"],
    ["PETRA",   "pietra"],
    ["NOX",     "notte"],
    ["DIES",    "giorno"],
    ["AQUA",    "acqua"],
    ["TERRA",   "terra"],
    ["IRA",     "ira"],
    ["PAX",     "pace"],
    ["VITA",    "vita"],
    ["MORS",    "morte"],
    ["ORA",     "prega"],
    ["SILEX",   "selce"],
    ["ORDO",    "ordine"],
    ["SACRUM",  "sacro"],
    ["UMBRA",   "ombra"],
    ["VENTUS",  "vento"],
  ];
  let wordIdx = 0;
  let lastWordBar = -1;
  const WORD_PERIOD = 4; // ogni 4 battute

  function setWord(latin, italian) {
    wordEl.classList.add("is-fading");
    wordTrans.classList.add("is-fading");
    setTimeout(() => {
      wordEl.textContent = latin;
      wordTrans.textContent = italian;
      wordEl.classList.remove("is-fading");
      wordTrans.classList.remove("is-fading");
    }, 460);
  }

  function maybeChangeWord() {
    const b = state.bar;
    if (b === lastWordBar) return;
    if (b % WORD_PERIOD === 0) {
      // scelgo un indice diverso da quello attuale
      let next = (wordIdx + 1 + Math.floor(Math.random() * (LEXICON.length - 2))) % LEXICON.length;
      if (next === wordIdx) next = (wordIdx + 1) % LEXICON.length;
      wordIdx = next;
      setWord(LEXICON[wordIdx][0], LEXICON[wordIdx][1]);
      lastWordBar = b;
    }
  }

  // ---- HUD sync ----
  let hudPrev = { bpm: -1, ritus: "", ten: -1 };
  function syncHUD() {
    if (state.bpm !== hudPrev.bpm) {
      hudBpm.textContent = `${state.bpm} BPM`;
      hudPrev.bpm = state.bpm;
    }
    if (state.ritus !== hudPrev.ritus) {
      hudRitus.textContent = `RITUS · ${state.ritus}`;
      hudPrev.ritus = state.ritus;
    }
    const tRound = Math.round(state.tenebrae * 100) / 100;
    if (tRound !== hudPrev.ten) {
      hudTen.textContent = `TENEBRAE · ${tRound.toFixed(2)}`;
      hudPrev.ten = tRound;
    }
    document.documentElement.style.setProperty("--vignette", state.tenebrae.toFixed(3));
  }

  // ---- voce buttons sync ----
  function syncVoci(now) {
    // proietto le accensioni recenti dalla queue
    for (const ent of fireQueue) {
      if (ent.time > now) continue;
      const elapsed = now - ent.time;
      if (elapsed > 0.18) continue;
      for (const k of Object.keys(ent.fired)) {
        if (ent.fired[k]) {
          const expiry = ent.time + 0.18;
          if (expiry > voceLitUntil[k]) voceLitUntil[k] = expiry;
        }
      }
    }
    for (const k of Object.keys(voceButtons)) {
      const btn = voceButtons[k];
      const active = !!state.voices[k];
      const firing = active && now < voceLitUntil[k];
      btn.classList.toggle("is-active", active);
      btn.classList.toggle("is-firing", firing);
    }
  }

  // ---- rendering rota su canvas ----
  function drawRota(audibleStep, phase, now, sd) {
    const w = canvas.width;
    const h = canvas.height;
    cctx.clearRect(0, 0, w, h);
    if (w < 2 || h < 2) return;

    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) * 0.46;
    cctx.lineCap = "round";
    cctx.lineJoin = "round";

    // sfondo: sottile croce centrale (lascio respirare lo spazio)
    cctx.strokeStyle = "rgba(232, 230, 225, 0.045)";
    cctx.lineWidth = 1 * dpr;
    cctx.beginPath();
    cctx.moveTo(cx, cy - R * 0.78);
    cctx.lineTo(cx, cy + R * 0.78);
    cctx.moveTo(cx - R * 0.78, cy);
    cctx.lineTo(cx + R * 0.78, cy);
    cctx.stroke();

    // anello esterno tenue
    cctx.strokeStyle = "rgba(232, 230, 225, 0.07)";
    cctx.lineWidth = 1 * dpr;
    cctx.beginPath();
    cctx.arc(cx, cy, R, 0, Math.PI * 2);
    cctx.stroke();

    // anello interno (dove pesca la campana)
    cctx.strokeStyle = "rgba(232, 230, 225, 0.05)";
    cctx.beginPath();
    cctx.arc(cx, cy, R * 0.62, 0, Math.PI * 2);
    cctx.stroke();

    // 16 step: tick radiali; quelli sui beat sono piu' decisi
    const tickInner = R - 14 * dpr;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 - Math.PI / 2;
      const isBeat = i % 4 === 0;
      cctx.strokeStyle = isBeat
        ? "rgba(232, 230, 225, 0.55)"
        : "rgba(232, 230, 225, 0.18)";
      cctx.lineWidth = (isBeat ? 1.4 : 1) * dpr;
      cctx.beginPath();
      cctx.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      cctx.lineTo(cx + Math.cos(a) * tickInner, cy + Math.sin(a) * tickInner);
      cctx.stroke();
    }

    // ripples: scorro la queue e disegno quel che c'e' di vivo
    for (const ent of fireQueue) {
      const elapsed = now - ent.time;
      if (elapsed < 0) continue;
      const a = (ent.step / 16) * Math.PI * 2 - Math.PI / 2;

      // CAMPANA: anello concentrico che si espande dal centro
      if (ent.fired.CAMPANA && elapsed < 1.8) {
        const decay = 1 - elapsed / 1.8;
        const r = R * 0.18 + (1 - decay) * R * 0.78;
        cctx.strokeStyle = `rgba(232, 230, 225, ${decay * 0.22})`;
        cctx.lineWidth = 1 * dpr;
        cctx.beginPath();
        cctx.arc(cx, cy, r, 0, Math.PI * 2);
        cctx.stroke();
      }

      // VOCE: chiarore caldo nel cuore della rota
      if (ent.fired.VOCE && elapsed < 1.6) {
        const decay = 1 - elapsed / 1.6;
        const grad = cctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.55);
        grad.addColorStop(0, `rgba(217, 38, 38, ${decay * 0.18})`);
        grad.addColorStop(1, "rgba(217, 38, 38, 0)");
        cctx.fillStyle = grad;
        cctx.beginPath();
        cctx.arc(cx, cy, R * 0.55, 0, Math.PI * 2);
        cctx.fill();
      }

      // BASSO: respiro rosso piu' stretto
      if (ent.fired.BASSO && elapsed < 1.0) {
        const decay = 1 - elapsed / 1.0;
        const grad = cctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.4);
        grad.addColorStop(0, `rgba(217, 38, 38, ${decay * 0.16})`);
        grad.addColorStop(1, "rgba(217, 38, 38, 0)");
        cctx.fillStyle = grad;
        cctx.beginPath();
        cctx.arc(cx, cy, R * 0.4, 0, Math.PI * 2);
        cctx.fill();
      }

      // KICK: lampo bianco sul tick + arco rosso esterno
      if (ent.fired.KICK && elapsed < 0.45) {
        const decay = 1 - elapsed / 0.45;
        // tick illuminato
        cctx.strokeStyle = `rgba(232, 230, 225, ${decay})`;
        cctx.lineWidth = 3 * dpr * (0.6 + decay * 0.6);
        cctx.beginPath();
        cctx.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
        cctx.lineTo(cx + Math.cos(a) * (R - 24 * dpr), cy + Math.sin(a) * (R - 24 * dpr));
        cctx.stroke();
        // arco esterno che si espande
        const aR = R + 6 * dpr + (1 - decay) * 28 * dpr;
        cctx.strokeStyle = `rgba(217, 38, 38, ${decay * 0.7})`;
        cctx.lineWidth = 2.4 * dpr * decay;
        cctx.beginPath();
        cctx.arc(cx, cy, aR, a - 0.22, a + 0.22);
        cctx.stroke();
      }

      // PERC: dot bianco appena dentro il tick
      if (ent.fired.PERC && elapsed < 0.28) {
        const decay = 1 - elapsed / 0.28;
        const x = cx + Math.cos(a) * (R - 24 * dpr);
        const y = cy + Math.sin(a) * (R - 24 * dpr);
        cctx.fillStyle = `rgba(232, 230, 225, ${decay})`;
        cctx.beginPath();
        cctx.arc(x, y, 2.4 * dpr, 0, Math.PI * 2);
        cctx.fill();
      }

      // FERRUM: trattino rosso radiale verso il centro
      if (ent.fired.FERRUM && elapsed < 0.5) {
        const decay = 1 - elapsed / 0.5;
        const r1 = R - 40 * dpr;
        const r2 = R - 64 * dpr;
        cctx.strokeStyle = `rgba(217, 38, 38, ${decay * 0.85})`;
        cctx.lineWidth = 1.6 * dpr;
        cctx.beginPath();
        cctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        cctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
        cctx.stroke();
      }
    }

    // playhead: linea sottile che ruota
    const pa = ((audibleStep + phase) / 16) * Math.PI * 2 - Math.PI / 2;
    cctx.strokeStyle = "rgba(232, 230, 225, 0.45)";
    cctx.lineWidth = 1.2 * dpr;
    cctx.beginPath();
    cctx.moveTo(cx + Math.cos(pa) * R * 0.16, cy + Math.sin(pa) * R * 0.16);
    cctx.lineTo(cx + Math.cos(pa) * R, cy + Math.sin(pa) * R);
    cctx.stroke();

    // punto sulla testa del playhead
    cctx.fillStyle = "rgba(217, 38, 38, 0.95)";
    cctx.beginPath();
    cctx.arc(cx + Math.cos(pa) * R, cy + Math.sin(pa) * R, 3.2 * dpr, 0, Math.PI * 2);
    cctx.fill();

    // centro: punto di luce
    cctx.fillStyle = "rgba(232, 230, 225, 0.9)";
    cctx.beginPath();
    cctx.arc(cx, cy, 1.8 * dpr, 0, Math.PI * 2);
    cctx.fill();
  }

  function visualTick() {
    if (!audioReady() || !state.playing) {
      // se siamo fermi, mantengo comunque il rendering della rota statica
      if (canvas.width > 0) drawRota(state.currentStep, 0, 0, stepDuration());
      syncHUD();
      requestAnimationFrame(visualTick);
      return;
    }
    const now = ctx.currentTime;

    // step udibile = ultimo entry in queue il cui time <= now
    let audibleStep = state.currentStep;
    let audibleTime = now;
    for (let i = fireQueue.length - 1; i >= 0; i--) {
      if (fireQueue[i].time <= now) {
        audibleStep = fireQueue[i].step;
        audibleTime = fireQueue[i].time;
        break;
      }
    }
    const sd = stepDuration();
    const phase = Math.max(0, Math.min(1, (now - audibleTime) / sd));

    // bar udibile (per il ciclo della parola): quello dell'entry corrente
    let audibleBar = state.bar;
    for (let i = fireQueue.length - 1; i >= 0; i--) {
      if (fireQueue[i].time <= now) { audibleBar = fireQueue[i].bar; break; }
    }
    const savedBar = state.bar;
    state.bar = audibleBar;
    maybeChangeWord();
    state.bar = savedBar;

    drawRota(audibleStep, phase, now, sd);
    syncVoci(now);
    syncHUD();

    requestAnimationFrame(visualTick);
  }

  resizeCanvas();
  syncHUD();
  requestAnimationFrame(visualTick);

  // Avvio anche su click/tap per accessibilita' mobile.
  document.addEventListener("pointerdown", (ev) => {
    if (!state.started && ev.target.closest("#stage")) awaken();
  }, { capture: true });

  // Esposizione minimale per debug.
  window.OFFICIUM = {
    state,
    get ctx() { return ctx; },
    play, pause, togglePlay, setRitus, setBpm, setTenebrae, toggleVoice,
    HARMONIES, RITUSES,
  };
})();
