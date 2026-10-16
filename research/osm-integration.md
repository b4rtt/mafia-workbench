# OpenStreetMap: import oblasti a povrchy ulic

Priorita uživatele z 16. října 2026: začít OSM integraci již dnes. Navazuje na [zadání městského pluginu](city-generator-plugin.md), nenahrazuje požadavek na plnohodnotné město. TCK authoring zůstává odložený.

## Použití

1. Otevřít herní projekt, uložit rozepsané změny a v horní liště zvolit **OpenStreetMap…**.
2. Výchozí funkční ukázka zůstává se souhlasem uživatele v Praze, 50.087, 14.420 o 200 m. Jiný uživatelem vybraný střed je místně zaznamenaný v `local/osm-location.json` pro rozšíření oblasti; v načteném čtverci 450 m zatím nejsou způsobilé veřejné automobilové cesty (viz ověření níže). Vložit lze HTTPS odkaz na openstreetmap.org, nebo zadat zeměpisný střed a čtverec 50–450 m. Odkaz určuje střed; rozměr se volí samostatně.
3. **Načíst oblast** stáhne přes Overpass pouze cesty `highway`, budovy `building` a uzly těchto cest. Ručně lze vybrat FOSSGIS nebo Private.coffee. Přepínání ani opakování není automatické. Otevřený JSON lze načíst přes **Otevřít uložený podklad…**: Overpass/OSM API JSON s uzly a cestami použije aktuální oblast, vlastní `osm-source.json` převezme uloženou oblast.
4. Náhled má sever nahoře, modré vybrané ulice, šedé uzavřené půdorysy a oranžové vynechané komunikace. Výběr je podle OSM cest, které mohou být jen částí ulice. Nejvýše 256 cest, 512 křižovatek a 4096 mezilehlých uzlů. Více než čtyři výjezdy v jednom uzlu blokují vytvoření; výběr lze zmenšit.
5. Volba **Povrchy ulic a kolize** přidá asfalt, vyvýšené chodníky a obrubníky. Zvolit společnou šířku vozovky 2–20 m, chodník .5–5 m, obrubník .05–.4 m, metrické opakování a tři vlastní herní BMP. Pokud v projektu existují výchozí textury, je generování zapnuté; jinak zůstává dostupný import samotné sítě.
6. Vybrat ověřený komunitní `Empty_Mission.zip`, jedinečný název nové mise a hráčský model s kostrou. **Vytvořit misi s ulicemi a kolizemi** vytvoří osm souborů šablony plus `osm-source.json`, `OSM-ATTRIBUTION.txt` a jediný model `models/WB_OSM_<mise>.4ds` jedním krokem undo. Bez povrchů vznikne pouze deset souborů mise. Existující mise ani původní herní soubory se nepřepisují.
7. S povrchy se otevře běžný 3D editor `scene2.bin`, kde je statický model `OSM_STREETS`; bez nich editor `road.bin`. Uzly a propojení lze dále editovat. Změna silniční sítě zatím automaticky nepřegeneruje povrch. Kolize patří vloženému modelu a jeho přesun, smazání či undo se promítnou i do KLZ. Export nese i podklad a atribuci. `osm-source.json` umožní zopakovat import offline do jiné nové mise.

## Rozhraní modulu a převod

`src/plugins/osm/area.js` je čistý plánovací modul bez přístupu k projektu. `download.js` obsluhuje pevně povolené servery a místní cache; `mission.js` je adaptér na existující projektové transakce a nativní writer silnic. `ui.js` dostává úzké hostitelské API. Rozhraní i podklad jsou verzované v1. Nejde zatím o obecný dynamický loader libovolných pluginů ani AI integraci.

Lokální metrická projekce: X na východ, Z na sever, Y = 0, střed oblasti v počátku. Pro velikost nejvýše 450 m používá equirektangulární projekci se zeměpisnou šířkou středu. Úseky se ořezávají na hranici čtverce. Skutečné společné OSM node ID vytváří křižovatku; pouhé křížení čar ji nevytváří. Kruhové uzavřené cesty se rozdělí na minimálně tři propojení, paralelní cesty se stejnými konci dostanou další mezilehlou křižovatku. Nativní writer seřadí mezilehlé uzly podle X a přepočítá reference, délky a směrové sloty.

Explicitní `oneway=yes/1/true`, `-1`, `no/0/false`, implicitní kruhové objezdy a motorway se převádějí na povolené směry. Neznámé/podmíněné jednosměrky, mosty, tunely, jiné vrstvy, soukromé/zakázané komunikace a neautomobilové typy se nyní nepřevádějí. Značky šířek, pruhů, chodníků, povrchu, rychlosti a výšky se zachovají v podkladu, ale nejsou automaticky aplikované na herní profil.

## Přesné hranice tohoto bloku

- Vzniká **automobilová síť a volitelně souvislé povrchy vozovek/chodníků s přesnými kolizemi**, nikoli celý model města. Start hráče je u prvního vybraného úseku, Y = 10 jako v šabloně.
- Jeden výchozí pruh v každém povoleném směru, rychlost 1.2 herních jednotek. Zákazy odbočení a OSM restrikční relace nejsou implementované. Provoz a chodci jsou vypnutí.
- Budovy jsou pouze uzavřené way půdorysy v náhledu. Multipolygonové relace, otvory, 3D budovy a vazby na herní katalog se ještě nevyhodnocují.
- Žádné skutečné výšky, DEM, modely terénu, pěší navigace, vybavení, zvuky ani automatické sektory. Existující ruční authoring zůstává dostupný.
- Příští navazující blok: individuální profil komunikace podle dostupných značek šířky/pruhů/stran chodníků a zvoleného stylu původní hry. Potom půdorysy/budovy, terén a osazení. Nedostupné informace se musí dát nastavit; nelze vydávat domněnku o výšce či šířce za skutečnost z OSM.

## Geometrie povrchů

`surface.js` je oddělený čistý modul pluginu. Pro každou trasu vytváří metrické pásy s 24úhelníkovými zaoblenými spoji, které `polygon-clipping` (MIT, připnuté 0.15.7) sjednotí do vozovky. Rozdíl širšího půdorysu a vozovky vytvoří chodníky bez překryvů v křižovatkách. Výsledek se ořízne na čtverec oblasti. Vnitřní otvory zůstávají zachované; triangulace je přes existující Three.js ShapeUtils. Souřadnice půdorysu jsou kvantované na 1 mm; nulové plochy po float32 se nezapisují. Nejvýše 60 000 trojúhelníků, standardní 4DS s díly nejvýše 60 000 vrcholů, obvyklé limity KLZ zůstávají kontrolované.

Vozovka leží 5 cm nad podlahou šablony (bez z-fightingu), chodníky podle zvolené výšky. Planární UV mají fyzické opakování v metrech bez protažení v ohybech. Výchozí asfalt `0OASF.BMP` je bez vodorovného značení; původní `^sl_6m02.bmp` obsahuje čáry a potřebuje orientované UV/profil, proto se nyní nevolí automaticky. Výchozí chodník `^chdnk01.bmp`, obrubník `^obrub01.bmp`; nic z toho se nepřibaluje do aplikace ani veřejného repozitáře.

Jeden statický model v `scene2.bin` a jednostranné nativní trojúhelníky v `tree.klz` se připraví v paměti a zveřejní jednou transakcí. Ta současně uloží evidenci vlastnictví kolizí; následné přesuny/smazání proto nenechávají staré neviditelné překážky. Vytvoření kontroluje hash hráčského modelu i použitých textur a odmítá kolidující názvy. Silniční síť není generátorem povrchů měněna; plošné spojení vozovek samo nevytváří nový dopravní uzel.

## Síť, zdroj a licence

Pouze výslovné načtení uživatelem, jeden dotaz najednou. Nejvýše 8 MB a 60 000 prvků, 45s timeout, žádné automatické retry, minimálně 30 s mezi síťovými dotazy na tentýž server, cache 24 hodin v soukromém `local/osm-cache`. Odpověď s chybou/remark nebo chybějícími uzly se odmítne. Cache se validuje stejně jako síť. Renderer nemá otevřený přístup na internet. Nepoužíváme mapové dlaždice, Nominatim, Google Maps ani placené služby. Import neupravuje OpenStreetMap.

V náhledu i exportu je atribuce OpenStreetMap contributors a ODbL 1.0 s odkazy; raw podklad zůstává v projektu, nikoli ve veřejném repozitáři zdrojového kódu. Plné budoucí distribuování generovaných map a odvozených databází musí zachovat odpovídající licenční podklady.

Primární reference ověřené 16. 10. 2026:

- [Overpass API: veřejné instance, účel, limity a identifikace aplikace](https://wiki.openstreetmap.org/wiki/Overpass_API).
- [Overpass QL](https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL).
- [OSM copyright a ODbL](https://www.openstreetmap.org/copyright).
- [OSM API JSON a význam bbox](https://wiki.openstreetmap.org/wiki/API_v0.6).
- [OSMF API usage policy](https://operations.osmfoundation.org/policies/api/): hlavní editing API není vhodný trvalý zdroj pro read-only projekt. Proto jej aplikace nepoužívá jako automatický fallback.

## Ověření

Sedm veřejných testů `test/osm.test.js`: metrické souřadnice, ořez, sdílené a nesdílené křižování, jednosměrky/opačný směr/kruhový objezd/motorway, paralelní cesty, více než čtyři výjezdy, neúplná data, URL a meze oblasti, validovaná cache a omezení přenosu, editace nativního road.bin, export/reopen/undo.

Soukromý Electron audit `local/osm-ui-*`: skutečné UI, zobrazení chyby síťového serveru, offline načtení skutečného pražského podkladu 200 × 200 m (54 půdorysů, 14 způsobilých way, 16 uzlů a 15 silničních propojení), výběr/odvýběr, zamčené neimportovatelné položky, šablona, vytvoření skutečné mise přes ModProject, zachování zdroje/atribuce, přesný export, znovuotevření, odmítnutí stejného názvu a neúplných dat, jedno undo a zneplatnění při změně středu. Screenshot je lokální, skutečné mapové a herní soubory nejsou v Gitu.

Živý přenos 16. 10.: FOSSGIS opakovaně vrátil HTTP 502 s výslovným důvodem „all query workers are busy and the request queue is full“. Private.coffee vrátil 500 a jiná veřejná instance 504. Editor zpracuje pouze omezený prefix chybové odpovědi, rozliší přetížení/frontu, limit požadavků a obecnou chybu brány; HTML nevypisuje a požadavek automaticky neopakuje. Test ověřuje i ukončení čtení nadměrného chybového těla. Při pozdějším jednotlivém GET dotazu FOSSGIS úspěšně vrátil uživatelem zvolenou oblast o 450 m: 21 elementů, jeden půdorys bunkru a dvě komunikace s omezeným přístupem. Ty současný automobilový import záměrně nezahrnuje. Místní soubor podkladu uvedený v `local/osm-location.json` uchovává tato skutečná data; není ve veřejném repozitáři. Úspěch GET po dřívějších neúspěších POST sám neprokazuje chybu metody, protože se současně změnila zátěž serveru.

Jednorázově byl dříve pro ověření dat stažen malý pražský JSON bbox z hlavního OSM API; aplikace tento endpoint nenabízí kvůli jeho provozní politice. Pražský podklad slouží pro offline regresní ověření a zůstává místní. Jízda po importované síti v původní hře tímto auditem prokázaná není.

### Ověření povrchů

Pět veřejných testů `test/osm-surface.test.js`: metrické UV/plochy/normály a čitelné 4DS, těsné/ostré křižovatky a hranice OSM way bez vrstev překrývajících se povrchů, vnitrobloky/oddělené ulice/ořez, odmítnutí neplatných dat a jedna transakce scene/model/KLZ včetně přesunu/smazání, exportu, znovuotevření a přesného undo.

Soukromé skutečné Electron UI `local/osm-surface-ui-*`: pražský podklad vytvořil 15 propojení, 16 uzlů, 1327 vizuálních a 1327 kolizních trojúhelníků; export, reopen a jedno undo. `local/osm-surface-view-*` ověřuje skutečný WebGL náhled a všechny tři původní textury bez chyb načítání.

Nativní GOG/Wine test `local/osm-surface-game-ZKKzti`: generovaná OSM mise skutečně spuštěná bez ručního vstupu, tři `coll_testline` výsledky načtené z nového autosavu. Asfalt Y=0.05000019, chodník Y=0.19999981, boční obrubník trefen ve správném bodě (odchylky pod 2 cm). Kontrolní běh bez generovaných kolizí trefí podlahu Y=0 a boční paprsek mine. Přesné hashe nasazeného modelu a KLZ, po testu ukončené Wine a obnovená historie izolovaného projektu; původní projekt/hra beze změny. Toto ověřuje geometrii/kolize v enginu, nikoli automatickou jízdu provozu.

Kontroly: check/build prošly, celá sada 668 testů má 667 úspěšných a jediný dříve existující nesoulad textu chyby v `mission-dialogue.test.js` (`/současně/` versus „vyberte pouze jednu šablonu“). Nesouvisející test se v tomto bloku nemění.
