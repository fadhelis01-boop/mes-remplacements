/* Interface du suivi des remplacements. Données gardées sur l'appareil (localStorage). */
(function () {
  "use strict";
  const C = window.Core;
  const KEY = "suivi-remplacements.v1";
  const VERSION = "1.0.0";
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const parseNum = (v) => { if (v === "" || v == null) return ""; const n = Number(String(v).replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) ? n : NaN; };
  const numTxt = (v) => (v === "" || v == null ? "" : String(v).replace(".", ","));
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isAndroid = /android/i.test(navigator.userAgent);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const mobile = window.matchMedia("(pointer: coarse)").matches;

  // ------------------------------------------------------------ stockage
  let stockageOK = true;
  function blank() {
    return { app: "suivi-remplacements", version: 1, settings: { ...C.DEFAULT_SETTINGS }, lieux: [], indispo: [], entries: [], prefs: {}, lastBackup: null };
  }
  function load() {
    try {
      localStorage.setItem(KEY + ".test", "1"); localStorage.removeItem(KEY + ".test");
      const raw = localStorage.getItem(KEY);
      if (!raw) return blank();
      const o = JSON.parse(raw);
      return { ...blank(), ...o, settings: { ...C.DEFAULT_SETTINGS, ...(o.settings || {}) }, prefs: o.prefs || {} };
    } catch (e) { stockageOK = false; return blank(); }
  }
  let state = load();
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); stockageOK = true; }
    catch (e) { stockageOK = false; toast("Impossible d'enregistrer sur cet appareil (stockage plein ou navigation privée). Faites une sauvegarde."); }
    renderBandeau();
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  // annuler la dernière action
  let annulable = null;
  function snapshot(label) { annulable = { label, entries: JSON.stringify(state.entries) }; }
  function annuler() {
    if (!annulable) return;
    state.entries = JSON.parse(annulable.entries); annulable = null; save(); render(); toast("Action annulée.");
  }

  // ------------------------------------------------------------ état de l'écran
  const now = C.todayIso();
  const ui = { vue: "saisir", y: +now.slice(0, 4), m: +now.slice(5, 7), moisMode: "mois", filtre: "tout", recherche: "" };
  let draft = nouveauBrouillon();

  function nouveauBrouillon(date) {
    const t = C.todayIso(), d = date || t, p = state.prefs || {};
    return {
      id: null, date: d, lieu: p.lieu || "", personne: "", motif: "", statut: d > t ? "Prévu" : "Effectué", statutTouche: false,
      mode: p.mode || "horaires", debut: p.debut || "", fin: p.fin || "", pause: p.pause != null ? p.pause : 0, pauseAutre: false,
      heures: "", jours: p.mode === "jour" ? 1 : null, km: "", frais: "", taux: "", paye: false, datePaie: "", commentaire: "",
      repeter: false, au: "", joursSem: [true, true, true, true, true, false, false], feries: true, sauterIndispo: true, details: false,
    };
  }
  function brouillonDepuis(e) {
    return {
      ...nouveauBrouillon(e.date), id: e.id, lieu: e.lieu || "", personne: e.personne || "", motif: e.motif || "", statut: e.statut, statutTouche: true,
      mode: e.mode, debut: e.debut || "", fin: e.fin || "", pause: e.pause || 0, pauseAutre: ![0, 15, 30, 45, 60].includes(+e.pause || 0),
      heures: e.mode === "heures" ? numTxt(e.heures) : "", jours: e.jours == null ? null : e.jours, km: numTxt(e.km), frais: numTxt(e.frais),
      taux: numTxt(e.taux), paye: !!e.paye, datePaie: e.datePaie || "", commentaire: e.commentaire || "", createdAt: e.createdAt,
      details: !!(e.personne || e.motif || e.km || e.frais || e.taux || e.paye || e.commentaire),
    };
  }
  function entreeDepuis(d, date, id) {
    const t = Date.now();
    return {
      id: id || uid(), date, lieu: d.lieu.trim(), personne: d.personne.trim(), motif: d.motif.trim(), statut: d.statut, mode: d.mode,
      debut: d.mode === "horaires" ? d.debut : "", fin: d.mode === "horaires" ? d.fin : "", pause: d.mode === "horaires" ? (d.pause === "" ? 0 : parseNum(d.pause)) : 0,
      heures: d.mode === "heures" ? C.parseDuree(d.heures) : "", jours: d.mode === "jour" ? d.jours : d.jours,
      km: parseNum(d.km), frais: parseNum(d.frais), taux: parseNum(d.taux), paye: !!d.paye,
      datePaie: d.paye ? (d.datePaie || C.todayIso()) : "", commentaire: d.commentaire.trim(), createdAt: d.createdAt || t, updatedAt: t,
    };
  }
  function datesDuBrouillon() {
    if (!draft.repeter || !draft.au) return C.isIso(draft.date) ? { dates: [draft.date], erreur: null } : { dates: [], erreur: null };
    return C.datesPeriode(draft.date, draft.au, draft.joursSem, { feries: draft.feries, sauterIndispo: draft.sauterIndispo }, state.settings, state);
  }

  // Calcul de l'aperçu : on ajoute les futures lignes aux données existantes
  function apercu() {
    const per = datesDuBrouillon();
    const dates = per.dates.slice(0, 400);
    const autres = state.entries.filter((e) => e.id !== draft.id);
    const temps = dates.map((dt, i) => entreeDepuis(draft, dt, "tmp" + i));
    const proto = entreeDepuis(draft, draft.date, "proto");
    const bloq = C.bloquants(proto);
    if (draft.repeter && !draft.au) bloq.push("Indiquez la date de fin de la période (ou décochez « plusieurs jours »).");
    if (per.erreur) bloq.push(per.erreur);
    const calc = C.calculer({ ...state, entries: [...autres, ...temps] });
    const res = temps.map((e) => calc.res[e.id]);
    const deja = dates.filter((dt) => autres.some((e) => e.date === dt && e.statut !== "Annulé"));
    const alertes = new Map();
    for (const r of res) for (const a of r.alertes) alertes.set(a, (alertes.get(a) || 0) + 1);
    const premier = res[0];
    const jours = res.reduce((t, r) => t + (draft.statut === "Prévu" ? (r.joursPrevus || 0) : r.jours), 0);
    return {
      dates, deja, bloq, premier, calc,
      alertes: [...alertes.entries()].map(([a, n]) => (dates.length > 1 && n > 1 ? `${a} (${n} dates)` : a)),
      heures: res.reduce((t, r) => t + r.m.dur, 0), nuit: res.reduce((t, r) => t + r.m.nuit, 0),
      jours, total: res.reduce((t, r) => t + r.total, 0),
    };
  }

  // ------------------------------------------------------------ icônes
  const ICO = {
    saisir: '<path d="M12 5v14M5 12h14"/>',
    journal: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    mois: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    reglages: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    gauche: '<path d="M15 18l-6-6 6-6"/>', droite: '<path d="M9 18l6-6-6-6"/>', alerte: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
    lune: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  };
  const ico = (n, cls) => `<svg class="ico ${cls || ""}" viewBox="0 0 24 24" aria-hidden="true">${ICO[n]}</svg>`;

  // ------------------------------------------------------------ rendu général
  const TITRES = { saisir: "Saisir", journal: "Journal", mois: "Synthèse", reglages: "Réglages", aide: "Aide" };
  function render() {
    $("#titre").textContent = draft.id && ui.vue === "saisir" ? "Modifier" : TITRES[ui.vue];
    document.querySelectorAll(".nav button").forEach((b) => b.setAttribute("aria-current", b.dataset.vue === ui.vue ? "page" : "false"));
    const v = $("#vue");
    v.innerHTML = { saisir: vueSaisir, journal: vueJournal, mois: vueMois, reglages: vueReglages, aide: vueAide }[ui.vue]();
    if (ui.vue === "saisir") majApercu();
    renderBandeau();
  }
  function aller(vue) {
    if (ui.vue === vue) { window.scrollTo(0, 0); return; }
    ui.vue = vue;
    history.replaceState(null, "", "#" + vue);
    render(); window.scrollTo(0, 0);
  }

  function renderBandeau() {
    const b = $("#bandeau"); const msgs = [];
    if (!stockageOK) msgs.push(`<div class="bandeau rouge">Cet appareil refuse d'enregistrer les données (navigation privée ?). Ce que vous saisissez sera perdu à la fermeture.</div>`);
    if (isIOS && !standalone && !(state.prefs || {}).installVu)
      msgs.push(`<div class="bandeau">Sur iPhone, ajoutez l'appli à l'écran d'accueil (bouton Partager puis « Sur l'écran d'accueil »). Sinon Safari peut effacer vos données après 7 jours sans visite. <button class="lien" data-act="installVu">Compris</button></div>`);
    const jours = state.lastBackup ? C.dayNum(C.todayIso()) - C.dayNum(state.lastBackup.slice(0, 10)) : null;
    if (state.entries.length >= 5 && (jours == null || jours > 30))
      msgs.push(`<div class="bandeau">${jours == null ? "Aucune sauvegarde pour l'instant" : `Dernière sauvegarde il y a ${jours} jours`} : vos données ne sont que sur cet appareil. <button class="lien" data-act="sauvegarder">Sauvegarder</button></div>`);
    b.innerHTML = msgs.join("");
  }

  // ------------------------------------------------------------ écran Saisir
  function seg(name, options, val, cls) {
    return `<div class="seg ${cls || ""}" role="radiogroup">${options.map(([v, l]) =>
      `<button type="button" role="radio" aria-checked="${String(v) === String(val)}" data-seg="${name}" data-val="${esc(v)}">${l}</button>`).join("")}</div>`;
  }
  function vueSaisir() {
    const d = draft, t = C.todayIso();
    const lieux = [...new Set([...state.lieux.map((l) => l.nom), ...state.entries.slice().reverse().map((e) => e.lieu)].filter(Boolean))].slice(0, 40);
    const pauses = [[0, "Aucune"], [15, "15 min"], [30, "30 min"], [45, "45 min"], [60, "1 h"], ["autre", "Autre"]];
    const pauseVal = d.pauseAutre ? "autre" : d.pause;
    const JS = ["L", "M", "M", "J", "V", "S", "D"];
    return `
    ${d.id ? `<div class="bandeau info">Vous modifiez une intervention enregistrée. <button class="lien" data-act="abandon">Abandonner</button></div>` : ""}
    <section class="carte">
      <h2>Quand</h2>
      <label class="champ"><span>Date</span><input type="date" data-f="date" value="${esc(d.date)}" required></label>
      <div class="chips">
        <button type="button" class="chip" data-act="jour" data-val="0">Aujourd'hui</button>
        <button type="button" class="chip" data-act="jour" data-val="-1">Hier</button>
        <button type="button" class="chip" data-act="jour" data-val="1">Demain</button>
      </div>
      <p id="typejour" class="typejour"></p>
      ${d.id ? "" : `<label class="bascule"><input type="checkbox" data-f="repeter" ${d.repeter ? "checked" : ""}><span>Plusieurs jours (une période)</span></label>`}
      ${d.repeter && !d.id ? `
        <label class="champ"><span>Jusqu'au</span><input type="date" data-f="au" value="${esc(d.au)}" min="${esc(d.date)}"></label>
        <div class="champ"><span>Jours de la semaine</span>
          <div class="jsem">${JS.map((l, i) => `<button type="button" aria-pressed="${d.joursSem[i]}" data-act="jsem" data-val="${i}" aria-label="${C.JOURS[i]}">${l}</button>`).join("")}</div>
          <div class="chips"><button type="button" class="chip" data-act="jsemPreset" data-val="1111100">Lun → ven</button><button type="button" class="chip" data-act="jsemPreset" data-val="1111110">Lun → sam</button><button type="button" class="chip" data-act="jsemPreset" data-val="1111111">Tous</button><button type="button" class="chip" data-act="jsemPreset" data-val="0000011">Week-ends</button></div>
        </div>
        <label class="bascule"><input type="checkbox" data-f="feries" ${d.feries ? "checked" : ""}><span>Inclure les jours fériés</span></label>
        ${state.indispo.length ? `<label class="bascule"><input type="checkbox" data-f="sauterIndispo" ${d.sauterIndispo ? "checked" : ""}><span>Sauter mes indisponibilités</span></label>` : ""}
        <p id="periode" class="aide"></p>` : ""}
    </section>

    <section class="carte">
      <h2>Où</h2>
      <label class="champ"><span>Lieu / employeur</span><input type="text" data-f="lieu" value="${esc(d.lieu)}" list="liste-lieux" autocomplete="off" enterkeyhint="next" placeholder="ex. École Jean-Moulin"></label>
      <datalist id="liste-lieux">${lieux.map((l) => `<option value="${esc(l)}">`).join("")}</datalist>
    </section>

    <section class="carte">
      <h2>Temps de travail</h2>
      ${seg("mode", [["horaires", "Horaires"], ["heures", "Nombre d'heures"], ["jour", "Journée"]], d.mode)}
      ${d.mode === "horaires" ? `
        <div class="ligne2">
          <label class="champ"><span>Début</span><input type="time" data-f="debut" value="${esc(d.debut)}"></label>
          <label class="champ"><span>Fin</span><input type="time" data-f="fin" value="${esc(d.fin)}"></label>
        </div>
        <div class="champ"><span>Pause non payée</span>${seg("pause", pauses, pauseVal, "petit")}</div>
        ${d.pauseAutre ? `<label class="champ"><span>Pause en minutes</span><input type="text" inputmode="numeric" data-f="pause" value="${esc(d.pause)}"></label>` : ""}
      ` : ""}
      ${d.mode === "heures" ? `
        <label class="champ"><span>Nombre d'heures</span><input type="text" inputmode="decimal" data-f="heures" value="${esc(d.heures)}" placeholder="7h30 ou 7,5" autocomplete="off"></label>
        <div class="chips">${["3h30", "4h", "6h", "7h", "7h30", "8h", "10h", "12h"].map((h) => `<button type="button" class="chip" data-act="heures" data-val="${h}">${h.replace("h", " h ").trim()}</button>`).join("")}</div>
        <p id="heurescomprises" class="aide"></p>` : ""}
      ${d.mode === "jour" ? `<div class="champ"><span>Compter</span>${seg("jours", [[1, "1 jour"], [0.5, "½ journée"]], d.jours)}</div>
        <p class="aide">Pour un jour payé au forfait sans horaires connus.</p>` : `
        <div class="champ"><span>Compter comme</span>${seg("jours", [["auto", "Auto"], [1, "1 jour"], [0.5, "½ jour"], [0, "0"]], d.jours == null ? "auto" : d.jours, "petit")}</div>`}
    </section>

    <section class="carte">
      <h2>Statut</h2>
      ${seg("statut", [["Effectué", "Effectué"], ["Prévu", "Prévu"], ["Annulé", "Annulé"]], d.statut)}
    </section>

    <section class="carte">
      <button type="button" class="deplier" data-act="details" aria-expanded="${d.details}">Plus de détails <small>(personne, frais, paiement…)</small></button>
      ${d.details ? `
        <label class="champ"><span>Personne remplacée</span><input type="text" data-f="personne" value="${esc(d.personne)}" autocomplete="off"></label>
        <label class="champ"><span>Poste / motif</span><input type="text" data-f="motif" value="${esc(d.motif)}" autocomplete="off"></label>
        <div class="ligne2">
          <label class="champ"><span>Kilomètres</span><input type="text" inputmode="decimal" data-f="km" value="${esc(d.km)}"></label>
          <label class="champ"><span>Autres frais (€)</span><input type="text" inputmode="decimal" data-f="frais" value="${esc(d.frais)}"></label>
        </div>
        <label class="champ"><span>Taux horaire pour cette intervention (€/h)</span><input type="text" inputmode="decimal" data-f="taux" value="${esc(d.taux)}" placeholder="vide = taux habituel"></label>
        <label class="bascule"><input type="checkbox" data-f="paye" ${d.paye ? "checked" : ""}><span>Déjà payé</span></label>
        ${d.paye ? `<label class="champ"><span>Date du paiement</span><input type="date" data-f="datePaie" value="${esc(d.datePaie || t)}"></label>` : ""}
        <label class="champ"><span>Commentaire</span><textarea data-f="commentaire" rows="2">${esc(d.commentaire)}</textarea></label>` : ""}
    </section>

    <section class="carte" id="controle"></section>
    ${d.id ? `<div class="actions-sec">
      <button type="button" class="btn sec" data-act="dupliquer">Dupliquer</button>
      <button type="button" class="btn danger" data-act="supprimer">Supprimer</button></div>` : ""}
    <div class="espace-barre"></div>
    <div class="barre"><div id="resume" class="resume"></div><button type="button" class="btn prim" data-act="enregistrer" id="btn-enr">${d.id ? "Enregistrer la modification" : "Enregistrer"}</button></div>`;
  }

  function majApercu() {
    if (ui.vue !== "saisir") return;
    const s = state.settings, d = draft;
    const tj = $("#typejour");
    if (tj) {
      if (C.isIso(d.date)) {
        const t = C.typeJour(d.date, s);
        const maj = t.type === "Férié" ? s.majFer : t.type === "Dimanche" ? s.majDim : t.type === "Samedi" ? s.majSam : 0;
        const badge = t.type === "Semaine" ? "" : `<span class="badge ${t.type === "Férié" ? "fer" : "we"}">${t.type === "Férié" ? "Férié : " + esc(t.nom) : t.type}</span>`;
        tj.innerHTML = `${C.dateLongue(d.date)} ${badge}${maj ? ` <span class="aide">majoration ${Math.round(maj * 100)} %</span>` : ""}${C.isIndispo(state, d.date) ? ' <span class="badge gris">indisponible</span>' : ""}`;
      } else tj.textContent = "";
    }
    const a = apercu();
    const per = $("#periode");
    if (per) per.innerHTML = a.dates.length ? `${a.dates.length} date${a.dates.length > 1 ? "s" : ""} : du ${C.dateCourte(a.dates[0])} au ${C.dateCourte(a.dates[a.dates.length - 1])}${a.deja.length ? ` · <strong>${a.deja.length} déjà saisie${a.deja.length > 1 ? "s" : ""}</strong>` : ""}` : "";
    const hc = $("#heurescomprises");
    if (hc) { const h = C.parseDuree(d.heures); hc.innerHTML = h == null ? "Exemples : 7h30 · 7:30 · 7,5 · 450min" : Number.isNaN(h) ? '<span class="rouge-txt">Illisible</span>' : `Compris : <strong>${C.fmtH(h)}</strong> (${C.fmtNb(h)} h)`; }
    const ctl = $("#controle");
    if (ctl) {
      let html = "";
      if (a.premier && !a.bloq.length) {
        const r = a.premier, p = r.m.plage;
        html += `<h2>Aperçu</h2><ul class="apercu">`;
        if (p) html += `<li>${C.hm(p.deb)} → ${C.hm(p.fin % 1440)}${p.lendemain ? " <strong>(le lendemain)</strong>" : ""}${+d.pause ? ` · pause ${d.pause} min` : ""}</li>`;
        html += `<li>${a.dates.length > 1 ? `${a.dates.length} dates · ` : ""}<strong>${C.fmtH(a.heures)}</strong>${a.nuit ? ` dont ${C.fmtH(a.nuit)} de nuit` : ""}</li>`;
        html += `<li>${d.statut === "Annulé" ? "Annulé : aucune heure ni jour compté" : `Jours comptés : <strong>${C.fmtNb(a.jours)}</strong>${d.statut === "Prévu" ? " (prévus)" : ""}`}</li>`;
        if (a.total || s.taux || s.forfait) html += `<li>Montant estimé : <strong>${C.fmtEur(a.total)}</strong> brut${a.dates.length > 1 ? " au total" : ""}</li>`;
        else html += `<li class="aide">Indiquez votre taux horaire dans Réglages pour voir les montants.</li>`;
        html += `</ul>`;
      }
      if (a.bloq.length) html += `<div class="boite rouge"><strong>À compléter</strong><ul>${a.bloq.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`;
      const av = [...a.alertes];
      if (a.deja.length && a.dates.length > 1) av.unshift(`${a.deja.length} date(s) de la période ont déjà une intervention.`);
      else if (a.deja.length) av.unshift("Il y a déjà une intervention ce jour-là.");
      if (av.length && !a.bloq.length) html += `<div class="boite orange"><strong>À vérifier</strong><ul>${av.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`;
      ctl.innerHTML = html;
      ctl.hidden = !html;
    }
    const res = $("#resume");
    if (res) res.innerHTML = a.bloq.length ? `<span class="rouge-txt">À compléter</span>` :
      `<strong>${C.fmtH(a.heures)}</strong> · ${C.fmtNb(a.jours)} j${a.total ? ` · ${C.fmtEur(a.total)}` : ""}${a.dates.length > 1 ? `<br><small>${a.dates.length} dates</small>` : ""}`;
    const btn = $("#btn-enr"); if (btn) btn.classList.toggle("inactif", a.bloq.length > 0);
  }

  async function enregistrer() {
    const a = apercu();
    if (a.bloq.length) { await modal({ titre: "Impossible d'enregistrer", html: `<ul>${a.bloq.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`, boutons: [["ok", "Compris", "prim"]] }); return; }
    let dates = a.dates;
    if (!draft.id && a.deja.length && dates.length > 1) {
      const r = await modal({ titre: "Dates déjà saisies", html: `<p>${a.deja.length} des ${dates.length} dates ont déjà une intervention.</p>`,
        boutons: [["tout", "Les enregistrer quand même", "prim"], ["sauter", "Sauter ces dates", "sec"], ["non", "Revenir", "lien"]] });
      if (r === "non" || r == null) return;
      if (r === "sauter") dates = dates.filter((x) => !a.deja.includes(x));
      if (!dates.length) { toast("Rien à enregistrer : toutes les dates sont déjà saisies."); return; }
    }
    const av = a.alertes.filter((x) => !(a.deja.length && x.startsWith("Doublon") && dates.length > 1));
    if (a.deja.length === 1 && dates.length === 1) av.unshift("Il y a déjà une intervention ce jour-là.");
    if (av.length) {
      const r = await modal({ titre: "À vérifier", html: `<ul>${av.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`, boutons: [["ok", "Enregistrer quand même", "prim"], ["non", "Revenir", "sec"]] });
      if (r !== "ok") return;
    }
    if (!draft.id && dates.length > 1) {
      const r = await modal({ titre: "Confirmer", html: `<p>Créer <strong>${dates.length} interventions</strong>, du ${C.dateLongue(dates[0])} au ${C.dateLongue(dates[dates.length - 1])} ?</p>`, boutons: [["ok", "Créer", "prim"], ["non", "Revenir", "sec"]] });
      if (r !== "ok") return;
    }
    snapshot(draft.id ? "modification" : "ajout");
    if (draft.id) {
      const i = state.entries.findIndex((e) => e.id === draft.id);
      const e = entreeDepuis(draft, draft.date, draft.id);
      if (i >= 0) state.entries[i] = e; else state.entries.push(e);
    } else {
      for (const dt of dates) state.entries.push(entreeDepuis(draft, dt));
    }
    state.prefs = { ...state.prefs, lieu: draft.lieu.trim(), mode: draft.mode, debut: draft.debut, fin: draft.fin, pause: Number(draft.pause) || 0 };
    save();
    const n = draft.id ? 1 : dates.length, modif = !!draft.id, dateGardee = draft.date;
    draft = nouveauBrouillon(modif ? undefined : dateGardee);
    render(); window.scrollTo(0, 0);
    toast(modif ? "Modification enregistrée." : n > 1 ? `${n} interventions enregistrées.` : "Intervention enregistrée.", true);
  }

  // ------------------------------------------------------------ écran Journal
  function ligneEntree(r) {
    const e = r.e, p = r.m.plage;
    const temps = e.mode === "horaires" && p ? `${C.hm(p.deb)}–${C.hm(p.fin % 1440)}${p.lendemain ? " (+1)" : ""}${+e.pause ? ` · pause ${e.pause} min` : ""}`
      : e.mode === "heures" ? "heures saisies" : "journée";
    const badges = [
      r.type !== "Semaine" ? `<span class="badge ${r.type === "Férié" ? "fer" : "we"}">${r.type === "Férié" ? esc(r.ferie) : r.type}</span>` : "",
      r.m.nuit ? `<span class="badge nuit">${ico("lune")}nuit</span>` : "",
      e.statut !== "Effectué" ? `<span class="badge ${e.statut === "Prévu" ? "prevu" : "annule"}">${e.statut}</span>` : "",
      e.statut === "Effectué" && e.paye ? `<span class="badge paye">payé</span>` : "",
      r.alertes.length ? `<span class="badge alerte" title="${esc(r.alertes.join(" "))}">${ico("alerte")}${r.alertes.length}</span>` : "",
    ].join("");
    const [y, m, dd] = e.date.split("-");
    const droite = r.m.dur ? C.fmtH(r.m.dur) : r.jours || r.joursPrevus ? C.fmtJ(r.jours || r.joursPrevus) : "";
    return `<button type="button" class="entree ${e.statut === "Annulé" ? "barre-txt" : ""}" data-edit="${esc(e.id)}">
      <span class="quand"><b>${+dd}</b><small>${C.JOURS_COURTS[C.weekday(e.date) - 1]}</small></span>
      <span class="quoi"><span class="lieu">${esc(e.lieu || "(sans lieu)")}</span><small>${temps}</small><span class="badges">${badges}</span></span>
      <span class="combien"><b>${droite}</b>${r.total ? `<small>${C.fmtEur(r.total)}</small>` : ""}</span></button>`;
  }
  function vueJournal() {
    const calc = C.calculer(state);
    const t = C.todayIso();
    const q = ui.recherche.trim().toLowerCase();
    let list = Object.values(calc.res);
    const f = ui.filtre;
    if (f === "mois") list = list.filter((r) => r.e.date.startsWith(t.slice(0, 7)));
    if (f === "nonpaye") list = list.filter((r) => r.e.statut === "Effectué" && !r.e.paye);
    if (f === "prevu") list = list.filter((r) => r.e.statut === "Prévu");
    if (f === "alerte") list = list.filter((r) => r.alertes.length);
    if (q) list = list.filter((r) => [r.e.lieu, r.e.personne, r.e.motif, r.e.commentaire].join(" ").toLowerCase().includes(q));
    list.sort((a, b) => (b.e.date + (b.e.debut || "")).localeCompare(a.e.date + (a.e.debut || "")));
    const groupes = {};
    for (const r of list) (groupes[r.e.date.slice(0, 7)] = groupes[r.e.date.slice(0, 7)] || []).push(r);
    const filtres = [["tout", "Tout"], ["mois", "Ce mois"], ["nonpaye", "Non payés"], ["prevu", "Prévus"], ["alerte", "Alertes"]];
    let html = `<div class="filtres">${filtres.map(([k, l]) => `<button type="button" class="chip" aria-pressed="${ui.filtre === k}" data-act="filtre" data-val="${k}">${l}</button>`).join("")}</div>
      <input type="search" class="recherche" placeholder="Rechercher un lieu, une personne…" value="${esc(ui.recherche)}" data-f="recherche" aria-label="Rechercher">`;
    if (!state.entries.length) return html + `<div class="vide"><p>Aucune intervention pour l'instant.</p><button type="button" class="btn prim" data-act="aller" data-val="saisir">Saisir la première</button></div>`;
    if (!list.length) return html + `<div class="vide"><p>Rien ne correspond à ce filtre.</p></div>`;
    for (const [mk, rs] of Object.entries(groupes)) {
      const [y, m] = mk.split("-").map(Number);
      const h = rs.filter((r) => r.e.statut === "Effectué").reduce((s, r) => s + r.m.dur, 0);
      html += `<h3 class="mois-titre"><span>${C.MOIS[m - 1]} ${y}</span><small>${C.fmtH(h)} effectuées</small></h3><div class="liste">${rs.map(ligneEntree).join("")}</div>`;
    }
    return html;
  }

  // ------------------------------------------------------------ écran Synthèse
  function tuile(lab, val, cls) { return `<div class="tuile ${cls || ""}"><small>${lab}</small><b>${val}</b></div>`; }
  function vueMois() {
    const calc = C.calculer(state), s = calc.settings, y = ui.y, m = ui.m;
    const tete = `<div class="mois-nav">
        <button type="button" class="rond" data-act="moisPrec" aria-label="Précédent">${ico("gauche")}</button>
        <strong>${ui.moisMode === "mois" ? `${C.MOIS[m - 1]} ${y}` : `Année ${y}`}</strong>
        <button type="button" class="rond" data-act="moisSuiv" aria-label="Suivant">${ico("droite")}</button></div>
      ${seg("moisMode", [["mois", "Mois"], ["annee", "Année"]], ui.moisMode)}`;
    if (ui.moisMode === "annee") return tete + vueAnnee(calc, y);
    const t = C.syntheseMois(calc, y, m);
    const ouv = C.joursOuvres(y, m, s, state);
    let html = tete + `<div class="tuiles">${tuile("Heures", C.fmtH(t.heures))}${tuile("Jours", C.fmtNb(t.jours))}${tuile("À percevoir", C.fmtEur(t.total))}${tuile("Reste dû", C.fmtEur(t.reste), t.reste > 0.004 ? "du" : "")}</div>`;
    // calendrier
    const first = `${y}-${C.pad(m)}-01`, decal = C.weekday(first) - 1, nb = C.daysInMonth(y, m), today = C.todayIso();
    html += `<div class="cal"><div class="cal-tete">${["L", "M", "M", "J", "V", "S", "D"].map((x) => `<span>${x}</span>`).join("")}</div><div class="cal-grille">`;
    for (let i = 0; i < decal; i++) html += `<span class="vide-j"></span>`;
    for (let d = 1; d <= nb; d++) {
      const iso = `${y}-${C.pad(m)}-${C.pad(d)}`, j = calc.jours[iso], tj = C.typeJour(iso, s);
      const annule = Object.values(calc.res).some((r) => r.e.date === iso && r.e.statut === "Annulé");
      let contenu = "", cls = [];
      if (j && (j.heures > 0 || j.jours > 0)) { cls.push("fait"); contenu = j.heures > 0 ? C.fmtNb(j.heures, 1).replace(",0", "") + " h" : C.fmtJ(j.jours); }
      else if (j && (j.heuresPrevues > 0 || j.joursPrevus > 0)) { cls.push("prevu"); contenu = "prévu"; }
      else if (annule) { cls.push("annule"); contenu = "annulé"; }
      if (tj.type === "Férié") cls.push("fer"); else if (tj.type !== "Semaine") cls.push("we");
      if (C.isIndispo(state, iso)) cls.push("indispo");
      if (iso === today) cls.push("auj");
      const al = Object.values(calc.res).some((r) => r.e.date === iso && r.alertes.length);
      html += `<button type="button" class="jour ${cls.join(" ")}" data-act="jourCal" data-val="${iso}" aria-label="${C.dateLongue(iso)}${tj.nom ? ", " + esc(tj.nom) : ""}${contenu ? ", " + contenu : ""}">
        <span class="num">${d}</span><span class="val">${contenu}</span>${al ? '<span class="pt"></span>' : ""}</button>`;
    }
    html += `</div><p class="legende"><span class="l fait"></span>remplacé <span class="l prevu"></span>prévu <span class="l fer"></span>férié <span class="l we"></span>week-end <span class="l indispo"></span>indisponible</p></div>`;
    // détails
    const det = [
      ["Jours en semaine", C.fmtNb(t.joursSem)], ["Jours le samedi", `${C.fmtNb(t.joursSam)} (${C.fmtH(t.hSam)})`],
      ["Jours le dimanche", `${C.fmtNb(t.joursDim)} (${C.fmtH(t.hDim)})`], ["Jours fériés", `${C.fmtNb(t.joursFer)} (${C.fmtH(t.hFer)})`],
      ["Heures de nuit", C.fmtH(t.nuit)], ["Interventions effectuées", t.interventions],
      ["Moyenne par jour travaillé", t.joursAvecHeures ? C.fmtH(t.heures / t.joursAvecHeures) : "–"],
      ["Jours ouvrés du mois", `${ouv.ouvres}${ouv.dispo !== ouv.ouvres ? ` (${ouv.dispo} disponibles)` : ""}`],
      ["Taux d'occupation (lun-ven)", ouv.dispo ? Math.round((t.joursSem / ouv.dispo) * 100) + " %" : "–"],
      ["Prévu à venir", t.prevuesH || t.prevuesJ ? `${C.fmtH(t.prevuesH)} · ${C.fmtNb(t.prevuesJ)} j` : "–"],
      ["Annulations", t.annulees || "–"], ["Rémunération brute", C.fmtEur(t.montant)], ["Frais", C.fmtEur(t.frais)],
      ["Déjà payé", C.fmtEur(t.paye)],
    ];
    html += `<section class="carte"><h2>Détail du mois</h2><dl class="det">${det.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
      ${t.reste > 0.004 ? `<button type="button" class="btn sec plein" data-act="payerMois">Marquer comme payé…</button>` : ""}</section>`;
    const sem = C.semaines(calc, y, m).filter((w) => w.heures || w.prevues);
    if (sem.length) html += `<section class="carte"><h2>Par semaine</h2><div class="semaines">${sem.map((w) => `<div class="sem ${w.alertes.length ? "a" : ""}">
        <span>du ${C.dateCourte(w.lundi).slice(0, 5)} au ${C.dateCourte(w.dimanche).slice(0, 5)}</span><b>${C.fmtH(w.heures)}</b>
        ${w.alertes.map((a) => `<small>${esc(a)}</small>`).join("")}</div>`).join("")}</div></section>`;
    const pl = C.parLieu(calc, `${y}-${C.pad(m)}`);
    if (pl.length > 1 || (pl.length === 1 && pl[0].reste > 0)) html += tableLieux(pl);
    return html;
  }
  function tableLieux(pl) {
    return `<section class="carte"><h2>Par lieu</h2><table class="tab"><thead><tr><th>Lieu</th><th>Heures</th><th>Jours</th><th>Total</th><th>Reste dû</th></tr></thead><tbody>
      ${pl.map((l) => `<tr><td>${esc(l.lieu)}</td><td>${C.fmtNb(l.heures)}</td><td>${C.fmtNb(l.jours)}</td><td>${C.fmtEur(l.total)}</td><td class="${l.reste > 0.004 ? "du" : ""}">${C.fmtEur(l.reste)}</td></tr>`).join("")}</tbody></table></section>`;
  }
  function vueAnnee(calc, y) {
    const t = C.syntheseAnnee(calc, y);
    let html = `<div class="tuiles">${tuile("Heures", C.fmtH(t.heures))}${tuile("Jours", C.fmtNb(t.jours))}${tuile("À percevoir", C.fmtEur(t.total))}${tuile("Reste dû", C.fmtEur(t.reste), t.reste > 0.004 ? "du" : "")}</div>`;
    html += `<section class="carte"><h2>Mois par mois</h2><table class="tab clic"><thead><tr><th>Mois</th><th>Heures</th><th>Jours</th><th>Total</th><th>Reste dû</th></tr></thead><tbody>`;
    for (let m = 1; m <= 12; m++) {
      const x = C.syntheseMois(calc, y, m);
      html += `<tr data-act="versMois" data-val="${m}"><td>${C.MOIS[m - 1]}</td><td>${x.heures ? C.fmtNb(x.heures) : "–"}</td><td>${x.jours ? C.fmtNb(x.jours) : "–"}</td><td>${x.total ? C.fmtEur(x.total) : "–"}</td><td class="${x.reste > 0.004 ? "du" : ""}">${x.reste ? C.fmtEur(x.reste) : "–"}</td></tr>`;
    }
    html += `<tr class="tot"><td>Total</td><td>${C.fmtNb(t.heures)}</td><td>${C.fmtNb(t.jours)}</td><td>${C.fmtEur(t.total)}</td><td>${C.fmtEur(t.reste)}</td></tr></tbody></table></section>`;
    const det = [["dont samedis", `${C.fmtNb(t.joursSam)} j · ${C.fmtH(t.hSam)}`], ["dont dimanches", `${C.fmtNb(t.joursDim)} j · ${C.fmtH(t.hDim)}`],
      ["dont jours fériés", `${C.fmtNb(t.joursFer)} j · ${C.fmtH(t.hFer)}`], ["Heures de nuit", C.fmtH(t.nuit)], ["Frais", C.fmtEur(t.frais)], ["Annulations", t.annulees || "–"]];
    html += `<section class="carte"><h2>Détail de l'année</h2><dl class="det">${det.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl></section>`;
    const pl = C.parLieu(calc, `${y}-`);
    if (pl.length) html += tableLieux(pl);
    const autres = state.entries.filter((e) => !e.date.startsWith(y + "-")).length;
    if (autres) html += `<p class="aide centre">${autres} intervention(s) sur d'autres années : utilisez les flèches.</p>`;
    return html;
  }

  async function jourCalendrier(iso) {
    const calc = C.calculer(state);
    const rs = Object.values(calc.res).filter((r) => r.e.date === iso).sort((a, b) => (a.e.debut || "").localeCompare(b.e.debut || ""));
    const tj = C.typeJour(iso, state.settings);
    const r = await modal({
      titre: C.dateLongue(iso),
      html: `${tj.nom ? `<p><span class="badge fer">Férié : ${esc(tj.nom)}</span></p>` : tj.type !== "Semaine" ? `<p><span class="badge we">${tj.type}</span></p>` : ""}
        ${rs.length ? `<div class="liste">${rs.map(ligneEntree).join("")}</div>` : "<p>Aucune intervention ce jour.</p>"}`,
      boutons: [["ajouter", "Ajouter une intervention ce jour", "prim"], ["non", "Fermer", "sec"]],
    });
    if (r === "ajouter") { draft = nouveauBrouillon(iso); aller("saisir"); }
  }

  async function payerMois() {
    const calc = C.calculer(state), y = ui.y, m = ui.m, pref = `${y}-${C.pad(m)}`;
    const cand = Object.values(calc.res).filter((r) => r.e.date.startsWith(pref) && r.e.statut !== "Prévu" && !r.e.paye && r.total > 0);
    const lieux = [...new Set(cand.map((r) => (r.e.lieu || "").trim() || "(sans lieu)"))];
    const r = await modal({
      titre: `Paiement de ${C.MOIS[m - 1]} ${y}`,
      html: `<label class="champ"><span>Lieu</span><select id="m-lieu"><option value="*">Tous les lieux</option>${lieux.map((l) => `<option>${esc(l)}</option>`).join("")}</select></label>
        <label class="champ"><span>Date du paiement</span><input type="date" id="m-date" value="${C.todayIso()}"></label>
        <p class="aide">${cand.length} intervention(s) non payée(s) ce mois.</p>`,
      boutons: [["ok", "Marquer payé", "prim"], ["non", "Annuler", "sec"]],
      lire: () => ({ lieu: $("#m-lieu").value, date: $("#m-date").value }),
    });
    if (!r || r.action !== "ok") return;
    const dp = C.isIso(r.valeurs.date) ? r.valeurs.date : C.todayIso();
    snapshot("paiement");
    let n = 0;
    for (const x of cand) if (r.valeurs.lieu === "*" || ((x.e.lieu || "").trim() || "(sans lieu)") === r.valeurs.lieu) {
      const e = state.entries.find((z) => z.id === x.e.id); e.paye = true; e.datePaie = dp; e.updatedAt = Date.now(); n++;
    }
    save(); render(); toast(`${n} intervention(s) marquée(s) payée(s).`, true);
  }

  // ------------------------------------------------------------ écran Réglages
  function champReglage(k, lab, type, aide) {
    const v = state.settings[k];
    if (type === "oui") return `<label class="bascule"><input type="checkbox" data-s="${k}" ${v ? "checked" : ""}><span>${lab}</span></label>${aide ? `<p class="aide">${aide}</p>` : ""}`;
    const val = type === "pct" ? numTxt(Math.round((+v || 0) * 1000) / 10) : type === "time" ? v : numTxt(v);
    return `<label class="champ"><span>${lab}</span><span class="avec-unite"><input type="${type === "time" ? "time" : "text"}" ${type === "time" ? "" : 'inputmode="decimal"'} data-s="${k}" data-t="${type}" value="${esc(val)}">${type === "pct" ? "<i>%</i>" : type === "eur" ? "<i>€</i>" : type === "h" ? "<i>h</i>" : type === "j" ? "<i>jours</i>" : type === "km" ? "<i>€/km</i>" : ""}</span></label>${aide ? `<p class="aide">${aide}</p>` : ""}`;
  }
  function vueReglages() {
    return `
    <section class="carte"><h2>Rémunération</h2>
      ${champReglage("taux", "Taux horaire brut habituel", "eur", "Un taux propre à un lieu (plus bas) ou à une intervention prend le dessus.")}
      ${champReglage("forfait", "Forfait par jour remplacé", "eur", "Si vous êtes payé à la journée. Laissez 0 sinon.")}
      ${champReglage("majSam", "Majoration du samedi", "pct")}
      ${champReglage("majDim", "Majoration du dimanche", "pct")}
      ${champReglage("majFer", "Majoration des jours fériés", "pct", "Le 1er mai travaillé est payé double : mettez un taux spécifique ce jour-là si besoin.")}
      ${champReglage("majNuit", "Majoration des heures de nuit", "pct", "S'ajoute à celle du jour.")}
      ${champReglage("ik", "Indemnité kilométrique", "km")}
    </section>
    <section class="carte"><h2>Règles de calcul</h2>
      <div class="ligne2">${champReglage("nuitDeb", "Nuit : début", "time")}${champReglage("nuitFin", "Nuit : fin", "time")}</div>
      ${champReglage("seuilJour", "Heures pour compter une journée entière", "h")}
      ${champReglage("demiJours", "Compter des demi-journées en dessous", "oui", "Désactivé : toute journée travaillée compte 1 jour.")}
      ${champReglage("maxJour", "Alerte au-delà de (par jour)", "h")}
      ${champReglage("refHebdo", "Durée de référence par semaine", "h")}
      ${champReglage("maxHebdo", "Alerte au-delà de (par semaine)", "h")}
      ${champReglage("delaiPaie", "Alerte si non payé après", "j")}
      ${champReglage("alsace", "Alsace-Moselle (Vendredi saint et 26 décembre fériés)", "oui")}
    </section>
    <section class="carte"><h2>Mes lieux</h2>
      <p class="aide">Facultatif : pour un taux ou un forfait différent selon le lieu.</p>
      <div class="lieux">${state.lieux.map((l, i) => `<div class="lieu-ligne">
        <input type="text" value="${esc(l.nom)}" data-lieu="${i}" data-k="nom" aria-label="Nom du lieu">
        <input type="text" inputmode="decimal" value="${esc(numTxt(l.taux))}" data-lieu="${i}" data-k="taux" placeholder="€/h" aria-label="Taux">
        <input type="text" inputmode="decimal" value="${esc(numTxt(l.forfait))}" data-lieu="${i}" data-k="forfait" placeholder="€/jour" aria-label="Forfait">
        <button type="button" class="rond" data-act="supLieu" data-val="${i}" aria-label="Supprimer ce lieu">×</button></div>`).join("")}</div>
      <button type="button" class="btn sec plein" data-act="ajoutLieu">Ajouter un lieu</button>
    </section>
    <section class="carte"><h2>Mes indisponibilités</h2>
      <p class="aide">Congés, arrêt, formation : ces jours sortent des jours disponibles.</p>
      ${state.indispo.map((p, i) => `<div class="indispo-ligne"><span>${C.dateCourte(p.du)}${p.au && p.au !== p.du ? " → " + C.dateCourte(p.au) : ""}${p.motif ? " · " + esc(p.motif) : ""}</span><button type="button" class="rond" data-act="supIndispo" data-val="${i}" aria-label="Supprimer">×</button></div>`).join("")}
      <div class="ligne2"><label class="champ"><span>Du</span><input type="date" id="ind-du"></label><label class="champ"><span>Au</span><input type="date" id="ind-au"></label></div>
      <label class="champ"><span>Motif (facultatif)</span><input type="text" id="ind-motif"></label>
      <button type="button" class="btn sec plein" data-act="ajoutIndispo">Ajouter</button>
    </section>
    <section class="carte"><h2>Mes données</h2>
      <p class="aide">Tout reste sur cet appareil, rien n'est envoyé ailleurs. ${state.entries.length} intervention(s). ${state.lastBackup ? "Dernière sauvegarde : " + C.dateCourte(state.lastBackup.slice(0, 10)) + "." : "Jamais sauvegardé."}</p>
      <button type="button" class="btn prim plein" data-act="sauvegarder">Sauvegarder dans un fichier</button>
      <button type="button" class="btn sec plein" data-act="restaurer">Restaurer une sauvegarde</button>
      <button type="button" class="btn sec plein" data-act="csv">Exporter pour Excel (CSV)</button>
      <p class="aide">Pour changer de téléphone : sauvegardez ici, envoyez-vous le fichier, puis « Restaurer » sur le nouveau.</p>
      <button type="button" class="btn danger plein" data-act="toutEffacer">Tout effacer</button>
      <input type="file" id="fichier" accept=".json,application/json" hidden>
    </section>
    <section class="carte"><h2>Installer sur le téléphone</h2>
      ${standalone ? "<p>L'appli est installée sur cet appareil.</p>" : `
      <p><strong>iPhone (Safari)</strong> : bouton Partager, puis « Sur l'écran d'accueil ».</p>
      <p><strong>Android (Chrome)</strong> : menu ⋮, puis « Installer l'application » ou « Ajouter à l'écran d'accueil ».</p>
      <p class="aide">Une fois installée, l'appli s'ouvre comme les autres et marche sans connexion.</p>`}
      <p class="aide">Version ${VERSION}</p>
    </section>`;
  }

  // ------------------------------------------------------------ écran Aide
  function vueAide() {
    return `<section class="carte"><h2>Saisir vite</h2>
      <p>Choisissez la date, le lieu, puis <strong>Horaires</strong> (début, fin, pause), <strong>Nombre d'heures</strong> (si vous n'avez pas les horaires) ou <strong>Journée</strong> (jour payé sans heures). Touchez Enregistrer.</p>
      <p>L'appli retient votre dernier lieu et vos derniers horaires : pour un remplacement semblable, il suffit souvent de changer la date.</p>
      <p>Les nombres d'heures s'écrivent comme vous voulez : 7h30, 7:30, 7,5 ou 450min.</p>
      <p>Pour une période, cochez « Plusieurs jours », indiquez la date de fin et les jours de la semaine (samedi et dimanche compris si besoin). Les jours fériés sont inclus, sauf si vous décochez.</p></section>
    <section class="carte"><h2>Week-ends et jours fériés</h2>
      <p>Toujours acceptés. L'appli reconnaît seule les samedis, dimanches et les 11 jours fériés (Pâques, Ascension et Pentecôte recalculés chaque année, option Alsace-Moselle) et applique les majorations prévues dans Réglages.</p></section>
    <section class="carte"><h2>Comment les jours sont comptés</h2>
      <p>Une date compte au plus 1 jour, même avec plusieurs remplacements ce jour-là. En automatique : 1 jour à partir de ${C.fmtNb(state.settings.seuilJour)} h, une demi-journée en dessous. Vous pouvez imposer 1, ½ ou 0.</p>
      <p>Une nuit (22 h → 6 h) compte sur le jour où elle commence ; les heures de nuit sont isolées.</p></section>
    <section class="carte"><h2>Ce que l'appli surveille</h2><ul>
      <li>Heure de fin avant le début : nuit qui finit le lendemain.</li>
      <li>Pause plus longue que la présence, heures illisibles ou nulles (bloquant).</li>
      <li>Doublon, chevauchement avec une autre intervention, nuit de la veille qui déborde.</li>
      <li>Moins de 11 h de repos entre deux jours, plus de 6 h sans pause, plus de ${C.fmtNb(state.settings.maxJour)} h dans la journée.</li>
      <li>Plus de ${C.fmtNb(state.settings.maxHebdo)} h ou 7 jours sur 7 dans la semaine, heures au-delà de ${C.fmtNb(state.settings.refHebdo)} h.</li>
      <li>« Effectué » dans le futur, « Prévu » resté dans le passé, intervention sur un jour d'indisponibilité.</li>
      <li>Paiement en retard, date de paiement avant l'intervention, reste dû par mois et par lieu.</li></ul></section>
    <section class="carte"><h2>Vos données</h2>
      <p>Elles restent sur ce téléphone, sans compte ni envoi. Faites une sauvegarde de temps en temps (Réglages) : en cas de perte ou de changement de téléphone, c'est elle qui vous sauve. L'export CSV s'ouvre dans Excel.</p>
      <p>Les montants sont des bruts indicatifs : comparez avec vos fiches de paie.</p></section>`;
  }

  // ------------------------------------------------------------ fenêtres, messages
  let modalResolve = null;
  function modal({ titre, html, boutons, lire }) {
    return new Promise((resolve) => {
      const m = $("#modal");
      m.innerHTML = `<div class="fond" data-mclose="1"></div><div class="fenetre" role="dialog" aria-modal="true" aria-labelledby="m-titre">
        <h2 id="m-titre">${esc(titre)}</h2><div class="m-corps">${html}</div>
        <div class="m-actions">${boutons.map(([k, l, c]) => `<button type="button" class="btn ${c}" data-m="${k}">${l}</button>`).join("")}</div></div>`;
      m.hidden = false; document.body.classList.add("bloque");
      history.pushState({ modal: 1 }, "");
      modalResolve = (action) => {
        const valeurs = lire && action ? lire() : null;
        m.hidden = true; m.innerHTML = ""; document.body.classList.remove("bloque"); modalResolve = null;
        resolve(lire ? (action ? { action, valeurs } : null) : action);
      };
      const first = m.querySelector(".m-actions .btn"); if (first) first.focus();
    });
  }
  // Fermer : on revient d'abord dans l'historique (bouton retour d'Android), puis on résout
  let enAttente = null;
  function fermerModal(action) {
    return new Promise((res) => {
      if (!modalResolve) return res();
      if (history.state && history.state.modal) { enAttente = { action, res }; history.back(); }
      else { modalResolve(action); res(); }
    });
  }
  window.addEventListener("popstate", () => {
    if (!modalResolve) return;
    const p = enAttente; enAttente = null;
    modalResolve(p ? p.action : null);
    if (p) p.res();
  });

  let toastTimer = null;
  function toast(msg, avecAnnuler) {
    const t = $("#toast");
    t.innerHTML = `<span>${esc(msg)}</span>${avecAnnuler && annulable ? '<button type="button" class="lien" data-act="annuler">Annuler</button>' : ""}`;
    t.hidden = false; t.classList.add("vu");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.classList.remove("vu"); t.hidden = true; }, avecAnnuler ? 7000 : 3500);
  }

  // ------------------------------------------------------------ fichiers
  async function partagerOuTelecharger(nom, contenu, type) {
    const blob = new Blob([contenu], { type });
    if (mobile && navigator.canShare && typeof File === "function") {
      const f = new File([blob], nom, { type });
      if (navigator.canShare({ files: [f] })) {
        try { await navigator.share({ files: [f], title: nom }); return true; }
        catch (e) { if (e && e.name === "AbortError") return false; }
      }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = nom; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    return true;
  }
  async function sauvegarder() {
    const data = JSON.stringify({ ...state, app: "suivi-remplacements", exporte: new Date().toISOString() });
    const ok = await partagerOuTelecharger(`remplacements-sauvegarde-${C.todayIso()}.json`, data, "application/json");
    if (ok) { state.lastBackup = new Date().toISOString(); save(); if (ui.vue === "reglages") render(); toast("Sauvegarde créée. Gardez ce fichier en lieu sûr (mail, cloud…)."); }
  }
  async function exporterCsv() {
    if (!state.entries.length) { toast("Rien à exporter pour l'instant."); return; }
    await partagerOuTelecharger(`remplacements-${C.todayIso()}.csv`, C.csv(state, C.calculer(state)), "text/csv;charset=utf-8");
  }
  async function restaurer(file) {
    let obj;
    try { obj = JSON.parse(await file.text()); } catch (e) { await modal({ titre: "Fichier illisible", html: "<p>Ce fichier n'est pas une sauvegarde valide.</p>", boutons: [["ok", "Compris", "prim"]] }); return; }
    const err = C.validerSauvegarde(obj);
    if (err) { await modal({ titre: "Restauration impossible", html: `<p>${esc(err)}</p>`, boutons: [["ok", "Compris", "prim"]] }); return; }
    const r = await modal({ titre: "Restaurer la sauvegarde", html: `<p>Le fichier contient <strong>${obj.entries.length} intervention(s)</strong>${obj.exporte ? ` (sauvegarde du ${C.dateCourte(obj.exporte.slice(0, 10))})` : ""}. Cet appareil en a ${state.entries.length}.</p>
      <p><strong>Fusionner</strong> garde tout et ajoute ce qui manque. <strong>Remplacer</strong> efface ce qui est sur cet appareil.</p>`,
      boutons: [["fusion", "Fusionner", "prim"], ["remplacer", "Remplacer", "danger"], ["non", "Annuler", "sec"]] });
    if (r === "fusion") {
      snapshot("restauration");
      const f = C.fusionner(state, obj); state = { ...state, ...f.state }; save(); render();
      toast(`${f.ajout} ajoutée(s), ${f.maj} mise(s) à jour.`, true);
    } else if (r === "remplacer") {
      const ok = await modal({ titre: "Vraiment remplacer ?", html: `<p>Les ${state.entries.length} intervention(s) de cet appareil seront remplacées par celles du fichier.</p>`, boutons: [["ok", "Remplacer", "danger"], ["non", "Annuler", "sec"]] });
      if (ok !== "ok") return;
      snapshot("restauration");
      state = { ...blank(), ...obj, settings: { ...C.DEFAULT_SETTINGS, ...(obj.settings || {}) }, prefs: obj.prefs || {} };
      delete state.exporte; save(); render(); toast("Sauvegarde restaurée.", true);
    }
  }
  async function toutEffacer() {
    const r = await modal({ titre: "Tout effacer ?", html: `<p>Les ${state.entries.length} intervention(s), vos lieux, indisponibilités et réglages seront effacés de cet appareil.</p><p>Faites d'abord une sauvegarde si vous voulez pouvoir revenir en arrière.</p>`,
      boutons: [["sauver", "Sauvegarder d'abord", "prim"], ["ok", "Tout effacer", "danger"], ["non", "Annuler", "sec"]] });
    if (r === "sauver") { await sauvegarder(); return; }
    if (r !== "ok") return;
    const r2 = await modal({ titre: "Dernière confirmation", html: "<p>Cette action ne peut pas être annulée.</p>", boutons: [["ok", "Effacer définitivement", "danger"], ["non", "Annuler", "sec"]] });
    if (r2 !== "ok") return;
    state = blank(); annulable = null; save(); draft = nouveauBrouillon(); render(); toast("Tout a été effacé.");
  }

  // ------------------------------------------------------------ événements
  document.addEventListener("click", async (ev) => {
    const mb = ev.target.closest("[data-m]"); if (mb) { fermerModal(mb.dataset.m); return; }
    if (ev.target.closest("[data-mclose]")) { fermerModal(null); return; }
    const nav = ev.target.closest(".nav button"); if (nav) { aller(nav.dataset.vue); return; }
    const ed = ev.target.closest("[data-edit]");
    if (ed) {
      const e = state.entries.find((x) => x.id === ed.dataset.edit);
      if (e) { if (modalResolve) await fermerModal(null); draft = brouillonDepuis(e); ui.vue = "saisir"; history.replaceState(null, "", "#saisir"); render(); window.scrollTo(0, 0); }
      return;
    }
    const sg = ev.target.closest("[data-seg]");
    if (sg) {
      const k = sg.dataset.seg, v = sg.dataset.val;
      if (k === "moisMode") { ui.moisMode = v; render(); return; }
      if (k === "mode") { const avant = draft.mode; draft.mode = v; if (v === "jour") draft.jours = draft.jours === 0.5 ? 0.5 : 1; else if (avant === "jour") draft.jours = null; }
      else if (k === "pause") { if (v === "autre") { draft.pauseAutre = true; } else { draft.pauseAutre = false; draft.pause = +v; } }
      else if (k === "jours") draft.jours = v === "auto" ? null : +v;
      else if (k === "statut") { draft.statut = v; draft.statutTouche = true; }
      render(); return;
    }
    const b = ev.target.closest("[data-act]"); if (!b) return;
    const act = b.dataset.act, val = b.dataset.val;
    switch (act) {
      case "jour": draft.date = C.addDays(C.todayIso(), +val); autoStatut(); render(); break;
      case "jsem": draft.joursSem[+val] = !draft.joursSem[+val]; render(); break;
      case "jsemPreset": draft.joursSem = val.split("").map((c) => c === "1"); render(); break;
      case "heures": draft.heures = val; render(); break;
      case "details": draft.details = !draft.details; render(); break;
      case "enregistrer": enregistrer(); break;
      case "abandon": draft = nouveauBrouillon(); render(); break;
      case "dupliquer": { const copie = { ...draft, id: null, createdAt: null, repeter: false, statutTouche: false, date: C.addDays(draft.date, 1) }; draft = copie; autoStatut(); render(); toast("Copie prête : vérifiez la date puis enregistrez."); break; }
      case "supprimer": {
        const r = await modal({ titre: "Supprimer cette intervention ?", html: `<p>${C.dateLongue(draft.date)}${draft.lieu ? " · " + esc(draft.lieu) : ""}</p>`, boutons: [["ok", "Supprimer", "danger"], ["non", "Annuler", "sec"]] });
        if (r === "ok") { snapshot("suppression"); state.entries = state.entries.filter((e) => e.id !== draft.id); save(); draft = nouveauBrouillon(); ui.vue = "journal"; history.replaceState(null, "", "#journal"); render(); toast("Intervention supprimée.", true); }
        break;
      }
      case "annuler": annuler(); break;
      case "aller": aller(val); break;
      case "filtre": ui.filtre = val; render(); break;
      case "moisPrec": if (ui.moisMode === "annee") ui.y--; else if (--ui.m < 1) { ui.m = 12; ui.y--; } render(); break;
      case "moisSuiv": if (ui.moisMode === "annee") ui.y++; else if (++ui.m > 12) { ui.m = 1; ui.y++; } render(); break;
      case "versMois": ui.m = +val; ui.moisMode = "mois"; render(); break;
      case "jourCal": jourCalendrier(val); break;
      case "payerMois": payerMois(); break;
      case "ajoutLieu": state.lieux.push({ nom: "", taux: "", forfait: "" }); save(); render(); { const ins = document.querySelectorAll('[data-k="nom"]'); if (ins.length) ins[ins.length - 1].focus(); } break;
      case "supLieu": { const l = state.lieux[+val]; const r = l && l.nom ? await modal({ titre: `Retirer « ${esc(l.nom)} » ?`, html: "<p>Les interventions déjà saisies gardent ce nom ; elles repasseront au taux habituel.</p>", boutons: [["ok", "Retirer", "danger"], ["non", "Annuler", "sec"]] }) : "ok"; if (r === "ok") { state.lieux.splice(+val, 1); save(); render(); } break; }
      case "ajoutIndispo": {
        const du = $("#ind-du").value, au = $("#ind-au").value || du;
        if (!C.isIso(du)) { toast("Indiquez au moins la date de début."); break; }
        if (au < du) { toast("La date de fin est avant la date de début."); break; }
        state.indispo.push({ du, au, motif: $("#ind-motif").value.trim() }); state.indispo.sort((a, b) => a.du.localeCompare(b.du)); save(); render(); toast("Indisponibilité ajoutée."); break;
      }
      case "supIndispo": state.indispo.splice(+val, 1); save(); render(); break;
      case "sauvegarder": sauvegarder(); break;
      case "restaurer": $("#fichier").click(); break;
      case "csv": exporterCsv(); break;
      case "toutEffacer": toutEffacer(); break;
      case "installVu": state.prefs = { ...state.prefs, installVu: true }; save(); break;
      case "aide": aller("aide"); break;
      case "recharger": location.reload(); break;
    }
  });
  function autoStatut() {
    if (draft.statutTouche || draft.id) return;
    draft.statut = C.isIso(draft.date) && draft.date > C.todayIso() ? "Prévu" : "Effectué";
  }
  document.addEventListener("input", (ev) => {
    const el = ev.target;
    if (el.dataset.f) {
      const k = el.dataset.f;
      if (k === "recherche") { ui.recherche = el.value; const pos = el.selectionStart; render(); const s = $(".recherche"); if (s) { s.focus(); try { s.setSelectionRange(pos, pos); } catch (e) {} } return; }
      if (el.type === "checkbox") return; // géré par change
      draft[k] = el.value;
      if (k === "date") { autoStatut(); const au = $('[data-f="au"]'); if (au) au.min = el.value; }
      majApercu();
      if (k === "date") { const sg = document.querySelectorAll('[data-seg="statut"]'); sg.forEach((b) => b.setAttribute("aria-checked", b.dataset.val === draft.statut)); }
      return;
    }
    if (el.dataset.lieu != null) {
      const l = state.lieux[+el.dataset.lieu]; if (!l) return;
      const k = el.dataset.k; l[k] = k === "nom" ? el.value : parseNum(el.value); save(); return;
    }
  });
  document.addEventListener("change", async (ev) => {
    const el = ev.target;
    if (el.id === "fichier" && el.files && el.files[0]) { await restaurer(el.files[0]); el.value = ""; return; }
    if (el.dataset.f && el.type === "checkbox") { draft[el.dataset.f] = el.checked; if (el.dataset.f === "repeter" && el.checked && !draft.au) draft.au = ""; render(); return; }
    if (el.dataset.s) {
      const k = el.dataset.s, t = el.dataset.t;
      let v;
      if (el.type === "checkbox") v = el.checked;
      else if (t === "time") v = el.value || C.DEFAULT_SETTINGS[k];
      else { v = parseNum(el.value); if (v === "" ) v = 0; if (Number.isNaN(v) || v < 0) { toast("Nombre invalide."); el.value = numTxt(state.settings[k]); return; } if (t === "pct") v = v / 100; }
      state.settings[k] = v; save(); toast("Réglage enregistré.");
    }
    if (el.dataset.lieu != null && el.dataset.k === "nom") {
      const noms = state.lieux.map((l) => l.nom.trim().toLowerCase()).filter(Boolean);
      if (new Set(noms).size !== noms.length) toast("Deux lieux portent le même nom : seul le premier sera utilisé.");
    }
  });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && modalResolve) fermerModal(null); });

  // ------------------------------------------------------------ démarrage
  window.addEventListener("hashchange", () => { const v = location.hash.slice(1); if (TITRES[v] && v !== ui.vue) { ui.vue = v; render(); } });
  const h = location.hash.slice(1); if (TITRES[h]) ui.vue = h;
  $("#aide").addEventListener("click", () => aller("aide"));
  // le jour change si l'appli reste ouverte (minuit) : on rafraîchit au retour
  document.addEventListener("visibilitychange", () => { if (!document.hidden && ui.vue !== "saisir") render(); });
  render();

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").then((reg) => {
      reg.addEventListener("updatefound", () => {
        const w = reg.installing;
        w && w.addEventListener("statechange", () => {
          if (w.state === "installed" && navigator.serviceWorker.controller) {
            const t = $("#toast"); t.innerHTML = '<span>Nouvelle version disponible.</span><button type="button" class="lien" data-act="recharger">Mettre à jour</button>'; t.hidden = false; t.classList.add("vu");
          }
        });
      });
    }).catch(() => {});
  }
  window.__app = { get state() { return state; }, get draft() { return draft; }, render };
})();
