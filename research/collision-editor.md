# Samostatný editor původních kolizí

Stav 13. října 2026: implementovaný a datově ověřený základ zápisu v `src/core/collision-editor.js`. Samostatné 3D ovládání, projektové transakce ručních úprav včetně evidence generovaných kolizí a herní ověření ještě následují. Odkaz „Kolize (soubor)“ v aplikaci zatím zůstává binárním pohledem; tato etapa sama není plnohodnotným editorem.

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

Soukromý datový audit nad místním projektem Mafia-CZ přečetl 77 mission/tree.klz: 1 561 715 trojúhelníků, 56 131 AABB, 117 041 XTOBB, 59 828 válců, 116 216 OBB a 250 koulí. Prošlo 1 324 operací: exact no-op, byte-local materiálové změny každého dostupného pole, prostorové změny reprezentativních objemů, mazání s přemapováním a jedna prostorová změna původního trojúhelníku ve 76 misích. Ověřily se nepřepsané záznamy, reference, pořadí, extra vrcholy, tail a nezměněné zdrojové hashe. Audit zapisoval výsledné KLZ pouze v paměti, herní data se neměnila.

Tři původní XTOBB `bar_nosniky02` v MISE02-SALIERY, MISE03-SALIERY a MISE03-SALIERYKONEC mají nulovou řadu matice, nulový místní Y rozměr a identitní uloženou inverzi. Jejich metadata/mazání se ověřily; prostorová změna tohoto neplatného tvaru se odmítá bez publikace. Další platný XTOBB ve stejných souborech prošel prostorovým testem. MISE16-LETISTE má `scene.4ds` s dosud nepodporovaným frame type 128: metadata, objemy a mazání KLZ prošly, prostorová editace frame-backed trojúhelníku zatím nemá ověřené rozlišení geometrie.

Jednotkové testy zahrnují všechny tvary, inverze a jejich roviny, rotaci trojúhelníku o 180°, sdílené světové vrcholy, odmítnutí chybných vstupů, nové/odstraněné kolize, buněčné hranice, byte-local metadata, opaque data a souběh nezávislých povrchů s generátorem. Projektový test generování ověřil následnou změnu modelu, export a přesné undo při ručně vloženém povrchu. Projektové uložení samotných ručních operací, 3D UI a herní testy této nové funkce ještě nejsou dokončené.
