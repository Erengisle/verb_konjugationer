# 🇸🇪 Svensk Verbkonjugering

Genererar 5 verbformer (infinitiv, imperativ, presens, preteritum, supinum) samt verbgrupp (1, 2a, 2b, 3, 4) för 1 223 svenska verb – helt gratis via Google Gemini AI.

## 🚀 Kom igång på 5 minuter

### 1. Lägg upp på GitHub Pages

1. Logga in på [github.com](https://github.com) (skapa gratis konto om du inte har ett)
2. Klicka på **+** → **New repository**
3. Namnge det t.ex. `svensk-verbkonjugering`
4. Se till att det är **Public**
5. Klicka **Create repository**
6. Klicka **Add file** → **Upload files**
7. Ladda upp `index.html` och `README.md`
8. Klicka **Commit changes**
9. Gå till **Settings** → **Pages** (i menyn till vänster)
10. Under *Source*, välj **Deploy from a branch** → branch: **main** → mapp: **/ (root)**
11. Klicka **Save**

Efter 1–2 minuter är appen live på:
```
https://DITTANVÄNDARNAMN.github.io/svensk-verbkonjugering/
```

---

### 2. Skaffa gratis Gemini API-nyckel

1. Gå till [aistudio.google.com](https://aistudio.google.com)
2. Logga in med ditt Google-konto
3. Klicka **Get API key** → **Create API key**
4. Kopiera nyckeln (börjar med `AIza...`)

Gratistjänsten inkluderar:
- 15 anrop per minut
- 1 miljon tokens per dag
- Ingen kreditkortsinformation krävs

---

### 3. Kör appen

1. Öppna din GitHub Pages-länk i webbläsaren
2. Klistra in API-nyckeln i fältet
3. Klicka **▶ Starta**
4. Vänta 4–7 minuter medan verben bearbetas
5. Klicka **⬇ Ladda ner Excel** när det är klart

---

## 📊 Vad Excel-filen innehåller

| Infinitiv | Imperativ | Presens | Preteritum | Supinum | Grupp |
|-----------|-----------|---------|------------|---------|-------|
| arbeta | arbeta | arbetar | arbetade | arbetat | 1 |
| köpa | köp | köper | köpte | köpt | 2b |
| ringa | ring | ringer | ringde | ringt | 2a |
| bo | bo | bor | bodde | bott | 3 |
| skriva | skriv | skriver | skrev | skrivit | 4 |

### Verbgrupper
| Grupp | Mönster | Exempel |
|-------|---------|---------|
| **1** | presens -ar, preteritum -ade | arbeta/arbetar/arbetade/arbetat |
| **2a** | presens -er, preteritum -de | ringa/ringer/ringde/ringt |
| **2b** | presens -er, preteritum -te | köpa/köper/köpte/köpt |
| **3** | korta verb, preteritum -dde | bo/bor/bodde/bott |
| **4** | starka verb, supinum -it | skriva/skriver/skrev/skrivit |

---

## 🛠 Teknisk info

- Helt fristående HTML-fil – ingen server, inget bygge, inga beroenden att installera
- Använder [Google Gemini 2.0 Flash](https://ai.google.dev/) via REST API
- Excel-export via [SheetJS](https://sheetjs.com/)
- Fungerar i alla moderna webbläsare
