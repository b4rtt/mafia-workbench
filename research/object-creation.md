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
| Fyzikální / rozstřelitelný předmět | aktér 35 | Tvar box/kolo, hmotnost, tření, nárazový zvuk a parametr zásahu; vhodný model/volume | mEdit Physical; mLib Shootable |
| Závodní kamera | aktér 28 | Specializované závodní nastavení; nenahrazuje obecnou kameru | mLib Racecam; katalog DCED |
| Navigační bod a silniční bod/křižovatka | check.bin / road.bin | Body, směrované vazby, délky, ID, pruhy, priority a semafory; podle operace také segmenty | mEdit Create Web Node / Waypoint / Crosspoint |
| Inicializační skript | AE51 | Program mise bez nutnosti modelu nebo nového NPC | DCED Init Script; mEdit Create Script |

Další hodnoty aktérského enumu mEdit: skrytý objekt 1, objekt vily 9, most 20, pes 21, letadlo 22, výhybka/trasa 24, pumpař 25, vagon 30, hodiny 34 a nákladní vůz 36. Jejich názvy v enumu nejsou hotové editory ani dostatečná specifikace pro konstruktor. V DCED se některé názvy liší; musí se porovnat se skutečnými misemi a enginem.

## Zjištěné rozdíly u aut

mEdit `Car.h` pouze určuje typ 4 a dědí prázdný datový writer základního Actor. mLib přidává minimální aktérský blok s jednobajtovým AE24, ne celý uložený stav vozidla. Naproti tomu engine `car_load_data_chunk` čte čtyřbajtovou verzi, komprimovaný záznam a aplikuje CARINIT; modelové fyzikální tabulky načítá jiná cesta (`car_load_model_level_tables`). Tyto cesty se nesmějí zaměnit. Ověřená konstrukce nového auta je popsaná níže; výsledek musí umožnit nastoupit a řídit, nejen zobrazit karoserii.

## Vkládání funkčních aut

Audit 79 místních scén našel 285 aktérů typu 4 s uloženými daty různé délky. Nová auta ale uložený stav nepotřebují. Mission loader kolem řádku 416332 volá načtení AE24 jen tehdy, když blok existuje a má data. Při AE22 už volá Init(frame), přidá aktéra a pozdější GameInit (`car_game_init`, kolem 92340) načte fyzikální úrovně modelu. Nový vlastní writer proto zapisuje AE23 jméno a AE22 typ 4, bez neplatné jednobajtové náhražky uloženého stavu. Původní aktéři a jejich komprimovaná data se zachovávají.

`vehicles.js` čte PC `tables/vehicles.bin` v1: verze, počet, záznamy s délkou payloadu, 32bajtovým názvem, počtem úrovní a jednotlivými délkovanými CARINIT payloady. Katalog fyziku neinterpretuje; samostatný editor `vehicle-table.js` nyní čte ověřené parametry. Jméno rodiny odpovídá modelovému basename před posledními dvěma číslicemi varianty; porovnání je bez rozlišení velikosti písmen. Čtení místní tabulky ověřilo 89 rodin a přesné vyčerpání souboru. Katalog nabízí modely s jednoznačnými BODY, SEAT0, WHL0/WHR0/WHL1/WHR1 a dostupnými BODYCOL framy, bez lidské kostry. V místní instalaci prošlo 325 variant; dalších 15 kandidátů nesplnilo čtení nebo kontrolu částí. Tyto strukturální kontroly nejsou herním důkazem všech modelů.

### Editace tabulky fyziky vozidel

Podklady: [komunitní mapa vozidel a popis RHAM/MCVE](https://github.com/st0rm94/mafia-reverse-engineering-export/blob/main/def-files-docs/vehicles-bin.md), [annotovaný engine](https://github.com/st0rm94/mafia-reverse-engineering-export/blob/main/ghidra/Game-ghidra.exe.annotated.c) a [struktura C_Vehicle](https://github.com/st0rm94/mafia-reverse-engineering-export/blob/main/structs/vehicle.md). Čtené lokální snapshoty jsou součástí soukromého katalogu referencí.

Diskový blok má 0x1121 bajtů; runtime S_CARINIT a vektor modelových úrovní mají jiné rozložení a velikost. `car_load_model_level_tables` načítá blok a volá `car_unpack_save_record`. Ten přenáší prvních 20 floatů přímo a přeuspořádává diskové trojice poměr/řazení nahoru/řazení dolů do tří runtime polí. Diskové trojice pro zpátečku a deset převodů začínají na 0x050, krok 12. Počet převodů na 0x04C je také float; `vehicle_apply_carinit_params` jej převádí na celé číslo a přijímá 1–10. Motor převádí RPM na otáčky za sekundu a meze řazení v procentech na rozsah mezi volnoběhem a maximem.

Některé názvy RHAM nesouhlasí s enginem: 0x040 a 0x044 jsou RPM meze porovnávané s 0x048, nikoli přední/zadní přítlak. 0x02C není v tomto editoru označené jako zdraví auta; runtime ho používá ve výpočtu motoru. Pole 0x108–0x110 jsou podíly interpolace těžiště mezi mezemi XYZ, nikoli rotace os. Výkon 0x004 není maximální rychlost. Nejasné jednotky zbývajících koeficientů se neoznačují vymyšlenými fyzikálními jednotkami.

Writer pokrývá 59 floatů: 0x000–0x0D0 a 0x108–0x11C. Celou mezeru 0x0D4–0x104, packed oblast od 0x120, příznaky a zvuky zachovává. Neodvozuje jejich typy ze samotného float dumpu. Neznámé velikosti úrovní zůstávají pouze ke čtení; neplatný float nebrání editaci ostatních konečných polí. Změny lze provést ve více autech a úrovních jedním uložením a jedním undo. Při úpravě RPM se kontroluje související pásmo a při změně počtu/poměrů kladné aktivní převody; nedotčené původní hodnoty se normalizací nepřepisují.

Soukromý audit skutečných dat: 89 aut, 103 úrovní, 14 posílených dvojic a 6 077 konečných polí. Hromadný zápis stejných hodnot je bajtově shodný. Každá úroveň prošla změnou výkonu a objemu nádrže s kontrolou všech nedotčených bajtů a přesným návratem (206 případů). Oddělený projekt prošel save/reopen/export/undo dvou úrovní; původní tabulka i délka historie se přesně obnovily. Formulář byl následně ověřen v Electronu: rodina arrow, výkon běžné úrovně 128,8 → 150 a posílené 300 → 330, zachování draftů při přepínání úrovní, jedna transakce, znovuotevření, byte-local zápis, přesný export a UI undo. Vliv parametrů na jízdní chování ještě není změřený.

Dialog **Přidat auto…** vloží frame a aktéra v jedné historické změně. Kontroluje jedinečné jméno, transformaci, měřítko 1, odpovídající tabulku, části modelu a hash tabulky z otevřeného dialogu. Čtené modely/tabulka se znovu hashově ověřují před publikováním manifestu. Statická kolize se negeneruje; vozidlo používá vlastní dynamické části. Editace zbývajících oblastí fyziky, uloženého stavu a specializovaných parametrů konkrétního auta zůstává součástí dalšího rozvoje.

V oddělené kopii prázdné mise bylo taxi00 vloženo přes UI. `iscarusable` potvrdilo použitelnost, `human_force_settocar` umístilo hráče za volant a `car_setspeed` rozhýbalo auto s rychloměrem. Druhý test běžného nástupu přes `enemy_move_to_car`/`enemy_usecar` a jízdy `enemy_car_moveto` k cíli skončil HUD 90. UI undo odstranilo přesně celý nově vložený model i aktéra; export scény odpovídal modu a KLZ zůstalo shodné. Další oddělená mise WB_VEHICLE_AUDIT ověřila vložení arrow00 přes UI, detail modelu v mapě a nový herní start s hráčem za volantem. Ruční vstupy řidiče a ostatní varianty nejsou těmito testy doložené.

Tlačítko **Fyzika auta…** v horní liště mapy je dostupné pouze pro jednoznačný modelový frame s jediným aktérem typu 4 a dostupnou tabulkou. Používá stejný převod rodiny/varianty jako katalog aut; v tabulce vybere odpovídající rodinu a běžnou úroveň. Návrat do mise používá zapamatovaný pohled a původní výběr. V UI bylo ověřené skrytí bez výběru, přímé otevření arrow, blokování při draftu polohy, zachování draftu fyziky po volbě Zůstat a návrat k detailu WB_CAR. Testovací úpravy tabulky i vložení auta byly přes dvě UI undo přesně vrácené; scéna, KLZ, tabulka a výchozí délka historie zůstaly shodné. Původní projekty i Game.exe zůstaly hashově shodné. Celá sada 271 testů, syntax check a build prošly.

## Nastavení dveří

Audit místní instalace našel 709 aktérů typu 6; všech 709 mělo 70bajtovou konfiguraci s uint32 verzí 8. Ověření všech 7 090 čtených vlastností potvrdilo přesné no-op zápisy. Engine `door_load_data` kolem řádku 114226 rozlišuje verze 5–8 a čte verzi jako DWORD. První čtyři bajty v mEdit `unk1` tedy nejsou libovolný parametr. Konstruktory mLib skládají tutéž verzi z bajtu 8 a tří nul. Starší verze zatím zůstávají opaque.

V8 layout: verze na 0; pomocný příznak na 4; otevírání podle strany postavy na 5; obrácený směr na 6; float úhel na 7; start-open na 11; zámek na 12; float rychlosti na 13 a 17; tři 16bajtové NUL-terminated názvy zvuků od 21, 37 a 53; další příznak závěsu na 69. Engine `door_ai` přičítá uplynulé milisekundy krát uloženou rychlost. Editor proto zobrazuje úhel v stupních a rychlosti v stupních za sekundu, přičemž soubor dál obsahuje radiány a radiány/ms. `door_game_init` vytvoří dynamickou kolizi a vyřeší závěs a propojená křídla. Samotný nový model s aktérem není dostatečnou specifikací správných dveří.

Vlastní `doors.js` nabízí deset ověřených polí. Boolean zapisuje jen jeden bajt, float jen čtyři, zvuk jen nové znaky a NUL; zbytek původního 16bajtového pole se zachovává. Verze, pomocné příznaky a tail nejsou přestavované. Názvy musí být zapsatelné do Windows-1250 a vejít se do 15 bajtů plus NUL. Parser odmítne interpretaci neúplné hlavičky, jiné verze, nekanonického booleanu, nekonečného floatu nebo názvu bez NUL. Původní byte 4 a 69 se nemění; jejich přepínače vyžadují samostatné ověření dopadu na kolizi, použitelnost a závěs.

UI používá checkbox, číslo a text místo psaní JSON. Nastavení patří pod existující aktér a při jednoznačném odkazu také pod odpovídající frame. „Vytvořit dveře…“ připojí novou konfiguraci ke křídlu vybranému ve 3D mapě. Vlastní závěs, propojená křídla a preview pohybu zůstávají dalšími částmi stejného rozsahu editoru.

Ověření přes Electron v oddělené kopii MISE01 přepnulo počáteční otevření dvere_frontX. Soubor měl jediný změněný bajt 0→1; export byl přesný. Skript v soukromé kopii zavolal `door_getstate` a zobrazil jeho výsledek + 50 jako energii hráče: při zapnutí HUD 50, po UI undo HUD 51. Výsledek potvrzuje stavy 0/1 po GameInit, nikoli ruční interakci hráče nebo všechny parametry dveří. Jednotkové testy pokrývají všech deset polí, převody jednotek, odmítnutí vadných dat, lokálnost zápisu, zachování paddingu/tail, skupiny aktéra, export a undo.

## Vytváření dveří

mEdit `SceneEditor::CreateActor` dovoluje ACTOR_DOOR na FRAME_MODEL (9) i FRAME_VISUAL (1) a odmítá frame s existujícím aktérem. Vlastní operace `attach-door` proto připne AE21 s názvem vybraného framu, typem 6 a novou 70bajtovou konfigurací v8. Transformace, geometrie, ostatní aktéři a neznámé chunky zůstanou zachované. Odkaz musí být jednoznačný bez ohledu na velikost písmen; samostatný model musí obsahovat statickou geometrii bez kostry či morfování. Původní vizuální díl podporuje standardní/singlemesh typ. Vnořené díly samostatně načteného modelu zatím UI nenabízí, protože jejich lokální názvy nelze vždy jednoznačně navázat v celé misi.

Nový aktér má pomocné bajty 4 a 69 nulové. `door_game_init` kolem řádku 113494 odvozuje závěs z lokálního obalu framu, upravuje pivot a vytváří pohyblivou kolizi; nenulový bajt 4 mění registraci kolize a použitelnost a bajt 69 ovlivňuje umístění závěsu. Výchozí hodnoty editoru jsou 90° a 90°/s, zavřeno, odemčeno, otevírání od postavy na obě strany a dřevěné zvuky. Dialog dovoluje jejich změnu. Vybrání celé budovy místo křídla by roztočilo celý vybraný frame.

Generovaný statický AABB editoru na vybraném modelu se odstraní ve stejné transakci jako přidání aktéra, aby otevřené křídlo neblokoval původní pevný box. Undo obnoví scénu, KLZ i vlastnictví boxu. Původní importované kolize se nemění; jejich ruční úprava může být u původní mapy nutná. Transakce hlídá hash scény, geometrie, samostatného modelu a KLZ. Testy ověřují odmítnutí duplicitních aktérů, nejednoznačných nebo nepodporovaných framů a zastaralé kolize, zachování původních dat a přesné undo.

Datový audit v oddělené kopii testovací mise WB_NAV_ENGINE použil model FMVdoor04d.4ds vložený z Electronu jako WB_DOOR s generovaným AABB. Připojení dveří přes projektové API vytvořilo všech deset parametrů, zachovalo objekt beze změn a odstranilo pouze jeho box; jiný generovaný box zůstal. Export scény a KLZ byl bajtově přesný, stejně jako undo. Mac se během UI ověření zamkl, takže vytvoření aktéra přes nový dialog a jeho otevření/zavření ve hře ještě čeká na ověření. Tento datový audit není potvrzením ruční interakce nebo pohyblivé kolize ve hře.

## Vkládání světel

`I3D_light.h` v mEdit definuje typy 1–8: point, spot, directional, ambient, fog, point ambient, point fog a layered fog. `SceneEditor.cpp` kolem 5192 zapisuje samostatný frame typu 2 a CT_MODIFY_LIGHT (0x4040): typ 0x4041, barvu 0x26, intenzitu 0x4042, kužel 0x4043, dosah 0x4044, režim 0x4045 a opakované odkazy na sektory 0x4046. mLib `Scene2.cpp` kolem 3537 a b4rtt `packages/core/src/scene/scene-bin.ts` potvrzují pořadí vnitřní/vnější hodnoty. Engine loader kolem 415492 přijímá tento blok jen pro frame typu 2, čte kužel jako dva floaty a opravuje příliš malý near či far ≤ near. Nový writer místo spoléhání na opravu odmítá takový dosah před uložením.

Audit 79 původních scene2.bin našel 9 095 světelných bloků: 7 695 bodových, 811 reflektorů, 163 směrových, 333 okolních, 92 mlh a jeden null typ. Typy 6–8 jsou potvrzené referenčním API, nikoli výskytem v této instalaci. Výchozí režim 99 se vyskytuje také u 315 bodových světel a 20 reflektorů; maska zůstává číselná, neověřené významy bitů se nepřekládají. Hra při načítání starých verzí některé bity doplňuje. `I3D_light::GetRange` rozlišuje zvláštní škálování fog/point ambient/point fog; dialog jejich dosah označuje jako herní jednotky a nevydává jej za univerzální metry.

`add-light` vytváří nový frame s polohou, jednotkovým quaternionem, měřítkem 1 a rodičem Primary sector. Dialog dovoluje výběr více sektorů z obou hlavních sektorů a jednoznačných framů typu 5. RGB má rozsah 0–1, intenzita je nezáporná, úhly se zadávají ve stupních a serializují do radiánů. Směrové světlo a reflektor používají orientaci lokální +Z. Režim je uint32. Neznámé parametry, chybějící/duplicitní sektory, nejednoznačný název, neplatné transformace a hodnoty se odmítnou. Geometrie se při transakci kontroluje hashem. Světla se nepřidávají do AE20 ani KLZ; původní chunky zůstávají raw. Samostatné světlo lze duplikovat a odstranit při stejných kontrolách vazeb jako jiné samostatné objekty.

Testy pro všech osm typů kontrolují přesná pole, opakované sektory, pořadí vnitřní/vnější hodnoty, no-op zápis, zachování původních dat, duplikaci a odstranění. Projektový test pokrývá zastaralý hash, změnu intenzity, reopen, přesný export a undo. Datový audit skutečné soukromé WB_NAV_ENGINE vložil a vrátil všech osm typů: všechna původní pole a objekty zůstala shodná, KLZ se nezměnilo a historie i scéna se přesně obnovily. Mac je zamčený, takže ověření nového dialogu a herního účinku ještě zbývá. Náhled zatím zůstává studiový; simulace světel, sektorového působení, mlhy a vypalování lightmap jsou další požadované části editoru.

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

## Prostorové zvuky

Zdroje: [mEdit I3D_sound](https://github.com/Richard01CZ/mEdit/blob/master/Vendors/LS3D/Include/I3D/I3D_sound.h), místní `SceneEditor.cpp` (CreateSound, editor a reader CT_MODIFY_SOUND), `mEdit/Include/IO/Chunk.h`, uložený `b4rtt/mafia-editor` scene-bin.ts a Game-ghidra.exe.annotated.c v referenčním exportu. Engine v části `case 0x4060` dočasně volá SetOn(false) a SetLoop(false); konec `LAB_00602ea5` zvuk zapíná. CT_SOUND_ENABLE 0x4067 při čtení neprokazuje samostatný přepínač aktivace; nevytváříme jej. CT_HIDDEN může na úrovni framu zvuk vypnout, nový frame jej nemá.

Samostatný frame 4 má obvyklý název, rodiče a transformaci. Vnořený 0x4060 obsahuje název WAV relativně ke složce Sounds (0x10), uint32 typ (0x4061), float volume (0x4062), float outVolume (0x4063), dva floaty kužele v radiánech (0x4064), čtyři floaty `[innerRadius, outerRadius, innerFalloff, outerFalloff]` (0x4068), prázdný přítomnostní LOOP (0x4066) a opakované názvy sektorů (0xb200). Nový objekt nemá herního aktéra ani KLZ kolizi. Ostatní vnořené bloky, včetně 0x4065, 0x4067, streaming 0x4069 a dalších neověřených parametrů, zůstávají při editaci opaque. Writer mEdit část známých polí neukládá (cone/outVolume), proto není jeho výstup kopírovaný jako kompletní specifikace.

Enum nabízí point 1, spot 2, ambient 3, volume 4 a pointambient 5. Místní audit našel 4 null zvuky, 4 356 point, 620 spot a 275 ambient; absence typu 4/5 neprokazuje podporu ani nepodporu v runtime. Hra má ve zvukové tabulce vlastní odlišný enum a její odmítnutí volume se nesmí bez dalšího přenést na loader scene2.bin. UI u 4/5 označuje chybějící ověření. Konstruktor kontroluje WAV hlavičku a zdroj v projektu, jednotkovou rotaci, konečné hodnoty, rozsahy nového zvuku a jednoznačné sektory. Vektor dosahu se v inspektoru čte celý; starší osmibajtový zápis se dál čte jako dvojice. Existující hodnoty se nemění podle výchozích hodnot nového objektu.

LOOP se upravuje vložením/odebráním známého chunku, nikoli přepisem ostatních příznaků. Proto se při hromadném uložení pole zapisují před LOOP: odebrání chunku může posunout číselná ID následných polí. Bez této závislosti by změna dosahu a opakování podle pořadí výběru mohla upravit špatný záznam. Projektová historie obnoví původní pořadí a bajty při undo. Datový audit, export a testy jsou v README; ověření nového dialogu a hry ještě zbývá.

### Náhled dosahů zvuků

`src/ui/sound-extent.js` čte pole výhradně z jediného zvukového bloku vybraného framu a používá rozepsané hodnoty. Bodový typ 1 a bodový okolní 5 kreslí poloměry; u 5 je nadále výslovně neověřený účinek ve hře. Směrový typ 2 kreslí hranice plných úhlů kolem +Z a radiální vzdálenosti, včetně apertur nad 180 stupňů a 360stupňové sféry. Geometrická interpretace úhlů vychází z [DirectSound SetConeAngles](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/ee417984(v=vs.85)) (360 je plná sféra); vazba těchto parametrů LS3D na tento geometrický náhled je odvození, nikoli nový poslechový test enginu. Prázdný či široký kužel nesmí vytvořit plochý konec v nesprávné vzdálenosti. Referenční mEdit DrawWireframeCone používá pomocný poloměr z úhlu a pevnou výšku 16, takže jeho vizualizace nebyla převzata jako akusticky přesná hranice.

Helper je mimo root mapy a kopíruje world matrix zdroje, včetně převrácení Z a rodičovských transformací. Při gizmu a změně vlastností se aktualizuje. Skrytí framu/rodiče nebo backdropu skryje i jeho dosah. Běžné výběry a zarámování jej ignorují; pouze výslovné „Zarámovat dosah“ používá jeho geometrii. Přepínač se obnoví s kamerou po uložení. Změna výběru uvolní předchozí geometrie/materialy. Neplatné, chybějící či duplicitní parametry se neinterpretují odhadem. Helper nic nezapisuje do projektu a neřeší směšování, sektorové tlumení ani viditelnost misí v herním enginu.

## Skriptové body a detektory

Primární zdroje: mEdit `Actors/Detector.h` a `CreateActor(ACTOR_DETECTOR)`, mLib `Scene2.cpp` scriptdata a lokální reverse-engineering `structs/detector.md`, `detector_load_data` a `detector_program_process`; syntaxe porovnaná s dodaným MSDR CZ. Aktér 5 má v1 byte, uint32 masku typů postav od offsetu 1 a C_program v1 od offsetu 5. S podporovaným prázdným prvním stringem je uint32 délka zdroje na 10 a kód od 14. U změny masky se přepíší pouze čtyři bajty; úprava zdroje ponechá prefix i tail. Neznámé verze/názvy programu se neinterpretují.

mEdit nazývá masku „Enable spatial detector“, ale engine ji používá jako bitový průnik s human_type: 1 hráč, 4 policie, 16 gangsteři, 128 pasažér taxi. `detector_inrange` vrací počet odpovídajících aktérů v přísně menší vzdálenosti než zadaný poloměr kolem world pozice frame. Maska 0 tak vrací nulový počet, nezakazuje však program. Význam dalších bitů neodhadujeme; raw uint32 se zachová. Staré omezení parseru na hodnoty 0/1 bránilo úpravám programů s kombinovanými maskami, proto je v rámci stejné funkce odstraněné.

`add-detector` vytvoří frame 6 (dummy) se jménem, XYZ, identitou rotace/měřítka a rodičem Primary sector a připojí nový aktér v pořadí AE23, AE22, AE24. Kontroluje unikátní jméno v objektech, aktérech i geometrii, konečnou float32 pozici, masku uint32 a Windows-1250 zdroj do 1 MB. Aktér a bod se publikují společně s jedním undo a kontrolou závislé geometrie. Nepřidává se statická KLZ ani externí model.

Dialog nabízí vlastní program nebo jednorázovou šablonu přiblížení: dim_flt 1, smyčka detector_inrange / if / wait 100 / goto a zadaná akce následovaná end. Šablona rezervuje flt[0] a label 10/20; při konfliktních labelech se vstup odmítne. Celý výsledný zdroj je v dialogu k náhledu. Poloměr se ukládá do programu, není vydáván za samostatné binární pole detektoru. Pro použití/zásah engine dále vytváří using object a dynamické objemy DYNB či bounding volume modelu; samotný dummy je tímto editorem zatím nabízen pro radius/vlastní program, nikoli jako ověřený boxový spouštěč pro střelbu. Nový dialog a akce v runtime čekají na odemčení Macu.

## Nastavení fyzikálních předmětů

Primární podklady: uložený [mEdit Physical.h](https://github.com/Richard01CZ/mEdit/blob/master/Include/Game/Actors/Physical.h), mLib `Scene2.cpp` SHOOTABLE a referenční export `structs/box_new.md`, `structs/physical_object.md`, `box_new_load_data`, `box_new_game_init` a `physical_object_init_box`. Aktér 35 odpovídá C_box_new (0x23). Všechny místní konfigurace mají verzi 2 a 31 bajtů; starší verze 0/1 zatím nejsou novým editorem interpretované.

Serializace je packed, nikoli C++ sizeof(PhysicalData): version byte na 0, is_box byte na 1, wheel_radius float na 2, neověřený wheel_param float na 6, mass float na 10, friction float na 14, wheel damping float na 18, int32 impact-sound column na 22, restart-sound bool na 26 a int32 hit parameter na 27. Místní hodnoty posledního parametru zahrnují i 95 a −1; nepřevádíme jej na enum Material jen podle jména v mEdit. Sloupec zvuku je skutečně index 0–13 v tabulce povrchových materiálů, ne přímý WAV ani obecné ID zvukové tabulky; −1 je ticho.

mEdit označuje is_box jako „Collide“, ale GameInit větev pro nenulový byte volá InitBox, nula volá InitWheel. Inspektor proto používá checkbox „Fyzikální box (vypnuto = kolo)“. Radius, wheel_param a damping se při boxovém režimu neaplikují. Box používá rozměry bounding volume modelu; tento editor existujících parametrů nevytváří statické KLZ kolize. Engine při načítání konfigurace omezí hmotnost na 0.01–100000; nové hodnoty zapisujeme v tomtéž rozsahu. Init odvozuje počáteční hmotnost z objemu modelu, LoadData ji však následně může přepsat uloženou hodnotou.

Vlastní inspector/writer nabízí osm polí, neověřený wheel_param zůstává opaque. U bool změny se přepíše jeden byte, u čísla čtyři; verze, ostatní parametry a tail se nemění. Nepodporované či neúplné hlavičky, nekonečné rozpoznané floaty a nekanonické boolean hodnoty se neinterpretují. Nezměněné původní číselné hodnoty se zachovávají i mimo rozsah nového vstupu. UI změny patří pod jednoznačný actor frame a používají standardní zálohy, export a undo. Interakce, nárazové zvuky a box/kolo v runtime zůstávají součástí stejného nedokončeného rozsahu.

### Vytvoření fyzikálního aktéra

`attach-physical` odpovídá mEdit CreateActor(ACTOR_PHYSICAL): vyžaduje modelový frame (9), nikoli vizuální křídlo nebo sektor. Připojuje se k jednoznačnému samostatnému modelu scene2.bin s externím statickým 4DS a bez aktéra. Skin, kostra, morph/billboard a model bez povrchu se odmítají. Existující frame, ostatní aktéři, skripty a opaque chunky zůstávají zachované. Před publikací se kontroluje hash modelu a geometrie stejně jako scény.

Nová packed konfigurace v2 má 31 bajtů. Výchozí box, radius 1, wheel_param 1, hmotnost 10, tření 0.5 a damping 0.01 vycházejí z `box_new_init`; explicitně uložená hmotnost se nepovažuje za automatický výpočet z objemu. Zvuk i hit parameter −1 a restartSound = 1 vycházejí z `physical_object_ctor` (+0x308/+0x30c/+0x338). Nový writer použije nejprve platné výchozí hodnoty a pak striktně ověří vstup, takže no-op zachování starých hodnot neumožňuje vytvořit nový aktér s nulovou hmotností či poloměrem. Wheel_param má ověřenou počáteční hodnotu, jeho další význam se neodhaduje.

Pokud vybraný model vlastní námi generovaný AABB, připojení aktéra jej odstraní v jediné atomické změně spolu se scene2.bin a evidencí vlastnictví. Boxy jiných objektů a původní kolize KLZ zůstanou zachované. Undo obnoví všechny části. Pohyblivou kolizi pak sestavuje GameInit fyzikálního aktéra; nevytváří se druhý statický box. Dialog nabízí všech osm parametrů a v boxovém režimu vypne vstup radius/damping. Zápis, export a přesné undo jsou ověřené na skutečných modelech i syntetických datech; dialog a pohyb v herním runtime čekají na odemčení Macu.

## Přesný povrch statického modelu

`collision-surfaces.js` doplňuje trojúhelníky v KLZ v5 s vlastními světovými vrcholy. První vertex-link 0x7fff přepne loader na extra pool (počet grid+0x60, 12 bajtů na vrchol); pro vlastní záznamy se tato hodnota používá ve všech třech odkazech. Vrcholové indexy jsou uint16, tedy nejvýše 65 536 vrcholů dohromady. Do buněk jde typ 0 s relativním byte offsetem v poli trojúhelníků, nikoli skutečný klasifikační byte 1–7. Buněčné max.y na +12 se zvyšuje pro přidané plochy. Nezměněné buňky, původní primitiva, odkazy a opaque data se zachovávají.

Primární důkaz je uložený `Game-ghidra.exe.annotated.c` z [reverse engineering exportu](https://github.com/st0rm94/mafia-reverse-engineering-export): `collision_load_level` kolem 299964, `collision_classify_static_primitives` kolem 299859, `collision_line_in_tree_level` kolem 302598 a `collision_sphere_in_tree_level` kolem 308189. Normála odpovídá GetNormal(v0,v2,v1), rovina má d=-dot(n,v0). Po seřazení vrcholů podle X musí nejnižší bit sortInfo sledovat paritu permutace. Zápis opačné roviny s opačným bitem vytvoří druhou stranu. Classify zvolí dominantní normálovou osu a první hranu s epsilon 0.0001; testy kontrolují všech sedm větví i barycentrické vzorce z line query.

Line i sphere query mohou skončit předčasně podle X prvního vrcholu. Přidané odkazy se proto slučují s původními podle světového X prvního vrcholu; objemy jsou před trojúhelníky. Původní vrcholy ani roviny se nepřestavují. Některé originální modelové vrcholy mají drobné rozdíly X po transformaci; pořadí jejich odkazů se vyhodnocuje podle skutečného prvního vrcholu stejně jako v enginu. Není odůvodněné opravovat jejich původní data.

Původní KLZ používá i názvy částí externích modelů (zboren27.Box01 v MISE02-ULICKA). Resolver doplní hierarchii původního modelu s prefixed názvy, zohlední změny scene2.bin a hashově ochrání čtený model v transakci. Neřešitelný frame zápis zastaví; jeho kolize se nesmí zahodit ani nechat neověřeně za novými plochami.

Vlastnictví povrchu ukládá rozsah trojúhelníků, výhradní suffix vrcholů, oboustrannost a hash obou bloků do stejné historie jako scene/KLZ. Při přepočtu se vlastní suffix znovu využije a ostatní odkazy přemapují; cizí povrch odkazující do vlastních vrcholů nebo překrývající se evidence změnu zablokuje. Duplikace, přejmenování, odstranění, změna na AABB a přidání dynamického aktéra jsou společné vratné operace. Původní geometrie modelu se neupravuje.

Generátor respektuje povolené framy a viditelné povrchy LOD 0. Ignoruje RF_HIDEMESH a pomocné SECT plochy, zachovává viditelné potomky. Animované modely se odmítají; degenerované plochy s nulovým či nepatrným obsahem se vynechají. Průhlednost textury sama netvoří otvor v kolizní geometrii. Volitelné převzetí modelových volume primitiv a ruční tvorba OBB/koulí/válců zůstávají součástí dalšího rozvoje.

Audit všech šesti kombinací bedny 9BOXSCH, dveří FMVdoor04d a domu #rad022 ve WB_NAV_ENGINE a MISE02-ULICKA ověřil původní záznamy, transformaci bez růstu poolu, export, reopen a přesné undo do výchozí historie. Nový dialog, kolizní povrch v herním runtime a jeho kontakt s pohybující se postavou ještě čekají na odemčení Macu.


## Předměty k sebrání: zbraně, klíče a dokumenty

Zdroje: [program.md](https://github.com/st0rm94/mafia-reverse-engineering-export/blob/main/structs/program.md), [using_object.md](https://github.com/st0rm94/mafia-reverse-engineering-export/blob/main/structs/using_object.md), [detector.md](https://github.com/st0rm94/mafia-reverse-engineering-export/blob/main/structs/detector.md) a [drop_in_weapon.md](https://github.com/st0rm94/mafia-reverse-engineering-export/blob/main/structs/drop_in_weapon.md). Místní export `Game-ghidra.exe.annotated.c`: `detector_init` na řádku 107021 a opcode 0x57 `createweaponfromframe` kolem řádků 352485–352580. MSDR má v popisu posunutá písmena argumentů; skutečný první argument je index registru framu, druhý ID předmětu, třetí zásobník a čtvrtý zásoba.

Příkaz přijímá frame typu 9 a kladné ID předmětu, které ukládá jako uint16. Vytvoří kopii modelu s jeho transformací a rodičem, připojí ji ke kořeni se zachováním světové transformace a zaregistruje `S_using_object` o 56 bajtech. Poloha akce je světová poloha kopie + [0,1,0], poloměr 0,5 a typ 3. Do záznamu se ukládá ID, dva int32 počty munice, kopie framu a nejbližší sektor mezi předky. Původní frame se skryje a odpojí. Záznam má nulového vlastníka; jde o položku nabídky akcí, ne o nově vytvořený aktér `C_drop_in_weapon`. Na PC se používá tlačítko akce, automatické sebrání PS2 není přenositelné pravidlo.

`C_drop_in_weapon` (typ 37) vzniká za běhu; jeho SaveData/LoadData jsou prázdné. Samotné přidání AE22=37 a AE24 tedy předmět s ID a municí spolehlivě neinicializuje. Editor místo toho vytváří frame 9 a detektor 5: pořadí AE23, AE22, AE24, verze detektoru 1, maska 0, C_program 1 a vlastní jednorázový program s `dim_frm`, `findframe`, `createweaponfromframe` a `end`. `detector_init` se opírá o obecné `actor_init` a nevyžaduje dummy frame. Maska vybírá postavy pouze pro detector_inrange, nevypíná běh programu.

Katalog používá indexy existujících 188bajtových záznamů predmety.def a jejich modelové názvy; neodvozuje ID z pořadí filtrovaného seznamu. Vylučuje ID 0, prázdné či chybějící modely, neplatné cesty a nepodporovanou animovanou geometrii. Modelové názvy jsou case insensitive, rozlišují se ale jednotlivá ID (např. běžný a tichý Thompson se stejným modelem). Místní tabulka má 35 záznamů; katalog našel 33 podporovaných položek ID 2–34, žádný neprázdný model neodmítl. Náboje mají rozsah nezáporného int32; jejich účinek závisí na třídě předmětu, u nepalných předmětů UI doporučuje nulu.

Vlastní script marker slouží pouze editoru a je komentářem nativního programu. Automatické řízení dovolujeme jen při přesné shodě celého programu, masky, délky dat a tří známých chunků aktéra bez dalších opaque bajtů. Přejmenování aktualizuje frame, jméno aktéra i findframe; konfigurace mění ID/model a počty munice společně. Duplicitní jména, geometrické názvy mise, potomci a cizí skriptové odkazy jsou chráněné. Po úpravě vlastního kódu nebo masky se automatické kopírování, nastavení a odstranění navázaného aktéra zakáže. Originální skripty se nepřepisují. Operace mají běžné exporty, společnou zálohu a undo; hash tabulky a modelu chrání otevřený dialog před souběžnou změnou. KLZ se kvůli pickupům nevytváří.

Herní inicializace přes nově vytvořený detektor a sebrání hráčem ještě vyžadují ověření v runtime; samotná shoda s loaderem a roundtrip dat nejsou důkazem tohoto výsledku.

### Značky objektů a interaktivní náhled světel

Zvukové framy typu 4, světla typu 2 a skriptové body typu 6 bez modelu používají značky reproduktoru, žárovky a kódu. Billboard zůstává natočený ke kameře a při přiblížení se nezvětšuje; sdílí materiál i texturu v rámci viewportu. Výběr a transformace patří původnímu framu. Chybějící odkazovaný model si zachovává oranžovou značku.

`light-preview.js` čte jediný světelný blok vybraného framu podle ID a bere rozepsané hodnoty. Bodové světlo ukazuje poloměry, reflektor kužely kolem lokální +Z, směrové světlo šipku a okolní světlo orientační celkové osvětlení. Náhled vybraného světla nahrazuje studiové osvětlení; vypnutí nebo přechod na jiný typ objektu jej obnoví. Hranice ani target nejsou součástí vybírané geometrie a nerozšiřují zarámování celé mapy. Volbu lze vypnout přes Zobrazení / Náhled světla a hranice zarámovat. Parametry i gizmo se projevují živě; stav přepínače a kamera se zachovají při uložení.

Geometrie kuželu používá plnou aperturu a radiální dosah; Three SpotLight používá polovinu vnějšího úhlu. Interpretace je odvozená podle rozhraní LS3D SetCone a [Direct3D světel](https://learn.microsoft.com/en-us/windows/win32/direct3d9/light-types), nikoli nové měření enginu. Sektory, režim, stíny a vlastní útlum LS3D se zde nesimulují; účinek je výslovně označený jako orientační. Typy mlhy a bodového okolního světla nemají tento náhled.

Ověření: testy nezáměnnosti bloků, draftů a neplatných hodnot, hranic kuželu a +Z cíle, světla v reflektované hierarchii, pohybu a viditelnosti rodiče, zachování rámování a uvolnění zdrojů. V izolovaném UI projektu ověřena značka zvuku, kompaktní žárovka, změna intenzity, směrová šipka, zarámování a přepínač náhledu. Herní soubory tento náhled nemění.
