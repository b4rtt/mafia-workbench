# OSM: výškový podklad a souvislý terén

## Stav a rozsah (16. 10. 2026)

Ověřená příprava výšek pro [městský plugin](city-generator-plugin.md) a interní generátor výškové geometrie, **nikoli zapnutá funkce importu**. Produkční OSM generátor dál používá rovinu. Existující mise, nastavení importu ani běžící editor se neměnily. Pokusy čtou uložený veřejný pražský výřez a zapisují pouze do ignorovaného `local/osm-elevation-research/`.

Výšky musí současně používat geometrie, KLZ, hráčský start, silniční síť, pěší navigace, domy, mobiliář, světla a zvukové body. Zvednutí pouze silnice by ostatní vrstvy ponechalo v rovině. Jednotlivé údaje OSM `ele` netvoří souvislý výškový podklad.

## Zdroje a skutečný síťový pokus

- [Terrain Tiles na AWS](https://registry.opendata.aws/terrain-tiles/) jsou dostupné bez účtu. [Terrarium](https://github.com/tilezen/joerd/blob/master/docs/formats.md) ukládá metry do RGB: `R × 256 + G + B / 256 − 32768`, ve Web Mercatoru. Kódovací krok 1/256 m není přesnost měření. [Dokumentace zdrojů](https://github.com/tilezen/joerd/blob/master/docs/data-sources.md) upozorňuje na převzorkování, starší data a artefakty staveb. Zoom není skutečné rozlišení DEM.
- Veřejný vzorek Praha 50.087, 14.420: `https://elevation-tiles-prod.s3.amazonaws.com/terrarium/14/8848/5550.png` vrátil HTTP 200, RGB 256 × 256, 71 333 bajtů, SHA-256 `1571927040e5e7733e015781b9bb79c589314c3344bffcdcc3b925303492471d`. Hlavička **`x-amz-meta-x-imagery-sources`** uvádí `eudem/eudem_dem_5deg_n50e010.tif`; `Last-Modified` je 16. 11. 2017. Původně dokumentovaná hlavička `X-Imagery-Sources` zde chybí. Není to aktuální zaměření města.
- [Atribuce poskytovatele](https://github.com/tilezen/joerd/blob/master/docs/attribution.md) musí doprovázet výškový podklad v náhledu a exportu, včetně použitých zdrojů a úprav; samotná současná OSM atribuce nestačí.
- [ČÚZK DMR 5G ImageServer](https://ags.cuzk.gov.cz/arcgis2/rest/services/dmr5g/ImageServer?f=pjson) zveřejňuje F32 rastr s pixelem 2 m, metry/Bpv a funkcí `None`. [Popis služby](https://geoportal.gov.cz/php/micka/en/record/basic/CZ-CUZK-AGS-DMR5G?dlang=cze) odlišuje stínovaný náhled od číselných výšek. [Get Samples](https://developers.arcgis.com/rest/services-reference/enterprise/get-samples/) se dvěma veřejnými pražskými body vrátil HTTP 403, HTML „Request forbidden by administrative rules“, při POST i GET. Příčina, funkční numerický odběr i podmínky další distribuce zůstávají neověřené. Omezení se neobcházelo.

Terrarium je dostupný kandidát pro hrubý reliéf, nikoli důkaz správných obrubníků, nájezdů, schodů nebo mostů. ČÚZK zůstává kandidát pro přesnější český podklad, nikoli automatický fallback.

## Místní měření a prototyp

Čtverec 200 × 200 m používá projekci `area.js`, Web Mercator pixelové středy a bilineární vzorkování RGB. Všechny potřebné pixely jsou uvnitř jediné dlaždice; její okraj tím ověřený není. Rastr 41 × 41 vzorků po 5 m obsahuje 202,845–206,437 m: **převýšení 3,591 m ve vzorkovaném modelu**, nikoli zaměřené ulici. Jemné vzorkování nezvyšuje zdrojovou přesnost.

Původní ulice: 1 327 trojúhelníků, 764 jedinečných pozic, nejdelší hrana vozovky 43,89 m. Prosté vzorkování DEM jen v existujících vrcholech má v těžištích vozovky proti bilineární dlaždici chybu až **5,98 cm** (RMS 1,17 cm), navíc k neznámé chybě DEM.

Oddělený prototyp použil společnou trojúhelníkovou síť po 5 m. Podle jejích ploch rozřezal vozovku/chodník; podle hran a diagonál také svislé obrubníky. Podklad pokryl celých 40 000 m². Relativní odstupy jsou 0,05 m pro vozovku a 0,20 m pro chodník. Základ `2 + výška − minimum` drží pokus nad podlahou šablony; nejde o vybranou obecnou politiku importu.

Výsledek: **514 trojúhelníků vozovky, 836 chodníků, 1 564 obrubníků a 3 200 podkladu; celkem 6 114 trojúhelníků a 3 341 kolizních vrcholů**. Jeden nativní 4DS díl, 623 956 bajtů; KLZ nad syntetickou testovací šablonou 327 099 bajtů. Existující writery a opětovné načtení potvrdily přesné množiny trojúhelníků modelu a jednostranné kolize. Těžiště 3 200 ploch výškové sítě se proti téže dlaždici liší nejvýše o 5,96 mm (RMS 1,56 mm); to opět není přesnost měření terénu.

Místní evidence: `tile.json`, `grid.json`, `error.json`, `grid-error.json`, `prototype.json`; skripty `terrarium.mjs`, `survey.py`, `surface.mjs`, `error.py`, `prototype.mjs`. Data, modely a kolize se nepublikují. Prototyp **neověřuje** všechny švy, maximální oblast, domy, navigaci, dopravu ani původní engine. V editoru není nasazený.

## Interní generátor a datové ověření

`src/plugins/osm/elevation.js` přijímá pouze číselný podklad verze 1: stejnou oblast jako plán, 1–128 polí v každé ose, úplné pole `(columns + 1) × (rows + 1)` absolutních výšek v metrech a explicitní relativní základ `base`. Vzorky jsou po řádcích od západu k východu, řádky od jihu k severu (místní X/Z). Odmítnuté jsou chybějící/NoData vzorky, neplatné rozměry i jiná oblast; žádná tichá náhrada rovinou. Kopie vzorků a souřadnic jsou neměnné. Návratová výška je float32 `base + vzorek − minimum`, uvnitř pole se interpoluje po dvou trojúhelnících se stejnou diagonálou jako nativní geometrie. `splitEdge` rozděluje hrany podle polí i jejich diagonál. Mimo podklad se neextrapoluje.

`src/plugins/osm/terrain.js` používá stávající půdorysy/profily ulic, rozřeže asfalt i chodník podle společné sítě a vytvoří svislé obrubníky se stejnými výškami. Doplní souvislý čtvercový podklad pod ulicemi; základní texturu a metrické opakování musí dodat volající. Výstup obsahuje standardní model 4DS a společné půdorysy pro navazující vrstvy. Kvantované hranice původního rovinného generátoru se znovu oříznou k přesným float32 hranicím rastru: například oblast 50,123 m jinak mohla zaokrouhlením na milimetry přesáhnout dostupné výšky. Normály se počítají z konečných vrcholů, každá část má nejvýše 60 000 vrcholů a celek nejvýše 60 000 trojúhelníků i jedinečných kolizních vrcholů. Překročení se odmítne; součet s dalšími vrstvami musí později hlídat importér.

Osm veřejných testů v `test/osm-elevation.test.js` ověřuje odlišnost od bilineárního sedla, úplnost/neměnnost dat, obousměrné dělení hran obdélníkového rastru, normály/UV a pokrytí, otvory a profily bez chodníků, švy obrubníků s dlažbou v zatáčkách i neceločíselné oblasti, rozdělení velkých nativních dílů a odmítnutí přehnaně husté sítě. Uložení a nové čtení 4DS/KLZ potvrzuje přesné množiny nativních trojúhelníků. Původní rovinný výstup zůstává byteově stejný.

Nový interní kód také znovu zpracoval výše uvedený uložený pražský výřez: **6 114 trojúhelníků, 3 341 kolizních vrcholů, 40 000 m² podkladu**. 4DS/KLZ mají přesné shodné trojúhelníky, maximální rozdíl výšky těžiště povrchu vůči společné síti byl `5,12 × 10⁻⁷ m` (numerická shoda, nikoli přesnost DEM). Evidence pouze místně: `foundation.mjs`, `foundation.json`, `foundation.4ds`, `foundation.klz`. Nativní engine tímto druhým ověřením stále testovaný není.

Celá sada po změně: 756/757; jediný dříve doložený nesoulad je očekávání `/současně/` v `mission-dialogue.test.js` oproti stávající chybě „vyberte pouze jednu šablonu“. Check a build prošly. Generátor není připojený k importéru ani UI: zatím chybí zdrojový kontrakt/provenance, odběr výšek, rozmístění ostatních vrstev, společný celoměstský rozpočet, návazné nativní sítě a ověření ve hře.

## Závislosti implementace

1. **Neměnný verzovaný podklad:** oblast/projekce, vzorky, datum, poskytovatel, známé rozlišení, výškový systém, normalizace, hashe a atribuce. Omezený přenos, timeout, validace chyb/NoData, sousední dlaždice, cache a přesné offline opakování. Žádná tichá náhrada rovinou nebo jiným poskytovatelem.
2. **Společný povrch:** jedna výšková síť pro všechny pozemní vrstvy se shodnými float32 švy. Bilineární funkce pro navigaci nestačí: uvnitř kolizního trojúhelníku může být jiná výška. Normály a UV počítat z konečné geometrie. Zachovat otvory, plánovaný společný rozpočet 60 000 kolizních vrcholů i konečný limit writeru 65 536.
3. **Domy a osazení:** hotové modely nedeformovat jako terén; usazení podle celé základny, sokl nebo výslovné vynechání při nevyhovujícím sklonu. Půdorysné pláště řešit zvlášť. Světla a zvuky musí následovat finální usazení.
4. **Nativní sítě:** `road.bin`, jízdní mezibody a `check.bin` na příslušném skutečném povrchu; přepočítat 3D délky a ověřit sklony, spoje, odstup těla od hran i obrubníky. Rastr sám neřeší vrstvení mostu/tunelu; ty zůstávají nepodporované.
5. **Publikace a ověření:** jediná transakce geometrie, sítí, scény, KLZ, evidence, zdroje a atribuce; hashové ochrany, export/reopen/reimport/undo. Syntetický svah, hřbet, údolí a švy dlaždic, potom Praha. Nativně ověřit start, podporu/paprsky, chůzi, schod, přechod a návrat chodce, průjezd auta i usazení domu. Až potom zpřístupnit volbu v běžném OSM formuláři.
