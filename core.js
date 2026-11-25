/* Moteur de calcul du suivi des remplacements (sans dépendance, testable sous Node).
   Les dates sont des chaînes "AAAA-MM-JJ" et les heures des chaînes "HH:MM" :
   aucun objet Date n'intervient dans les calculs, donc pas de décalage de fuseau
   ni de surprise au changement d'heure. */
(function (root) {
  "use strict";

  const DEFAULT_SETTINGS = {
    taux: 0, forfait: 0,
    majSam: 0, majDim: 0, majFer: 0, majNuit: 0,
    nuitDeb: "21:00", nuitFin: "06:00",
    seuilJour: 6, demiJours: true,
    maxJour: 10, refHebdo: 35, maxHebdo: 48,
    ik: 0, alsace: false, delaiPaie: 45,
  };

  // ---------------------------------------------------------------- dates
  const pad = (n) => String(n).padStart(2, "0");
  function isIso(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && dayNum(s) !== null; }
  function dayNum(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    const t = Date.UTC(y, mo - 1, d);
    const back = new Date(t);
    if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
    return Math.round(t / 86400000);
  }
  function isoFromNum(n) {
    const d = new Date(n * 86400000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const addDays = (iso, k) => isoFromNum(dayNum(iso) + k);
  const weekday = (iso) => ((dayNum(iso) + 3) % 7 + 7) % 7 + 1; // 1 = lundi … 7 = dimanche
  const mondayOf = (iso) => addDays(iso, 1 - weekday(iso));
  function todayIso(now) {
    const d = now || new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  const yearOf = (iso) => +iso.slice(0, 4);
  const monthKey = (iso) => iso.slice(0, 7);
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

  const JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
  const JOURS_COURTS = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];
  const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  function dateLongue(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return `${JOURS[weekday(iso) - 1]} ${d === 1 ? "1er" : d} ${MOIS[m - 1]} ${y}`;
  }
  function dateCourte(iso) { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; }

  // ---------------------------------------------------------------- jours fériés
  function paques(y) { // algorithme de Butcher (calendrier grégorien)
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mois = Math.floor((h + l - 7 * m + 114) / 31), jour = ((h + l - 7 * m + 114) % 31) + 1;
    return `${y}-${pad(mois)}-${pad(jour)}`;
  }
  const ferieCache = {};
  function feries(y, alsace) {
    const key = y + (alsace ? "A" : "");
    if (ferieCache[key]) return ferieCache[key];
    const p = paques(y);
    const list = {
      [`${y}-01-01`]: "Jour de l'an", [addDays(p, 1)]: "Lundi de Pâques", [`${y}-05-01`]: "Fête du travail",
      [`${y}-05-08`]: "Victoire 1945", [addDays(p, 39)]: "Ascension", [addDays(p, 50)]: "Lundi de Pentecôte",
      [`${y}-07-14`]: "Fête nationale", [`${y}-08-15`]: "Assomption", [`${y}-11-01`]: "Toussaint",
      [`${y}-11-11`]: "Armistice 1918", [`${y}-12-25`]: "Noël",
    };
    if (alsace) { list[addDays(p, -2)] = "Vendredi saint"; list[`${y}-12-26`] = "Saint-Étienne"; }
    return (ferieCache[key] = list);
  }
  function ferie(iso, s) { return feries(yearOf(iso), !!(s && s.alsace))[iso] || null; }
  function typeJour(iso, s) {
    const f = ferie(iso, s);
    if (f) return { type: "Férié", nom: f };
    const w = weekday(iso);
    return { type: w === 7 ? "Dimanche" : w === 6 ? "Samedi" : "Semaine", nom: null };
  }

  // ---------------------------------------------------------------- lecture des saisies
  function parseHeure(txt) { // "08:30", "8h30", "830", "8" -> minutes depuis minuit
    if (txt == null) return null;
    let s = String(txt).trim().toLowerCase().replace(/\s+/g, "").replace(/h|\./g, ":");
    if (s === "") return null;
    let h, m;
    if (s.includes(":")) {
      const [a, b] = s.split(":");
      h = a === "" ? 0 : Number(a); m = b === "" || b === undefined ? 0 : Number(b);
    } else if (/^\d{3,4}$/.test(s)) { h = Math.floor(+s / 100); m = +s % 100; }
    else { const n = Number(s.replace(",", ".")); h = Math.floor(n); m = Math.round((n - h) * 60); }
    if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isInteger(h) || !Number.isInteger(m)) return NaN;
    if (h < 0 || m < 0 || m > 59 || h * 60 + m > 1440) return NaN;
    return h * 60 + m;
  }
  function parseDuree(txt) { // "7h30", "7:30", "7,5", "7.5", "450min", "45m", "7h" -> heures
    if (txt == null) return null;
    if (typeof txt === "number") return txt >= 0 ? txt : NaN;
    let s = String(txt).trim().toLowerCase().replace(/\s+/g, "").replace(/minutes?|mins?|mn/g, "m").replace(/h/g, ":");
    if (s === "") return null;
    let r;
    if (s.includes(":")) {
      const [a, b] = s.split(":"); const bb = (b || "").replace(/m$/, "");
      const h = a === "" ? 0 : Number(a.replace(",", ".")), m = bb === "" ? 0 : Number(bb);
      r = (Number.isFinite(h) && Number.isFinite(m) && m >= 0 && m < 60) ? h + m / 60 : NaN;
    } else if (/m$/.test(s)) { const n = Number(s.slice(0, -1).replace(",", ".")); r = n / 60; }
    else r = Number(s.replace(",", "."));
    return Number.isFinite(r) && r >= 0 ? Math.round(r * 100) / 100 : NaN;
  }
  const hm = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;

  // ---------------------------------------------------------------- une intervention
  // mode : "horaires" (début/fin/pause), "heures" (nombre d'heures), "jour" (jour sans heures)
  function plage(e) {
    if (e.mode !== "horaires") return null;
    const a = parseHeure(e.debut), b = parseHeure(e.fin);
    if (a == null || b == null || Number.isNaN(a) || Number.isNaN(b)) return null;
    const deb = a % 1440, fin0 = b % 1440;
    const fin = fin0 <= deb ? fin0 + 1440 : fin0; // fin avant (ou égale) au début : lendemain
    return { deb, fin, lendemain: fin0 < deb, egal: fin0 === deb };
  }
  function overlap(a1, a2, b1, b2) { return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1)); }
  function nuitMinutes(deb, fin, s) {
    const ns = parseHeure(s.nuitDeb), ne = parseHeure(s.nuitFin);
    if (ns == null || ne == null || Number.isNaN(ns) || Number.isNaN(ne) || ns === ne) return 0;
    const iv = ns > ne ? [[0, ne], [ns, 1440 + ne], [1440 + ns, 2880]] : [[ns, ne], [1440 + ns, 1440 + ne]];
    return iv.reduce((t, [x, y]) => t + overlap(deb, fin, x, y), 0);
  }
  function mesure(e, s) {
    s = s || DEFAULT_SETTINGS;
    if (e.mode === "horaires") {
      const p = plage(e);
      if (!p) return { dur: 0, nuit: 0, plage: null };
      if (p.egal) return { dur: 0, nuit: 0, plage: p };
      const pause = Math.max(0, Number(e.pause) || 0);
      const durMin = Math.max(0, p.fin - p.deb - pause);
      const nuit = Math.min(durMin, nuitMinutes(p.deb, p.fin, s));
      return { dur: r2(durMin / 60), nuit: r2(nuit / 60), plage: p, brut: (p.fin - p.deb) / 60 };
    }
    if (e.mode === "heures") { const h = parseDuree(e.heures); return { dur: Number.isFinite(h) ? h : 0, nuit: 0, plage: null }; }
    return { dur: 0, nuit: 0, plage: null };
  }
  const r2 = (x) => Math.round(x * 100) / 100;

  // Ce qui empêche d'enregistrer (renvoie une liste de messages)
  function bloquants(e) {
    const m = [];
    if (!isIso(e.date)) m.push("Date manquante ou invalide.");
    if (!["Effectué", "Prévu", "Annulé"].includes(e.statut)) m.push("Choisissez un statut.");
    if (e.mode === "horaires") {
      const a = parseHeure(e.debut), b = parseHeure(e.fin);
      if (a == null || b == null) m.push("Indiquez l'heure de début et l'heure de fin.");
      else if (Number.isNaN(a) || Number.isNaN(b)) m.push("Heure illisible (exemple : 08:30).");
      else {
        const p = plage(e);
        if (p.egal) m.push("L'heure de fin est identique à l'heure de début.");
        else if ((Number(e.pause) || 0) >= p.fin - p.deb) m.push("La pause est plus longue que la présence.");
      }
      if (!(Number(e.pause) >= 0) || Number(e.pause) > 720) m.push("Pause invalide (en minutes, entre 0 et 720).");
    } else if (e.mode === "heures") {
      const h = parseDuree(e.heures);
      if (h == null) m.push("Indiquez le nombre d'heures (exemples : 7h30, 7,5).");
      else if (Number.isNaN(h)) m.push("Nombre d'heures illisible (exemples : 7h30, 7:30, 7,5).");
      else if (h === 0) m.push("Le nombre d'heures est nul.");
      else if (h > 24) m.push("Plus de 24 heures sur une seule intervention.");
    } else if (e.mode === "jour") {
      if (![1, 0.5].includes(e.jours)) m.push("Choisissez 1 jour ou une demi-journée.");
    } else m.push("Choisissez horaires, nombre d'heures ou journée.");
    for (const k of ["km", "frais", "taux"]) if (e[k] != null && e[k] !== "" && !(Number(e[k]) >= 0)) m.push(`Valeur invalide : ${k}.`);
    return m;
  }

  // ---------------------------------------------------------------- calcul global
  function lieuDe(state, nom) {
    if (!nom) return null;
    const n = nom.trim().toLowerCase();
    return (state.lieux || []).find((l) => l.nom.trim().toLowerCase() === n) || null;
  }
  function tauxDe(state, e) {
    const s = state.settings;
    if (Number(e.taux) > 0) return Number(e.taux);
    const l = lieuDe(state, e.lieu);
    if (l && Number(l.taux) > 0) return Number(l.taux);
    return Number(s.taux) || 0;
  }
  function forfaitDe(state, e) {
    const l = lieuDe(state, e.lieu);
    if (l && Number(l.forfait) > 0) return Number(l.forfait);
    return Number(state.settings.forfait) || 0;
  }
  function majDe(type, s) {
    return type === "Férié" ? +s.majFer || 0 : type === "Dimanche" ? +s.majDim || 0 : type === "Samedi" ? +s.majSam || 0 : 0;
  }

  // Jours comptés pour une date (au plus 1), à partir des interventions données
  function joursDuJour(list, s) {
    const avec = list.filter((x) => x.e.jours === 1 || x.e.jours === 0.5 || x.e.jours === 0);
    const total = list.reduce((t, x) => t + x.m.dur, 0);
    let j;
    if (avec.length) j = Math.min(1, avec.reduce((t, x) => t + x.e.jours, 0));
    else if (total <= 0) j = 0;
    else j = !s.demiJours || total >= (+s.seuilJour || 0) ? 1 : 0.5;
    // l'intervention « porteuse » du jour : celle qui a fixé les jours, sinon la plus longue
    let porteur = null;
    if (j > 0) {
      const cand = avec.length ? avec.filter((x) => x.e.jours > 0) : list;
      porteur = cand.slice().sort((a, b) => b.m.dur - a.m.dur || (a.e.createdAt || 0) - (b.e.createdAt || 0))[0] || null;
    }
    return { jours: j, heures: r2(total), porteur: porteur ? porteur.e.id : null };
  }

  function calculer(state, today) {
    const s = { ...DEFAULT_SETTINGS, ...(state.settings || {}) };
    const st = { ...state, settings: s };
    today = today || todayIso();
    const entries = (state.entries || []).filter((e) => isIso(e.date));
    const res = {}; // id -> calculs
    const parDate = {}; // date -> { eff: [], prev: [], tous: [] }
    for (const e of entries) {
      const m = mesure(e, s);
      const t = typeJour(e.date, s);
      res[e.id] = { e, m, type: t.type, ferie: t.nom, jours: 0, alertes: [] };
      const d = (parDate[e.date] = parDate[e.date] || { eff: [], prev: [], actifs: [] });
      if (e.statut === "Effectué") d.eff.push(res[e.id]);
      if (e.statut === "Prévu") d.prev.push(res[e.id]);
      if (e.statut !== "Annulé") d.actifs.push(res[e.id]);
    }
    const jours = {}; // date -> { jours, heures, porteur, joursPrevus }
    for (const [date, d] of Object.entries(parDate)) {
      const j = joursDuJour(d.eff, s);
      const jp = joursDuJour(d.prev, s);
      jours[date] = { ...j, joursPrevus: jp.jours, heuresPrevues: jp.heures };
      if (j.porteur) res[j.porteur].jours = j.jours;
      if (jp.porteur) res[jp.porteur].joursPrevus = jp.jours;
    }
    // montants
    for (const r of Object.values(res)) {
      const e = r.e;
      r.taux = tauxDe(st, e);
      const fr = r2((Number(e.km) || 0) * (+s.ik || 0) + (Number(e.frais) || 0));
      r.frais = fr;
      if (e.statut === "Annulé") { r.montant = 0; }
      else {
        const j = e.statut === "Effectué" ? r.jours : (r.joursPrevus || 0);
        r.montant = r2(r.taux * (r.m.dur * (1 + majDe(r.type, s)) + r.m.nuit * (+s.majNuit || 0)) + j * forfaitDe(st, e));
      }
      r.total = r2(r.montant + r.frais);
    }
    // alertes
    for (const r of Object.values(res)) {
      const e = r.e, a = r.alertes, d = parDate[e.date];
      const actif = e.statut !== "Annulé";
      if (e.statut === "Effectué" && e.date > today) a.push("Effectué à une date future : plutôt Prévu ?");
      if (e.statut === "Prévu" && e.date < today) a.push("Prévu dans le passé : à passer en Effectué ou Annulé.");
      if (!e.lieu || !e.lieu.trim()) a.push("Lieu non renseigné.");
      if (actif) {
        const tot = d.actifs.reduce((t, x) => t + x.m.dur, 0);
        if (tot > (+s.maxJour || 24)) a.push(`Plus de ${fmtNb(s.maxJour)} h ce jour-là (${fmtNb(r2(tot))} h).`);
        if (r.m.plage && !r.m.plage.egal) {
          const p = r.m.plage;
          const chev = d.actifs.some((x) => x !== r && x.m.plage && !x.m.plage.egal && x.m.plage.deb < p.fin && x.m.plage.fin > p.deb);
          if (chev) a.push("Chevauche une autre intervention du même jour.");
          const veille = parDate[addDays(e.date, -1)];
          if (veille) {
            const finVeille = Math.max(-1, ...veille.actifs.filter((x) => x.m.plage && !x.m.plage.egal).map((x) => x.m.plage.fin));
            if (finVeille >= 0) {
              const repos = p.deb + 1440 - finVeille;
              if (repos < 0) a.push("Chevauche l'intervention de nuit de la veille.");
              else if (repos < 11 * 60) a.push(`Seulement ${fmtH(repos / 60)} de repos depuis la veille (11 h minimum).`);
            }
          }
          if (r.m.dur > 6 && (Number(e.pause) || 0) < 20) a.push("Plus de 6 h sans pause d'au moins 20 min.");
        }
        const doublon = d.actifs.some((x) => x !== r && (x.e.lieu || "").trim().toLowerCase() === (e.lieu || "").trim().toLowerCase()
          && ((x.m.plage && r.m.plage && x.m.plage.deb === r.m.plage.deb) || (!x.m.plage && !r.m.plage)));
        if (doublon) a.push("Doublon probable : même jour, même lieu" + (r.m.plage ? ", même heure de début." : "."));
      }
      if (e.statut === "Effectué" && !e.paye && dayNum(today) - dayNum(e.date) > (+s.delaiPaie || 9999))
        a.push(`Non payé depuis plus de ${s.delaiPaie} jours.`);
      if (e.paye && e.datePaie && isIso(e.datePaie) && e.datePaie < e.date) a.push("Date de paiement avant l'intervention.");
      if (isIndispo(state, e.date) && actif) a.push("Ce jour figure dans vos indisponibilités.");
    }
    return { res, jours, settings: s, today };
  }

  function isIndispo(state, iso) {
    return (state.indispo || []).some((p) => p.du && iso >= p.du && iso <= (p.au || p.du));
  }

  // ---------------------------------------------------------------- synthèses
  function vide() {
    return { heures: 0, nuit: 0, jours: 0, joursSem: 0, joursSam: 0, joursDim: 0, joursFer: 0, hSam: 0, hDim: 0, hFer: 0,
      interventions: 0, prevuesH: 0, prevuesJ: 0, annulees: 0, montant: 0, frais: 0, total: 0, paye: 0, reste: 0, joursAvecHeures: 0 };
  }
  function ajouter(t, r, calc) {
    const e = r.e;
    if (e.statut === "Effectué") {
      t.interventions++;
      t.heures += r.m.dur; t.nuit += r.m.nuit;
      if (r.type === "Samedi") t.hSam += r.m.dur; if (r.type === "Dimanche") t.hDim += r.m.dur; if (r.type === "Férié") t.hFer += r.m.dur;
      if (r.jours) {
        t.jours += r.jours;
        if (r.type === "Samedi") t.joursSam += r.jours; else if (r.type === "Dimanche") t.joursDim += r.jours;
        else if (r.type === "Férié") t.joursFer += r.jours; else t.joursSem += r.jours;
        if (calc.jours[e.date].heures > 0) t.joursAvecHeures++;
      }
      t.montant += r.montant;
    }
    if (e.statut === "Prévu") { t.prevuesH += r.m.dur; t.prevuesJ += r.joursPrevus || 0; }
    if (e.statut === "Annulé") t.annulees++;
    if (e.statut !== "Prévu") {
      t.frais += r.frais;
      const tot = (e.statut === "Effectué" ? r.montant : 0) + r.frais;
      t.total += tot;
      if (e.paye) t.paye += tot;
    }
  }
  function arrondir(t) { for (const k of Object.keys(t)) if (typeof t[k] === "number") t[k] = r2(t[k]); t.reste = r2(t.total - t.paye); return t; }
  function synthese(calc, filtre) {
    const t = vide();
    for (const r of Object.values(calc.res)) if (filtre(r.e)) ajouter(t, r, calc);
    return arrondir(t);
  }
  const syntheseMois = (calc, y, m) => synthese(calc, (e) => e.date.startsWith(`${y}-${pad(m)}`));
  const syntheseAnnee = (calc, y) => synthese(calc, (e) => e.date.startsWith(`${y}-`));
  function parLieu(calc, prefix) {
    const map = {};
    for (const r of Object.values(calc.res)) {
      if (!r.e.date.startsWith(prefix)) continue;
      const k = (r.e.lieu || "").trim() || "(sans lieu)";
      ajouter((map[k] = map[k] || vide()), r, calc);
    }
    return Object.entries(map).map(([lieu, t]) => ({ lieu, ...arrondir(t) })).sort((a, b) => b.heures - a.heures);
  }
  function joursOuvres(y, m, s, state) { // lundi-vendredi hors fériés et indisponibilités
    let ouvres = 0, dispo = 0;
    for (let d = 1; d <= daysInMonth(y, m); d++) {
      const iso = `${y}-${pad(m)}-${pad(d)}`;
      if (weekday(iso) <= 5 && !ferie(iso, s)) { ouvres++; if (!isIndispo(state, iso)) dispo++; }
    }
    return { ouvres, dispo };
  }
  function semaines(calc, y, m) { // semaines (lundi-dimanche) qui touchent le mois
    const s = calc.settings, out = [];
    const first = `${y}-${pad(m)}-01`, last = `${y}-${pad(m)}-${pad(daysInMonth(y, m))}`;
    for (let lun = mondayOf(first); lun <= last; lun = addDays(lun, 7)) {
      let h = 0, hp = 0, j = 0;
      for (let k = 0; k < 7; k++) {
        const iso = addDays(lun, k), d = calc.jours[iso];
        if (d) { h += d.heures; hp += d.heuresPrevues; if (d.jours > 0 || d.heures > 0) j++; }
      }
      const alertes = [];
      if (h > s.maxHebdo) alertes.push(`Au-dessus du maximum de ${fmtNb(s.maxHebdo)} h.`);
      else if (h + hp > s.maxHebdo) alertes.push(`Avec le prévu, la semaine dépasse ${fmtNb(s.maxHebdo)} h.`);
      if (j >= 7) alertes.push("Aucun jour de repos dans la semaine.");
      if (h > s.refHebdo && h <= s.maxHebdo) alertes.push(`Au-delà de ${fmtNb(s.refHebdo)} h : vérifiez la majoration des heures en plus.`);
      out.push({ lundi: lun, dimanche: addDays(lun, 6), heures: r2(h), prevues: r2(hp), joursTravailles: j, alertes });
    }
    return out;
  }

  // ---------------------------------------------------------------- répétition sur une période
  function datesPeriode(du, au, jours, opts, s, state) {
    // jours : tableau de 7 booléens (lundi..dimanche)
    if (!isIso(du)) return { dates: [], erreur: "Date de début invalide." };
    if (!au) return { dates: [du], erreur: null };
    if (!isIso(au)) return { dates: [], erreur: "Date de fin invalide." };
    const n = dayNum(au) - dayNum(du);
    if (n < 0) return { dates: [], erreur: "La date de fin est avant la date de début." };
    if (n > 365) return { dates: [], erreur: "Période de plus d'un an : coupez-la en deux." };
    const out = [];
    for (let k = 0; k <= n; k++) {
      const iso = addDays(du, k);
      if (!jours[weekday(iso) - 1]) continue;
      if (!opts.feries && ferie(iso, s)) continue;
      if (opts.sauterIndispo && isIndispo(state, iso)) continue;
      out.push(iso);
    }
    return { dates: out, erreur: out.length ? null : "Aucune date retenue avec ces jours de la semaine." };
  }

  // ---------------------------------------------------------------- formats
  function fmtNb(x, dec) {
    const v = Number(x) || 0;
    return v.toLocaleString("fr-FR", { minimumFractionDigits: dec || 0, maximumFractionDigits: dec == null ? 2 : dec });
  }
  function fmtH(h) {
    const min = Math.round((Number(h) || 0) * 60);
    const H = Math.floor(min / 60), M = min % 60;
    return M ? `${H} h ${pad(M)}` : `${H} h`;
  }
  const fmtEur = (x) => (Number(x) || 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
  const fmtJ = (j) => (j === 0.5 ? "½ j" : `${fmtNb(j)} j`);

  // ---------------------------------------------------------------- export tableur
  function csv(state, calc) {
    const sep = ";";
    const q = (v) => { const s = v == null ? "" : String(v); return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const num = (x) => (x === "" || x == null ? "" : String(x).replace(".", ","));
    const head = ["Date", "Lieu / employeur", "Personne remplacée", "Poste / motif", "Statut", "Début", "Fin", "Pause (min)",
      "Heures saisies", "Jours saisis", "Km", "Autres frais", "Taux spécifique", "Payé ?", "Date de paiement", "Commentaire",
      "Type de jour", "Heures", "dont nuit", "Jours comptés", "Rémunération brute", "Frais", "Total", "Alertes"];
    const rows = [head.join(sep)];
    const list = (state.entries || []).slice().sort((a, b) => (a.date + (a.debut || "")).localeCompare(b.date + (b.debut || "")));
    for (const e of list) {
      const r = calc.res[e.id]; if (!r) continue;
      rows.push([
        dateCourte(e.date), e.lieu, e.personne, e.motif, e.statut,
        e.mode === "horaires" ? e.debut : "", e.mode === "horaires" ? e.fin : "", e.mode === "horaires" ? (e.pause || "") : "",
        e.mode === "heures" ? num(r.m.dur) : "", e.jours == null ? "" : num(e.jours), num(e.km || ""), num(e.frais || ""), num(e.taux || ""),
        e.paye ? "Oui" : "Non", e.datePaie && isIso(e.datePaie) ? dateCourte(e.datePaie) : "", e.commentaire,
        r.ferie ? `Férié (${r.ferie})` : r.type, num(r.m.dur), num(r.m.nuit), num(r.jours), num(r.montant), num(r.frais), num(r.total),
        r.alertes.join(" "),
      ].map(q).join(sep));
    }
    return "﻿" + rows.join("\r\n");
  }

  // ---------------------------------------------------------------- sauvegarde
  function validerSauvegarde(obj) {
    if (!obj || typeof obj !== "object") return "Fichier illisible.";
    if (obj.app !== "suivi-remplacements") return "Ce fichier n'est pas une sauvegarde du suivi des remplacements.";
    if (!Array.isArray(obj.entries)) return "Sauvegarde incomplète (aucune intervention).";
    for (const e of obj.entries) if (!e || !e.id || !isIso(e.date)) return "Sauvegarde abîmée : une intervention n'a pas de date valide.";
    return null;
  }
  function fusionner(local, distant) {
    const map = new Map((local.entries || []).map((e) => [e.id, e]));
    let ajout = 0, maj = 0;
    for (const e of distant.entries) {
      const l = map.get(e.id);
      if (!l) { map.set(e.id, e); ajout++; }
      else if ((e.updatedAt || 0) > (l.updatedAt || 0)) { map.set(e.id, e); maj++; }
    }
    const lieux = [...(local.lieux || [])];
    for (const l of distant.lieux || []) if (!lieux.some((x) => x.nom.trim().toLowerCase() === l.nom.trim().toLowerCase())) lieux.push(l);
    const indispo = [...(local.indispo || [])];
    for (const p of distant.indispo || []) if (!indispo.some((x) => x.du === p.du && x.au === p.au)) indispo.push(p);
    return { state: { ...local, entries: [...map.values()], lieux, indispo }, ajout, maj };
  }

  const Core = {
    DEFAULT_SETTINGS, JOURS, JOURS_COURTS, MOIS, pad, isIso, dayNum, isoFromNum, addDays, weekday, mondayOf, todayIso, yearOf, monthKey,
    daysInMonth, dateLongue, dateCourte, paques, feries, ferie, typeJour, parseHeure, parseDuree, hm, plage, mesure, bloquants,
    calculer, isIndispo, syntheseMois, syntheseAnnee, parLieu, joursOuvres, semaines, datesPeriode, fmtNb, fmtH, fmtEur, fmtJ,
    csv, validerSauvegarde, fusionner, lieuDe, tauxDe,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = Core; else root.Core = Core;
})(typeof window !== "undefined" ? window : globalThis);
