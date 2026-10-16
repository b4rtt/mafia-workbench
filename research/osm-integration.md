# OpenStreetMap: první importní blok

Priorita uživatele z 16. října 2026: začít OSM integraci již dnes. Navazuje na [zadání městského pluginu](city-generator-plugin.md), nenahrazuje požadavek na plnohodnotné město. TCK authoring zůstává odložený.

## Použití

1. Otevřít herní projekt, uložit rozepsané změny a v horní liště zvolit **OpenStreetMap…**.
2. Vložit HTTPS odkaz `https://www.openstreetmap.org/#map=18/50.087/14.420`, nebo zadat zeměpisný střed a čtverec 50–450 m. Odkaz určuje střed; rozměr se volí samostatně.
3. **Načíst oblast** stáhne přes Overpass pouze cesty `highway`, budovy `building` a uzly těchto cest. Ručně lze vybrat FOSSGIS nebo Private.coffee. Přepínání ani opakování není automatické. Otevřený JSON lze načíst přes **Otevřít uložený podklad…**: Overpass/OSM API JSON s uzly a cestami použije aktuální oblast, vlastní `osm-source.json` převezme uloženou oblast.
4. Náhled má sever nahoře, modré vybrané ulice, šedé uzavřené půdorysy a oranžové vynechané komunikace. Výběr je podle OSM cest, které mohou být jen částí ulice. Nejvýše 256 cest, 512 křižovatek a 4096 mezilehlých uzlů. Více než čtyři výjezdy v jednom uzlu blokují vytvoření; výběr lze zmenšit.
5. Vybrat ověřený komunitní `Empty_Mission.zip`, jedinečný název nové mise a hráčský model s kostrou. **Vytvořit misi se sítí ulic** vytvoří osm souborů šablony plus `osm-source.json` a `OSM-ATTRIBUTION.txt` jedním krokem undo. Existující mise ani původní herní soubory se nepřepisují.
6. Otevře se běžný 3D editor `road.bin`; uzly a propojení lze dále editovat. Export nese i podklad a atribuci. `osm-source.json` umožní zopakovat import offline do jiné nové mise.

## Rozhraní modulu a převod

`src/plugins/osm/area.js` je čistý plánovací modul bez přístupu k projektu. `download.js` obsluhuje pevně povolené servery a místní cache; `mission.js` je adaptér na existující projektové transakce a nativní writer silnic. `ui.js` dostává úzké hostitelské API. Rozhraní i podklad jsou verzované v1. Nejde zatím o obecný dynamický loader libovolných pluginů ani AI integraci.

Lokální metrická projekce: X na východ, Z na sever, Y = 0, střed oblasti v počátku. Pro velikost nejvýše 450 m používá equirektangulární projekci se zeměpisnou šířkou středu. Úseky se ořezávají na hranici čtverce. Skutečné společné OSM node ID vytváří křižovatku; pouhé křížení čar ji nevytváří. Kruhové uzavřené cesty se rozdělí na minimálně tři propojení, paralelní cesty se stejnými konci dostanou další mezilehlou křižovatku. Nativní writer seřadí mezilehlé uzly podle X a přepočítá reference, délky a směrové sloty.

Explicitní `oneway=yes/1/true`, `-1`, `no/0/false`, implicitní kruhové objezdy a motorway se převádějí na povolené směry. Neznámé/podmíněné jednosměrky, mosty, tunely, jiné vrstvy, soukromé/zakázané komunikace a neautomobilové typy se nyní nepřevádějí. Značky šířek, pruhů, chodníků, povrchu, rychlosti a výšky se zachovají v podkladu, ale nejsou automaticky aplikované na herní profil.

## Přesné hranice tohoto bloku

- Vzniká **automobilová síť**, nikoli povrch vozovky nebo model města. Hra zatím zobrazí rovnou plochu původní šablony. Start hráče je u prvního vybraného úseku, Y = 10 jako v šabloně.
- Jeden výchozí pruh v každém povoleném směru, rychlost 1.2 herních jednotek. Zákazy odbočení a OSM restrikční relace nejsou implementované. Provoz a chodci jsou vypnutí.
- Budovy jsou pouze uzavřené way půdorysy v náhledu. Multipolygonové relace, otvory, 3D budovy a vazby na herní katalog se ještě nevyhodnocují.
- Žádné skutečné výšky, DEM, modely terénu, silniční povrchy/kolize, pěší navigace, vybavení, zvuky ani automatické sektory. Existující ruční authoring zůstává dostupný.
- Příští navazující blok: profil komunikace podle dostupných značek a zvoleného stylu původní hry, souvislé povrchy s chodníky/obrubníky, spojení křižovatek a kolize. Teprve potom půdorysy/budovy, terén a osazení. Nedostupné informace se musí dát nastavit; nelze vydávat domněnku o výšce či šířce za skutečnost z OSM.

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

Živý přenos dnes: FOSSGIS vrátil 502, Private.coffee 500 a další veřejná instance 504. Bez opakované zátěže. Jednorázově byl pro ověření dat stažen malý JSON bbox z hlavního OSM API; aplikace tento endpoint nenabízí kvůli jeho provozní politice. Pražský podklad slouží pro offline ověření a zůstává místní. Úspěšné živé stažení z Overpass a jízda po importované síti v původní hře tedy nejsou tímto auditem prokázané.
