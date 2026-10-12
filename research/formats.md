# Formáty a uložené zdroje

Rozcestník: [MafiaHub/awesome-mafia](https://github.com/MafiaHub/awesome-mafia/blob/main/README.md); jeho přesná uložená revize je v `repositories.json`. Následující přehled slouží k volbě referencí, ne jako tvrzení, že editor všechny formáty již podporuje. Nejasnosti označené v rozcestníku otazníkem nejsou ověřenými vlastnostmi nástrojů.

| Data | Obsah a hlavní reference | Další nástroje z rozcestníku |
| --- | --- | --- |
| DTA | ISD0 archivy; Mafia_DTAExtractor, mafia-re, uživatelovy extraktory | MafiaDataXTractor, DTAUnpacker, DTA Packer |
| 4DS | Modely, materiály, hierarchie, kostra; Mafia4Blender_4ds, MafiaFormats, mafia-formats | Boz 4ds Full Manager, 4ds View, ZModeler, Noesis plugin |
| 5DS | Animační uzly a klíče; Mafia4Blender_5ds, MafiaFormats, mafia-formats | 5ds Converter |
| scene2.bin | Objekty, aktéři, skripty mise; DCED2, mEdit, mLib, MafiaFormats | Boz Scene Tree Editor, BScriptView, Scena2 Editor |
| cache.bin | Umístění statických modelů a související hodnoty; DCED2, mLib, MafiaFormats | Cache.bin Editor, CacheRE |
| check.bin | Navigační body a propojení pro pěší/vozidla; MafiaFormats, mafia-formats | CheckBIN Editor, CheckRE |
| road.bin | Síť navigace aut; MafiaFormats, mafia-formats | Road.bin Creator, Road.bin Editor, RoadRE |
| tree.klz | Kolize; MafiaFormats, mafia-formats, mLib | Dostupné informace je nutné porovnat s reálnými soubory |
| effects.bin | Efekty mise; DCED2 a přidružené reference | Effects.bin Editor |
| TextDB .def | Texty a titulky; MafiaFormats, mafia-formats | MTE, SSDM, CSVtoDEF |
| Ostatní .def/.dat | Tabulky aut, zbraní, předmětů a menu; MafiaFormats, mEdit, mLib | M Editor, RHAM, Predmety.def Editor, Mafia Menu Editor |
| BMP | Textury; materiály 4DS mohou odkazovat na diffuse, alpha a environment mapy | Texture Resizer, 4ds Texture Manager |
| WAV/OGG | Zvuky, dialogy a hudba; archiv může obsahovat DPCM bloky | Sound Maker; samotný archiv A0 nemusí být přítomný v každé distribuci |
| TCK | Herní cutscény; Cutscene-Tools-, MafiaFormats | Cutscene Guide |
| BIK/AVI | Předrenderované video | Přehrávání ve hře ověřeno; náhled v editoru zatím není implementovaný |
| rmorf.bin/CHG/DNC/GMF | Zbývající specializovaná data; DCED_misc, DCED2, mLib | Rmorf.bin Editor, DNC Extractor, CHG Editor, GmfRE |

## Prázdná mise

Uživatel dodal [Empty_Mission.zip](https://github.com/user-attachments/files/16255595/Empty_Mission.zip), stejnou šablonu uvádí awesome-mafia. SHA-256 staženého archivu:

`30e85b0f896de45945b445d83fe02a8f8405f832f4764c3cbb449ebe10e85e2e`

Soukromá místní kopie obsahuje osm souborů: cache.bin, car_table.dat, check.bin, effects.bin, road.bin, scene.4ds, scene2.bin a tree.klz. Nebyla spuštěna žádná přiložená binárka. V scene2.bin jsou připravené objekty hráče Tommy, startovní pozice, obloha, světla, doprava a chodci. Konfigurovatelná tvorba mise se bude opírat o kopii této šablony a zachová neznámá data.

Licence herní šablony není doložená; archiv ani jeho soubory se nevkládají do veřejného repozitáře. Editor musí při importu použít vlastní místní kopii uživatele.

## Spuštění levelu

Export reverse engineeringu st0rm94 uvádí starší Game 1.0; jeho adresy nejsou použitelné bez ověření na jiném EXE. U místní GOG 1.2 byl v disassembly dohledán hlavní dispatcher menu a větev tréninku. Případný workaround musí nejdříve ověřit celý hash a konkrétní instrukce, upravovat pouze samostatnou kopii EXE a používat oddělená herní data i ukládání. Původní instalace se nesmí patchovat.

## Podmínky renderování LS3D

Barva diffuse tónuje diffuse texturu pouze při příznaku `0x08000000` (COLORED). Ověřeno v uloženém b4rtt/mafia-webgl-renderer, `mafia.js`, definice `MATERIALFLAG_COLORED`, a v referenci Mafia4Blender_4ds. U skutečného modelu Sarah2HIGHnaha jsou modré authoring barvy hlavy a nohou uložené bez tohoto příznaku; jejich bezpodmínečné násobení způsobovalo modrý náhled. Model ani barvy uložené v souboru se opravou náhledu nemění.

`scene2.bin` obsahuje odkazy na pojmenované rodiče. mEdit, `Source/Editors/SceneEditor.cpp`, větev `CT_LINK`, řeší zvlášť `Backdrop sector`. Náhled editoru jej odděluje od hlavní mapy a nezahrnuje oblohu do zarámování kamery. Cyklické vazby se odmítnou; chybějící nebo nejednoznačné vazby se oznámí.

Některé dodané 4DS obsahují neplatné hodnoty nepoužitých normál nebo UV. Náhled nahrazuje neplatné UV nulami a dopočítá normály; editace zachovává původní bajty. Neplatné pozice vrcholů zůstávají chybou.

Přímý start GOG 1.2 je implementovaný pouze v izolované kopii a byl ověřen v tréninku, na autodromu a v restauraci. Příprava dalších startů používá uložený index aplikovaných souborů; znovu nerozbaluje DTA ani nečte všechny původní assety. Na místním macOS přímý procesový start Wine z Electronu selhával při inicializaci desktopu. Ověřený start přes `/bin/zsh -f` obnovuje cestu místních DYLD knihoven z pozičního argumentu a pokračuje přes `exec`; cesty se nevkládají do zdrojového textu shellu.

## Cache.bin

Rozložení ověřeno podle mEdit `SceneEditor::LoadCacheBin` a všech 25 souborů místní hry: kořenový chunk typu 500 obsahuje verzi 1; části typu 1000 mají název s délkou uint32, 19 floatů oblasti a vložené chunky modelů typu 2000. Model má název s délkou uint32, pozici XYZ, rotaci WXYZ, měřítko XYZ, nerozpoznaný uint32 a druhou uloženou trojici měřítka. Transformace instancí jsou vůči hlavnímu sektoru, nikoli relativně k části města. Zápis reference nebyl převzat; vlastní writer přepočítá délky chunků a zachovává ostatní bajty. Úpravy pozice, modelové cesty a návrat k původním hodnotám byly ověřené přesným porovnáním dat.
