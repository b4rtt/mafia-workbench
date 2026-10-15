# Samostatné zakončení mise

Stav: 15. října 2026. Koncový skriptový bod bez úkolového zadání a bez cílového objektu. Je vhodný za rozhovor, volbu odpovědi nebo poslední úkol.

## Použití

V **Logice mise → Přidat → Přidat zakončení mise…** zadejte jedinečný název a polohu. Stejný formulář je ve **3D scéně → Přidat**. Zvolte výsledek:

- **Úspěšně ukončit misi**: `endofmission 1, ID` s existujícím textem výsledku.
- **Neúspěšně ukončit misi**: `endofmission 0, ID`; hra zobrazí Konec hry, vlastní text a volbu opakování/návratu.
- **Načíst další misi**: `change_mission "název", "", -1`; cíl musí mít platnou scénu s hráčem, geometrii a kolize. Nelze vybrat stejnou misi. Nepřenáší se inventář, zdraví ani auto předchozího hráče.

Výchozí **Čekat na signál z jiného bodu** ponechte zapnuté a spuštění automaticky po načtení/signálu. Potom v posledním rozhovoru, úkolu nebo odpovědi vyberte tento bod jako cíl signálu. Takové zakončení nepotřebuje žádný prostorový cíl; poloha jeho rámu výsledek neomezuje. Bez čekání na signál automatická varianta skončí dvě sekundy po načtení mise, na což formulář upozorňuje.

Volitelně lze po signálu čekat ještě na tlačítko akce nebo příchod hráče do kulové oblasti s kladným poloměrem včetně výšky. Pouze varianta tlačítka potřebuje ID textu akce. Jazykový TextDB slouží ke kontrole existujících neprázdných jednoznačných ID; poslední hraniční záznam není text. Jazyk se do programu neukládá. Samotný automatický přechod do další mise TextDB nepotřebuje.

Vyberte kartu v diagramu a **Nastavit…**, nebo ve 3D **Objekt → Nastavit zakončení mise…**. Nezměněný formulář neumožní zbytečné uložení. Polohu existujícího bodu měňte ve 3D vlastnostech. Upravený vlastní zdroj, nejednoznačný aktér nebo jiná maska se nebudou vydávat za tento recept; použijte zdrojový editor.

## Zápis a meze

Jde o aktéra typu 5 s maskou 1. Generátor nejprve vyhodnotí čekání na signál a zvolenou aktivaci, potom právě jeden koncový příkaz. Nemá odchozí signál, checkpoint ani automatické mazání ostatních zadání. Pro další práci před koncem použijte samostatný předchozí bod.

Vytvoření a nastavení mají jednu transakci, kontrolu verze, zálohu, export a undo. Nastavení mění pouze program daného bodu. Před publikací se znovu kontrolují čtené texty, geometrie a všechny tři základní soubory cílové mise; změna během ukládání zápis odmítne. Název cílové mise přebírá skutečnou velikost písmen. Kontrola mise i diagram využívají stejný rozpoznaný recept.

V izolovaném rychlém startu podporované GOG 1.2 se úspěšný konec/vrácení do hlavního menu promění v ukončení testovacího procesu. Neúspěch správně ponechá obrazovku Konec hry. Přechod načte startovní skripty a hráče cíle. Vytváření kampaně, přenos stavu hráče a obecná analýza vlastních koncových programů nejsou součástí této funkce.

## Ověření

512/512 testů, `npm run check` a `npm run build` prošly. Nové testy zahrnují všech 18 kombinací výsledku/aktivace/signálu, CRLF a přesnou obnovu, vlastní zdroj/masky, chybná nebo prázdná/hraniční ID, stale závislosti, kanonický název další mise, odmítnutí stejného cíle, navázání diagramu, kontrolu mise, rollback publikace a přesný export/znovuotevření/undo.

Produkční renderer v místním prohlížeči s privátním adaptérem nad skutečným ModProject: vytvoření neúspěšného oblastního bodu, odmítnutí hraničního ID, obnova nastavení a disabled nezměněné uložení. Změna na automatický přechod do jiné mise zkontrolovala cíl a po save ukázala novou hranu. Opětovné otevření, 3D výběr a jeho nastavovací nabídka, přesný export a kontrola závislostí prošly. Dvě UI undo vrátily celou testovací kopii na historii 42 a původní hashe; chráněné projekty a Game.exe shodné. Toto je ověření rendereru v prohlížeči, nikoli nové ověření Electron okna.

Tři izolované běhy skutečné GOG 1.2/Wine použily produkčně vytvořený bod. Před spuštěním konce úplný checkpoint v přibližně šesté herní sekundě potvrdil signál 0. Diagnostická NPC poslala signál až ve dvanácté sekundě:

- Úspěch s tlačítkem: NPC následně použila bod a testovací hra skončila s kódem 0.
- Neúspěch s oblastí: hráč uvnitř oblasti po signálu dostal viditelnou obrazovku **Konec hry** s vlastním českým textem a tlačítky Opakovat/návratu. První pomocný test nesprávně očekával ukončení procesu; opraveno bylo očekávání testu, produkce se neměnila.
- Přechod po signálu: druhá vlastní mise vytvořila checkpoint s energií hráče 31, nastavenou pouze jejím startovním programem; původní koncový aktér v cíli nebyl. Snímek ukázal novou misi a energii 31. Hra nadále běžela, potom ji pomocník ukončil.

Řízení signálů a použití bodu bylo diagnostické, nejde o ruční průchod celé vlastní mise ani důkaz přenosu stavu či restartu z menu. Všechny přípravné změny byly přes undo vrácené, hry ukončené a původní/chráněné hashe shodné. Soukromé důkazy zůstávají v `local/mission-finish-browser.json` a `local/mission-finish-native.json`; herní data a snímky se nepublikují. Goal plného editoru pokračuje, městský plugin zůstává další navazující úkol.
