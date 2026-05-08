// OFFICIUM
// =========================================================================
// Una macchina da liturgia industriale.
//
// Il file e' diviso in sezioni:
//   STATE         lo stato globale dell'applicazione
//   AUDIO ENGINE  la sintesi e il bus master (Web Audio nativo)
//   VOICES        le sei voci sintetizzate
//   BOOT          inizializzazione e tastiera
//
// Sequencer e visualizzazione vivono in moduli successivi.
// =========================================================================

(() => {
  "use strict";

  // === STATE =============================================================

  const state = {
    started: false,
    tenebrae: 0.18, // 0 = lux, 1 = tenebrae
    masterGain: 0.9,
  };

  // === AUDIO ENGINE ======================================================

  /** @type {AudioContext|null} */
  let ctx = null;

  // Bus
  let voiceBus = null;
  let dryBus = null;
  let wetBus = null;
  let wetGain = null;
  let masterLP = null;
  let master = null;

  // Reusable noise buffer
  let noiseBuffer = null;

  function audioReady() {
    return ctx !== null && ctx.state !== "closed";
  }

  function initAudio() {
    if (ctx) return;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) {
      console.warn("Web Audio non supportata in questo browser.");
      return;
    }
    ctx = new Ctor({ latencyHint: "interactive" });

    // Voice bus: tutto cio' che le voci producono passa di qui.
    voiceBus = ctx.createGain();
    voiceBus.gain.value = 1.0;

    // --- Dry path ---
    dryBus = ctx.createGain();
    dryBus.gain.value = 0.88;
    voiceBus.connect(dryBus);

    // --- Wet path: distorsione + riverbero ---
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
    wetGain.gain.value = 0.0; // pilotato da TENEBRAE

    wetIn.connect(distortion);
    distortion.connect(wetEQ);
    wetEQ.connect(reverb);
    reverb.connect(wetGain);

    // --- Master sum ---
    master = ctx.createGain();
    master.gain.value = state.masterGain;
    dryBus.connect(master);
    wetGain.connect(master);

    // --- Master lowpass: chiude le alte come TENEBRAE sale ---
    masterLP = ctx.createBiquadFilter();
    masterLP.type = "lowpass";
    masterLP.frequency.value = 18000;
    masterLP.Q.value = 0.7;
    master.connect(masterLP);

    // --- Compressore di sicurezza ---
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
    // wet 0 -> 0.65
    wetGain.gain.setTargetAtTime(t * 0.65, now, 0.04);
    // master lowpass: 18000 Hz a t=0, 500 Hz a t=1 (logaritmico)
    const cutoff = 18000 / Math.pow(36, t);
    masterLP.frequency.setTargetAtTime(cutoff, now, 0.04);
  }

  function setTenebrae(t) {
    state.tenebrae = Math.max(0, Math.min(1, t));
    applyTenebrae();
  }

  // ---- Helpers ----------------------------------------------------------

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
        // rumore con coda esponenziale e leggero filtro 1-pole verso le alte
        let n = Math.random() * 2 - 1;
        if (i > 0) n = n * 0.7 + data[i - 1] * 0.3;
        data[i] = n * Math.pow(1 - t, decay);
      }
    }
    return ir;
  }

  // === VOICES ============================================================
  // Ogni voce e' una funzione che, dato un istante AudioContext.time,
  // istanzia oscillatori/buffer effimeri che si auto-distruggono.
  // Tutte scrivono su voiceBus.

  // ---- Kick: sub 808 industriale con click ----
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

    // click metallico in cima
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

  // ---- Snare: corpo + rumore filtrato ----
  function vSnare(time, accent = 1) {
    // corpo
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

    // rumore: snap
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

  // ---- Hat: closed/open ----
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

  // ---- Ferrum: percussione metallica inarmonica ----
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
    // transient
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

  // ---- Basso: sub puro + reese detunato un'ottava sopra ----
  function vBasso(time, freq, dur) {
    // sub
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

    // reese: due seghe detunate, ottava sopra, lp risonante
    const detunings = [-9, 9];
    detunings.forEach((det) => {
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

  // ---- Campana: accordo additivo con armoniche inarmoniche ----
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

  // ---- Voce: coro con formanti (vocale "ah") ----
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
      // micro-vibrato sui voci superiori
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

  // === BOOT ==============================================================

  const boot = document.getElementById("boot");

  function awaken() {
    if (state.started) return;
    state.started = true;
    initAudio();
    if (audioReady() && ctx.state === "suspended") ctx.resume();
    boot.style.transition = "opacity 700ms ease";
    boot.style.opacity = "0";
    setTimeout(() => boot.remove(), 750);
  }

  window.addEventListener("keydown", (ev) => {
    if (ev.code === "Space") {
      ev.preventDefault();
      if (!state.started) awaken();
    }
  });

  // Espongo l'engine all'oggetto window per testing/manuale.
  // Verra' rimosso quando il sequencer prendera' il controllo.
  window.OFFICIUM = {
    state,
    get ctx() { return ctx; },
    get voiceBus() { return voiceBus; },
    setTenebrae,
    voices: { vKick, vSnare, vHat, vFerrum, vBasso, vCampana, vVoce },
  };
})();
