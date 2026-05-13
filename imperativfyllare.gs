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
    .addItem('Fyll imperativ', 'fyllImperativ')
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
// Språkgranskare: kontrollerar om imperativformerna i kolumn B ser korrekta
// ut och markerar misstänkta celler med gul bakgrund.
// ---------------------------------------------------------------------------
function granskaimperativ() {
  const sheet  = SpreadsheetApp.getActiveSheet();
  const data   = sheet.getDataRange().getValues();
  const apiKey = PropertiesService.getScriptProperties()
    .getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) {
    SpreadsheetApp.getUi().alert('Ingen API-nyckel sparad. Kör "Spara API-nyckel" först.');
    return;
  }

  // Samla rader som har både infinitiv och imperativ
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
  SpreadsheetApp.flush();

  const GRANSKA_BATCH = 50;
  let totalFlaggade   = 0;
  let misslyckade     = 0;

  for (let i = 0; i < rader.length; i += GRANSKA_BATCH) {
    const batch = rader.slice(i, i + GRANSKA_BATCH);
    let lyckat  = false;

    for (let forsok = 1; forsok <= MAX_RETRIES; forsok++) {
      try {
        const flaggade = granskaBatch(batch, apiKey);
        flaggade.forEach(inf => {
          const rad = batch.find(r => r.inf === inf);
          if (rad) {
            sheet.getRange(rad.radnr, 2).setBackground('#FFD966'); // gul
            totalFlaggade++;
          }
        });
        SpreadsheetApp.flush();
        lyckat = true;
        break;
      } catch (e) {
        Logger.log(`Granskningsbatch ${i}–${i + GRANSKA_BATCH}, försök ${forsok}: ${e}`);
        if (forsok < MAX_RETRIES) Utilities.sleep(RETRY_DELAY_S * 1000);
      }
    }

    if (!lyckat) misslyckade++;
  }

  let meddelande = `Granskning klar.\n${totalFlaggade} misstänkta former markerade i gult.`;
  if (misslyckade > 0) meddelande += `\n${misslyckade} batch(er) kunde inte granskas.`;
  SpreadsheetApp.getUi().alert(meddelande);
}

// Skickar en batch par { inf, imp } till Claude och returnerar en lista med
// infinitiverna för de par där imperativformen verkar felaktig.
function granskaBatch(batch, apiKey) {
  const parLista = batch.map(r => `${r.inf} → ${r.imp}`).join('\n');

  const prompt =
    'Du är en noggrann svensk språkgranskare.\n\n' +
    'Nedan följer en lista med svenska verb i formatet "infinitiv → imperativ".\n' +
    'Din uppgift är att identifiera de rader där imperativformen är FEL eller ' +
    'INTE EXISTERAR som ett riktigt svenskt ord (t.ex. stavfel, felaktig verbgrupp, ' +
    'form som aldrig används).\n\n' +
    'Returnera ett JSON-objekt med en enda nyckel "fel" vars värde är en array med ' +
    'infinitiverna (exakt stavning) för de felaktiga paren.\n' +
    'Om allt är korrekt, returnera {"fel": []}.\n\n' +
    'Svara ENDAST med JSON-objektet — ingen annan text, inga code fences.\n\n' +
    'Verb att granska:\n' + parLista;

  const response = UrlFetchApp.fetch(API_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    }),
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    const kropp = response.getContentText();
    try {
      const felObj = JSON.parse(kropp);
      throw new Error(`HTTP ${response.getResponseCode()}: ${felObj.error?.message || kropp}`);
    } catch (_) {
      throw new Error(`HTTP ${response.getResponseCode()}: ${kropp.substring(0, 300)}`);
    }
  }

  const body    = JSON.parse(response.getContentText());
  const rawText = body.content[0].text.trim();
  const parsed  = extrahera_json(rawText);
  return Array.isArray(parsed.fel) ? parsed.fel : [];
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
