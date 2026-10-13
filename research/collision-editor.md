# Samostatný editor původních kolizí

Stav 13. října 2026: obecný KLZ writer, projektové transakce a samostatný 3D editor jsou implementované. V okně ověřený výběr původního boxu, posun manipulátorem, materiál, duplikace/odstranění, vložení koule, uložení a undo. Ve hře ověřené paprskové dotazy na všech šest nových typů, přesun na nové souřadnice, odstranění a undo. Nepodporovaná původní data se zachovávají a označují. Celý komplexní editor není dokončený.

## Doložené rozložení a význam

Primární reference: [RoadTrain / klz.bt](https://github.com/RoadTrain/mafia-formats/blob/master/klz.bt), [popis kolizí enginu](https://github.com/st0rm94/mafia-reverse-engineering-export/blob/main/structs/collision.md) a místní export anotovaných funkcí `collision_load_level`, `collision_classify_static_primitives`, `collision_line_in_primitive_volume` a `collision_box_in_primitive_volume`. Formátové template je nutné porovnávat s loaderem: starší template nepokrývá světový vertex pool a nesprávně popisuje některé bajty hlavičky buňky.

GifC v5 má šest polí. V souboru jsou v pořadí trojúhelníky (32 B), AABB (32 B, 0x81), XTOBB (184 B, 0x80), válce (20 B, 0x84), OBB (160 B, 0x83), koule (24 B, 0x82). Typ reference trojúhelníku v buňce je 0; jeho vlastní první byte je klasifikace 1–7. Buňka ukládá type v horních osmi bitech a byte offset vzhledem k příslušnému poli v dolních 24. Po referencích následují jednotlivé příznaky a čtyřbajtové zarovnání. Maximální kolizní výška je float na +12 hlavičky buňky; +4 a +8 se zachovávají jako opaque runtime pointery.

| Pole | Editovaná geometrie | Pravidla |
| --- | --- | --- |
| triangles | tři světové XYZ | Původní povrch se řeší přes první link a LOD 0 příslušného framu; 0x7fff znamená světový pool. Ostatní link bity loader při výběru vertex bufferu nepoužívá. |
| aabbs | světové minimum/maximum | Tři kladné rozměry. |
| xtobbs | místní minimum/maximum a matice | Přepočítává se inverze i světový AABB pro předběžný test. |
| obbs | místní minimum/maximum a matice | Nativní test je obdélník na místní Y=0 omezený X/Z, nikoli plný objem. Původní uložené Y rozsahy se zachovávají. |
| spheres | světový střed XYZ a poloměr | Kladný reprezentovatelný poloměr. |
| cylinders | světový střed XZ a poloměr | Výška/Y ve formátu není; dotazy enginu testují nekonečný svislý válec. Omezený válec by vyžadoval jiný typ geometrie. |

Matice má 16 floatů, translaci na indexech 12–14 a afinní poslední složky 0/0/0/1. Zápis prostorových změn vyžaduje bezpečnou inverzi a konečné float32 hodnoty. Převrácení Z patří jen do náhledu, soubor zůstává v LS3D souřadnicích. Materiál i byte `flags` přijímají 0–255; význam všech bitů tohoto byte není ověřený, proto jej nelze prezentovat jako obecný přepínač viditelnosti nebo kolize.

## Pravidla zápisu

`editCollision(bytes, operations, {resolveFrame})` přijímá operace edit/add/delete s polem, indexem existujícího záznamu a rozpoznanými vlastnostmi. Vrací nové bajty, mapy původních indexů pro projektovou evidenci a ID přidaných záznamů. Editace drží pořadí polí, odstranění přemapuje relativní reference. Nové objemy vyžadují existující index linku; názvy chybějících framů se neodhadují. Projektová vrstva musí před vložením ověřit dostupnost konkrétního framu a chránit přečtené závislosti hashem.

Materiál/příznaky se zapisují lokálně bez řešení vertex bufferu, změny normály nebo mřížky. Změna geometrie trojúhelníku zachová orientaci podle původní winding parity i při rotaci přes 90°. Přepočítá rovinu, klasifikaci a X pořadí; příkaz reverse otočí normálu. Frame-backed vrcholy se při prostorové editaci oddělí do světového poolu, aniž by měnily vizuální model. Exkluzivní světové vrcholy lze použít znovu; sdílené se oddělí, takže ostatní plochy zůstanou shodné. Nepoužívané původní vrcholy se automaticky neodstraňují.

Prostorová změna odebere staré vazby vybraného primitiva, vloží nové včetně sousedních buněk při dotyku hranice a podle potřeby rozšíří mřížku o celé původní buňky. Objemy jsou před trojúhelníky; v dotčených buňkách s novým povrchem se trojúhelníky seřadí podle minima X, protože engine může dotaz ukončit předčasně. Příznak reference se v původně pokryté buňce zachová. Výškové boundy se zvyšují konzervativně; u nekonečného válce se použije nejvyšší konečný float32. Neklesají po odstranění, což zachovává bezpečný předběžný test původních kolizí. Neměněné buňky a ostatní záznamy, pointery, link gaps, padding, separátory i konec souboru se zachovávají.

Generátor povrchů nyní umí odstranit konkrétní vlastněné vertex rozsahy místo požadavku na souvislý suffix. To je nutné, aby ručně přidaná kolize mohla následovat automatické kolize modelů a přežila jejich další regeneraci. Cizí vrcholy zůstávají a jejich indexy se přemapují. Pokud vlastněný vertex používá jiný neodstraňovaný povrch, zápis se odmítne. Evidence vlastníků se nadále ukládá ve stejném kroku historie jako scéna a KLZ.

## Ověření a zbývající práce

Soukromý datový audit nad místním projektem Mafia-CZ přečetl 77 mission/tree.klz: 1 561 715 trojúhelníků, 56 131 AABB, 117 041 XTOBB, 59 828 válců, 116 216 OBB a 250 koulí. Po opravě čtení instancovaných billboardů prošlo 1 325 operací: exact no-op, byte-local materiálové změny každého dostupného pole, prostorové změny reprezentativních objemů, mazání s přemapováním a jedna prostorová změna původního trojúhelníku ve všech 77 misích. Ověřily se nepřepsané záznamy, reference, pořadí, extra vrcholy, tail a nezměněné zdrojové hashe. Audit zapisoval výsledné KLZ pouze v paměti, herní data se neměnila.

Tři původní XTOBB `bar_nosniky02` v MISE02-SALIERY, MISE03-SALIERY a MISE03-SALIERYKONEC mají nulovou řadu matice, nulový místní Y rozměr a identitní uloženou inverzi. Jejich metadata/mazání se ověřily; prostorová změna tohoto neplatného tvaru se odmítá bez publikace. Další platný XTOBB ve stejných souborech prošel prostorovým testem. Původní hlášení frame type 128 letiště bylo způsobené posunutým čtením: instancovaný billboard stále ukládá vlastní pětibajtový axis/mode blok. Po opravě se načte všech 380 framů a 4 719 kolizí MISE16-LETISTE bez nevyřešené geometrie; prostorová změna původního trojúhelníku prošla datovým auditem.

Jednotkové testy zahrnují všechny tvary, inverze a jejich roviny, rotaci trojúhelníku o 180°, sdílené světové vrcholy, odmítnutí chybných vstupů, nové/odstraněné kolize, buněčné hranice, byte-local metadata, opaque data a souběh nezávislých povrchů s generátorem. Projektové testy ručních úprav ověřují následnou změnu modelu, export, přesné undo, rollback a ochranu závislostí. Zbývají další herní dotazy a dynamické reakce; rozsah provedeného testu je uveden níže.

## Projekt a 3D ovládání

`collision-project.js` načítá scénu, geometrii a potřebné externí modely jako hashově chráněné závislosti. Zápis publikuje KLZ a evidenci vlastnictví jednou transakcí. U nedotčených generovaných boxů se přemapuje přesný index, který odlišuje i bajtově shodnou ruční kopii. U povrchů se ověřuje celý rozsah a podpis. Změna vlastněného záznamu vyžaduje explicitní odpojení generátoru; UI důsledek vysvětluje před uložením. Vlastnictví jiných modelů zůstává a jejich další přepočet zachová ruční kolize. Metadata a mazání nevyžadují řešení chybějící geometrie; prostorové změny se při neřešitelných potřebných závislostech odmítnou.

Editor seskupuje záznamy podle framu a dlouhé seznamy načítá po 100 položkách. 3D primitiva jsou dávkovaná; koule a válce používají instance. Zvolený tvar má obrys a manipulátor. AABB dovoluje posun/měřítko; OBB/XTOBB a trojúhelníky také rotaci. Koule/válce dovolují posun a číselný poloměr. U válců nelze posouvat Y. Náhled a writer používají stejné nativní geometrické převody. Kamera, výběr, filtr, hledání, režim transformace a podklad se uchovají při přepnutí části mise. Podklad je samotná scene.4ds, bez externích aktérů. Neplatné původní tvary zůstávají v seznamu s vysvětlením.

Soukromý projektový audit na TUTORIAL upravil původní trojúhelník, AABB, XTOBB, OBB a válec, přidal všech šest typů, znovu je načetl a odstranil. Export se přesně shodoval s modem a tři undo přesně obnovila každý stav i výchozí KLZ; zdrojové soubory zůstaly stejné. Inspekční audit otevřel všech 77 původních KLZ, včetně označení neplatných původních hodnot a neřešených trojúhelníků letiště. TUTORIAL má 13 010 primitiv; inspekce trvala přibližně 140 ms (místní Node, bez IPC a vykreslení).

V odděleném okně ověřen materiál boxu, posun na X manipulátorem, uložení přes ⌘S, zachování kamery/výběru, deaktivace startu s draftem, duplikace/odstranění boxu a undo. Nová koule při neodpovídajícím filtru se zviditelnila; záporný poloměr nešel uložit, opravená hodnota se uložila. Testovací změny se vracejí do výchozí historie.

## Herní ověření šesti typů

Oddělená prázdná mise v nezávislé APFS kopii používá šest vodorovných `coll_testline` dotazů mimo původní podlahu. Každý zásah přičítá do energie hráče jiný bit (1, 2, 4, 8, 16, 32). Skript běží přímo v GOG 1.2, výsledky se ověřily na herním HUD; žádný výsledek se neodvozuje z náhledu nebo samotné přítomnosti procesu. Všechny první fáze mají stejný scene2.bin.

| Stav | HUD | Výsledek |
| --- | --- | --- |
| Původní podlaha bez nových tvarů | 9 | Žádný zásah |
| Přidán trojúhelník, AABB, otočený XTOBB, otočený OBB, koule a válec | 72 | Rozdíl 63 potvrzuje všech šest zásahů |
| Všechny tvary přesunuty o 3 m na X, původní paprsky | 9 | Původní pozice už nekoliduje |
| Undo přesunu | 72 | Obnovené zásahy |
| Odstranění všech šesti tvarů | 9 | Žádný zásah |
| Přesunuté tvary a paprsky na nových X | 72 | Nová poloha je dosažitelná dotazem |

Každý start kontroluje hash KLZ vloženého do testovací mise; export po přidání se přesně shodoval s modem. Po testu se KLZ a skript přes undo vrátily na výchozí hashe. Zdrojový projekt i původní Game.exe zůstaly shodné a soukromá hra byla ukončena. Soukromé protokoly a snímky nepatří do veřejného repozitáře. Test prokazuje paprskové dotazy; nepokrývá všechny původní tvary, chování pohybu postav, aut ani všechny kombinace sphere/box dotazů enginu.

Oprava billboardů byla porovnaná s původním parserem na 3 223 místních 4DS: letiště se nově načte, žádný dříve podporovaný soubor nepřestal fungovat a no-op writer zůstal byte-exact. Tři verze 27/58 se nadále odmítají. Celá sada 270 testů prošla.
