# Tvorba obsahu mise a kolizí

Průzkum 12. října 2026 podle uložených revizí v `repositories.json`. Tento dokument určuje rozsah dalšího rozvoje; nabídka nebo číselný typ v referenci nejsou důkazem podpory v našem editoru. Ověření ve hře je uvedené zvlášť v README.

## Model, frame a aktér

Frame nese jméno, rodiče a transformaci. Model přidává vizuální obsah z 4DS; aktér připojený ke stejnému jménu přidává herní funkci. Kolize statické scény jsou další samostatná vrstva. Vložit vizuální model auta tedy není totéž jako vytvořit řiditelné auto; model budovy zase automaticky nevytvoří její KLZ kolize.

mEdit připojuje aktéry k vybranému frame a hlídá, aby neměl dva aktéry. Jeho menu nabízí hráče, člověka, auto, detektor, železniční vozidlo, správce chodců, správce dopravy a fyzikální objekt. Dveře jsou rovněž implementované v `CreateActor` a vlastní třídě. DCED2 rozlišuje vizuální objekty, definice aktérů a inicializační skripty; jeho katalog obsahuje i nepodporované typy. Pro naši nabídku musí být viditelné, co vytvoří funkční obsah a co je zatím jen nalezený typ.

| Obsah | Typ nebo vrstva | Potřebné části a rozpoznané nastavení | Reference |
|---|---|---|---|
| Model a dekorace | frame 9 | 4DS, jméno, rodič, transformace; samostatná volba kolize | mEdit Create Model; mLib model writer |
| Pomocný bod | frame 6 / dummy | Transformace, rodič; cíl kamer, skriptů a dalších vazeb | mEdit Create Dummy; DCED Standard Object |
| Světlo | frame 2 | Typ, barva, síla, dosah, kužel, sektor, odlesk | mEdit Create Light; mLib Scene2 |
| Prostorový zvuk | frame 4 | Zvukový zdroj, hlasitost, dosah, kužel a sektor | mEdit Create Sound; DCED označuje svůj starší zápis za neúplný |
| Kamera | frame 3 | Transformace a vazby skriptů; bez automatické tvorby REP | DCED Camera |
| Sektor, occluder, lightmap, oblast hudby | Specializované framy | Geometrie oblasti, hierarchie, viditelnost; některé položky DCED jsou pouze katalog | DCED objecttypes; mEdit lightmap/scene editor |
| Hráč | aktér 2 | Model s kostrou, lidské parametry, start a inicializace; druhý hráč není běžné NPC | mEdit Player; mLib Player |
| Postava / NPC | aktér 27 | Model s kostrou, lidské parametry, hlas a vlastní program | mEdit Enemy; mLib Character; engine C_human/C_entity |
| Auto | aktér 4 | Automobilový model a jeho části, vazba aktéra, fyzikální tabulky a inicializace; případný uložený stav má jiné rozložení | mEdit Car; mLib car template; engine car/vehicle |
| Dveře | aktér 6 | Vhodný model/visual, osa či pivot, úhel, směr, otevření/zámek, rychlost, tři zvuky | mEdit Door |
| Skriptový spouštěč / detektor | aktér 5 | Frame, program a prostorový příznak detektoru; samotný skript může sloužit i bez prostorového spouštění | mEdit Detector; mLib Script; MSDR |
| Tramvaj / metro | aktér 8 | Model, počet a vzdálenost vozů, maximální rychlost, trasa a skriptové ovládání | mEdit Railway |
| Doprava | aktér 12 | Sada modelů aut, hustoty a navazující silniční síť | mEdit TrafficManager; mLib Traffic |
| Chodci | aktér 18 | Sada modelů chodců, hustoty a navigační síť | mEdit PedManager; mLib Peds |
| Fyzikální / rozstřelitelný předmět | aktér 35 | Kolizní příznak, hmotnost, tření, zvuk a materiál zásahu; vhodný model/volume | mEdit Physical; mLib Shootable |
| Závodní kamera | aktér 28 | Specializované závodní nastavení; nenahrazuje obecnou kameru | mLib Racecam; katalog DCED |
| Navigační bod a silniční bod/křižovatka | check.bin / road.bin | Body, směrované vazby, délky, ID, pruhy, priority a semafory; podle operace také segmenty | mEdit Create Web Node / Waypoint / Crosspoint |
| Inicializační skript | AE51 | Program mise bez nutnosti modelu nebo nového NPC | DCED Init Script; mEdit Create Script |

Další hodnoty aktérského enumu mEdit: skrytý objekt 1, objekt vily 9, most 20, pes 21, letadlo 22, výhybka/trasa 24, pumpař 25, vagon 30, hodiny 34 a nákladní vůz 36. Jejich názvy v enumu nejsou hotové editory ani dostatečná specifikace pro konstruktor. V DCED se některé názvy liší; musí se porovnat se skutečnými misemi a enginem.

## Zjištěné rozdíly u aut

mEdit `Car.h` pouze určuje typ 4 a dědí prázdný datový writer základního Actor. mLib přidává minimální aktérský blok s jednobajtovým AE24, ne celý uložený stav vozidla. Naproti tomu engine `car_load_data_chunk` čte čtyřbajtovou verzi, komprimovaný záznam a aplikuje CARINIT; modelové fyzikální tabulky načítá jiná cesta (`car_load_model_level_tables`). Tyto cesty se nesmějí zaměnit. Ověřená konstrukce nového auta je popsaná níže; výsledek musí umožnit nastoupit a řídit, nejen zobrazit karoserii.

## Vkládání funkčních aut

Audit 79 místních scén našel 285 aktérů typu 4 s uloženými daty různé délky. Nová auta ale uložený stav nepotřebují. Mission loader kolem řádku 416332 volá načtení AE24 jen tehdy, když blok existuje a má data. Při AE22 už volá Init(frame), přidá aktéra a pozdější GameInit (`car_game_init`, kolem 92340) načte fyzikální úrovně modelu. Nový vlastní writer proto zapisuje AE23 jméno a AE22 typ 4, bez neplatné jednobajtové náhražky uloženého stavu. Původní aktéři a jejich komprimovaná data se zachovávají.

`vehicles.js` čte PC `tables/vehicles.bin` v1: verze, počet, záznamy s délkou payloadu, 32bajtovým názvem, počtem úrovní a jednotlivými délkovanými CARINIT payloady. Samotná fyzika zůstává opaque. Jméno rodiny odpovídá modelovému basename před posledními dvěma číslicemi varianty; porovnání je bez rozlišení velikosti písmen. Čtení místní tabulky ověřilo 89 rodin a přesné vyčerpání souboru. Katalog nabízí modely s jednoznačnými BODY, SEAT0, WHL0/WHR0/WHL1/WHR1 a dostupnými BODYCOL framy, bez lidské kostry. V místní instalaci prošlo 325 variant; dalších 15 kandidátů nesplnilo čtení nebo kontrolu částí. Tyto strukturální kontroly nejsou herním důkazem všech modelů.

Dialog **Přidat auto…** vloží frame a aktéra v jedné historické změně. Kontroluje jedinečné jméno, transformaci, měřítko 1, odpovídající tabulku, části modelu a hash tabulky z otevřeného dialogu. Čtené modely/tabulka se znovu hashově ověřují před publikováním manifestu. Statická kolize se negeneruje; vozidlo používá vlastní dynamické části. Editor fyzikálních úrovní, uloženého stavu a specializovaných parametrů auta zůstává součástí dalšího rozvoje.

V oddělené kopii prázdné mise bylo taxi00 vloženo přes UI. `iscarusable` potvrdilo použitelnost, `human_force_settocar` umístilo hráče za volant a `car_setspeed` rozhýbalo auto s rychloměrem. Druhý test běžného nástupu přes `enemy_move_to_car`/`enemy_usecar` a jízdy `enemy_car_moveto` k cíli skončil HUD 90. UI undo odstranilo přesně celý nově vložený model i aktéra; export scény odpovídal modu a KLZ zůstalo shodné. Ověření proběhlo na taxi00; ruční vstupy řidiče a ostatní varianty nejsou tímto testem doložené.

## Generování kolizí přidaných modelů

Statické KLZ a dynamické kolize aktérů nejsou jedna věc. `tree.klz` má signaturu GifC a pro Mafii verzi 5. Obsahuje tabulku odkazů na framy, prostorovou mřížku, pole kolizních primitiv a buňky s odkazy na tato pole. Přidání objemu bez zahrnutí do správných buněk není funkční kolize.

Podle RoadTrain `klz.bt` a porovnání mEdit jsou dostupné:

| Tvar | Kód | Záznam pro Mafii včetně základní hlavičky | Použití |
|---|---|---|---|
| Trojúhelník | 0–7 | 32 bajtů; tři odkazy vertexBufferIndex/linkIndex, rovina | Přesný povrch podle vhodných vizuálních meshů |
| XTOBB | 0x80 | 184 bajtů | Rozšířený orientovaný objem |
| AABB | 0x81 | 32 bajtů | Box rovnoběžný se světovými osami |
| Koule | 0x82 | 24 bajtů | Střed a poloměr |
| OBB | 0x83 | 160 bajtů | Orientovaný box, extenty, matice i její inverze |
| Válec | 0x84 | 20 bajtů | 2D půdorys a poloměr podle KLZ varianty |

Tvorba v editoru má nabídnout převzetí vhodných volume objektů z modelu, generování přesného povrchu z geometrie, automatický box a ručně nastavitelné primitivum. Přesný povrch nemá zahrnovat skryté pomocné framy, oblohu a ostatní nekolizní plochy. Materiál/příznaky kolize ovlivňují zásahy a další herní chování, proto mají být upravitelné spolu s tvarem.

Závislosti implementace:

1. Parser a writer KLZ musí zachovat původní primitiva, vazby, raw příznaky, padding a případná další data. Bez editace se vrací přesně původní soubor.
2. Generátor musí respektovat celou hierarchii modelu, souřadnice LS3D, světovou pozici, quaternion, měřítko a inverzní matici. Nestačí přenést lokální bounding box.
3. Tabulka jmen musí ukazovat na framy, které hra skutečně načte a které jednoznačně najde. Odkazy na vrcholy vizuálu vyžadují správný mesh a jeho pořadí vrcholů; nestačí libovolný název root modelu. Alternativní cesta 0x7fff používá samostatné světové vrcholy, popsané níže.
4. Změna přepočítá rozsah a indexování mřížky, zařadí primitiva do všech potřebných buněk a správně zapíše relativní odkazy. Zápis buněk je nutné odvodit z loaderu a skutečných souborů, nikoli převzít neověřený writer.
5. Vložení modelu a kolize, posun/rotace/měřítko objektu i odstranění musí uložit scene2.bin a tree.klz jako jednu transakci se společným undo. Soubory původní hry se nemění.
6. 3D mapa potřebuje přepínač kolizí, rozlišení vizuální geometrie od objemů a výběr kolizního materiálu. Ve hře se ověří blokování pohybu i zásahy, poté export a undo.

## Co z referencí nepřebírat bez ověření

mEdit `GenerateGrid` má opakovanou aktualizaci max.y a chybí odpovídající max.x; vypočtené rozměry také nepřiřazuje do grid.width/length. `GenerateCells` v trojúhelnících používá Y místo půdorysného Z a jeho writer pracuje s absolutními pozicemi souboru. Záznam buňky v RoadTrain a jména polí mEdit se rovněž liší. To jsou konkrétní důvody pro vlastní implementaci a porovnání s `collision_load_level`; nejde o požadavek opravovat cizí repozitář.

Loader enginu po načtení pracuje s grid blokem na +0x284, přesouvá vazby do frame/vertex ukazatelů a přestavuje ukazatele jednotlivých polí. Mezi primitivy a buňkami existuje ještě další počet/tabulka na offsetech grid+0x60/+0x64, kterou základní template a mEdit writer nepopisují úplně. Při práci s původními KLZ ji nelze zahodit.

## Reference pro pokračování

- [mEdit nabídky, vytváření aktérů a KLZ čtení/zápis](https://github.com/Richard01CZ/mEdit/blob/6f6f9cb134b6016f1b323b9293b24f41cb4bc5f3/Source/Editors/SceneEditor.cpp): CreateActor kolem 3526, LoadTreeKlz kolem 4360, WriteTreeKlz kolem 5460.
- [mEdit typy aktérů](https://github.com/Richard01CZ/mEdit/blob/6f6f9cb134b6016f1b323b9293b24f41cb4bc5f3/Include/Game/Enums.h), [kolizní mřížka](https://github.com/Richard01CZ/mEdit/blob/6f6f9cb134b6016f1b323b9293b24f41cb4bc5f3/Include/Editors/SceneEditor.h), třídy v `Include/Game/Actors/`.
- [DCED2 katalog objektů a příznak podporovanosti](https://github.com/Richard01CZ/DCED2/blob/d09d611ba1a0bee8646c359b818594457c8ea481/src/objecttypes.cpp), `addobjectdialog.cpp` a `MLWrapper.cpp`.
- [mLib scénové readery a konstruktory](https://github.com/Richard01CZ/mLib/blob/b10cbd136eac074fb6a98d9186a1d01d2a8be084/src/Scene2.cpp), typy v `src/Datablock.h`.
- [RoadTrain KLZ layout](https://github.com/RoadTrain/mafia-formats/blob/13d2ff8b4d58a098438a0b300129d9e7c574e783/klz.bt), typy v `ls3d.bt`.
- [Engine collision, car a human](https://github.com/st0rm94/mafia-reverse-engineering-export/tree/eb4eaabf718bf9a879f1721e9231ff359871fb47/structs); skutečné loadery v uloženém `ghidra/Game-ghidra.exe.annotated.c`.

Implementační pořadí po rozpracovaném vložení NPC: KLZ včetně generování kolizí modelu a propojeného ukládání; řiditelné auto; dveře, světla, zvuky a spouštěče; doprava/chodci a další specializované typy. Katalog výše zachovává celý rozsah a nemění cíl plnohodnotného editoru.

## Ověřený základ vlastního KLZ zápisu

`src/core/collision.js` čte GifC v5: 24bajtovou hlavičku, absolutní tabulku offsetů frame odkazů, grid na offsetu z hlavičky, 104bajtovou pevnou část gridu, X/Z hranice, separátor, pole triangles/AABB/XTOBB/cylinders/OBB/spheres, extra vrcholy, další separátor a buňky. Původní runtime ukazatele v hlavičkách se neinterpretují ani nenulují. Offsety grid+0x60/+0x64 znamenají počet a runtime ukazatel pole extra vrcholů s 12bajtovými XYZ. Pokud první vertex link trojúhelníku má index 0x7fff, loader použije všechny tři uint16 indexy do tohoto pole. Jinak první link určí vizuální vertex buffer s 32bajtovým krokem. Místní KLZ extra vrcholy nemají; tuto větev pokrývá syntetický test, nikoli dosud herní test.

Buňka má 16bajtovou hlavičku, `count` uint32 odkazů, `count` bajtů příznaků a padding na čtyři bajty. Pole +4/+8 jsou loaderem přepsaná na ukazatele odkazů/příznaků; údaj +8 označený některými template jako height není spolehlivý prostorový parametr. **Float32 na +12 je maximální výška kolize v buňce.** Například `collision_test_line_vertical` kolem řádku 302857 porovná dolní Y dotazu s touto výškou ještě před průchodem primitiv. Writer ji musí zvýšit při vložení vyššího boxu, jinak jej hra přeskočí. Při odstranění ji ponechá jako konzervativní horní mez, aby nezúžil rozsah původních primitiv. Horní bajt odkazu je typ pole (trojúhelníky vždy 0), dolních 24 bitů je bajtový offset vůči začátku příslušného pole primitiv. Není to absolutní offset souboru ani offset od gridu. Loader toto potvrzuje kolem řádků 300260–300315.

Pořadí v buňce ovlivňuje dotazy: `collision_box_in_tree_level` a `collision_line_in_tree_level` mohou ukončit průchod při seřazené X hranici trojúhelníku. Objemové reference musí být před touto sekvencí. Všech 208 937 místních buněk obsahujících oba druhy má právě toto pořadí. Vkládané AABB proto předcházejí původním referencím; pořadí těch původních se zachovává.

Core zápis `appendCollisionBoxes` připojí světové AABB a typ-2 frame odkazy. Rozšíří grid pouze o celé původní buňky, zachová původní osy a přesune původní buňky podle X/Z. Nová primitiva zahrne i do obou buněk na přesné společné hranici. Nedotčené buňky zachovávají raw hlavičku, reference, příznaky a padding; dotčené zachovávají runtime bajty +4/+8, původní reference a příznaky, přičemž počet, výška, délka a zarovnání se upraví podle nových primitiv. Při odstranění explicitně určených AABB se přemapují pouze jejich reference a indexy následujících AABB; ostatní pole zůstanou shodná. Tabulka jmen zachovává celý původní blok včetně mezer a paddingu; při růstu offsetové tabulky se přepočtou absolutní offsety. Zachovávají se ostatní pole primitiv, extra vrcholy, separátory a koncová data.

Audit všech 78 místních KLZ vložil box mimo původní grid a ověřil přesné zachování všech původních primitiv a 2 554 880 původních buněk. Unit fixture obsahuje všechny typy, nenulové runtime ukazatele, padding a mezery mezi link záznamy, tail a extra vrcholy. Parser odmítá neplatné rozměry, useknuté bloky a odkazy mimo pole. Zápis má limity 1 000 000 výsledných buněk, 10 000 000 nových referencí a 24bitových offsetů.

## Generované boxy v 3D mapě

`model-collision.js` počítá obal referencovaných vrcholů viditelného LOD 0 v nativních souřadnicích LS3D. Respektuje hierarchii modelu i scény, inverse WXYZ rotaci, měřítko, instance a skryté framy. Reflection Z je jen v rendereru. Pro ploché modely má obal minimální tloušťku 2 cm; animované/skinované modely se odmítnou. AABB vyplní také otvory a mezery, takže pro budovy s interiérem bude třeba přesný povrch nebo více primitiv.

`scene-collision.js` uchovává názvy a SHA-256 generovaných AABB ve společné historické položce projektu. Odstraní pouze jednoznačně nalezené, hashově shodné vlastní záznamy. Přepočítá obal při uložení pozice, rotace, měřítka, rodičovské transformace či názvu. Duplikace získá vlastní box; odstranění objektu/obnovení či náhrada scény odstraní jeho vlastní box. Scene2.bin a KLZ se publikují jedním atomickým nahrazením manifestu; čtené modely a geometrie jsou také chráněné očekávanými hashi. Undo obnovuje oba soubory a předchozí evidenci. Ruční změna evidovaného záznamu přeruší operaci.

UI nabízí volbu boxu při vložení modelu, **Kolize modelu…** pro existující samostatný model, výběr materiálu 0–255 a přepínač generovaných boxů. Pomocné obaly nezasahují do výběru objektů ani rámování kamery. Další tvary, přesný povrch z trojúhelníků, převzetí modelových volume objektů a kompletní editor původních kolizí zůstávají součástí dalšího vývoje.

Herní paprskový test v oddělené prázdné misi vložil model 9BOXSCH a jeho AABB. Stejný program přes `coll_testline` po vložení hlásil zásah; po odstranění boxu přes UI hlásil volný průchod, ačkoli model zůstal ve scéně. Tento příkaz bere druhý vektor jako směr/délku, nikoli koncový bod; MSDR to nerozlišuje, skutečné přičtení k počátku potvrzuje `collision_test_line_vertical` kolem řádku 302790. Export scény/KLZ odpovídal modům a UI undo přesně obnovilo box i jeho evidenci.

Pohybový test použil `enemy_move_to_frame` pro chodce z [-55, 0.01, 0] k cíli [-55, 0.01, 12], s bednou kolem Z=6. Skript průběžně zobrazil 50 + světové Z chodce jako energii hráče. S boxem se chodec zastavil před bednou a HUD zůstal na 54; po odstranění pouze AABB při bajtově shodné scéně prošel a HUD dosáhl 62 u cíle. Tři undo obnovila původní testovací scénu, KLZ i historii. Testy proběhly pouze v nové soukromé kopii projektu; podklady a existující uživatelské projekty se nepřepisovaly.
