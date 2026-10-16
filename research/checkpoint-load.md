# Obnovení úplného checkpointu v odděleném playtestu

## Rozsah a použití

Vedle **Spustit level** je samostatné **Načíst checkpoint…**. Výchozí start dál otevírá novou misi. Úplný checkpoint vytvoří úkolová šablona přes `autosavegamefull ID, 1`; po ukončení testu editor zaeviduje nové či změněné úplné save výchozího testovacího profilu 0. Nabídka není prohlížečem všech původních uložených her.

Editor přiděluje původ každému save: hash, misi, revizi všech synchronizovaných assetů a stav manifestu projektu. Převzatý nezměněný save nezíská evidenci. Výměna souboru, změna projektu či herních assetů zabrání načtení; přesné undo projektovou shodu obnoví. Kontrola se opakuje po synchronizaci před zápisem přesměrované mise a EXE. Evidence běhu v `run.json` umožňuje sběr i při opětovném připojení editoru k běžícímu testu.

## Nativní načtení

Primární podklady: uložená [PC dekompilace](https://github.com/st0rm94/mafia-reverse-engineering-export/blob/main/ghidra/Game-ghidra.exe.annotated.c) a [struktury loadsave](https://github.com/st0rm94/mafia-reverse-engineering-export/blob/main/structs/loadsave.md). Referenční adresy se liší od podporovaného GOG EXE; výsledná místa byla ověřena přímo v jeho instrukcích.

Podporovaný originál má SHA-256 `303eb95ee2de3433511ce0cb518921dcb96b62b0f64ebfcc436723ff5083f298`. Patch se vytváří pouze v odděleném testovacím EXE. V přeskočeném menu nastaví profil 0 a vybraný slot v loadsave singletonu `0x6d4628` (pole +0x28 a +0x7c). Nejprve běžnou cestou otevře přesměrovanou misi `wbtest`, potom místo NewGame volá loader `0x606150` a pokračuje do herní smyčky bez následujícího GameInit. Přímé vyvolání menu větve Load před otevřením scény selhalo, protože loader porovnává živé jméno mise; tuto experimentální cestu finální implementace nepoužívá.

## Čtení save

`src/core/checkpoints.js` pouze kontroluje strukturu a metadata. Těla aktérů a programu zůstávají neprůhledná a loader dostává původní soubor. G_Stream má 24bajtovou vnější hlavičku s magic `0x53617647`, flag 1; vnitřní dešifrovaná hlavička má doslovné `SavG` (`0x47766153` při čtení LE), verzi 16, slot a ID. Tyto dva magic nejsou shodné.

Cipher se počítá po jednotlivých blocích Read: celé dwordy se xorují s klíčem 0x23101976, druhý klíč začíná 0x10072002. Po každém slově se druhý klíč zvýší o plaintext a první o nový druhý klíč; obě hodnoty mají 32 bitů. Nezarovnaný konec každého bloku zůstává prostý. Čtení celé řady jako jednoho souvislého šifrovaného bufferu proto není správné.

Kontroly omezují velikost souboru na 64 MiB, všechny bloky na zbývající délku, slot na 0–599, ID na 5000 + slot a počet aktérů na 100000. Požaduje se úplný herní blok, přesné jméno `wbtest` a uložený lidský hráč `Tommy`. Zápisy a čtení používají projektové kontroly odkazů. Syntetické testovací fixture neobsahují herní data.

## Ověření 14. října 2026

- Produkční start vytvořil save ID 5599 / slot 599 se zdravím 21 a devíti aktéry. Po ukončení testu se automaticky zaevidoval bez dodatečné ruční úpravy indexu.
- Produkční načtení obnovilo zdraví a pozici hráče i rozpracovaný úkol. Nezávislý uložený program pokračoval po zbývajícím čekání, přesunul hráče k cíli a nastavil zdraví 61; úkol zobrazil dokončení. Save při samotném načtení zůstal bajtově stejný.
- Stejný průchod fungoval tlačítkem v okně Audit editoru. Po vrácení změny TextDB přes UI se checkpoint zobrazil jako jiná verze projektu a tlačítko Načíst bylo zakázané.
- Pomocné změny TextDB a scény byly vráceny přes UI na historii 38; pět kontrolovaných assetů odpovídá výchozím hashům. Předchozí soukromý save byl obnoven ze zálohy. Chráněné ostatní projekty a původní EXE se nezměnily; hra i Audit aplikace byly ukončené.
- Prošlo 327 testů, statická kontrola a build. Testy zahrnují per-block cipher, poškozené bloky, provenance, stale/replaced save, odkazy a sběr po opětovném připojení včetně selhání indexu.

Tento první průchod sám neprokazuje obnovení časového limitu a návazných signálů; ty ověřuje následující blok. Dialogy, všechny stavy AI a ruční aktivace hráčem zůstávají neověřené. Pomocný `camera_lock` se po načtení neobnovil; kamera přešla k hráči. Restart přes herní menu a ostatní profily zatím nejsou podporou tohoto tlačítka doložené. Kompletní vlastní mise a celý editor zůstávají otevřeným goalem.


## Časový limit a signály po načtení

Navazující ověření 14. října 2026 používá stejnou produkční cestu Playtest.start/checkpoints, skutečný GOG 1.2 a oddělený projekt. Tři scénáře mají vždy nový start a potom nový proces hry načítající evidovaný checkpoint stejné verze. Testovací úkol přebírá kontrolní NPC přibližně v osmé sekundě herního času; save obsahuje jedenáct aktérů.

| Scénář | Nová mise | Načtený checkpoint |
| --- | --- | --- |
| Limit 8 sekund, bez přesunu k cíli | Vypršení limitu, signál pouze do větve neúspěchu, HUD 81 | Stejné vypršení a větev, HUD 81 |
| Limit 25 sekund, přesun hráče k cíli | Dokončení úkolu, signál pouze do větve úspěchu, HUD 31 | Obnovený přesun, dokončení a větev úspěchu, HUD 31 |
| Signál odeslaný před save, příjemce nejprve čeká 20 sekund | Příjemce zachová časný signál a po čekání pokračuje, HUD 31 | Stejný příjemce pokračuje po zbývajícím čekání, HUD 31 |

Poslední scénář nemá úkolové odkazy onComplete/onFailure. Jediný odesílatel po šestisekundovém čekání odešle signál, počká další dvě sekundy a převezme úkol s checkpointem; jeho program už další odeslání neobsahuje. Rozbor uložených souborů ukazuje nulový signal byte v běžných čekajících příjemcích a hodnotu 1 v časném příjemci. Byte 5 koncového 12bajtového detector save záznamu tedy odpovídá skutečnému byte +0xdc v getteru/setteru i writeru/readeru. Komentáře k save ve zdrojovém exportu označují některá pole nepřesně; rozhodující jsou těla funkcí a tento průchod.

Časový test má oddělený měřicí skript: getgametime, dělení 1000 a přičtení 20 ve dvou příkazech let, výsledek na HUD. Save s tagem herního bloku 0x0a obsahuje čas 8150 ms; po načtení HUD pokračuje hodnotami 31 a 36 před následným 81. Čas nezačíná znovu od nuly. Primární podklad je game_get_frame_time_ms (C_game +0x2b0c), game_save_game_load obnovující tento dword z offsetu 1 a uložení float registrů programu. Wall-clock snímky nejsou přesným stopováním příkazů: inicializace a jednotlivé instrukce spotřebují herní framy.

První pomocné měření použilo nepodporovaný výraz se dvěma operátory v jednom let a ukazovalo neplatné hodnoty energie. Nešlo o chybu produkční šablony. Podklad program_decode_let/dispatcher case 8 dovoluje pouze dva operandy, bez precedence; měření bylo opraveno a oba časové běhy opakovány. Tyto první snímky se nepoužívají jako důkaz číselného času.

Všech šest finálních běhů skončilo přes vlastní wineserver. Při načtení se hash save nezměnil. Po každém scénáři byly obě pomocné operace přes undo vráceny na historii 38 a předchozí soukromý save obnoven. Pět kontrolovaných projektových assetů, ostatní chráněné projekty a původní EXE jsou stejné. Herní soubory, save, snímky a pomocné testovací skripty se nepublikují. Produkční kód nebylo pro tyto průchody nutné měnit.

Zbývá ruční převzetí a pohyb hráče, dialog po načtení, smrt hlídané postavy po načtení, restart přes menu a širší kombinace úkolů; tento audit neprokazuje všechny herní stavy ani dokončení celého editoru.

## Prostorové a automobilové větvení: příprava obnovení, 16. října

Nová samostatná mise obsahovala 28 produkčně generovaných rozhodnutí: pěší hráč / řidič jiného auta / spolujezdec / řidič vybraného auta, dosah pohybujícího se auta, výškově vzdálený cíl, negace a spojení všechno / alespoň jednu. Diagnostický kontrolér vytvářel úplné save do podporovaných slotů 588–591. Po každém save vynuloval oba výstupy právě dokončených sedmi rozhodnutí a před další fází čekal 1,5 s. Následující save tedy ověřuje nejen správnou právě aktivní větev, ale také nulové starší výstupy při trvajícím vstupním signálu. Skriptově přidané přesazování hráče není ruční jízda.

V běhu s předem inicializovanou výchozí plochou Wine vznikly čerstvé checkpointy v 5 699 / 11 095 / 16 501 / 21 901 ms. Nezávislé čtení uložených stavů potvrdilo správné výstupy všech 28 bodů a zachování nulových dříve dokončených výstupů. Po produkčním `Playtest.stop` nabídka `Playtest.checkpoints` zaevidovala všechny čtyři jako kompatibilní. Scéna aplikovaná ve hře měla přesný hash projektu; do indexu se nepřidávaly ruční záznamy.

**Načtení těchto nových stavů není tímto blokem ověřené.** První běžný produkční start selhal před oknem. Druhý pokus s rozšířeným logem vytvořil všechny čtyři checkpointy, ale samotný načítací proces opět skončil před oknem se stejnou chybou. V posledním pokusu po úspěšné nové misi nedokončil inicializaci nový přípravný Explorer; načítání hry se vůbec nevolalo. Žádný z těchto neúspěchů není důkaz chyby obnovy skriptů. Diagnostika a pracovní hypotéza pořadí inicializace jsou v [wine-startup.md](wine-startup.md). Produkční launcher, patch EXE i parser checkpointů se neměnily.

Soukromá evidence posledního běhu je `local/spatial-checkpoint-F6eNLG/results.json`, čtyři `new-*.sav`, logy a `cleanup.json`. Všechny diagnostické úpravy projektu byly vrácené přes undo na historii 53 a původní hash scény. Chráněné soubory a uživatelský projekt zůstaly přesné; vlastní hry/přípravné procesy jsou ukončené. Prošlo 9/9 cílených testů spouštěče a checkpointů. Obnovení nových prostorových/automobilových podmínek zůstává otevřený test, nikoli hotová položka.

## Řazené rozhovory po načtení, 16. října

Samostatná kopie projektu použila šest produkčně generovaných rozhovorů s kamerou, zámkem ovládání, kontrolou života a společným detektorem `WB_DIALOGUE_QUEUE`. Diagnostický kontrolér současně aktivoval A/B, později usmrtil čekajícího účastníka D během C a nakonec vlastníka E při čekajícím F. Každý rozhovor měl čtyři dabované repliky. Nový běh vytvořil sedm úplných checkpointů 570–576 v časech 4 339 / 17 972 / 31 137 / 32 837 / 45 126 / 47 012 / 60 217 ms. První frontu v tomto běhu získal B; pořadí A/B není součástí slibu této funkce.

Po produkčním ukončení a sběru byly všechny save kompatibilní. Následovaly tři skutečné procesy hry přes `Playtest.start` s vybraným slotem a hashem z `Playtest.checkpoints`:

| Načtený stav | Herní čas save | Nově vytvořené následující save | Ověřený výsledek |
| --- | --- | --- | --- |
| 570: první rozhovor běží, druhý čeká | 4 339 ms | 571–576 | Oba postupně dokončené; pozdější smrt D/E vede pouze do jejich neúspěchu; F dokončený |
| 573: C běží, čekající D už zemřel | 33 078 ms | 574–576 | C pokračuje, výsledky dokončených A/B/D zůstávají zachované; pozdější E/F správně navážou |
| 575: po smrti vlastníka E už mluví F | 48 516 ms | 576 | F dokončí, E zůstává pouze v neúspěšné větvi, hráč i fronta uvolnění |

Druhý vybraný save pochází z prvního obnoveného běhu a třetí z druhého; nejde o tři načtení pouze původní nové hry. Před každým načtením se v soukromé kopii odstranily pouze budoucí sloty. Jejich další vznik proto dokládá vykonání pokračování, nikoli čtení starších souborů. Evidence kompatibility vznikla produkčním sběrem, žádné ruční přidání indexu. Hash každého vybraného save se při načtení nezměnil.

Nezávislé dekódování sedmi nových a deseti obnovených stavů ověřilo všech dvanáct success/failure signálů, signál fronty a uložený zámek hráče. Nové fáze mají lock/queue `[1,1,0,1,0,1,0]`; obnovené části mají odpovídající konce téže řady. Stav po smrti čekajícího má aktivní cizí zámek zachovaný a závěrečné stavy mají oba zámky nulové. Herní čas pokračoval z uložené hodnoty; konce obnovených běhů byly 60 575 / 61 579 / 62 099 ms. Nejde o přesné měření pozice v právě vyslovované replice ani souvislé sledování zámku mezi checkpointy. Zachované jedničkové výsledky samy neprokazují, že se stejný výstup nikdy znovu neodeslal.

Tento audit dokládá pokračování skriptů, vazeb aktérů, fronty, větví a uvolnění ovládání. **Nedokládá obnovu stejného záběru kamery, přesné pozice dabingu, nativní nabídky odpovědí ani ruční pohyb hráče.** Programový save/load obnovuje čítač instrukce, registry a odkazy aktérů; `human_talk` má navíc stav kanálu v payloadu instrukce. Pokračování programu samo o sobě proto není důkaz věrné obnovy zvuku nebo kamery. Primární podklad: `program_save_game_save`, `program_save_game_load` a dispatcher 0x83 v PC dekompilaci výše.

První dva nové starty a první dva pokusy načtení 570 selhaly před oknem se známou chybou Wine; třetí pokusy prošly. Načtení 573 a 575 prošla napoprvé. Přípravný Explorer někdy hlásil stopu připravenosti i před následným grafickým selháním hry; tato stopa tedy není dostatečná produkční podmínka startu. Launcher ani runtime se neměnily.

Soukromá evidence `local/dialogue-queue-load-qZTiSy/results.json`, save, logy a `cleanup.json` zůstává mimo Git. Vlastní procesy ukončené, diagnostická změna vrácená přes undo na historii 53 a původní hash scény; čerstvě zachycené hashe chráněných souborů i uživatelského manifestu přesné. Prošlo 11/11 cílených testů checkpointů, spouštěče a fronty rozhovorů. Audit celé vlastní mise a výše vyjmenované meze zůstávají otevřené.
