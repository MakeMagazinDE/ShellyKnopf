// shelly_button.js – Version 4.1
// Ein Shelly BLU RC Button 4 steuert Pumpen (Laufzeit pro Klick)
// und Lichtstimmungen (beliebig viele Shellys pro Stimmung).
// Läuft auf einem Shelly Gen2 oder neuer mit Bluetooth (hier: Pro 2PM).

// ===================== KONFIGURATION =====================
let CONFIG = {
  button: "bthomedevice:200", // BLU-Taster, siehe Komponenten im Web-UI
  klickPause: 1500,           // Licht: so lange zählt ein weiterer Klick mit

  // ip und Passwort (pw) des jeweiligen Shellys, Benutzer ist "admin".
  // Ohne Passwort am Gerät: pw: "" eintragen.
  tasten: {
    1: { art: "pumpe", name: "Brunnen", ip: "192.168.178.101", pw: "USHsssudikS26",
         stundenProKlick: 1, maxStunden: 8 },

    2: { art: "pumpe", name: "Pool", ip: "192.168.178.99", pw: "USHsssudikS26",
         stundenProKlick: 1, maxStunden: 8 },

    // Taste 3 ist noch frei

    4: { art: "licht", name: "Wohnzimmer",
         lampen: {                       // beliebig viele Shellys
           L1: { ip: "192.168.178.135", pw: "USHsssudikS26" },
           L2: { ip: "192.168.178.102", pw: "USHsssudikS26" }
         },
         stimmungen: [                   // 1 Klick, 2 Klicks, 3 Klicks …
           { name: "Hell",          an: ["L1", "L2"] },
           { name: "Fernsehen",     an: ["L1"] },
           { name: "Gemütlichkeit", an: ["L2"] }
         ] }
  }
};
// =========================================================

// Wie viele Klicks steckt der Taster in ein Ereignis?
let PUNKTE = { single_push: 1, double_push: 2, triple_push: 3 };

let klicks = {}; // gesammelte Klicks je Taste
let timer = {};  // laufender Auswerte-Timer je Taste

// ---------- Taster auswerten ----------

Shelly.addEventHandler(function (e) {
  if (e.component !== CONFIG.button || !e.info) return;
  // Empfangsqualität mitloggen: RSSI in dBm (ab etwa -90 wird es knapp)
  let s = Shelly.getComponentStatus(CONFIG.button);
  print("Taste " + ((e.info.idx || 0) + 1) + " " + e.info.event +
        ", RSSI " + s.rssi + " dBm, Batterie " + s.battery + " %");
  tasteGedrueckt((e.info.idx || 0) + 1, e.info.event);
});

function tasteGedrueckt(taste, ereignis) {
  let t = CONFIG.tasten[taste];
  if (!t) return;
  if (ereignis === "long_push") {     // langer Druck: sofort aus
    verwerfen(taste);
    ausschalten(t);
    return;
  }
  if (!PUNKTE[ereignis]) return;      // andere Ereignisse ignorieren

  // Pumpen reagieren sofort: jeder Klick gibt Laufzeit dazu
  if (t.art === "pumpe") {
    pumpeVerlaengern(t, PUNKTE[ereignis]);
    abarbeiten();
    return;
  }

  // Licht: sofort schalten. Jeder weitere Klick innerhalb von
  // klickPause schaltet zur nächsten Stimmung, danach beginnt
  // die Zählung wieder bei Stimmung 1.
  klicks[taste] = (klicks[taste] || 0) + PUNKTE[ereignis];
  stimmungSetzen(t, klicks[taste]);
  abarbeiten();
  if (timer[taste]) Timer.clear(timer[taste]);
  timer[taste] = Timer.set(CONFIG.klickPause, false, function () {
    timer[taste] = null;              // dieser Timer ist abgelaufen
    verwerfen(taste);
  });
}

function verwerfen(taste) {
  if (timer[taste]) Timer.clear(timer[taste]);
  timer[taste] = null;
  klicks[taste] = 0;
}

// ---------- Aktionen ----------

function ausschalten(t) {
  print(t.name + ": AUS");
  if (t.art === "pumpe") {
    offen[t.name] = 0;                // noch nicht verbuchte Klicks verwerfen
    schalten(t, false);
  }
  if (t.art === "licht") {
    for (let lampe in t.lampen) schalten(t.lampen[lampe], false);
  }
  abarbeiten();
}

// Jeder Klick verlängert die Restlaufzeit, höchstens bis maxStunden.
// Kommen Klicks, während die Restlaufzeit noch abgefragt wird,
// werden sie in "offen" gesammelt und gemeinsam verbucht.
let offen = {};

function pumpeVerlaengern(t, anzahl) {
  let abfrageLaeuft = offen[t.name] > 0;
  offen[t.name] = (offen[t.name] || 0) + anzahl;
  print(t.name + ": +" + anzahl + " Klick(s)");
  if (abfrageLaeuft) return;

  restlaufzeit(t, function (rest) {
    let n = offen[t.name];
    offen[t.name] = 0;
    if (rest === null || n === 0) return;  // Fehler oder inzwischen AUS
    let sek = rest + n * t.stundenProKlick * 3600;
    sek = Math.min(sek, t.maxStunden * 3600);
    print(t.name + ": läuft jetzt " + dauer(sek));
    schalten(t, true, sek);
  });
}

// n Klicks = Stimmung n; erst die Lampen der Stimmung einschalten,
// dann alle anderen ausschalten
function stimmungSetzen(t, anzahl) {
  let nr = Math.min(anzahl, t.stimmungen.length) - 1;
  let s = t.stimmungen[nr];
  print(t.name + ": " + anzahl + " Klick(s), Stimmung " + s.name);
  for (let i = 0; i < s.an.length; i++) {
    schalten(t.lampen[s.an[i]], true);
  }
  for (let lampe in t.lampen) {
    if (s.an.indexOf(lampe) < 0) schalten(t.lampen[lampe], false);
  }
}

// ---------- Shellys schalten (Gen1 und Gen2+) ----------
// "geraet" ist ein Eintrag mit ip und pw, also eine Pumpe oder Lampe

function schalten(geraet, an, sekunden) {
  let gen1 = "/relay/0?turn=" + (an ? "on" : "off");
  let gen2 = "/rpc/Switch.Set?id=0&on=" + an;
  if (sekunden) {
    gen1 += "&timer=" + sekunden;
    gen2 += "&toggle_after=" + sekunden;
  }
  anfrage(geraet, gen1, gen2);
}

// Restlaufzeit in Sekunden (0 = aus oder ohne Timer, null = Fehler)
function restlaufzeit(geraet, fertig) {
  anfrage(geraet, "/relay/0", "/rpc/Switch.GetStatus?id=0", function (d, gen) {
    if (!d) return fertig(null);
    if (gen === 1) return fertig(d.ison && d.has_timer ? d.timer_remaining : 0);
    if (!d.output || !d.timer_duration) return fertig(0);
    let jetzt = Shelly.getComponentStatus("sys").unixtime;
    fertig(Math.max(0, Math.round(d.timer_started_at + d.timer_duration - jetzt)));
  });
}

// ---------- Warteschlange für HTTP-Anfragen ----------
// Skripte dürfen nur wenige Aufrufe gleichzeitig starten und nur
// wenig verschachteln. Deshalb landet jeder Auftrag in einer Liste,
// die nacheinander abgearbeitet wird. Jeder Auftrag enthält den Pfad
// für Gen1-Shellys und den für Gen2+; welche Generation ein Gerät hat,
// fragt die Warteschlange beim ersten Kontakt über /shelly ab.
// Das Passwort steht in der Adresse (http://admin:pw@ip/...), Shelly
// erledigt damit Basic- (Gen1) und Digest-Anmeldung (Gen2) selbst.
// Sonderzeichen wie @ : / im Passwort deshalb besser vermeiden.

let warteschlange = [];
let beschaeftigt = false;
let generationen = {};               // IP -> 1 oder 2

function anfrage(geraet, gen1, gen2, fertig) {
  warteschlange.push({ ip: geraet.ip, pw: geraet.pw,
                       gen1: gen1, gen2: gen2, fertig: fertig });
}

function abarbeiten() {
  if (!beschaeftigt) naechsteAnfrage();
}

function naechsteAnfrage() {
  if (warteschlange.length === 0) { beschaeftigt = false; return; }
  beschaeftigt = true;
  let job = warteschlange[0];
  let gen = generationen[job.ip];
  let pfad = !gen ? "/shelly" : (gen === 1 ? job.gen1 : job.gen2);
  let login = job.pw ? "admin:" + job.pw + "@" : "";
  Shelly.call("HTTP.GET", { url: "http://" + login + job.ip + pfad, timeout: 5 },
              antwort, job);
}

function antwort(r, ec, em, job) {
  let daten = null;
  if (ec === 0 && r && r.code === 200) {
    try { daten = JSON.parse(r.body); } catch (x) { daten = {}; }
  } else {
    print("Fehler bei " + job.ip + ": " + (em || (r ? r.code : "?")));
  }
  if (daten && !generationen[job.ip]) {
    generationen[job.ip] = daten.gen || 1;   // Gen1 kennt das Feld "gen" nicht
  } else {
    warteschlange.splice(0, 1);              // Auftrag erledigt
    if (job.fertig) job.fertig(daten, generationen[job.ip]);
  }
  naechsteAnfrage();
}

// ---------- Hilfsfunktionen ----------

function dauer(sek) {                // 9000 -> "2:30 h"
  let min = Math.round(sek / 60);
  let mm = min % 60;
  return Math.floor(min / 60) + ":" + (mm < 10 ? "0" : "") + mm + " h";
}

// Beim Start alle Shellys einmal ansprechen, damit ihre Generation
// schon bekannt ist, wenn der erste Klick kommt
for (let nr in CONFIG.tasten) {
  let t = CONFIG.tasten[nr];
  if (t.ip) anfrage(t, "/shelly", "/shelly");
  for (let lampe in t.lampen) anfrage(t.lampen[lampe], "/shelly", "/shelly");
}
abarbeiten();

print("shelly_button V4.1 läuft, lauscht auf " + CONFIG.button);