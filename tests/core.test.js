// Tests du moteur : node tests/core.test.js
const C = require("../core.js");
let ok = 0, ko = 0;
function eq(nom, got, exp) {
  const g = JSON.stringify(got), x = JSON.stringify(exp);
  if (g === x) ok++; else { ko++; console.log(`ÉCHEC ${nom}\n  obtenu  : ${g}\n  attendu : ${x}`); }
}
const S = { ...C.DEFAULT_SETTINGS, taux: 15 };
let n = 0;
const E = (o) => ({ id: "e" + ++n, createdAt: n, lieu: "A", statut: "Effectué", mode: "horaires", pause: 0, jours: null, ...o });

// dates
eq("lundi", C.weekday("2026-11-16"), 1);
eq("dimanche", C.weekday("2026-11-22"), 7);
eq("lundi de la semaine", C.mondayOf("2026-01-01"), "2025-12-29");
eq("29 février invalide", C.isIso("2026-02-29"), false);
eq("29 février bissextile", C.isIso("2028-02-29"), true);
eq("date longue", C.dateLongue("2026-11-01"), "dimanche 1er novembre 2026");
// Pâques et fériés
eq("Pâques 2026", C.paques(2026), "2026-04-05");
eq("Pâques 2027", C.paques(2027), "2027-03-28");
eq("Pâques 2025", C.paques(2025), "2025-04-20");
eq("Ascension 2026", C.ferie("2026-05-14", S), "Ascension");
eq("Pentecôte 2026", C.ferie("2026-05-25", S), "Lundi de Pentecôte");
eq("pas férié", C.ferie("2026-05-26", S), null);
eq("Alsace non", C.ferie("2026-12-26", S), null);
eq("Alsace oui", C.ferie("2026-12-26", { ...S, alsace: true }), "Saint-Étienne");
eq("type férié un dimanche", C.typeJour("2026-11-01", S).type, "Férié");
eq("type samedi", C.typeJour("2026-11-21", S).type, "Samedi");
// lecture des heures
for (const [t, v] of [["08:30", 510], ["8h30", 510], ["830", 510], ["8", 480], ["8,5", 510], ["08H05", 485], ["24:00", 1440], ["0h", 0]]) eq("heure " + t, C.parseHeure(t), v);
for (const t of ["25h", "8:75", "abc"]) eq("heure illisible " + t, Number.isNaN(C.parseHeure(t)), true);
for (const [t, v] of [["7h30", 7.5], ["7:30", 7.5], ["7,5", 7.5], ["7.5", 7.5], ["450min", 7.5], ["45m", 0.75], ["7h", 7], ["7 h 15", 7.25]]) eq("durée " + t, C.parseDuree(t), v);
eq("durée négative", Number.isNaN(C.parseDuree("-2")), true);
// mesures
eq("journée avec pause", C.mesure(E({ date: "2026-11-16", debut: "08:30", fin: "17:00", pause: 60 }), S).dur, 7.5);
const nuit = C.mesure(E({ date: "2026-11-16", debut: "21:00", fin: "07:00" }), S);
eq("nuit à cheval", [nuit.dur, nuit.nuit, nuit.plage.lendemain], [10, 9, true]);
eq("soirée 18-23", C.mesure(E({ date: "2026-11-16", debut: "18:00", fin: "23:00" }), S).nuit, 2);
eq("matin 5-9", C.mesure(E({ date: "2026-11-16", debut: "05:00", fin: "09:00" }), S).nuit, 1);
eq("24 h", C.mesure(E({ date: "2026-11-16", debut: "08:00", fin: "08:00" }), S).dur, 0);
eq("heures directes", C.mesure(E({ date: "2026-11-16", mode: "heures", heures: "7h30" }), S).dur, 7.5);
// bloquants
eq("début = fin bloque", C.bloquants(E({ date: "2026-11-16", debut: "08:00", fin: "08:00" })).length > 0, true);
eq("pause trop longue bloque", C.bloquants(E({ date: "2026-11-16", debut: "08:00", fin: "09:00", pause: 60 })).length > 0, true);
eq("week-end autorisé", C.bloquants(E({ date: "2026-11-22", debut: "08:00", fin: "12:00" })), []);
eq("férié autorisé", C.bloquants(E({ date: "2026-12-25", debut: "08:00", fin: "12:00" })), []);
eq("jour sans heures ok", C.bloquants(E({ date: "2026-11-16", mode: "jour", jours: 1 })), []);
eq("jour sans valeur bloque", C.bloquants(E({ date: "2026-11-16", mode: "jour", jours: null })).length, 1);

// calcul global
const state = {
  settings: { ...S, majDim: 0.25, majFer: 1, majNuit: 0.1, forfait: 0 },
  lieux: [{ nom: "B", taux: 20 }],
  entries: [
    E({ id: "m", date: "2026-11-16", debut: "08:00", fin: "12:00" }),           // 4 h
    E({ id: "a", date: "2026-11-16", lieu: "B", debut: "13:00", fin: "17:00" }), // 4 h, même jour -> 1 jour au total
    E({ id: "n", date: "2026-11-17", debut: "21:00", fin: "07:00" }),            // nuit 10 h dont 9
    E({ id: "r", date: "2026-11-18", debut: "14:00", fin: "17:00" }),            // repos 7 h
    E({ id: "d", date: "2026-11-22", debut: "08:00", fin: "12:00" }),            // dimanche 4 h
    E({ id: "f", date: "2026-12-25", mode: "heures", heures: "7,5", statut: "Prévu" }), // Noël prévu
    E({ id: "j", date: "2026-11-19", mode: "jour", jours: 0.5 }),                // demi-journée sans heures
    E({ id: "x", date: "2026-11-20", debut: "09:00", fin: "12:00", statut: "Annulé", km: 20, frais: 5 }),
    E({ id: "c1", date: "2026-11-21", debut: "09:00", fin: "12:00" }),
    E({ id: "c2", date: "2026-11-21", debut: "11:00", fin: "13:00", lieu: "Z" }),
  ],
};
const calc = C.calculer(state, "2026-11-25");
eq("jours 16/11", calc.jours["2026-11-16"].jours, 1);
eq("jour porté une seule fois", calc.res.m.jours + calc.res.a.jours, 1);
eq("taux du lieu B", calc.res.a.taux, 20);
eq("montant nuit", calc.res.n.montant, 15 * (10 + 9 * 0.1));
eq("montant dimanche", calc.res.d.montant, 15 * 4 * 1.25);
eq("repos alerte", calc.res.r.alertes.some((a) => a.includes("repos")), true);
eq("demi-journée", calc.jours["2026-11-19"].jours, 0.5);
eq("annulé : 0 € mais frais", [calc.res.x.montant, calc.res.x.frais], [0, 5]);
eq("chevauchement", calc.res.c1.alertes.some((a) => a.includes("Chevauche")), true);
eq("Noël prévu", [calc.res.f.type, calc.res.f.ferie, calc.jours["2026-12-25"].joursPrevus], ["Férié", "Noël", 1]);
eq("pas d'alerte doublon entre lieux différents", calc.res.c2.alertes.some((a) => a.includes("Doublon")), false);
const nov = C.syntheseMois(calc, 2026, 11);
eq("novembre heures", nov.heures, 4 + 4 + 10 + 3 + 4 + 3 + 2);
eq("novembre jours", nov.jours, 1 + 1 + 0.5 + 0.5 + 0.5 + 0.5); // 16, 17, 18 (3 h), 19 (½ saisi), 21 (5 h), 22 (4 h)
const dec = C.syntheseMois(calc, 2026, 12);
eq("décembre prévu", [dec.prevuesH, dec.prevuesJ, dec.heures], [7.5, 1, 0]);
const ouv = C.joursOuvres(2026, 11, state.settings, state);
eq("jours ouvrés novembre 2026", ouv.ouvres, 20);
// période
const p = C.datesPeriode("2026-12-21", "2026-12-27", [true, true, true, true, true, false, false], { feries: false }, S, state);
eq("période sans Noël", p.dates, ["2026-12-21", "2026-12-22", "2026-12-23", "2026-12-24"]);
const p2 = C.datesPeriode("2026-12-21", "2026-12-27", [false, false, false, false, true, true, true], { feries: true }, S, state);
eq("période week-end + férié", p2.dates, ["2026-12-25", "2026-12-26", "2026-12-27"]);
eq("fin avant début", C.datesPeriode("2026-12-21", "2026-12-01", [1, 1, 1, 1, 1, 1, 1], { feries: true }, S, state).erreur !== null, true);
// semaine
const big = { settings: S, entries: [] };
for (let k = 0; k < 7; k++) big.entries.push(E({ date: C.addDays("2026-11-16", k), debut: "08:00", fin: "16:00", pause: 30 }));
const w = C.semaines(C.calculer(big, "2026-12-31"), 2026, 11).find((x) => x.lundi === "2026-11-16");
eq("semaine 7 jours", [w.heures, w.joursTravailles, w.alertes.length >= 2], [52.5, 7, true]);
// export et sauvegarde
const out = C.csv(state, calc);
eq("csv BOM + entête", out.startsWith("﻿Date;"), true);
eq("csv décimales à la virgule", out.includes(";7,5;"), true);
eq("sauvegarde refusée", C.validerSauvegarde({ app: "autre" }) !== null, true);
const fus = C.fusionner({ entries: [{ id: "1", date: "2026-01-01", updatedAt: 1 }] }, { app: "suivi-remplacements", entries: [{ id: "1", date: "2026-01-01", updatedAt: 5, lieu: "N" }, { id: "2", date: "2026-01-02" }] });
eq("fusion", [fus.ajout, fus.maj, fus.state.entries.length], [1, 1, 2]);

console.log(`${ok} réussis, ${ko} échoués`);
process.exit(ko ? 1 : 0);
