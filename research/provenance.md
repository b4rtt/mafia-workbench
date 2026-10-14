# Původ implementace a reference

REP parser, writer a náhled časové osy jsou vlastní implementace podle loaderů a spotřebitelů záznamů v uloženém exportu st0rm94. Referenční C/C++ zdroj ani starší šablony nebyly kopírované do editoru. Konkrétní funkce, rozdíly verzí a neinterpretované části jsou v `formats.md`; lineární náhled drah není implementací herních kamerových křivek.

Všech 16 dodaných repozitářů je uložených lokálně mimo veřejné repo; přesné revize jsou v `repositories.json`. Duplicitní awesome-mafia je uložený jednou. Soukromé repozitáře uživatele zůstávají soukromými referencemi.

Nové modové projekty, bezpečné zápisy, editor TextDB, Electron IPC a UI jsou implementací tohoto projektu. Tabulka klíčů DTA a numerické tabulky zvukových delt vycházejí z uživatelova `b4rtt/mafia-editor`. DTA parser byl nově napsaný s přísnými kontrolami, podle struktury ISD0 ověřené porovnáním uložených referencí a skutečnými archivy. Nepoužívá Windows DLL ani heuristické fallbacky původního extraktoru.

Pozorované rozdíly referencí:

- `b4rtt/mafia-editor`: uživatelský Electron základ a TS parsování. Původní extraktor při některých chybách pokračoval; ukládání položek přes IPC nezachovávalo raw record. Tyto zápisové cesty nebyly převzaté.
- `Richard01CZ/Mafia_DTAExtractor`: struktura DTA a dekódování; jeho WAV fallback vytváří syntetickou hlavičku a stereo kopíruje raw. Nový parser chybnou hlavičku odmítá a stereo dekóduje po kanálech.
- `Marvisak/mafia-re`: porovnání faktů o DTA layoutu, big-endian LZ řídicích bitech, přímých vzdálenostech odkazů a WAV blocích. Zdroj reverse engineeringu nebyl kopírovaný do editoru.
- `MafiaHub/MafiaFormats`: specifikace TextDB: počet, neznámé pole, ID, absolutní offsety a nulou ukončené řetězce. Repo uvádí Apache-2.0; zdroj parseru nebyl převzatý.
- `RoadTrain/mafia-formats`: porovnání binárního layoutu TextDB, check.bin a road.bin; šablony nebyly kopírované.
- `Richard01CZ/mEdit`: referenční Windows editor a rozsah scén/aktorů/skriptů. Obsahuje GPL-3.0. Jeho C++ kód nebyl vložený do tohoto MIT projektu.
- `Richard01CZ/Mafia4Blender_4ds` a `Mafia4Blender_5ds`: referenční čtení/zápis modelů a animací; před převzetím zdroje je nutné zachovat jeho licenční podmínky.
- `st0rm94/mafia-reverse-engineering-export`: exporty pro různé verze. Adresy z Game 1.0 se automaticky nepoužívají pro testovanou GOG 1.2.
- `MafiaHub/awesome-mafia`: rozcestník dokumentace a nástrojů.
- `Richard01CZ/DCED_misc`, `mLib`, `DCED2`, `Sanderfol/Cutscene-Tools-`, `b4rtt/mafia-nodejs-extractor`, `b4rtt/mafia-webgl-renderer`: uložené reference pro další formáty a nástroje. Jejich celé zdroje, binárky a závislosti nebyly veřejně zkopírované ani spuštěné.

U některých starších referencí nebyla nalezena jednoznačná licence v kořeni. Jejich uložení a čtení není totéž jako svolení k přelicencování. Pro další funkce se použije vlastní implementace podle formátu nebo řádně licencovaný zdroj s atribucí.

Scénový chunk parser, 4DS/5DS parsery a jejich zápisové cesty jsou vlastní implementace podle porovnaných binárních layoutů a reálných souborů. Nebyl kopírovaný zdroj Blender doplňků, DCED ani mEdit. Převod V pro náhled 4DS odpovídá konvenci LS3D popsané čtením Blender reference. Three.js a esbuild jsou instalované balíčky s vlastními licencemi; sestavení uchovává jejich licenční komentáře. Přehled dalších formátů a původ soukromé šablony Empty Mission jsou v `formats.md`.


Sektorové/portálové čtení a byte-local zápis 4DS v29 i Three.js obrysy jsou vlastní implementace. Rozložení bylo porovnáno s Richard01CZ/Mafia4Blender_4ds `4ds.py` a RoadTrain/mafia-formats `4ds.bt`; žádný jejich zdrojový kód nebyl převzat. Rozpor pořadí dat portálu je vyřešen kontrolou skutečných rovin a vrcholů, popsanou v `formats.md`. Neověřené dvě float hodnoty jsou zpřístupněné jako raw; šablonové názvy near/far se nepřebírají jako tvrzení o enginu. Testovací model v `test/sector-fixture.js`, sdílený oběma sektorovými testy, je syntetický, není výňatkem herního assetu.


Validace a writer změněné sektorové geometrie, portálů a jejich UI jsou vlastní implementace podle porovnané struktury a pravidel `validate_sector_and_portal` v Blender referenci. Výpočet bounds a jednotkové roviny vychází z geometrie a pozorovaných původních hodnot; zdroj exportéru nebyl kopírovaný. Nepoužité vrcholy původních objemů se zachovávají podle reálných dat. PS2 `UpdatePortal__10I3D_portalFv` z uloženého st0rm94 exportu je pomocný podklad transformace, nikoli důkaz nativního chování nového writeru. Omezení a výsledky ověření jsou v `formats.md`.


Writer nového sektorového frame, box, jeho validace a dialog jsou vlastní implementace podle struktury `serialize_frame`/`serialize_sector` v uložené Blender referenci a auditu skutečných defaultů původních sektorů. Žádný zdroj exportéru ani původní herní asset nebyl vložen do veřejného repo. Testy používají syntetickou sektorovou fixture; nativní evidence a herní kopie zůstávají soukromé v ignored local.


Plán propojení sektorů, převody souřadnic, kontroly hranice/overlap a dialog protikusu jsou vlastní implementace. Princip geometrického spojování byl porovnán s `UpdatePortalInterconnection`/`MakeReadySectors` z PS2 st0rm94 exportu a s polygonovými dvojicemi původních misí; zdroj ani neznámé tolerance nebyly kopírovány. Windows účinek ověřuje oddělený nativní test nové dvojice sektorů; evidence/herní data zůstávají ignored local. Syntetické testy nevkládají původní game asset do veřejného repo.


Konstrukce konvexního povrchu používá MIT Three.js addon [ConvexHull](https://threejs.org/docs/pages/ConvexHull.html) z již instalované závislosti (QuickHull port uvedený v její dokumentaci). Addon je importovaný, nikoli kopírovaný z jiného Mafia editoru; bundler zachovává licenční komentáře. Mapování původních bodů/ID, float32 a LS3D inward validace, odebrání/přemapování, GUI a testy jsou implementace tohoto projektu. Herní evidence zůstává soukromá v ignored local.
