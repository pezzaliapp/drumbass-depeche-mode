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

  function scheduleStep(step, time) {
    const ritus = RITUSES[state.ritus];
    const v = state.voices;
    const harmony = currentHarmony();
    const sd = stepDuration();

    if (v.KICK) {
      const k = ritus.patterns.KICK[step];
      if (k > 0) vKick(time, k === 2 ? 1.18 : 1.0);
    }

    if (v.PERC) {
      const p = ritus.patterns.PERC[step];
      if (p === 1) vHat(time, false, 1.0);
      else if (p === 2) vHat(time, true, 0.9);
      else if (p === 3) vSnare(time, 1.0);
      else if (p === 4) vSnare(time, 0.5);
    }

    if (v.FERRUM) {
      const f = ritus.patterns.FERRUM[step];
      if (f > 0) vFerrum(time, f === 2 ? 1.15 : 0.85);
    }

    // Voci sostenute: scattano sul battere della battuta.
    if (step === 0) {
      if (v.BASSO) {
        vBasso(time, harmony.sub, STEPS_PER_BAR * sd);
      }
      if (v.CAMPANA) {
        // dura poco piu' di una battuta per code che si sovrappongono
        vCampana(time, harmony.chord, STEPS_PER_BAR * sd * 1.25);
      }
      if (v.VOCE && state.bar % 2 === 0) {
        // la voce respira piu' lenta: ogni due battute
        vVoce(time, harmony.voce, STEPS_PER_BAR * 2 * sd);
      }
    }
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

  window.addEventListener("mousemove", (ev) => {
    if (!state.started) return;
    state.tenebraeTouched = true;
    setTenebrae(ev.clientY / window.innerHeight);
  });

  // Esposizione minimale per debug e per il modulo visivo che arrivera'.
  window.OFFICIUM = {
    state,
    get ctx() { return ctx; },
    play, pause, togglePlay, setRitus, setBpm, setTenebrae, toggleVoice,
    HARMONIES, RITUSES,
  };
})();
