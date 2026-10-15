# Logika mise

Stav: 15. října 2026. Společný přehled a vstup do existujících nastavení, nikoli simulace enginu.

## Použití

Otevřete libovolnou část mise a zvolte **Logika mise**. Vyberte kartu nebo bod vlevo. **Nastavit…** otevře odpovídající formulář úkolu, rozhovoru, boje nebo volby odpovědi. Dvojklik na kartu dělá totéž. **Otevřít zdrojový skript** vybere přímo jeho program v inspektoru; **Ukázat ve 3D** vybere jeho scénový objekt. Tlačítka **Body** a **Podrobnosti** schovají boční panely, **Najít vybraný** vystředí kartu. Diagram lze posouvat vodorovně i svisle. Hledání filtruje seznam bodů, zachovává kontext diagramu. Samostatné vlastní programy jsou výchozí skryté a dostupné přepínačem.

## Data a omezení

- Přesná obnova používá existující `editableMissionTask`, `editableMissionDialogue`, `editableMissionCombat` a `editableMissionChoice`. Nevytváří další metadata ani nepřepisuje soubory pouhým otevřením. CRLF je rozpoznané, vlastní změna programu nebo masky jej ponechá jako vlastní skript.
- Známé hrany: dokončení, neúspěch a každá odpověď. Přechod do jiné mise a oba způsoby ukončení mají samostatné cíle. Pomocné body a kompletní řadič voleb jsou seskupené; částečně upravený řadič zůstává dostupný jako vlastní zdroj. Přímý signál pomocnému bodu uvádí jeho přesný název a upozornění, nepředstírá aktivaci celé volby.
- Cíle se řeší bez rozlišování velikosti písmen a musí být jednoznačně navázané na scénu. Chybějící nebo nejednoznačný cíl je výslovně nedostupný. Čekání bez rozpoznaného odesílatele ani cyklus nejsou důkazem chyby: aktivaci může zajistit vlastní skript nebo hráč.
- Původní a vlastní programy nemají odhadované odchozí hrany. Přehled nehodnotí skutečnou dosažitelnost, časování, AI, dynamické vytváření objektů, save/load ani podmínky hry. Neslouží k libovolnému přepisování původních questů grafem.
- Nabídka **Přidat** vytvoří úkol, rozhovor, boj, volbu odpovědi nebo vlastní skript přímo v diagramu. Používá stejné formuláře, kontroly závislostí a transakce jako 3D scéna. Volný výchozí název zohledňuje objekty, geometrii, aktéry, samostatné programy i všechny pomocné názvy nové volby bez rozlišování velikosti písmen. Poloha nového objektu se zadává XYZ ve formuláři. Po uložení zůstane otevřená logika a vybere se nová karta; neodpovídající hledání se vyčistí, vlastní skript zapne zobrazení vlastních programů. Schované panely zůstanou schované. Rozpracované změny přidání dočasně zakážou. Zrušení formuláře nic neukládá. Návaznosti se mění ve stávajících formulářích s jejich kontrolou závislostí, jedním undo a exportem. Poloha diagramu není herní poloha objektu. Paměť pohledu platí během běhu editoru, odděleně podle projektu a části mise.

## Ověření

471/471 testů, `npm run check` a `npm run build` prošly. Nové datové testy používají binární scény a původní generátory receptů: všechny větve, inventářový úkol, rozlišení actor/standalone, chybějící/nejednoznačné vazby, změněné masky/programy, CRLF, pomocný bod, dvě skupiny jednoho řadiče a částečně upravenou skupinu. Rozvržení ověřuje větvení, oddělené body, cykly a řetězec 12 000 bodů bez rekurze. Vstupní scéna se nemění; paměť logiky je oddělená od 3D kamery i jiného projektu.

Izolovaná kopie projektu v Electron aplikaci obsahovala pět receptů a sedm hran: úkol → rozhovor → volba → boj nebo závěr, samostatná větev neúspěchu. Skutečné UI uložilo změnu dokončení úkolu na volbu; nová hrana a upozornění rozhovoru bez známého odesílatele se objevily. Export měl přesný hash UI scény, TextDB zůstalo stejné, transakce obsahovala pouze scénu. UI undo obnovilo připravený hash a ponechalo diagram.

Zdrojový přechod otevřel program vybraného úkolu; přechod do 3D vybral jeho objekt. Formuláře všech čtyř druhů obnovily původní nastavení. Panely se skutečně schovaly a po návratu ze 3D zůstaly schované, vybraný rozhovor zůstal vybraný. Po testu vlastní aplikace ukončená a sedm přípravných změn vráceno přes undo na historii 12; původní hashe všech částí mise/TextDB a chráněných projektů/Game.exe shodné. Herní skripty/generátory tato změna neupravuje; nová nativní zkouška ani ruční průchod celé mise tím nejsou doložené.


### Přidávání přímo v diagramu (15. října 2026)

498/498 testů, check/build. Pět nových testů ověřuje kolize výchozích názvů v různých částech scény, rezervaci pomocných názvů, výběr skutečného zdrojového ID úkolu a seskupené volby, odlišení samostatného programu, odhalení vlastního skriptu, zachování filtrů/panelů a oddělení paměti projektů. Nejednoznačný nebo chybějící výsledek výběru neohrozí už úspěšné uložení.

Produkční renderer byl kvůli zamčenému Macu ověřen v místním prohlížeči, s dočasným HTTP adaptérem nad skutečným ModProject a samostatnou kopií vlastní doručovací mise. Z nabídky vzniklo všech pět druhů bodů; rozhovor použil existující vlastní WAV, úkol a boj své návaznosti, druhá volba sdílela řadič a měla dvě nové větve. Diagram měl 10 receptů a 13 hran. Nové karty byly vybrané; skrytý panel zůstal skrytý, předchozí neodpovídající filtr se vyčistil. Opětovné přidání úkolu nabídlo další volný název; zrušení zachovalo výběr i historii.

Znovuotevření obnovilo všechny recepty, export scény měl přesný hash. Každá z pěti transakcí měnila pouze scénu; TextDB, modely a kolize beze změny. Pět skutečných UI undo obnovilo historii 42 a původní hashe všech částí vlastní mise. Chráněný uživatelský projekt, ukázkový projekt i původní Game.exe beze změny; konzole bez chyb. Tato zkouška dokládá formuláře a produkční ukládání v prohlížeči, nikoli nové ověření Electron okna nebo běhu ve hře. Generátory ani herní programy se tímto blokem neměnily.
