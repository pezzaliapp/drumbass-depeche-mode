# OFFICIUM

> *una macchina da liturgia industriale*

Strumento web sonoro all'incrocio fra ritmica drum &amp; bass e sintetica
EBM/dark-pop dei primi anni Ottanta. Scritto in HTML, CSS e JavaScript
puri &mdash; nessun framework, nessuna dipendenza runtime, nessun build
step. Tutta la sintesi viene generata in tempo reale con la **Web Audio
API** nativa.

L'interfaccia &egrave; una *rota* circolare che ruota in sincrono col
tempo. Sei voci sintetizzate &mdash; drum, percussione metallica, sub,
campana, coro &mdash; abitano una struttura ritmica fissa di sedici
sedicesimi. L'utente non programma i pattern: li attraversa, li
combina, li corrompe.

## Cosa &egrave;

OFFICIUM &egrave; un *piccolo officio sintetico*: una pratica di
ascolto pi&ugrave; che un workstation. Si compone di:

- quattro **RITUS** (Matutinum, Laudes, Vesperae, Nox) che cambiano
  pattern, BPM e disposizione delle voci.
- un'armonia statica e lentissima (Am / Dm in alternanza ogni quattro
  battute) &mdash; il tonal center *non* si muove velocemente, perch&eacute;
  la liturgia &egrave; ripetizione.
- una macro globale chiamata **TENEBRAE** legata alla posizione Y del
  mouse: come scende il puntatore, il riverbero cresce, la distorsione
  invade il segnale, l'alta frequenza viene chiusa. La luce viene
  mangiata dal buio.
- una parola latina al centro della rota che muta ogni quattro
  battute, scelta da un piccolo lessico minerale (LUX, FERRUM, NOX,
  PULVIS, &hellip;).

Estetica monocromatica con un solo accento di rosso pompeiano, tipografia
brutalista (Bebas Neue per la parola al centro, IBM Plex Mono per
l'HUD). Niente immagini.

## Come si usa

### Da tastiera (desktop)

Premi **SPAZIO** per cominciare. Da quel momento l'officio gira.
- **1 2 3 4** scegli il RITUS.
- **&uarr; &darr;** alza e abbassa il BPM di un'unit&agrave;.
- **Q W E R T Y** accendi e spegni una a una le voci (KICK, PERC,
  BASSO, FERRUM, CAMPANA, VOCE).
- **mouse Y** controlla TENEBRAE: in alto pulito, in basso saturo.
- **SPAZIO** di nuovo &rarr; pause / resume.

### Su touch (iPhone, iPad, Android)

Le scorciatoie da tastiera non esistono qui, e va bene cos&igrave;. Tutto
&egrave; sotto il dito.

- **Tocca lo schermo** o il pulsante centrale (triangolo) per
  cominciare. Il centro della rota ospita il play / pause: triangolo
  per partire, due barre per fermare.
- **Toolbar in basso**: i quattro RITUS (I II III IV in numeri
  romani), i due pulsanti BPM (&minus; / +) col valore corrente al
  centro, e le sei iniziali delle voci (K P B F C V) per accendere
  e spegnere ciascuna.
- **Swipe verticale ovunque** sullo schermo &rarr; TENEBRAE. Trascini in
  basso e il rito si fa scuro, trascini verso l'alto e torna lucido.
  Una piccola guida visiva sul bordo destro suggerisce il gesto nei
  primi cinque secondi e poi sparisce.
- I pulsanti hanno tap target da 44pt come da linee guida iOS.
  Tappare un controllo non muove TENEBRAE, anche se il dito sosta
  in basso.

Le scorciatoie da tastiera continuano a funzionare anche su tablet
con tastiera Bluetooth. I controlli touch sono in aggiunta, non in
sostituzione.

## Anatomia

### Le sei voci, sintetizzate dal vivo

| voce      | sintesi                                                  |
|-----------|----------------------------------------------------------|
| KICK      | sub a 808: sine con pitch envelope 190 &rarr; 46 Hz, click metallico |
| PERC      | rullante (triangolare + rumore filtrato), hi-hat aperto/chiuso (HP+peaking) |
| BASSO     | sub puro + reese ottava sopra (due seghe detunate, lp risonante) |
| FERRUM    | percussione metallica inarmonica: cinque sinusoidi + rumore transient |
| CAMPANA   | accordo additivo con armoniche inarmoniche (1, 2.001, 3.012, 4.99) |
| VOCE      | coro: sawtooth attraverso tre formanti (700, 1220, 2600 Hz), micro-vibrato |

### Il bus master

```
voiceBus &rarr; dryBus &rarr;&rarr;&rarr;&rarr;&rarr;&rarr;&rarr;&rarr;&rarr;&rarr; master &rarr; lowpass &rarr; comp &rarr; out
       &rarr; wetIn &rarr; ws &rarr; hp &rarr; conv &rarr; wetGain &nearr;
```

`TENEBRAE` (0&hellip;1) modula simultaneamente:

- `wetGain` &mdash; quanto del segnale passa dalla catena distorsione+riverbero
- la cutoff del lowpass master &mdash; da 18 kHz a circa 500 Hz, logaritmico
- una vignettatura CSS che chiude i bordi visivi

L'impulse response del riverbero &egrave; generata sul momento (rumore con
coda esponenziale + filtraggio 1-polo): nessun file da scaricare.

### Il sequencer

Lookahead scheduler classico Web Audio: un `setInterval` a 25 ms con
finestra di pianificazione di 100 ms; ogni tick avanza i passi
sedicesimi. Le voci sostenute (BASSO, CAMPANA, VOCE) scattano sul
battere della battuta; la VOCE respira pi&ugrave; lenta, ogni due battute.

## Pubblicazione su GitHub Pages

I file vivono nella *root* della repo. Niente cartelle `dist/`,
`public/` o `src/`. Tutti i percorsi (script, css, audio, immagini)
sono relativi senza slash iniziale.

Per servirla su GitHub Pages:

1. Settings &rarr; Pages &rarr; *Deploy from a branch*, branch `main`,
   folder `/`.
2. Il file `.nojekyll` impedisce il preprocessing Jekyll.
3. Il custom domain &egrave; gestito a livello user: nessun `CNAME` qui dentro.

Url di pubblicazione: <https://www.alessandropezzali.it/drumbass-depeche-mode/>

## Avviare in locale

```bash
npm start
# &rarr; http://localhost:4173
```

oppure qualunque altro server statico. Non c'&egrave; build da fare.

## Vincoli tecnici

- HTML / CSS / JS puri. Nessuna dipendenza runtime, niente bundler.
- Sintesi via **Web Audio API** nativa. Niente Tone.js, niente Howler.
- Font tramite Google Fonts via CDN (Bebas Neue, IBM Plex Mono, Inter).
- Funziona offline una volta caricati i font.
- Tutti i path sono relativi.

## Licenza

MIT.

Nessuna canzone, nessun testo, nessun marchio &egrave; stato citato.
*Drumbass depeche mode* &egrave; il nome di un'idea: la ritmica veloce dei
breakbeat e il sentimento solenne della synth-pop ottantiana che si
incontrano in un piccolo officio elettrico.
