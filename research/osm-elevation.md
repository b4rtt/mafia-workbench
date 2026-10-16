# OSM: výškový podklad a souvislý terén

## Stav a rozsah (16. 10. 2026)

Ověřená příprava výšek pro [městský plugin](city-generator-plugin.md), interní generátor výškové geometrie a návazné nativní sítě, **nikoli zapnutá funkce importu**. Produkční OSM generátor dál používá rovinu. Existující mise, nastavení importu ani běžící editor se neměnily. Datové pokusy čtou uložený veřejný pražský výřez; nativní test používá syntetický svah v oddělené místní kopii projektu. Veškerá data a pokusy zůstávají v ignorovaném `local/`.

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

`src/plugins/osm/terrain.js` používá stávající půdorysy/profily ulic, rozřeže asfalt i chodník podle společné sítě a vytvoří svislé obrubníky se stejnými výškami. Doplní souvislý čtvercový podklad pod ulicemi; základní texturu a metrické opakování musí dodat volající. Výstup obsahuje standardní model 4DS, společné půdorysy a relativní úrovně povrchů pro navazující vrstvy. Kvantované hraniční roviny původního rovinného generátoru se vrátí na přesné float32 hranice rastru a půdorysy se oříznou: zaokrouhlení na milimetry tak nepřesáhne dostupné výšky ani nenechá tenký nepokrytý pás pod krajním jízdním bodem. Normály se počítají z konečných vrcholů, každá část má nejvýše 60 000 vrcholů a celek nejvýše 60 000 trojúhelníků i jedinečných kolizních vrcholů. Překročení se odmítne; součet s dalšími vrstvami musí později hlídat importér.

Osm veřejných testů v `test/osm-elevation.test.js` ověřuje odlišnost od bilineárního sedla, úplnost/neměnnost dat, obousměrné dělení hran obdélníkového rastru, normály/UV a pokrytí, otvory a profily bez chodníků, švy obrubníků s dlažbou v zatáčkách i neceločíselné oblasti, rozdělení velkých nativních dílů a odmítnutí přehnaně husté sítě. Uložení a nové čtení 4DS/KLZ potvrzuje přesné množiny nativních trojúhelníků. Původní rovinný výstup zůstává byteově stejný.

Nový interní kód také znovu zpracoval výše uvedený uložený pražský výřez: **6 114 trojúhelníků, 3 341 kolizních vrcholů, 40 000 m² podkladu**. 4DS/KLZ mají přesné shodné trojúhelníky, maximální rozdíl výšky těžiště povrchu vůči společné síti byl `5,12 × 10⁻⁷ m` (numerická shoda, nikoli přesnost DEM). Evidence pouze místně: `foundation.mjs`, `foundation.json`, `foundation.4ds`, `foundation.klz`. Nativní engine tímto druhým ověřením stále testovaný není.

## Silniční a pěší navigace na stejném povrchu

`navigation-elevation.js` promítá body na tentýž neměnný trojúhelníkový podklad a relativní úroveň vozovky/chodníku. Spojení rozděluje na hranách polí i diagonálách a dále podle skutečné 3D délky. `osmTerrainRoadPlan` zachová směry a mapované mezibody původního rovinného plánu; nové mezibody jsou nejvýše 2 m od sebe a platí nativní limit 4 096 mezibodů. Tento nový plán se předává writeru `road.bin` i volitelné dopravě. Použití rovinného plánu s výškovým povrchem doprava odmítne. Samotný půdorysný generátor dál dostává původní rovinný plán.

Pěší síť používá skutečnou výšku každého bodu, ne nejvyšší vrchol modelu. Spoje do 4 m se dělí na stejných hranách terénu. Mapované přechody mají vlastní výšky obou nástupů a úroveň vozovky oddělenou od absolutní výšky; připojují se místně ke správnému chodníku i na svahu. Dosavadní zákazy chybějícího povrchu, překážek a obrubníku nad 0,25 m zůstávají. Kombinace výškového povrchu s dosud rovinnými parkovými cestami se výslovně odmítá, dokud jejich geometrie nepoužívá stejný podklad.

Pět nových testů v `test/osm-elevation-navigation.test.js` kontroluje uložené a znovu načtené nativní sítě proti trojúhelníkům skutečného 4DS, výšky uvnitř spojů přes hřbet/sedlo, strmé a šikmé úseky, krajní float32 zaokrouhlení, směry/pruhy a 3D délky, místní průchod přechodem a ochranné limity. Společně s osmi testy terénu prošlo 13/13. Celá sada 761/762: jediný dříve doložený nesoulad je očekávání `/současně/` v `mission-dialogue.test.js` oproti stávající chybě „vyberte pouze jednu šablonu“. Check a build prošly; tento nesouvisející nesoulad zůstává beze změny.

Uložený pražský vzorek: **16 křižovatek / 218 jízdních mezibodů, 3 242 pěších bodů / 3 269 spojů, dva pěší komponenty, čtyři vložené a čtyři vynechané přechody**. Největší rozdíl bodu od nativního povrchu je `2,88 × 10⁻⁷ m` u vozovky a `4,41 × 10⁻⁷ m` u pěších bodů; nejdelší pěší spoj 3,97211 m. Jde o numerickou shodu, nikoli přesnost DEM. Nativní parsery nehlásí upozornění. Tentýž rovinný pražský vstup také vytvořil byteově shodné `road.bin` s dopravou i bez ní a `check.bin` s přechody i bez nich proti archivovanému předchozímu HEAD. Místní evidence `navigation.mjs`, `navigation.json`, `navigation-road.bin`, `navigation-check.bin` v adresáři výškového průzkumu.

## Nativní průchod syntetickým svahem

Oddělená mise `WB_ELEV_PROBE` v GOG 1.2/Wine má podklad se sklonem v obou osách a středovým hřbetem, rozdělený po 5 m. Model má **1 288 trojúhelníků / 710 kolizních vrcholů**; pěší síť 145 bodů / 150 spojů v jediném komponentu. Skriptovaný chodec přešel od nástupu `[0, 9.63, −4]` přes vozovku k `[0, 10.27, 4]` a vrátil se. Čerstvé checkpointy zachytily průchod vozovkou, protějším chodníkem i první návrat; výšky těla odpovídaly místnímu povrchu v toleranci 5,5 cm pro fyzický pohyb postavy. Tři `coll_testline` paprsky potvrdily podklad, vozovku a chodník. Druhý běh se stejnou geometrií, ale odebranou kolizí ulic, dopadl všemi paprsky až na původní podlahu Y=0. Nejde o ověření jízdy auta, hráčského startu, domů nebo celého města.

První měřicí pokusy přepisovaly návratovou polohu i po následné volné chůzi mimo chodník a jeden paprsek zasahoval testovacího hráče. Nejsou důkazem správné výšky; úspěšný audit zachycuje první návrat a má hráče mimo paprsky. Finální model, `road.bin` i `check.bin` jsou po poslední úpravě generátoru byteově shodné s testovanými soubory. Snímky obou variant byly zkontrolované; průchod dokazují také naměřené souřadnice a čerstvé checkpointy. Vlastní Wine prefix je ukončený, transakce testovacího projektu vrácené, chráněné původní projekty a `Game.exe` hashově nezměněné.

Místní evidence: `local/osm-elevation-navigation-5ulBNZ/` (`result.json`, `generated-summary.json`, oba checkpointy/snímky a `final-byte-verification.json`) a `local/probe-osm-elevation-navigation.mjs`. Veřejně pouze kód, syntetické testy a dokumentace. Generátor stále není připojený k importéru ani UI: zbývá zdrojový kontrakt/provenance, odběr výšek, usazení ostatních vrstev, společný celoměstský rozpočet, transakční integrace a širší ověření ve hře.

## Závislosti implementace

1. **Neměnný verzovaný podklad:** oblast/projekce, vzorky, datum, poskytovatel, známé rozlišení, výškový systém, normalizace, hashe a atribuce. Omezený přenos, timeout, validace chyb/NoData, sousední dlaždice, cache a přesné offline opakování. Žádná tichá náhrada rovinou nebo jiným poskytovatelem.
2. **Společný povrch:** jedna výšková síť pro všechny pozemní vrstvy se shodnými float32 švy. Bilineární funkce pro navigaci nestačí: uvnitř kolizního trojúhelníku může být jiná výška. Normály a UV počítat z konečné geometrie. Zachovat otvory, plánovaný společný rozpočet 60 000 kolizních vrcholů i konečný limit writeru 65 536.
3. **Domy a osazení:** hotové modely nedeformovat jako terén; usazení podle celé základny, sokl nebo výslovné vynechání při nevyhovujícím sklonu. Půdorysné pláště řešit zvlášť. Světla a zvuky musí následovat finální usazení.
4. **Nativní sítě:** `road.bin`, jízdní mezibody a `check.bin` na příslušném skutečném povrchu; přepočítat 3D délky a ověřit sklony, spoje, odstup těla od hran i obrubníky. Rastr sám neřeší vrstvení mostu/tunelu; ty zůstávají nepodporované.
5. **Publikace a ověření:** jediná transakce geometrie, sítí, scény, KLZ, evidence, zdroje a atribuce; hashové ochrany, export/reopen/reimport/undo. Syntetický svah, hřbet, údolí a švy dlaždic, potom Praha. Nativně ověřit start, podporu/paprsky, chůzi, schod, přechod a návrat chodce, průjezd auta i usazení domu. Až potom zpřístupnit volbu v běžném OSM formuláři.
