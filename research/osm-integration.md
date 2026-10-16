# OpenStreetMap: import oblasti, ulice a budovy

Priorita uživatele z 16. října 2026: začít OSM integraci již dnes. Navazuje na [zadání městského pluginu](city-generator-plugin.md), nenahrazuje požadavek na plnohodnotné město. TCK authoring zůstává odložený.

## Použití

1. Otevřít herní projekt, uložit rozepsané změny a v horní liště zvolit **OpenStreetMap…**.
2. Výchozí funkční ukázka zůstává se souhlasem uživatele v Praze, 50.087, 14.420 o 200 m. Jiný uživatelem vybraný střed je místně zaznamenaný v `local/osm-location.json` pro rozšíření oblasti; v načteném čtverci 450 m zatím nejsou způsobilé veřejné automobilové cesty (viz ověření níže). Vložit lze HTTPS odkaz na openstreetmap.org, nebo zadat zeměpisný střed a čtverec 50–450 m. Odkaz určuje střed; rozměr se volí samostatně.
3. **Načíst oblast** stáhne přes Overpass pouze cesty `highway`, budovy `building` a uzly těchto cest. Ručně lze vybrat FOSSGIS nebo Private.coffee. Přepínání ani opakování není automatické. Otevřený JSON lze načíst přes **Otevřít uložený podklad…**: Overpass/OSM API JSON s uzly a cestami použije aktuální oblast, vlastní `osm-source.json` převezme uloženou oblast.
4. Náhled má sever nahoře, modré vybrané ulice, šedé uzavřené půdorysy a oranžové vynechané komunikace. Zelená plocha po zapnutí budov ukazuje obálky přiřazených modelů nebo celé generované půdorysy s otvory. Výběr je podle OSM cest, které mohou být jen částí ulice. Nejvýše 256 cest, 512 křižovatek a 4096 mezilehlých uzlů. Více než čtyři výjezdy v jednom uzlu blokují vytvoření; výběr lze zmenšit.
5. Volba **Povrchy ulic a kolize** přidá asfalt, vyvýšené chodníky a obrubníky. Nový import výchozí volbou použije podporované rozměry a strany chodníků z OSM. Náhradní šířka vozovky 2–20 m, chodník .5–5 m a jeho strany jsou nastavitelné; původ a nejasnosti jsou vypsané u jednotlivých ulic. Odhad podle počtu pruhů je volitelný a výchozí vypnutý. Zvolit lze také obrubník .05–.4 m, metrické opakování a tři vlastní herní BMP. Pokud v projektu existují výchozí textury, je generování zapnuté; jinak zůstává dostupný import samotné sítě.
6. Volitelně otevřít **Budovy a uliční zástavba** a zapnout **Vytvořit domy s přesnými kolizemi**. **Způsob tvorby budov** nabízí přiřazení původních modelů nebo domy podle celých půdorysů. Katalog načte původní modely či styly fasád z projektu; jednotlivé modely/styly i půdorysy lze odškrtnout. Přehled uvádí výsledek, vyplnění, výšku a zdroj cílové výšky nebo důvod vynechání.
7. Vybrat ověřený komunitní `Empty_Mission.zip`, jedinečný název nové mise a hráčský model s kostrou. **Vytvořit misi s ulicemi a kolizemi** vytvoří osm souborů šablony plus `osm-source.json`, `OSM-ATTRIBUTION.txt` a jediný model `models/WB_OSM_<mise>.4ds` jedním krokem undo. Bez povrchů vznikne pouze deset souborů mise; přiřazené původní domy odkazují na existující modely. Půdorysný režim navíc vytváří samostatné `models/WB_OSMH_<mise>_<pořadí>.4ds` pro každý dům ve stejné transakci. Existující mise ani původní herní soubory se nepřepisují.
8. S povrchy nebo domy se otevře `scene2.bin`; tlačítko **Otevřít 3D mapu** zobrazí běžný 3D editor. Při generování povrchů je ve scéně statický model `OSM_STREETS`; bez povrchů i domů se otevře editor `road.bin`. Uzly a propojení lze dále editovat. Změna silniční sítě zatím automaticky nepřegeneruje povrch. Každý dům je samostatný `OSM_B_<way ID>` (u relací `OSM_R_<ID>_<část>`) s přiřazenou nebo generovanou geometrií a původními texturami. Kolize patří vloženým modelům a jejich přesun, smazání či undo se promítnou i do KLZ. Export nese i podklad a atribuci. `osm-source.json` umožní zopakovat import offline do jiné nové mise.

## Rozhraní modulu a převod

`src/plugins/osm/area.js` je čistý plánovací modul bez přístupu k projektu. `download.js` obsluhuje pevně povolené servery a místní cache; `mission.js` je adaptér na existující projektové transakce a nativní writer silnic. `ui.js` dostává úzké hostitelské API. Rozhraní i podklad jsou verzované v1. Nejde zatím o obecný dynamický loader libovolných pluginů ani AI integraci.

Lokální metrická projekce: X na východ, Z na sever, Y = 0, střed oblasti v počátku. Pro velikost nejvýše 450 m používá equirektangulární projekci se zeměpisnou šířkou středu. Úseky se ořezávají na hranici čtverce. Skutečné společné OSM node ID vytváří křižovatku; pouhé křížení čar ji nevytváří. Kruhové uzavřené cesty se rozdělí na minimálně tři propojení, paralelní cesty se stejnými konci dostanou další mezilehlou křižovatku. Nativní writer seřadí mezilehlé uzly podle X a přepočítá reference, délky a směrové sloty.

Explicitní `oneway=yes/1/true`, `-1`, `no/0/false`, implicitní kruhové objezdy a motorway se převádějí na povolené směry. Neznámé/podmíněné jednosměrky, mosty, tunely, jiné vrstvy, soukromé/zakázané komunikace a neautomobilové typy se nyní nepřevádějí. Značky šířek a chodníků se při zapnuté volbě převádějí na profil povrchu podle pravidel níže. Počet pruhů může sloužit jen jako výslovně zvolený odhad šířky; nemění počet nativních jízdních pruhů. Ostatní údaje o povrchu, rychlosti a výšce se uchovávají bez automatické aplikace.

## Přesné hranice tohoto bloku

- Vzniká **automobilová síť a volitelně souvislé povrchy vozovek/chodníků s přesnými kolizemi**, nikoli celý model města. Start hráče je u prvního vybraného úseku, Y = 10 jako v šabloně.
- Jeden výchozí pruh v každém povoleném směru, rychlost 1.2 herních jednotek. Zákazy odbočení a OSM restrikční relace nejsou implementované. Provoz a chodci jsou vypnutí.
- Budovy mohou být náhrady z omezeného katalogu původních modelů uvnitř uzavřených way půdorysů a úplných multipolygonových relací s nádvořími. Každá oddělená vnější část dostane nanejvýš jeden vhodný model. Druhý režim vytvoří celý vnější plášť každé vyhovující části, včetně nádvoří a střechy s otvory. Přesné památky, 3D building parts, složité střechy, interiéry a automatická návaznost vstupů zatím nejsou implementované.
- Žádné skutečné výšky, DEM, modely terénu, pěší navigace, vybavení, zvuky ani automatické sektory. Existující ruční authoring zůstává dostupný.
- Individuální profily jsou hotové pro podporované rozměry a strany chodníků. Zbývají samostatné pěší cesty, parkovací/cyklistické pásy a značení. Další větší bloky: věrnější střechy a fasády, doplnění mezer uliční zástavby, 3D části budov, terén a osazení. Nedostupné informace se musí dát nastavit; nelze vydávat domněnku o výšce či šířce za skutečnost z OSM.

## Geometrie povrchů

### Individuální profily

`profiles.js` bez přístupu k projektu vyhodnocuje každý původní OSM way. Dostupné `width`, pak `width:carriageway`, pak `est_width` mají přednost před náhradní šířkou. `est_width` je označený odhad. Podporované délky: desetinná tečka, metry, cm, km, ft, in a zápis stop/palců; nejasné seznamy, rozsahy, čárky nebo hodnoty mimo meze vedou na upozornění a náhradní profil, nikoli tiché oříznutí. Volitelný odhad `lanes × šířka pruhu` (2–4.5 m) je samostatně označený a nezahrnuje parkovací/cyklistické pásy. Dostupná použitelná šířka z OSM má před odhadem přednost.

Strany se vyhodnocují v pořadí `sidewalk`, `sidewalk:both`, `sidewalk:left/right`. Levá/pravá odpovídá původnímu směru OSM way i při `oneway=-1`. `both/left/right`, boční `yes` a `no/none` jsou rozlišené; globální `yes` neurčuje stranu. `separate` znamená samostatně mapovanou pěší cestu, jejíž geometrii tento blok ještě nespojuje: použije proto jasně označený ruční náhradní profil. Šířky `sidewalk:left/right:width` mají přednost před `sidewalk:both:width`. Bez použitelného záznamu jde o ruční šířku, i když přítomnost chodníku určila mapa.

Nové UI zapíná použití OSM značek, ale starší uložená nastavení bez této volby i přímé původní API zůstávají v ručním režimu. Import ukládá nastavení i vyhodnocené profily (`surfaceProfiles`) do podkladu; opakovaný import se znovu ověří a přepočítá z raw dat, nikoli z důvěry v odvozené profily. Načtení vlastního podkladu obnoví i vypnutí povrchů. V pražské ukázce chybí skutečné šířky vozovek a chodníky jsou často `separate`; výchozí rozměry jsou proto náhradní, nikoli změřená Praha.

### Síťový povrch

`surface.js` je oddělený čistý modul pluginu. Pro každou trasu vytváří metrické pásy s 24úhelníkovými zaoblenými spoji, které `polygon-clipping` (MIT, připnuté 0.15.7) sjednotí do vozovky. Rozdíl širšího půdorysu a vozovky vytvoří chodníky bez překryvů v křižovatkách. Výsledek se ořízne na čtverec oblasti. Vnitřní otvory zůstávají zachované; triangulace je přes existující Three.js ShapeUtils. Souřadnice půdorysu jsou kvantované na 1 mm; nulové plochy po float32 se nezapisují. Nejvýše 60 000 trojúhelníků, standardní 4DS s díly nejvýše 60 000 vrcholů, obvyklé limity KLZ zůstávají kontrolované.

Každý úsek má vlastní šířku a levý/pravý pás; jednostranný chodník přidává jen odpovídající půlkruhové spoje a nevytváří chodník na protější straně. Nulový počet chodníků je platný profil.

Vozovka leží 5 cm nad podlahou šablony (bez z-fightingu), chodníky podle zvolené výšky. Planární UV mají fyzické opakování v metrech bez protažení v ohybech. Výchozí asfalt `0OASF.BMP` je bez vodorovného značení; původní `^sl_6m02.bmp` obsahuje čáry a potřebuje orientované UV/profil, proto se nyní nevolí automaticky. Výchozí chodník `^chdnk02.bmp` obsahuje průběžnou dlažbu. Předchozí `^chdnk01.bmp` má v obrázku také okrajový pás, který při plošném opakování vytvářel falešné obruby uvnitř chodníku. Samostatný obrubník používá `^obrub01.bmp`; nic z toho se nepřibaluje do aplikace ani veřejného repozitáře. Uložené podklady zachovávají zvolenou texturu; změna výchozího nastavení nepřepisuje existující modely ani uživatelské volby.

Jeden statický model v `scene2.bin` a jednostranné nativní trojúhelníky v `tree.klz` se připraví v paměti a zveřejní jednou transakcí. Ta současně uloží evidenci vlastnictví kolizí; následné přesuny/smazání proto nenechávají staré neviditelné překážky. Vytvoření kontroluje hash hráčského modelu i použitých textur a odmítá kolidující názvy. Silniční síť není generátorem povrchů měněna; plošné spojení vozovek samo nevytváří nový dopravní uzel.

## Přiřazení původních domů

`building-assets.js` načítá malý kurátorovaný katalog 16 původních domů, bez přibalování dat hry. Ověří soubory, texturové reference, celou statickou hierarchii, obálku a kolizní plochy. Nepoužije postavy, billboardy, animované modely ani domy vyžadující výrazně jiné výškové usazení. Chybějící model je v katalogu uvedený s důvodem, ne nahrazený náhodným objektem.

`buildings.js` hledá orientaci a umístění konzervativní obálky XZ, podle zvolené minimální vyplněnosti 25–90 %. Kontroluje celou plochu proti skutečnému, i konkávnímu půdorysu a proti sjednoceným vozovkám, chodníkům a již vloženým domům. Bez generovaných povrchů chrání výchozí pás 6 m vozovky + 2 m chodníků po stranách. Nevyhovující objekt zůstane vynechaný s důvodem. Dům přes hranici oblasti se neořezává. Speciální stavby, části, jiné vrstvy a zvýšené základy vyžadují ruční model. Celá obálka musí zůstat také mimo všechny vnitřní otvory multipolygonu; vyplněnost se počítá z plochy po odečtení otvorů. Členské cesty se samostatně nenabízejí, aby jejich půdorys nevložil druhou budovu do nádvoří.

Geometrie ani UV původního modelu se nepřepisují. Volitelně se použije stejnoměrné měřítko 85–115 %, jinak původní velikost. Cílem je `height` v metrech nebo stopách, odhad `building:levels × 3 m + 3 m střecha`, nebo ruční náhradní výška. Poslední dvě varianty jsou výslovně označené odhady; model musí mít výšku 65–145 % cíle. OSM výška není přepsaná na skutečnou přesnou výšku herního domu. Orientace vybírá mezi protilehlými směry podle nejbližší vozovky za předpokladu přední strany lokální −Z; umístění a směr zůstávají ručně upravitelné. Nejde o přesnou rekonstrukci staveb.

Nejvýše 128 vybraných půdorysů a 32 vložených domů; konzervativní společný rozpočet 60 000 kolizních vrcholů včetně povrchu ulic ponechává rezervu pro šablonu. Zápis KLZ navíc ověří skutečný limit a mřížku. Každý dům má přesný statický povrch, evidenci vlastnictví a hash zdrojového modelu. Změněný katalog import odmítne před zápisem. Uložený zdroj obsahuje volby, hashe, přiřazení, důvody vynechání a výškové odhady; stejný podklad/katalog/nastavení vytvoří byteově shodnou scénu a KLZ. Vše vznikne jednou projektovou transakcí s exportem a undo.

### Složené půdorysy a nádvoří

`footprints.js` spojuje úplné `type=multipolygon` relace s `building` na relaci. Cesty outer/inner mohou být neoznačené, rozdělené, otočené či v jiném pořadí; propojují se podle ID koncových uzlů. Každý obrys se kanonizuje podle ID, takže pořadí a směr členů nemění identitu části `relation/ID/část`. Way ID a relation ID mají oddělený jmenný prostor. Starší uložené číselné výběry cest zůstávají načitatelné.

Nejvýše 128 členských cest, 32 prstenců a 256 hran na uzavřený obrys. Chybějící cesty/uzly, otevřené či nejednoznačné spoje, duplicity, samoprůniky, dotýkající se či překryté obrysy a otvory mimo vnější část se označí konkrétním důvodem. Otvor musí mít právě jednoho vlastníka. Vnořené relace, role jiné než outer/inner, starší značení jen na členské cestě a `type=building` s 3D částmi vyžadují ruční model; jejich známé členské building ways se nikdy tiše nenahradí plným vnějším půdorysem. Dotyk vnitřního a vnějšího prstence se zatím nepodporuje.

Náhled používá stejná normalizovaná data a vykreslí otvory průhledně. Výběr oddělených částí a hashe katalogu se ukládají do zdroje; host znovu sestaví půdorysy a osazení z raw dat. Jeden původní model vyplní jen vyhovující část obálky a nevytvoří celý prstencový dům. Úzká křídla nebo příliš malá vyplněnost zůstanou vynechané. Tato funkce chrání nádvoří, ale ještě nestaví souvislé městské bloky. Alternativní plný plášť je popsaný níže.

Dotaz Overpass získává cesty a building relace oblasti, rodičovské building/multipolygon relace vybraných cest a jejich členské cesty/uzly. Jediné `out body` po sjednocení brání duplicitním prvkům. Změněný dotaz má jiný klíč cache; původní uložené neúplné podklady si uživatel může ponechat, chybějící členové se v nich nedoplňují odhadem.

## Domy podle celých půdorysů

Volitelný režim `buildings.mode = footprint` používá `building-shells.js` a samostatný hashově ověřený katalog `building-shell-assets.js`. Původní režim bez `mode` zůstává kompatibilní. Každý vyhovující uzavřený půdorys vytvoří vlastní nativní 4DS: přízemí, horní fasádu, římsu, vnitřní stěny nádvoří a triangulovanou střechu s otevřenými otvory; výchozí starší importy mají plochou střechu, nová volba tvarování je popsaná níže. Otvor nedostane ani střešní kolizi. Původní normály, winding a transformace se kontrolují na nativních souřadnicích. Nejde o přesnou rekonstrukci architektury; [OSM 3D model budov](https://wiki.openstreetmap.org/wiki/Simple_3D_Buildings) rozlišuje obrys, celkovou výšku, střechu a části, které tento první generátor všechny neinterpretuje.

Dva volitelné styly odkazují jen na původní BMP uživatelovy hry. Metrické rozměry opakování vycházejí z původních fasád `3rad03` a `newdum8`, ne z roztažení obrázku přes celou budovu. Celé okenní moduly se upřednostní jen do 15 % rozdílu; krátká hrana zachová metrický výřez. Přízemí a římsa mají oddělené UV, V míří stejně jako u původních fasád. Střecha používá souvislou krytinu `3STRE1.BMP`. Herní obrázky se nedistribuují s pluginem.

Platí stejné explicitní výšky/odhady jako u původních domů. Zvláštní stavby a 3D části se vynechají. Celý půdorys musí ležet v oblasti a mimo vozovky, chodníky i ostatní domy; samostatná budova v nádvoří je možná. Nejvýše 128 vybraných půdorysů, 64 domů, 120 m výšky a společný konzervativní rozpočet 60 000 unikátních kolizních vrcholů. Překročení rozpočtu vynechá celý dům. Nativní writer kontroluje konečné limity KLZ. Všechny modely, scéna, síť, KLZ, evidence kolizí a zdroj vznikají jedinou atomickou transakcí. Hashový konflikt BMP zastaví import před zápisem. Uložený podklad znovu sestaví plán z raw OSM dat a skutečných textur, nedůvěřuje uloženým odvozeným modelům.

### Tvary střech

**Tvarovat střechy** v režimu celých půdorysů zapíná `buildings.roof`. Nové nastavení nabízí plochou, sedlovou a pultovou střechu, náhradní výšku 0,5–15 m a hřeben podél či napříč delší straně. Dostupné značky OSM lze použít nebo vypnout. Podklady bez této nové volby zůstanou při otevření i opakování byteově ve starším plochém režimu.

`building-roofs.js` čte podporované `roof:shape`, dále `roof:height` v metrech/stopách, odhad z `roof:angle` nebo `roof:levels × 3 m`. [Výška střechy](https://wiki.openstreetmap.org/wiki/Key:roof:height) je součástí `height`, nepřičítá se nad celkovou výšku. Bez `height` se počet běžných pater odhaduje po 3 m a přičte se zvolená výška střechy. Náhradní celková výška zůstává celkovou výškou. Střecha se omezí na 30 m a zachová alespoň 3 m fasády; omezení i chybné/nepodporované značky mají upozornění u domu. Valbové, mansardové a jiné nepodporované tvary dostanou výslovně uvedenou zvolenou náhradu.

[Směr střechy](https://wiki.openstreetmap.org/wiki/Key:roof:direction) je spád od hřebene k okapu (0° sever, 90° východ; také 16 světových stran), u sedlové střechy tedy kolmý k hřebeni. Bez něj `roof:orientation` nebo ruční náhrada řídí odhad podle nejmenšího obdélníku ve směrech hran půdorysu. Směr je označený jako odhad. Složené/konkávní domy používají jediný společný směr; členité střechy, vikýře, přesahy a dílčí 3D střechy se zatím nerekonstruují. Rozsah tvarů vychází z [OSM roof:shape](https://wiki.openstreetmap.org/wiki/Key:roof:shape).

Sedlová plocha se rozdělí v hřebeni před triangulací, včetně konkávních částí a otvorů nádvoří. Štíty a stěny nad okapem se uzavřou, normály míří ven. UV krytiny používají skutečnou délku po sklonu, nikoli zkrácený půdorysný průmět. Stejné trojúhelníky vstupují do vlastněné KLZ kolize. Host znovu sestaví plán z raw podkladu a nastavení; zdrojová data, modely a kolize zůstávají v jedné transakci a undo.

## Síť, zdroj a licence

Pouze výslovné načtení uživatelem, jeden dotaz najednou. Nejvýše 8 MB a 60 000 prvků, 45s timeout, žádné automatické retry, minimálně 30 s mezi síťovými dotazy na tentýž server, cache 24 hodin v soukromém `local/osm-cache`. Odpověď s chybou/remark nebo chybějícími uzly se odmítne. Cache se validuje stejně jako síť. Renderer nemá otevřený přístup na internet. Nepoužíváme mapové dlaždice, Nominatim, Google Maps ani placené služby. Import neupravuje OpenStreetMap.

V náhledu i exportu je atribuce OpenStreetMap contributors a ODbL 1.0 s odkazy; raw podklad zůstává v projektu, nikoli ve veřejném repozitáři zdrojového kódu. Plné budoucí distribuování generovaných map a odvozených databází musí zachovat odpovídající licenční podklady.

Primární reference ověřené 16. 10. 2026:

- [Overpass API: veřejné instance, účel, limity a identifikace aplikace](https://wiki.openstreetmap.org/wiki/Overpass_API).
- [Overpass QL](https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL).
- [OSM width: jednotky a šířka vozovky](https://wiki.openstreetmap.org/wiki/Key:width).
- [OSM sidewalk: směry stran, hierarchie a separate](https://wiki.openstreetmap.org/wiki/Key:sidewalk).
- [OSM šířka chodníku](https://wiki.openstreetmap.org/wiki/Key:sidewalk:both:width).
- [OSM multipolygon: outer/inner, spojování a platnost](https://wiki.openstreetmap.org/wiki/Relation:multipolygon), [3D seskupení building](https://wiki.openstreetmap.org/wiki/Relation:building).
- [OSM budovy](https://wiki.openstreetmap.org/wiki/Key:building), [výšky a části](https://wiki.openstreetmap.org/wiki/Simple_3D_Buildings), [počet podlaží](https://wiki.openstreetmap.org/wiki/Key:building:levels).
- [OSM lanes: počet pruhů a výluky](https://wiki.openstreetmap.org/wiki/Key:lanes).
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

### Ověření individuálních profilů

Šest veřejných testů `test/osm-profiles.test.js`: délky a odhady, hierarchie stran/šířek, nejasné údaje, jednostranná geometrie i opačná jednosměrka, žádný chodník, různě široká křižovatka/zakřivení bez překrytí horních ploch, otvory a zachované tagy přes plánování.

Soukromé skutečné UI `local/osm-profiles-ui-W33OWr`: pražský podklad s ručně zvoleným náhradním levým profilem vytvořil 611 trojúhelníků; přesný export/reopen/undo, opakovaný import s byteově shodným 4DS, obnovení starších původních nastavení (1327 trojúhelníků), explicitní vypnutí povrchů, zneplatnění změnou středu a dostupnost voleb odhadu podle nadřazených přepínačů. V nasazené desktopové aplikaci se navíc přes skutečný systémový výběr souboru ověřilo načtení uloženého profilu (7.25 m, levý chodník 1.25 m, odhad vypnutý); projekt se při této kontrole neměnil. `local/osm-profiles-view-YMpxwM` ověřuje nové různě široké/jednostranné kontrolní ulice ve skutečném WebGL včetně všech tří původních textur bez chyb. Kontrolní tagy v tomto druhém vzorku jsou syntetické, nikoli skutečně změřené pražské ulice.

Nativní GOG/Wine test `local/osm-profiles-game-UQJyd3`: syntetická síť v pražském středu s šířkami 8/4/6 m, levým/pravým chodníkem a opačnou jednosměrkou. Čtyři paprsky v novém autosavu potvrzují vozovku Y=.05, levý chodník Y=.2, obrubník na Z=4 a žádný chodník na protější straně (pouze základní podlaha Y=0). Kontrola bez kolizí zasáhne na obou stranách pouze podlahu a boční paprsek mine; přesné hashe nasazeného modelu/KLZ. Po testu se zastavilo vlastní Wine a vrátila historie izolovaného projektu; původní soubory jsou byteově shodné.

Kontroly: 84 relevantních testů prošlo; check/build prošly, celá sada 674 testů má 673 úspěšných a jediný dříve existující nesoulad textu chyby v `mission-dialogue.test.js` (`/současně/` versus „vyberte pouze jednu šablonu“). Nesouvisející test se v tomto bloku nemění.

### Ověření přiřazení domů

Osm veřejných testů `test/osm-buildings.test.js`: otočené/konkávní půdorysy, přesné umístění modelů s posunutým lokálním počátkem v nativních WXYZ souřadnicích, stejnoměrné či vypnuté měřítko, vyloučení ulic/chodníků/sousedů, výškové tolerance a zdroje odhadů, nepodporované/otevřené/přesahující stavby, limity domů a kolizních vrcholů, determinismus, známé členy složených budov/multipolygonů, katalog skutečné syntetické 4DS geometrie, hash a odmítnutí neplatných cest.

Soukromý Electron audit `local/osm-buildings-ui-1JN6yB`: skutečný pražský podklad, 16 dostupných modelů a 9 umístěných domů; 45 vynechaných půdorysů s vysvětlením. Skutečná tvorba mise, 10 vlastněných kolizních povrchů včetně ulic, jedno undo, přesun/smazání domu včetně KLZ, export/reopen, byteově shodné opakování importu, hashový konflikt bez zápisu a kompatibilní vypnutí domů. Test neprováděl síťové požadavky.

`local/osm-buildings-view-CROBHC` zobrazuje skutečnou složenou scénu přes aplikací používaný WebGL renderer, 54 původních textur bez chyb. Nativní GOG/Wine test `local/osm-buildings-game-UThRnG` spustil skutečnou pražskou síť se stejnými devíti domy. Čtyři paprsky na střechy prvních čtyř domů v novém autosavu zasáhly vypočtené body do 2 cm. Kontrolní běh s vypnutými kolizemi těchto domů všechny čtyři plochy minul; ověřily se i přesné hashe nasazeného povrchu/KLZ. Vlastní Wine bylo po testu zastavené a historie izolovaného projektu vrácená, původní data byteově zachovaná. Nejde o test každého domu ani hráčský průchod celým městem.

Po tomto bloku 92 relevantních testů prošlo. Celá sada má 682 testů, 681 úspěšných a tentýž dřívější nesouvisející nesoulad textu chyby v `mission-dialogue.test.js` popsaný výše.

Běžící nasazená aplikace také přes skutečné IPC načetla katalog a vytvořila novou ukázku `WB_OSM_BUILDINGS` v soukromém kontrolním projektu. V seznamu i 3D mapě je všech devět samostatných domů; starší mise zůstala zachovaná.

### Multipolygonové budovy (16. 10. 2026)

Sedm veřejných testů `test/osm-footprints.test.js` ověřuje dělené a otočené členské cesty, stabilní oddělené části, nádvoří, neúplná či nejednoznačná data, překryvy, starší značení na outer way a výběry bez kolize ID. Plánování ověřuje celou plochu i výslednou nativní transformaci domu mimo otvor. Související sada: 71/71; `npm run check` a build prošly. Celá sada: 688/689; jediná dřívější chyba `mission-dialogue.test.js` očekává `/současně/` místo stávající zprávy „vyberte pouze jednu šablonu“, mimo tento blok.

Soukromé skutečné Electron UI `local/osm-multipolygons-ui-idwfi4`: 67 půdorysů, 13 složených relací, výběr a zrušení textových relation ID, 10 původních domů (jeden v multipolygonu), 57 vynechaných, jeden společný krok historie. Pixel nádvoří má barvu pozadí, ne vyplněné budovy. Export/reopen, posun kolize se scénou, smazání/undo, byteově shodný opakovaný import, změněný hash bez zápisu a explicitně vypnuté budovy prošly. `local/osm-multipolygons-view-pGDSW9` používá skutečný WebGL a 54 původních BMP bez chyb načítání.

Nativní GOG/Wine `local/osm-multipolygons-game-DUFu4Y`: čtyři svislé paprsky zasáhnou skutečné střechy (včetně domu složené budovy) do 2 cm od očekávaných ploch; pátý paprsek v nádvoří zasáhne pouze původní podlahu Y=0. Kontrolní běh po vypnutí kolizí domů střechy mine a nádvoří stále zasáhne podlahu. Výsledky jsou z čerstvých autosavů, nasazené soubory mají očekávané hashe. Vlastní Wine po testu ukončeno, původní projekt i herní data byteově beze změny.

Živý dotaz Private.coffee úspěšně vrátil 1756 prvků a všech 13 úplných building relací pražského vzorku. Pozdější kontrola konečného rozšířeného dotazu s rodiči starších multipolygonů narazila na HTTP 500 (Private.coffee) a HTTP 504 s výslovně přetíženým dispatcherem (FOSSGIS); tuto poslední variantu proto nelze označit za úspěšně živě ověřenou. Offline import úplného získaného podkladu prošel výše uvedenými kontrolami. Žádné automatické retry ani změny síťových limitů nebyly přidány.

Nasazená hlavní aplikace přes skutečný systémový výběr načetla nový úplný podklad a obnovila půdorysy i katalog. V kontrolním projektu vytvořila `WB_OSM_COURTYARDS` jedním krokem historie (41 → 42): 10 domů, 11 kolizních skupin včetně ulic, opravená dlažba `^chdnk02.bmp`. Nová mise i vybraný dům `OSM_R_4444474_1` byly ověřené ve 3D pohledu. Předchozí ukázky zůstaly zachované.

### Plné půdorysné domy (16. 10. 2026)

Sedm veřejných testů `test/osm-shells.test.js` ověřuje konkávní a prstencové pláště, plochu a otvory střech, vnější i vnitřní winding, světové souřadnice/kolize, metrické UV, explicitní výšky/odhady, vyloučení ulic/sousedů/hranice, validaci katalogu a hashů i limity počtu domů/kolizních vrcholů.

Soukromé skutečné Electron UI `local/osm-shells-ui-u64UYH`: na stejném úplném pražském podkladu původní režim umístil 10 domů, nový režim 27 plných plášťů (2 s nádvořími), 40 půdorysů má konkrétní důvod vynechání. Volby/přepnutí, skryté neplatné ovládací prvky, výběr/odvýběr, save gating, 28 vlastněných kolizních skupin, byteově přesný export a opakovaný import, přesun/smazání s kolizí a undo, změněný hash bez zápisu a vypnutí domů prošly. Skutečný WebGL `local/osm-shells-view-K4aFjn`: 28 objektů, 9 načtených původních BMP, 111 materiálů s texturou, bez upozornění. Plochá střecha a opakovaná fasáda jsou viditelné zjednodušení, nejde o hotové věrné město.

Nativní GOG/Wine `local/osm-shells-game-omneB3`: čerstvý autosave ověřil dva zásahy střech, vnější stěnu a stěnu nádvoří do 2 cm od očekávané geometrie. Svislý paprsek otvorem zasáhl pouze podlahu Y=0. Kontrolní běh bez kolizí testovaných domů jejich čtyři plochy minul. Nasazené soubory mají přesné hashe, vlastní Wine ukončeno, původní projekt a herní soubory stejné. Nejde o kompletní hráčský průchod ani ověření provozu.

Finální související sada 78/78, `npm run check`, build a `git diff --check` prošly. Před přidáním sedmého testu limitů měla celá sada 694/695; selhal pouze dříve zaznamenaný nesoulad chybového textu v `mission-dialogue.test.js`. Finální kontrola limitů prošla v sedmi nových testech i cílené sadě.

Nasazená aplikace přes skutečné systémové dialogy načetla uložený podklad i šablonu a vytvořila `WB_OSM_BLOCKS` v odděleném kontrolním projektu (historie 42 → 43). Nových 38 souborů zahrnuje 27 samostatných domů a model ulic; 28 vlastněných kolizních skupin, dva otevřené otvory nádvoří, opravená dlažba `^chdnk02.bmp`. Výběr a zarámování domu s nádvořím byly ověřené ve 3D mapě. Předchozí mise zůstaly zachované; snímek `local/osm-shells-production.png` je soukromý.


### Ověření střech (16. 10. 2026)

Pět veřejných testů `test/osm-roofs.test.js` ověřuje roviny obou sklonů a štíty, spád N/E/stupně/světové strany, odvozenou orientaci i opačný a dělený obrys, metrické UV po skutečném sklonu, konkávní/nádvořní otvory a normály, nativní kolize, celkové výšky/patra/omezení a upozornění, normalizaci roof značek way i relací a legacy režim. Dalších 360 soukromých otočených konkávních modelů se úspěšně převedlo do nativní geometrie. Původní plochý writer porovnán byteově s předchozím commitem.

`local/osm-roofs-ui-WgUtFu`: skutečný renderer/dialog Electron s projektovým IPC mostem a offline pražskými daty. Přepnutí všech tří tvarů, 27 domů, dvě nádvoří, 28 kolizních skupin, přesný export/reopen/opakování importu, posun/smazání/undo, konflikt textur bez zápisu, vypnuté budovy a obnovení starého podkladu s automaticky vypnutými střechami prošly. `local/osm-roofs-view-nQHKIF` používá sdílený skutečný WebGL renderer, 28 objektů/9 BMP/111 materiálů s mapou, bez varování; přehled a uliční pohled vizuálně zkontrolované. Textury jsou z původní hry, ne veřejné přílohy.

`local/osm-roofs-game-MEqN0z`: čerstvý nativní GOG 1.2/Wine autosave ověřil dvě sedlové střešní plochy, vnější a nádvořní stěnu do 2 cm. Otvor nádvoří zasáhl pouze podlahu Y=0. Kontrolní běh bez vlastněných kolizí domů všechny čtyři jejich plochy minul, nádvoří dál zasahovalo podlahu. Všech 27 nasazených 4DS má přesné bajty finálního writeru; KLZ/povrch hashe shodné, vlastní Wine ukončeno, původní chráněné projekty a hra zachované. Tato konkrétní herní zkouška nezahrnuje hráčský průchod ani ověření všech typů střech.

Finální celá sada 700/701, pouze známý nesouvisející textový nesoulad v mission-dialogue.test.js. Check, build a diff check prošly. Nasazená hlavní aplikace přes skutečné výběrové dialogy vytvořila samostatnou WB_OSM_ROOFS (historie 43 → 44), předchozí mise se nemění. 27 domů má 28 vlastněných kolizních skupin včetně ulic a dvě volná nádvoří. Finální aplikace byla znovu spuštěna a nová scéna otevřena se zarámovaným domem s nádvořím. Soukromý snímek `local/osm-roofs-production.png`.
