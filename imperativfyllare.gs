// ============================================================
//  Imperativfyllare för verb-spel — robust batch-version
//  Förutsättning: kolumn A = infinitiv, kolumn B = imperativ
//  Installation: klistra in i Apps Script-editorn för ditt Sheet
// ============================================================

const MODEL   = 'claude-haiku-4-5-20251001';
const API_URL = 'https://api.anthropic.com/v1/messages';

const BATCH_SIZE    = 50;              // verb per API-anrop
const MAX_RETRIES   = 3;              // försök per batch vid fel
const RETRY_DELAY_S = 10;             // sekunder mellan retries
const MAX_KOT_MS    = 25 * 60 * 1000; // 25 min — säker marginal mot Workspace 30-min-gräns

// ---------------------------------------------------------------------------
// Menyinit
// ---------------------------------------------------------------------------
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Verbverktyg')
    .addItem('Fyll imperativ (kolumn B)',  'fyllImperativ')
    .addItem('Fyll verbgrupp (kolumn C)',  'fyllVerbgrupp')
    .addSeparator()
    .addItem('Granska imperativ (markera fel)', 'granskaimperativ')
    .addItem('Rensa markeringar', 'rensaMarkeringar')
    .addSeparator()
    .addItem('Spara API-nyckel', 'sparaApiNyckel')
    .addSeparator()
    .addItem('Testa API-anslutning', 'testaAnslutning')
    .addToUi();
}

// ---------------------------------------------------------------------------
// Spara API-nyckel i Script Properties
// ---------------------------------------------------------------------------
function sparaApiNyckel() {
  const ui  = SpreadsheetApp.getUi();
  const svar = ui.prompt(
    'API-nyckel',
    'Klistra in din Anthropic API-nyckel (börjar med sk-ant-):',
    ui.ButtonSet.OK_CANCEL
  );
  if (svar.getSelectedButton() !== ui.Button.OK) return;

  const nyckel = svar.getResponseText().trim();
  if (!nyckel.startsWith('sk-ant-')) {
    ui.alert('Varning: Nyckeln ser inte ut att stämma (bör börja med "sk-ant-"). Sparad ändå — kontrollera att du kopierade hela strängen.');
  }
  PropertiesService.getScriptProperties()
    .setProperty('ANTHROPIC_API_KEY', nyckel);
  ui.alert('Nyckel sparad.');
}

// ---------------------------------------------------------------------------
// Snabbtest: skickar ett enda verb för att verifiera konto + nyckel
// ---------------------------------------------------------------------------
function testaAnslutning() {
  const ui = SpreadsheetApp.getUi();
  const apiKey = PropertiesService.getScriptProperties()
    .getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) {
    ui.alert('Ingen API-nyckel sparad. Kör "Spara API-nyckel" först.');
    return;
  }

  try {
    const result = anropaClaude(['läsa'], apiKey);
    ui.alert(`Anslutning OK!\n\nTestresultat: läsa → ${result['läsa'] || '(inget svar)'}`);
  } catch (e) {
    ui.alert(`Anslutningstest misslyckades:\n\n${e}`);
  }
}

// ---------------------------------------------------------------------------
// Huvudfunktion: fyller kolumn B med imperativ för alla tomma rader
// ---------------------------------------------------------------------------
function fyllImperativ() {
  const start = Date.now();
  const sheet = SpreadsheetApp.getActiveSheet();
  const data  = sheet.getDataRange().getValues();

  // Samla rader som saknar imperativ
  const attProcessa = [];
  for (let i = 1; i < data.length; i++) {
    const infinitiv   = String(data[i][0] || '').trim();
    const redanIfylld = String(data[i][1] || '').trim();
    if (infinitiv && !redanIfylld) {
      attProcessa.push({ rad: i + 1, verb: infinitiv });
    }
  }

  if (attProcessa.length === 0) {
    SpreadsheetApp.getUi().alert('Inga nya verb att processa — kolumn B är redan fylld.');
    return;
  }

  const apiKey = PropertiesService.getScriptProperties()
    .getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) {
    SpreadsheetApp.getUi().alert('Ingen API-nyckel sparad. Kör "Spara API-nyckel" först.');
    return;
  }

  const totalt = attProcessa.length;
  let klara             = 0;
  let misslyckadeBatcher = 0;
  let forstaFelet        = null;

  for (let i = 0; i < totalt; i += BATCH_SIZE) {

    // Säkerhetsventil mot Apps Scripts maxtid
    if (Date.now() - start > MAX_KOT_MS) {
      SpreadsheetApp.getUi().alert(
        `Stoppade innan timeout.\n${klara} av ${totalt} verb klara.\n` +
        'Kör "Fyll imperativ" igen för att fortsätta.'
      );
      return;
    }

    const batch  = attProcessa.slice(i, i + BATCH_SIZE);
    let   lyckat = false;

    for (let forsok = 1; forsok <= MAX_RETRIES; forsok++) {
      try {
        const mapping = anropaClaude(batch.map(v => v.verb), apiKey);

        batch.forEach(({ rad, verb }) => {
          const imp = mapping[verb];
          if (imp) {
            sheet.getRange(rad, 2).setValue(imp);
            klara++;
          } else {
            // Verbet finns inte i svaret — logga men krascha inte
            Logger.log(`Inget imperativ för "${verb}" i batch rad ${rad}`);
          }
        });

        SpreadsheetApp.flush();
        lyckat = true;
        break; // Batcher klar — hoppa ur retry-loopen

      } catch (e) {
        Logger.log(`Batch rad ${batch[0].rad}, försök ${forsok}/${MAX_RETRIES}: ${e}`);
        if (!forstaFelet) forstaFelet = String(e);
        if (forsok < MAX_RETRIES) {
          Utilities.sleep(RETRY_DELAY_S * 1000);
        }
      }
    }

    if (!lyckat) misslyckadeBatcher++;
  }

  // Rapport
  let meddelande;
  if (misslyckadeBatcher === 0) {
    meddelande = `Klart! ${klara} av ${totalt} verb ifyllda.`;
  } else {
    meddelande =
      `Klart med ${klara} av ${totalt} verb.\n` +
      `${misslyckadeBatcher} batch(er) misslyckades trots ${MAX_RETRIES} försök.\n\n` +
      `Första felet:\n${forstaFelet}\n\n` +
      'Tips: Kör "Testa API-anslutning" för att diagnostisera problemet.';
  }
  SpreadsheetApp.getUi().alert(meddelande);
}

// ---------------------------------------------------------------------------
// Fyller kolumn C med verbgrupp (1, 2, 3 eller 4) för rader där C är tomt.
// ---------------------------------------------------------------------------
function fyllVerbgrupp() {
  const start = Date.now();
  const sheet = SpreadsheetApp.getActiveSheet();
  const data  = sheet.getDataRange().getValues();

  const attProcessa = [];
  for (let i = 1; i < data.length; i++) {
    const infinitiv = String(data[i][0] || '').trim();
    const grupp     = String(data[i][2] || '').trim();
    if (infinitiv && !grupp) {
      attProcessa.push({ rad: i + 1, verb: infinitiv });
    }
  }

  if (attProcessa.length === 0) {
    SpreadsheetApp.getUi().alert('Inga tomma celler i kolumn C att fylla.');
    return;
  }

  const apiKey = PropertiesService.getScriptProperties()
    .getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) {
    SpreadsheetApp.getUi().alert('Ingen API-nyckel sparad. Kör "Spara API-nyckel" först.');
    return;
  }

  const totalt = attProcessa.length;
  let klara = 0, misslyckadeBatcher = 0, forstaFelet = null;

  for (let i = 0; i < totalt; i += BATCH_SIZE) {
    if (Date.now() - start > MAX_KOT_MS) {
      SpreadsheetApp.getUi().alert(
        `Stoppade innan timeout. ${klara} av ${totalt} verb klara.\n` +
        'Kör "Fyll verbgrupp" igen för att fortsätta.'
      );
      return;
    }

    const batch = attProcessa.slice(i, i + BATCH_SIZE);

    for (let forsok = 1; forsok <= MAX_RETRIES; forsok++) {
      try {
        const mapping = anropaClaudeGrupp(batch.map(v => v.verb), apiKey);
        batch.forEach(({ rad, verb }) => {
          const g = mapping[verb];
          if (g) { sheet.getRange(rad, 3).setValue(g); klara++; }
        });
        SpreadsheetApp.flush();
        break;
      } catch (e) {
        Logger.log(`Gruppbatch rad ${batch[0].rad}, försök ${forsok}: ${e}`);
        if (!forstaFelet) forstaFelet = String(e);
        if (forsok === MAX_RETRIES) misslyckadeBatcher++;
        else Utilities.sleep(RETRY_DELAY_S * 1000);
      }
    }
  }

  let meddelande;
  if (misslyckadeBatcher === 0) {
    meddelande = `Klart! ${klara} av ${totalt} verbgrupper ifyllda i kolumn C.`;
  } else {
    meddelande =
      `Klart med ${klara} av ${totalt} verb.\n` +
      `${misslyckadeBatcher} batch(er) misslyckades.\n\nFörsta felet:\n${forstaFelet}`;
  }
  SpreadsheetApp.getUi().alert(meddelande);
}

// Anropar Claude för att bestämma verbgrupp. Returnerar { infinitiv: "1"|"2"|"3"|"4" }.
function anropaClaudeGrupp(verbLista, apiKey) {
  const prompt =
    'Ange verbgrupp (1, 2, 3 eller 4) för varje svenskt verb nedan.\n\n' +
    'Definitioner:\n' +
    '- Grupp 1: presens -ar, preteritum -ade, supinum -at (arbeta, tala, fråga)\n' +
    '- Grupp 2: presens -er, preteritum -de eller -te, supinum -t (läsa, köpa, ringa, hjälpa)\n' +
    '- Grupp 3: korta verb utan infinitiv-a, preteritum -dde, supinum -tt (bo, tro, sy)\n' +
    '- Grupp 4: starka verb, preteritum vokalväxling, supinum -it (skriva, sjunga, komma, vara)\n\n' +
    'Returnera ETT JSON-objekt där varje nyckel är infinitivverbet exakt som det stavas nedan\n' +
    'och värdet är gruppnumret som en sträng: "1", "2", "3" eller "4".\n' +
    'Svara ENDAST med JSON-objektet — ingen annan text, inga code fences.\n\n' +
    'Verb:\n' + verbLista.join('\n');

  const response = UrlFetchApp.fetch(API_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    }),
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    try {
      const fel = JSON.parse(response.getContentText());
      throw new Error(`HTTP ${response.getResponseCode()}: ${fel.error?.message || response.getContentText()}`);
    } catch(_) {
      throw new Error(`HTTP ${response.getResponseCode()}: ${response.getContentText().substring(0, 200)}`);
    }
  }

  const body = JSON.parse(response.getContentText());
  return extrahera_json(body.content[0].text.trim());
}

// ---------------------------------------------------------------------------
// Hjälpfunktion: anropar Claude med en lista verb, returnerar { infinitiv: imperativ }
// ---------------------------------------------------------------------------
function anropaClaude(verbLista, apiKey) {
  const prompt =
    'Konvertera dessa svenska verb från infinitiv till imperativ.\n\n' +
    'Regler:\n' +
    '- Grupp 1 (ar-verb, t.ex. "tala", "arbeta"): imperativ = infinitiv.\n' +
    '- Grupp 2 och 4 (er-verb och starka, t.ex. "läsa", "skriva"): ' +
      'stryk avslutande -a. "läsa" → "läs", "skriva" → "skriv".\n' +
    '- Grupp 3 (korta verb utan -a, t.ex. "bo", "tro"): imperativ = infinitiv.\n' +
    '- Oregelbundna: "vara" → "var", "göra" → "gör", "ha" → "ha", "se" → "se".\n\n' +
    'Returnera ETT JSON-objekt där varje nyckel är infinitivverbet exakt ' +
    'som det stavas nedan, och värdet är imperativformen ' +
    '(inga utropstecken, ingen punkt, bara gemener).\n\n' +
    'Verb:\n' + verbLista.join('\n') + '\n\n' +
    'Svara ENDAST med JSON-objektet — ingen annan text, inga code fences, ' +
    'ingen markdown.';

  const response = UrlFetchApp.fetch(API_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }]
    }),
    muteHttpExceptions: true
  });

  const statusKod = response.getResponseCode();
  if (statusKod !== 200) {
    const kropp = response.getContentText();
    // Extrahera läsbart felmeddelande om möjligt
    try {
      const felObj = JSON.parse(kropp);
      const msg = (felObj.error && felObj.error.message) || kropp;
      throw new Error(`HTTP ${statusKod}: ${msg}`);
    } catch (parseErr) {
      throw new Error(`HTTP ${statusKod}: ${kropp.substring(0, 300)}`);
    }
  }

  const body = JSON.parse(response.getContentText());
  const rawText = body.content[0].text.trim();
  return extrahera_json(rawText);
}

// ---------------------------------------------------------------------------
// Extraherar ett JSON-objekt ur text som kan innehålla code fences eller
// förklarande text runt om.
// ---------------------------------------------------------------------------
function extrahera_json(text) {
  // 1. Direktförsök
  try { return JSON.parse(text); } catch (_) {}

  // 2. Strippa code fences: ```json ... ``` eller ``` ... ```
  const strippad = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  try { return JSON.parse(strippad); } catch (_) {}

  // 3. Hitta det JSON-objekt som finns inbäddat i texten
  const match = strippad.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch (_) {}
  }

  throw new Error(
    'Kunde inte parsa JSON-svar.\n' +
    'Råsvar (200 tecken): ' + text.substring(0, 200)
  );
}

// ---------------------------------------------------------------------------
// Oregelbundna imperativformer — verb där varken "samma som infinitiv" eller
// "stryk sista -a" ger rätt svar.
// Nyckel: infinitiv i gemener. Värde: korrekt imperativ (eller array med
// alternativa godkända former).
// ---------------------------------------------------------------------------
const OREGELBUNDNA_IMP = {
  'komma':    'kom',    // komma-a = komm, men rätt form är kom
  'simma':    ['simm', 'sim'],
  'glömma':   'glöm',
  'rymma':    'rym',
  'hämma':    'häm',
  'klämma':   ['kläm', 'klämm'],
  'stämma':   ['stäm', 'stämm'],
  'skrämma':  ['skräm', 'skrämm'],
  'gömma':    'göm',
  'strömma':  ['ström', 'strömm'],
  'blomma':   ['blom', 'blomm'],
  'drömma':   'dröm',
  'kamma':    ['kam', 'kamm'],
  'gamma':    'gam',
  'flamma':   ['flam', 'flamm'],
  'gamma':    'gam',
  'hamma':    ['ham', 'hamm'],
  'lamma':    'lam',
  'klamma':   'klam',
  'stamma':   ['stam', 'stamm'],
  'tvinga':   'tvinga',  // grupp 1: imperativ = infinitiv
  'umgås':    'umgås',
  'hoppas':   'hoppas',
  'andas':    'andas',
  'minnas':   'minns',
  'trivas':   'trivs',
  'kännas':   'känns',
  'finnas':   'finns',
  'fattas':   'fattas',
  'saknas':   'saknas',
  'kallas':   'kallas',
  'verkas':   'verkas',
  'låtsas':   'låtsas',
  'vänslas':  'vänslas',
  'synas':    'syns',
  'hetas':    'hetas',
  'sysslas':  'sysslas',
  'umgås':    'umgås',
};

// ---------------------------------------------------------------------------
// Kontrollerar om ett (infinitiv, imperativ)-par verkar korrekt.
// Returnerar true = OK, false = misstänkt fel.
// ---------------------------------------------------------------------------
function imperativVerkarOk(inf, imp) {
  inf = inf.toLowerCase().trim();
  imp = imp.toLowerCase().trim();

  if (!imp) return false;

  // Kolla mot kända oregelbundna former
  if (OREGELBUNDNA_IMP.hasOwnProperty(inf)) {
    const ok = OREGELBUNDNA_IMP[inf];
    if (Array.isArray(ok)) return ok.includes(imp);
    return imp === ok;
  }

  // Regel 1: imperativ = infinitiv (grupp 1, grupp 3, samt många -s-verb)
  if (imp === inf) return true;

  // Regel 2: stryk sista -a (grupp 2 och 4)
  if (inf.endsWith('a') && imp === inf.slice(0, -1)) return true;

  // Regel 3: -as-verb → stryk -as och lägg till -s  (t.ex. minnas → minns)
  if (inf.endsWith('as') && imp === inf.slice(0, -2) + 's') return true;

  return false;
}

// ---------------------------------------------------------------------------
// Regelbaserad språkgranskare — inga API-anrop, ingen kostnad.
// Markerar celler i kolumn B vars imperativform avviker från kända regler.
// ---------------------------------------------------------------------------
function granskaimperativ() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const data  = sheet.getDataRange().getValues();

  const rader = [];
  for (let i = 1; i < data.length; i++) {
    const inf = String(data[i][0] || '').trim();
    const imp = String(data[i][1] || '').trim();
    if (inf && imp) rader.push({ radnr: i + 1, inf, imp });
  }

  if (rader.length === 0) {
    SpreadsheetApp.getUi().alert('Kolumn B är tom — fyll imperativ först.');
    return;
  }

  // Rensa tidigare markeringar
  rader.forEach(r => sheet.getRange(r.radnr, 2).setBackground(null));

  let flaggade = 0;
  rader.forEach(({ radnr, inf, imp }) => {
    if (!imperativVerkarOk(inf, imp)) {
      sheet.getRange(radnr, 2).setBackground('#FFD966');
      flaggade++;
    }
  });

  SpreadsheetApp.flush();
  SpreadsheetApp.getUi().alert(
    `Granskning klar (regelbaserad, inga API-anrop).\n` +
    `${flaggade} misstänkta former markerade i gult av ${rader.length} kontrollerade.`
  );
}

// ---------------------------------------------------------------------------
// Rensa alla gula markeringar i kolumn B
// ---------------------------------------------------------------------------
function rensaMarkeringar() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    sheet.getRange(i + 1, 2).setBackground(null);
  }
  SpreadsheetApp.flush();
  SpreadsheetApp.getUi().alert('Alla markeringar borttagna.');
}
