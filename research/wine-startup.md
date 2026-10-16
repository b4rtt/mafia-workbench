# Nestálý grafický start Wine na macOS

Diagnostika 16. října 2026. Produkční spouštěč se v tomto bloku nemění. Chyba startu není chyba mise ani důkaz, že se nevykonal skript kvůli jeho obsahu.

## Reprodukce a hranice výsledků

Oddělená kopie stejné připravené scény GOG 1.2 vytváří checkpoint po přibližně pěti herních sekundách. Každý srovnávaný studený start dostal vlastní kopii základního prefixu, stejná herní data a stejný místní runtime. Nový dešifrovaný checkpoint dokládá vykonání scény; pouhý PID nebo návratový kód není důkaz úspěchu.

| Varianta | Výsledek |
| --- | --- |
| Přímý start, obvyklé logování, tři samostatné prefixy | Dva nové checkpointy; třetí proces zůstal živý, ale do 50 s checkpoint nevytvořil. Příčina tohoto čekání není doložená. |
| Přesný produkční shell a prostředí, čerstvý prefix | Návrat 0, `nodrv_CreateWindow` / `The explorer process failed to start.`, bez nového checkpointu. |
| Stejný produkční příkaz s rozšířeným logováním modulů/ovladače | Jeden úspěšný studený start; následné produkční načtení checkpointu v dalším testu opět selhalo před oknem. Samotné logování není oprava. |
| Přímý start s obecným předáním argumentů přes shell | Úspěšné běhy, ale nedostatek srovnání k připsání rozdílu syntaxi shellu. Žádná taková oprava není prokázaná. |
| Explorer `/desktop=ColdTest,640x480` a samostatný argument `Game.exe` | Nový checkpoint. Pouze jeden správně zadaný společný start; není důkaz spolehlivosti ani správného sledování konce procesu hry. |
| Explorer a po 15 s samostatný Game.exe | Dva úspěšné běhy v nových prefixech. Pevná prodleva není důkaz připravenosti a není přidaná do editoru. |

První pokus společného startu chybně připojil `Game.exe` jako třetí čárkou oddělenou část `/desktop=…`; ten nevytvořil checkpoint a nepočítá se mezi platná srovnání. Syntaxe podle zdroje je `/desktop=name[,widthxheight[,driver]]` a teprve další argument je příkaz. Nelze z tohoto neplatného pokusu odvozovat poruchu Wine.

Další samostatný test produkčního `Playtest.start` nad novou kopií projektu reprodukoval návrat 0 se stejnou grafickou chybou. S rozšířeným logem vznikly čtyři nové, automaticky zaevidované checkpointy 588–591; následující načítací proces ale opět selhal ještě před oknem. Ani úspěšná příprava dat, čerstvý prefix, opakování nebo ladicí log tedy samy nezajišťují start.

## Doložená stopa a pracovní hypotéza

V neúspěšném načítacím procesu se v jednom souboru logu objeví chyba okna hry dříve než načtení 64bit `winemac.drv` procesem Exploreru. Hra poté zavírá DLL a končí. To odpovídá závodu při inicializaci plochy, ale samotné pořadí řádků ještě neprokazuje úplnou příčinu.

Primární srovnávací zdroj [Wine 9.0, win32u/driver.c](https://github.com/wine-mirror/wine/blob/wine-9.0/dlls/win32u/driver.c) v `load_desktop_driver` čeká přes zprávu okna plochy a čte její identifikátor ovladače; obecnou výchozí chybu pojmenovává jako selhání Exploreru. [Explorer desktop.c](https://github.com/wine-mirror/wine/blob/wine-9.0/programs/explorer/desktop.c), `manage_desktop`, nejprve načítá ovladač a vytváří plochu, potom spouští případný příkaz a zůstává ve smyčce zpráv. Jde o upstream podklad, nikoli o doklad úplné shody se zdejším sestavením CrossOver.

Diagnostika proto před dalším testem spouští Explorer na výchozí ploše (`explorer.exe /desktop`) a čeká na čerstvou stopu `macdrv_SetDesktopWindow` v jeho vlastním logu. Hra se potom stále spouští produkční metodou. Toto je testovací příprava, nikoli nová produkční cesta. Případná integrace musí navíc ověřit přirozené ukončení hry, vlastnictví procesů, stop, opětovné připojení editoru a úklid při selhání. Přepsat sledovaný PID na Explorer by samo o sobě nebylo správnou opravou.

## Bezpečnost a evidence

Každá diagnostika používá soukromá herní data/prefix, ukončuje pouze vlastní prefix a kontroluje původní hashe. Projektové změny při neúspěšných testech byly vrácené přes undo. Původní Game.exe, herní save a uživatelská mise se nemění. Soukromé logy/checkpointy nepatří do veřejného repozitáře.

Místní evidence: `local/cold-launch-AtAICq`, `local/cold-launch-yTt2fE`, `local/cold-launch-VGTTzU`, `local/spatial-checkpoint-g8NryK` a `local/spatial-checkpoint-CtldXf`. Tyto checkpointové diagnostiky jsou neúspěšné celkové testy; dílčí nové save se nevydávají za ověřené obnovení. Datové testy spouštěče a checkpointů v tomto bloku prošly 9/9.

Další pokus `local/spatial-checkpoint-F6eNLG` úspěšně inicializoval výchozí plochu, spustil novou misi a ověřil čtyři nové checkpointy i jejich evidenci. Před navazujícím načtením se však nový vlastní Explorer do 30 s nedostal k očekávané stopě připravenosti a hra se proto vůbec nespouštěla. Tento timeout neprokazuje ukončení procesu ani poruchu načítání save; stav procesu byl před úklidem stále živý a zachoval se jeho log. Ani tento způsob přípravy tudíž zatím není produkční opravou. Příprava původního testu byla vrácená na historii 53, pomocné procesy ukončené. Dílčí ověřený stav nové mise a přesné hranice jsou v research/checkpoint-load.md.

Navazující `local/dialogue-queue-load-qZTiSy` vytvořil sedm nových checkpointů a úspěšně načetl tři různé fáze rozhovorů, včetně save z již obnovené hry. Nový start i první načtení potřebovaly tři omezené pokusy, další dvě načtení prošla napoprvé. Dva neúspěšné procesy hry měly předem stopu `macdrv_SetDesktopWindow` v logu pomocného Exploreru. Ani tato stopa sama nezaručuje, že následující herní proces vytvoří své okno. Úspěšné obnovení je doložené až novými save a jejich rozborem v [checkpoint-load.md](checkpoint-load.md); selhané starty se mezi důkazy obnovení nepočítají. Produkční kód se nemění, procesy vlastního prefixu ukončené, původní hashe přesné.
