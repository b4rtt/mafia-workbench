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

## Náhled rotací a animací

Rotace 4DS, scene2.bin, cache.bin a 5DS zůstávají uložené jako WXYZ. Pro Three se použije konjugovaná rotace; zrcadlení osy Z zůstává v kořeni pohledu. Směr potvrdila reference `b4rtt/mafia-webgl-renderer/main.js` v `GeneralMesh.initFromMafia`, která obrací W (ekvivalent konjugace), a skutečný náhled #rad022.4ds: před opravou vyklopená střecha a otočené zábradlí, po opravě souvislý dům. Gizmo převádí rotaci zpět do LS3D.

Váhy SINGLEMESH byly porovnané s `RoadTrain/mafia-formats/4ds.bt` a čtením v `Richard01CZ/Mafia4Blender_4ds`: pořadí pevných a vážených vrcholů po skupinách kostí, zbytek kořenových vrcholů na konci; každá váha doplňuje vliv uloženého rodiče do 1. ID kloubu ve frame typu 10 je uložené od nuly, skupiny kostí od jedné. Náhled odvozuje bind inverze z původní zobrazované hierarchie včetně měřítek. 553 sad skinningu skutečné hry má platné počty a váhy. 5DS klíče představují absolutní lokální transformace, chybějící kanály zachovávají bind pose; v UI bylo ověřeno 21/21 uzlů Tommyho při chůzi. Rychlost náhledu je volitelná, není odhadovaným údajem ze souboru. Morfování a herní události poznámek ještě nejsou přehrávané.

## Prázdná mise

Uživatel dodal [Empty_Mission.zip](https://github.com/user-attachments/files/16255595/Empty_Mission.zip), stejnou šablonu uvádí awesome-mafia. SHA-256 staženého archivu:

`30e85b0f896de45945b445d83fe02a8f8405f832f4764c3cbb449ebe10e85e2e`

Soukromá místní kopie obsahuje osm souborů: cache.bin, car_table.dat, check.bin, effects.bin, road.bin, scene.4ds, scene2.bin a tree.klz. V scene2.bin jsou připravené objekty hráče Tommy, startovní pozice, obloha, světla, doprava a chodci. Průvodce nové mise načítá tento přesný ZIP přímo do paměti po ověření SHA-256; nevykonává soubory z archivu. Konfigurace upraví rozpoznaná pole objektů Tommy/start a světel light_sun/light_ambient. Vynechání inicializace policie vyprázdní známý GameInitEnd, zachová jeho hlavičku a koncová data. Aktérské skripty a další nerozpoznané bloky zůstávají beze změny. Tvorba osmi souborů se publikuje jedním zápisem indexu projektu a vrací jedním krokem; nové assety mají vlastní výchozí kopii a exportují se vždy.

Licence herní šablony není doložená; archiv ani jeho soubory se nevkládají do veřejného repozitáře. Editor musí při importu použít vlastní místní kopii uživatele.

## Vytváření objektů scene2.bin

Reference mEdit `SceneEditor::WriteFrame` a načítání `CT_MODIFICATION` v `SceneEditor.cpp` rozlišuje úpravu existujícího frame a jeho vytvoření: chunk `0x4011` (FRAME_TYPE) předchází názvu při tvorbě. Enum LS3D uvádí model = 9 a dummy = 6. Nový model obsahuje typ, jméno, lokální i světovou pozici, quaternion WXYZ, měřítko, odkaz na Primary sector a jméno modelu `.i3d` v chunku `0x2012`; odpovídá také zápisu modelu v DCED2 `Scene2.cpp`. Herní asset zůstává `.4ds`, přípona `.i3d` je odkaz používaný enginem.

Vlastní writer přidává nebo odstraňuje jediný chunk a přepočítá délky předků. Duplikace přejmenuje jeho přesnou kopii; sourozenci, neznámé bloky a aktérská data zůstávají zachované. Typ frame sám nestačí k rozpoznání bezpečně odstranitelného objektu: kontrolují se i názvy v geometrii scene.4ds, aktéři, rodičovské vazby a rozpoznané zdroje skriptů. Další skryté vazby v neznámých datech se automaticky nepřepisují. Kolize tree.klz se nemění. Nové operace ukládají celý upravený scene2.bin do samostatného modu přes existující zálohy a kontrolu hash otevřeného souboru.

## Spuštění levelu

Export reverse engineeringu st0rm94 uvádí starší Game 1.0; jeho adresy nejsou použitelné bez ověření na jiném EXE. U místní GOG 1.2 byl v disassembly dohledán hlavní dispatcher menu a větev tréninku. Případný workaround musí nejdříve ověřit celý hash a konkrétní instrukce, upravovat pouze samostatnou kopii EXE a používat oddělená herní data i ukládání. Původní instalace se nesmí patchovat.

## Podmínky renderování LS3D

Barva diffuse tónuje diffuse texturu pouze při příznaku `0x08000000` (COLORED). Ověřeno v uloženém b4rtt/mafia-webgl-renderer, `mafia.js`, definice `MATERIALFLAG_COLORED`, a v referenci Mafia4Blender_4ds. U skutečného modelu Sarah2HIGHnaha jsou modré authoring barvy hlavy a nohou uložené bez tohoto příznaku; jejich bezpodmínečné násobení způsobovalo modrý náhled. Model ani barvy uložené v souboru se opravou náhledu nemění.

`scene2.bin` obsahuje odkazy na pojmenované rodiče. mEdit, `Source/Editors/SceneEditor.cpp`, větev `CT_LINK`, řeší zvlášť `Backdrop sector`. Náhled editoru jej odděluje od hlavní mapy a nezahrnuje oblohu do zarámování kamery. Cyklické vazby se odmítnou; chybějící nebo nejednoznačné vazby se oznámí.

Některé dodané 4DS obsahují neplatné hodnoty nepoužitých normál nebo UV. Náhled nahrazuje neplatné UV nulami a dopočítá normály; editace zachovává původní bajty. Neplatné pozice vrcholů zůstávají chybou.

Přímý start GOG 1.2 je implementovaný pouze v izolované kopii a byl ověřen v tréninku, na autodromu a v restauraci. Příprava dalších startů používá uložený index aplikovaných souborů; znovu nerozbaluje DTA ani nečte všechny původní assety. Na místním macOS přímý procesový start Wine z Electronu selhával při inicializaci desktopu. Ověřený start přes `/bin/zsh -f` obnovuje cestu místních DYLD knihoven z pozičního argumentu a pokračuje přes `exec`; cesty se nevkládají do zdrojového textu shellu.

## Cache.bin

Rozložení ověřeno podle mEdit `SceneEditor::LoadCacheBin` a všech 25 souborů místní hry: kořenový chunk typu 500 obsahuje verzi 1; části typu 1000 mají název s délkou uint32, 19 floatů oblasti a vložené chunky modelů typu 2000. Model má název s délkou uint32, pozici XYZ, rotaci WXYZ, měřítko XYZ, nerozpoznaný uint32 a druhou uloženou trojici měřítka. Transformace instancí jsou vůči hlavnímu sektoru, nikoli relativně k části města. Zápis reference nebyl převzat; vlastní writer přepočítá délky chunků a zachovává ostatní bajty. Úpravy pozice, modelové cesty a návrat k původním hodnotám byly ověřené přesným porovnáním dat.

## Predmety.def

PC varianta je pole záznamů o 188 bajtech bez hlavičky, ID je index od nuly. Reference: uložený `b4rtt/mafia-editor/src/Include/Data/ItemsDatabase.h` a `st0rm94/mafia-reverse-engineering-export/structs/def_tables.md`; 6 580 bajtů skutečného souboru odpovídá 35 záznamům. PS2 používá jiné rozložení a není tímto parserem podporována.

Název má 32 bajtů na +0x00, příznaky uint32 na +0x20, model 32 bajtů na +0x24. Int32: animace nabíjení +0x4c, zvuk výstřelu +0x54, zvuk nabíjení +0x58, třída +0x5c, kapacita zásobníku +0x60, zásoba +0x64. Float32: dostřel +0x74, poškození +0x78, zpětný ráz +0x84, přesnost +0x88. Rozložení odpovídá skutečným hodnotám zbraní; kapacity potvrzují také spotřebitelé v exportu inventáře. Pole příznaků se ukazuje jako maska bez nejistých jmen jednotlivých bitů.

Starší TS reference interpretuje model jako 48 bajtů; překryla by tak metadata a animaci nabíjení. Nový parser tento postup nepřebírá. Texty jsou nulou ukončené ve Windows-1250, nepřekódovávají se všechny záznamy při uložení. Vlastní writer kopíruje zdroj a zapisuje pouze změněná pole; u textu zachová padding za novým ukončovacím bajtem. Neznámé parametry včetně časování zůstávají beze změny. Zpětné nastavení textu nemusí obnovit historický padding, proto úplné undo obnovuje přesnou zálohu souboru.

## Check.bin

Reference `RoadTrain/mafia-formats/check.bin.bt` odpovídá skutečným souborům: uint32 magic `0x01ABCEDF`, uint32 počet bodů, všechny 30bajtové body, pak všechny 8bajtové vazby. Bod začíná float32 XYZ, následují uint16 typ, ID, velikost oblasti, deset neznámých bajtů a dvě bajtová počítadla vazeb. Počet položek bloku vazeb je součet prvního počítadla; obě počítadla všech ověřených skutečných bodů jsou shodná. Vazby patří postupně příslušným bodům a obsahují uint16 cíl, uint16 typ a čtyři neznámé bajty. Cíl je index pole bodů, nikoli uložené ID: ve skutečné hře jsou ID často stejná pro tisíce bodů.

Specifikace `MafiaHub/MafiaFormats/docs/checkbin.md` a její generovaný parser vynechávají počáteční XYZ; jako úplný layout se proto nepoužívají. Jejich popisy typových masek slouží pro orientační barvy náhledu. Poloměr/velikost oblasti nemá ověřené jednotky a zobrazuje se jako raw uint16. Neznámá hodnota vazby nemá odhadovanou funkci ani přepočet podle délky spojnice. Writer přepisuje jen vybraná rozpoznaná pole, zachovává všechny ostatní bajty, počty, pořadí a nerozpoznané masky. Při rozdílných počítadlech parser hlásí varování a neopravuje je automaticky.
