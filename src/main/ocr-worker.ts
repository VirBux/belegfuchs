// Einstieg der Tesseract-Worker-Threads: lädt das Node-Worker-Skript von tesseract.js unverändert,
// gibt aber je Auftrag nur die erste abschließende Meldung weiter. Ein fehlgeschlagenes Init meldet
// tesseract.js als reject und danach zusätzlich als resolve; die zweite Meldung trifft im
// Main-Prozess auf einen erledigten Auftrag und endet dort als unbehandelter Fehler mit Dialog.
export {};

type Send = (msg: { status: string }) => void;
type WorkerScript = { dispatchHandlers: (packet: unknown, send: Send) => void };

const script: WorkerScript = require('tesseract.js/src/worker-script');
const dispatch = script.dispatchHandlers;
script.dispatchHandlers = (packet, send) => {
  let settled = false;
  dispatch(packet, (msg) => {
    if (settled) return;
    if (msg.status !== 'progress') settled = true;
    send(msg);
  });
};
require('tesseract.js/src/worker-script/node');
