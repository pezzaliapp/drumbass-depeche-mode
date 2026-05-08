// OFFICIUM — entry point.
// La macchina viene assemblata in moduli successivi.
// Per ora il boot intercetta lo SPAZIO e prepara il terreno.

(() => {
  "use strict";

  const boot = document.getElementById("boot");

  function start() {
    // placeholder — il vero awakening verrà negli step successivi.
    boot.style.transition = "opacity 600ms ease";
    boot.style.opacity = "0";
    setTimeout(() => boot.remove(), 700);
  }

  window.addEventListener("keydown", (ev) => {
    if (ev.code === "Space") {
      ev.preventDefault();
      if (boot.isConnected) start();
    }
  });
})();
