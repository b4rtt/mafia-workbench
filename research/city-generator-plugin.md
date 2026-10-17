# Navazující projekt: mapový generátor města

Požadavek uživatele, uložený 13. října 2026. Modul zůstává oddělený od editoru; celý generátor města dosud není hotový.

## Podmínka zahájení

Původně měl navazovat po dokončení celé vlastní hratelné mise. **16. října 2026 uživatel výslovně přesunul prioritu na OSM integraci už dnes.** Začíná proto první oddělený importní blok v `src/plugins/osm/` v rámci probíhající práce. Původní požadavek na kompletní kvalitní město i odložené vytváření TCK drah zůstávají uložené; první síť ulic není splněním celého generátoru. [Aktuální implementace a hranice](osm-integration.md).

## Požadovaný výsledek

Uživatel vybere část skutečného města na mapě. Modul z mapových podkladů a dostupných herních modelů vytvoří plnohodnotné, vizuálně propracované město pro původní Mafii, srovnatelné s prostředím skutečné hry. Nestačí hrubé bloky domů nebo orientační vizualizace ulic.

- Podklady: uživatel navrhuje OpenMaps a Google Maps, případně jiný vhodný zdroj. Přesný poskytovatel, přístup, licenční možnosti a dostupnost potřebných dat se teprve vyhodnotí; žádné placené služby ani účty zatím nejsou zadané.
- Terén: skutečné výškové rozdíly, návaznost svahů, komunikací a budov.
- Město: silnice, chodníky, domy a další stavby, parky a zeleň; použití existujících herních assetů s věrohodným umístěním a měřítkem.
- Vybavení: lampy, koše a další městské rekvizity, osvětlení a zvukové prostředí.
- Živý svět: automobilový provoz, chodci, jejich navigace a vazby na prostředí.
- Herní funkčnost: kolize, silniční i pěší sítě, sektory/portály a potřebné soubory mise; export a ověřené spuštění v enginu, ne pouze náhled v editoru.
- Kvalita: souvislé ulice, přirozené křižovatky, chodníky, osazení rekvizit a výškové napojení; výsledky musí být kontrolovatelné a ručně opravitelné v editoru.
- Generování bez AI: upřesnění uživatele 17. října 2026 nahrazuje původní představu AI generátoru. Import mapy a sestavení města nesmějí vyžadovat model, účet ani volání AI služby. Codex/Claude mohou pomáhat při vývoji pravidel a assetů; nejsou závislostí následného importu.

## Oddělení modulu

### Upřesnění vzhledu ulic a aktuální základ (14. října 2026)

Uživatel požaduje silnice a chodníky vzhledem odpovídající původní hře. Editor nově umí samostatný povrch z jednoho propojení road.bin: vozovku, dva zvýšené chodníky a obrubníky, původní městské materiály, UV v metrech a přesné kolize. Podklady a ověření jsou v [road-surfaces.md](road-surfaces.md). Tento nástroj je základ authoringu, nikoli hotový generátor města.

Po posledním náhledu uživatel současný vzhled přijal; asymetrické krajnice a přesnější tvar skutečné silnice chce ladit podle OSM. Při návrhu pluginu řešit šířku/pruhy/profil ulice, napojení chodníků a křižovatek, značení na obou stranách a návaznost textur bez deformace, spolu s reálnými výškami. OSM blok nyní umí spojené rovinné povrchy ulic/chodníků/křižovatek a kolize, individuální šířky i jednostranné chodníky podle podporovaných značek OSM a výslovně označené náhradní profily. Odhad z pruhů je volitelný; původ a upozornění se zobrazují i ukládají. Samostatná pěší geometrie, parkovací/cyklistické pásy, značení a výšky zůstávají další prací. Uživatel 16. 10. vybral jinou oblast; střed, skutečný podklad a další postup jsou místně v `local/osm-location.json`; Po ověření dvou cest s `access=no` v okolí 450 m chce rozšířit oblast kolem stejného středu; pro aktuální funkční ukázku následně schválil pokračovat zatím s Prahou. Rozšíření oblasti je další práce, současný limit zůstává 450 m.

Při zahájení navrhnout úzké verzované rozhraní pro katalog assetů, tvorbu mise a transakční zápis změn. Generátor má mít vlastní vstupy, plán a kontroly; editor dál spravuje otevření, vizuální úpravy, export a playtest. Konkrétní architektura zůstává rozhodnutím příštího goalu.

## Zadání příštího goalu

Vytvořit oddělený deterministický plugin/modul pro Mafia Workbench, který z uživatelem vybrané reálné oblasti města a vhodných dostupných mapových/výškových dat sestaví vizuálně propracované, hratelné město z herních assetů: terén, budovy, silnice a chodníky, parky, lampy a vybavení, zvuky, kolize, dopravu i chodce a jejich navigaci. Výsledek musí jít dále editovat, exportovat a ověřit v původní hře. Generování musí fungovat bez AI, se znovupoužitelnými pravidly a katalogem assetů. Vyhodnotit vhodné poskytovatele mapových a výškových dat. Zahájit po dokončení schopnosti editoru tvořit celou vlastní misi; neoznačovat hrubou generovanou mapu za hotový plugin.


## Upřesnění uživatele 17. října 2026: celé město a vzhled

- Cílem je vybrat i **celé město**, nejen současný výřez do 450 m. Současné limity ukázky nejsou cílové omezení produktu. Vstup lze sestavit po částech, ale výsledek musí být souvislý: společné OSM identity, přesné hrany terénu, průběžné ulice/chodníky, kolize, pěší i automobilová navigace bez duplicit a umělých slepých konců na hranici částí.
- Shodný uložený podklad, ověřený katalog a verze pravidel musejí vytvořit stejný výsledek bez AI a bez sítě. Případná variace má stabilní seed; závislosti, verze a původ dat se ukládají. AI není požadavkem spuštění/importu.
- Větší město potřebuje skutečné prostorové rozdělení a rozpočty. Ověřit využití nativních sektorů/portálů, LOD a instancí/cache; geometrii i kolize dělit podle doložených limitů enginu, ne zvyšováním bezpečnostních limitů naslepo. Samostatně měřit editor (načítání, výběr, paměť) a hru (snímkování, paměť, přechody oblastí, doprava). Negarantovat plynulost jen podle počtu trojúhelníků nebo syntetického náhledu.
- Priorita vzhledu: zamezit ořezaným oknům a dveřím, nekonzistentnímu měřítku fasád a nápadnému opakování stejného domu. Vycházet z původních herních fasád a domů, s respektováním jejich skutečných UV/pater/střech, materiálů a kolizí. Vhodné původní modely lze umístit například do odpovídajících půdorysů rodinných domů; nenatahovat model přes libovolný pozemek.
- Různorodost nesmí přebít mapový půdorys, výšku, návaznost ulice nebo bezpečné rozměry. Výběr podle typu/rozměrů stavby a stabilní obměna jsou součástí algoritmu, ne ručního promptu při každém importu.

Tyto požadavky nejsou dosud splněné. První navazující práce po dokončení rozpracované kontroly mise: prohlédnout původní fasády/UV a odstranit příčinu useknutých fasádních modulů; následně rozšířit vhodný katalog původních domů. Celé město a prostorové členění zůstávají dalšími většími bloky.

## Rozšířený katalog původních domů a pravidla výběru (17. října 2026)

- Katalog původních modelů má nyní 24 položek: 15 městských a devět rodinných domů. Osm nových úplných modelů `#rad013`, `#rad015`, `#rad016`, `#rad017`, `#rad018`, `#rad020`, `#rad035`, `#rad042` bylo prohlédnuto s vlastními původními texturami ve 3D náhledu i společně v Mafii. Neúplné fasády, pohyblivé modely a nevhodně usazené kandidáty katalog automaticky nepoužívá. Herní modely a obrázky zůstávají místní.
- Nové importy původních modelů mají zapnutou volbu `buildings.matching={version:1}`. Pravidla rozlišují přibližný rodinný a městský charakter podle fyzického typu `building`, nikoli podle provozovny uvnitř; viz [definice OSM building](https://wiki.openstreetmap.org/wiki/Key:building). Obecné `yes`/`residential` neznamená známou architektonickou formu, proto dovolí obě skupiny podle rozměrů. Pro nepodporované typy se zobrazí důvod vynechání. Nejde o rozpoznání okolní čtvrti ani rekonstrukci konkrétního domu.
- Chybějící výška rodinného domu má odhad nejvýše 9 m, bungalovu 6 m, současně omezený ruční náhradní výškou. Výslovné `height` a `building:levels` se tím nemění. Mírná penalizace opakování a stabilní rozlišení shodného skóre podle OSM identity/modelu zvýhodní různorodost pouze mezi vhodnými kandidáty. Půdorys, nádvoří, kolize s ulicemi/sousedy, výška a stejnoměrné měřítko ±15 % dál omezují výběr.
- Starší podklad bez verze výběru zachovává původní pravidla i vlastní podmnožinu modelů; katalog se mu sám nerozšíří. Dvanáct úplných plánů skutečného pražského výřezu je proti `af92da5` shodných včetně transformací a důvodů vynechání. Výsledek nových pravidel je opakovatelný bez AI a bez sítě.
- Kapacita výběru modelů je 32, aby pojala rozšířený katalog; limit umístěných původních domů zůstává 32 a výřez nejvýše 450 m. Původní modely a generované půdorysné domy jsou stále samostatné režimy. Společné automatické doplnění obou režimů, větší navazující oblasti a ověřené nativní sektorování/LOD jsou další otevřené bloky. Dosavadní fasádní katalog má devět stylů; tato změna přidává celé původní domy s jejich vlastními materiály.

## Společný import původních a půdorysných domů (17. října 2026)

- Volba **Původní domy a doplnění půdorysů**, uložená jako `buildings.mode='hybrid'`, propojuje oba katalogy v jedné deterministické transakci. Nejprve vybere vyhovující původní modely, ostatní podporované půdorysy zkusí doplnit úplným pláštěm se zvolenými fasádami a střechami. U každého doplnění ukládá důvod, proč nevyhověl původní model. Každá OSM identita má nejvýše jeden dům.
- Původní domy rezervují skutečné půdorysné meze a vrcholy kolizí včetně terénních soklů. Náhradní pláště nesmějí překrýt rezervace, ulice, chodníky ani jiné pláště; nádvoří zůstávají otevřená. Oba průchody sdílejí rozpočet 60 000 kolizních vrcholů a nejvýše 64 domů celkem, z toho nejvýše 32 původních. Rozpočet ulic, zeleně a osazení navazuje na celý smíšený plán. Chybějící výšky a zvláštní typy při zapnutém matching používají stejná deklarovaná pravidla pro obě skupiny.
- Formulář uchovává samostatný výběr modelů a fasád, obnoví je z podkladu a ukazuje počty původních/doplněných domů. Původní samostatné režimy zůstávají dostupné i výchozí; staré podklady se samy nemigrují. Nativní soubory čtyř starších variant jsou bajtově shodné proti `111292a`.
- Pražský výřez: osm původních a dvanáct doplněných domů, 21 kolizních skupin včetně ulic; ověřen skutečný formulář, export, opakovaný import, posun/smazání obou druhů s kolizemi a undo, konflikty hashů modelů i textur bez zápisu a načtení v Mafii. Stále jde o omezený výřez a vnější pláště bez interiérů/funkčních dveří. Větší propojené oblasti, nativní prostorové členění/LOD a jejich měřený výkon zůstávají nutné pro celé město.

## Širší využití původních textur domů (17. října 2026)

- Uživatel upozornil, že herních textur je mnohem více než v dosavadním katalogu. Prohlédnuto 65 kandidátních BMP z řad fasád/oken a dohledáno 223 použití těchto materiálů v původních modelech. Jde o pracovní výběr, nikoli úplný počet textur domů ve hře. Podklady a obrázky zůstávají místně v `local/facade-expansion/`; žádné herní pixely nejsou součástí veřejného repozitáře.
- Katalog pro půdorysný i hybridní import rozšířen z devíti na **24 odlišných fasád**. Přibyly šedé kamenné kvádry, vyřezávaný a světlý kámen, písková a terakotová omítka, tmavá/červená/teplá cihla, bílý kámen s římsami, světlá omítka, zdobená zelená, modrá, tmavá a okrová fasáda a cihla s bílými oblouky. Přízemí, horní fasáda a střecha mají samostatné materiály; rozměry atlasu jsou odvozené z původních UV, ne z názvu nebo rozlišení BMP. Výplně mezi celými bloky oken a štíty se odvozují z prohlédnutého úseku čistého zdiva/omítky.
- Výběr zůstává deterministický bez AI. Nový import nabízí rozšířený katalog a náhledy; uložený výběr devíti stylů se automaticky nerozšíří ani nepřečísluje. Původních devět receptů a pravidla plánování se nemění. Další textury a materiály původních domů lze postupně kurátorovat; větší počet stylů sám o sobě neřeší celé město, věrnou architekturu, členění fasád kolem rohů ani výkon enginu.

## Předpoklad větších oblastí: kolize po modelech (17. října 2026)

První nativní kapacitní blok ověřil zápis KLZ trojúhelníků odkazujících na samostatné první LOD visualů. Ve skutečné hře prošlo 74 498 použitých vrcholů / 147 456 trojúhelníků rozdělených do dvou bufferů, aniž by se duplikovaly do společného světového zásobníku. Šest správných zásahů do otočených/škálovaných modelů, jeden negativní bod a kontrolní běh bez nových kolizí jsou popsané v [collision-editor.md](collision-editor.md).

Tím je doložená cesta přes nynější společný limit kolizních vrcholů. Import OSM zatím zůstává omezený jako dosud: writer je připravený, ale zapojení vyžaduje verzovanou evidenci vlastnictví, zachování náhledu/přepočtu/ručních změn/undo a kontrolu modelových závislostí. Další blok má napojit tuto schopnost na generované části města a teprve potom rozšířit propojené oblasti se společnými OSM identitami. Nativní sektory/portály, LOD, paměť a reálné snímkování dál vyžadují samostatné ověření. Syntetický test není důkaz plynulosti celého města; žádná AI není nutná pro tuto cestu generování.

## Modelové kolize dostupné v editoru (17. října 2026)

Statické modely už lze běžně přidávat s přesnými kolizemi používajícími jejich vlastní LOD0 buffery. Evidence sdružuje všechny visualy pod jedním objektem a zachovává přepočet transformací, přejmenování/duplikaci/mazání, náhled, export, ruční odpojení a undo. Regrese zvládá 72 000 použitých vrcholů přes dvě části; GOG/Wine ověřil přes běžné API editoru 74 498 vrcholů a 147 456 trojúhelníků při 104 světových vrcholech. Podrobnosti a omezení viz [collision-editor.md](collision-editor.md).

OSM stále používá původní světové skupiny a dosavadní limity. Nyní lze navázat explicitním uloženým režimem kolizí, dělením generovaných visualů a odpovídajícími rozpočty, aniž by staré importy změnily výstup. Rozšíření samotného limitu oblasti by před propojením identit a ověřením nativního prostorového členění/LOD a výkonu bylo předčasné. Generování zůstává deterministické bez AI.

## Další původní fasády (17. října 2026)

Katalog má nyní **30 stylů**. Dalších šest kombinací využívá `5OKNA34`, `5OKNA36`, `5OKNA38`, `5OKNA43`, `5OKNA46` a `5OKNA51B`: cihlu s oválnými reliéfy, šalvějovou omítku, oranžovou cihlu, světlý kámen se sloupky, krémovou a broskvovou omítku. Nová přízemí používají také `5STENA15–17`, `5ZSPOD02`, `VYLOH32` a `SPODEK06`. Měřítka vycházejí z původních UV; recepty uvádějí zdrojové modely a prohlédnuté celé řady oken i čisté výplňové vzorky. Střešní materiály jsou sdílené ověřené krytiny, nejde o kopii celé původní architektury. Dva další kandidáti neprošli stávající kontrolou palety, proto se do nabídky nezařadili.

Všechny nové kombinace prošly produkčním WebGL náhledem a načtením ve skutečné hře. Import zůstává bez AI, se stabilním uloženým výběrem: starší katalogy 24 stylů nepotřebují nové textury a čtyři úplné starší varianty importu jsou bajtově stejné proti `5bd22c1`. V nově spuštěné aplikaci je celý katalog dostupný přes **Budovy a uliční zástavba → Načíst modely / styly → Povolené modely / styly fasád**. Tím lze výslovně rozšířit i dřívější výběr. Nejde o úplný soupis všech stavebních textur hry; další kurátorství, věrnější členění architektury a větší propojené město zůstávají otevřené.

## Zapojení modelových kolizí do OSM (17. října 2026)

Nová oblast výchozím nastavením používá `collisions={version:1,storage:'frame'}`. Uložený podklad bez této volby zachová starší výstup WORLD a rozpočet 60 000 bodů. Ulice, domy, sokly, zeleň, cesty i vybavení mohou odkazovat do vlastních LOD0 bufferů; vlastnictví kolizí zůstává součástí jedné transakce a obvyklého přepočtu, náhledu, změn objektů, exportu a undo. Původní modelové závislosti jsou chráněné hashi, generované části se řeší před zveřejněním z transakčních dat.

Rozpočet importéru je 240 000 použitých bodů sloučených po vlastnících, 240 000 výsledných trojúhelníků včetně rubových a 960 000 skutečných vrcholů bufferů. Úplné náklady se ověřují před zápisem, nikoli změnou bezpečných limitů jednotlivých modelů. Je to konzervativní aplikační obálka; není to maximum enginu ani důkaz výkonu celého města. Čtyři starší varianty importu dávají stejné bajty jako `bd6c8fd`. Skutečný formulář a host obnovují nový i starý režim, také pro hybridní domy.

Kapacitní import přes běžné API prošel v GOG/Wine s 61 608 body a 121 212 trojúhelníky při nulovém společném WORLD zásobníku: šest správných zásahů do obou modelů a jeden bod mimo ně. Datový import skutečné Prahy se všemi stávajícími vrstvami má 61 vlastníků a 5 583 pěších bodů; to není nativní průchod všemi větvemi. Podrobná evidence a testy jsou v DEVELOPMENT.md. Limity výřezu a počtu objektů se nyní nemění. Následuje propojení větších oblastí podle společných OSM identit a ověřené prostorové členění/LOD s měřením výkonu; generování je nadále deterministické bez AI.


### Další původní materiály: 44 stylů (17. října 2026)

Katalog rozšířen z 30 na 44 kombinací. Nové horní atlasy: `5OKNA01`, `5OKNA18`, `5OKNA25`, `5OKNA28`, `5OKNA29`, `5OKNA32`, `5OKNA37`, `5OKNA47B`, `5OKNA51C`, `5OKNA55A`, `5ZOKNA06`, `5ZOKNA07`, `5ZOKNA08` a `5ZOKNA09`. Přibyla přízemí s odlišnými výlohami, dveřmi i prkenným obkladem. Recept uvádí zdrojový model, metrické UV, celé řady oken a prohlédnutý vzorek výplně bez oken. Úzký atlas `5OKNA39` se po vizuálním testu nezařadil: jeho nesouhlasné řady oken vyžadovaly příliš mnoho nevhodné výplně. Nahrazuje jej původní dvorní omítka; parser a původní BMP zůstávají beze změny.

Jde o další ověřenou podmnožinu, nikoli kompletní soupis stavebních textur hry. Pravidla generování jsou deterministická, bez AI. Nový import může využít celý katalog; uložené výběry 24 nebo 30 stylů si zachovají původní materiály i bez nových BMP. Pro výslovné rozšíření starého výběru použijte **Budovy a uliční zástavba → Načíst modely / styly**. Nadále chybí věrnější členění architektury a generování většího souvislého města s ověřeným výkonem; samotné rozšíření fasád tyto části nenahrazuje.

## Společné identity více podkladů (17. října 2026)

**Sloučit podklady…** přijímá 2–16 úplných Overpass JSON nebo uložených `osm-source.json`. Všechny prvky se sjednotí podle dvojice typu a OSM ID, potom se jednou promítnou do aktuálně zvoleného středu a výřezu. Sdílený uzel je jediný; různé identity ve stejném místě se samy nespojí. Celé cesty i členské relace zůstávají zachované. Každá část musí být sama úplná: nesmí obsahovat timeout/remark, opakovanou identitu nebo chybějící uzly/členy. Sloučení nedokládá úplné pokrytí celé oblasti; nesmí doplňovat chybějící mapu odhadem.

Klíče objektů se porovnávají kanonicky; pořadí uzlů cest a členů relací se nemění. Jakýkoli rozdíl v geometrii, značkách, členství či dalších atributech společného prvku zastaví celou operaci, místo aby nejasně vyhrál první/poslední soubor. Pořadí vybraných souborů nezmění výsledek ani metadata. Neznámé atributy prvků se uchovají. `data.workbench_merge` verze 1 ukládá počty a SHA-256 kanonického mapového obsahu každého vstupu, jeho deklarovaný čas a počet odstraněných opakování. Názvy/soukromé cesty souborů se neukládají. Při různých nebo chybějících časech se nezapisuje jeden společný čas snímku a formulář upozorní na neověřenou návaznost. Konfliktní společné identity se odmítnou i při stejném deklarovaném čase.

Nastavení generování, výběry a výškové rastry jednotlivých uložených misí se neslučují; používá se aktuální formulář, výšky lze načíst pro společný výřez znovu. Samostatné otevření uložené mise nadále obnoví její vlastní volby. Úspěšný společný import je obvyklá atomická transakce s exportem a undo; zavření výběru nebo konflikt zachová dosavadní rozpracovaný import. Data a evidence sloučení jsou součástí exportovaného podkladu a při opětovném otevření se obnoví přehled.

Rozpočty: 8 MiB na vstup, 32 MiB celkem, nejvýše 60 000 jedinečných prvků a výsledný podklad včetně uložených nastavení nejvýše 8 MiB. Dosavadní limit **50–450 m** a limity geometrie/navigace se nemění. Tento blok je použitelný základ společného zdroje pro budoucí větší oblasti; není hotové sektorování, LOD, automatické stahování města ani důkaz výkonu celého města. Generování je bez AI a sloučení nevolá síť.

Ověření pražského podkladu rozděleného podle polohy cest na dvě překrývající se části: 1 697 + 1 647 vstupních záznamů, 1 756 jedinečných, 1 588 opakování. Produkční formulář a callback hostu s řízeným výběrem souborů vytvořily 20 domů (osm původních / 12 doplněných); všech 32 souborů mimo samotný podklad je bajtově stejných jako při importu jednoho úplného zdroje se stejnými volbami. Export/reopen, opakování uloženého podkladu, opačné pořadí částí, undo a konflikt/zrušení bez ztráty rozpracovaného importu prošly. Nativní GOG/Wine hra vytvořila čerstvý checkpoint 5500/500; ověřeno okno a načtení, nikoli průchod všemi objekty nebo výkon. Soukromá evidence: `local/osm-merge-ui-XqH6kr`, `local/osm-merge-native-ocJjMZ`. Původní hra i chráněné projekty zachované, testovací historie a save soubory obnovené.


## Prostorové části ulic a terénu (17. října 2026)

Explicitní `surface.partition={version:1,cellSize:25..250}` rozděluje až konečný společný povrch do mřížky X/Z. `osmCitySurface` používá tentýž postup v náhledu, otevření podkladu i tvorbě mise. Vypnutá volba vrací původní povrch beze změny. Vše zůstává jedním objektem `OSM_STREETS` a jedním modelem se samostatnými standardními visualy `OSM_CELL_*`; nelze zaměňovat s nativními sektory/portály nebo vzdálenostními LOD.

Trojúhelníky se oříznou o skutečné hranice buněk, interpolují normály/UV a zachovají baked světové souřadnice s jednotkovými transformacemi. Průsečíky sdílené hrany se počítají z původních konců, vnitřní rohy z původní roviny trojúhelníku. Tím se zamezuje postupnému zaokrouhlování; finální float32 souřadnice a indexy používá i kolizní zapisovač. Svislá stěna ležící přímo na hranici patří jediné buňce. Materiály, metrické měřítko textur, půdorysy i společná navigační topologie se nemění. Výstupní metadata uvádějí buňky, meze, počty trojúhelníků a vrcholů. Dělení může počet trojúhelníků/vrcholů zvýšit.

Zůstává limit 450 m a celkové limity importu. Samotný dělič odmítne více než 60 000 výsledných trojúhelníků, 512 buněk/visualů nebo neplatný standardní model; jednotlivý buffer má nejvýše 60 000 vrcholů. Světové a modelové kolize dál podléhají vlastním rozpočtům. Výkon celého města, sektorování/LOD a větší propojené oblasti nejsou tímto krokem doložené ani hotové.


### Další dvorní a uliční materiály: 52 stylů (17. října 2026)

Po připomínce uživatele, že hra obsahuje více textur domů, přibylo osm dalších ověřených sad. Katalog nyní nabízí 52 různých horních fasádních atlasů. Nové jsou `5ZOKNA02`, `5ZOKNA03`, `5ZOKNA04`, `5ZOKNA05`, `5OKNA26`, `5OKNA27`, `5OKNA31` a `%FASA3B`: dvorní omítky, pískovcové a pruhované fasády i tovární okna. Měřítko vychází z původních modelů; přízemí je vhodná opakovatelná kombinace, nikoli vždy původní přízemí téhož domu. Recepty a hranice celých řad jsou v `building-shells.js` a `building-facades.js`.

Atlas `5OKNA39` zůstává vyřazený: nestejně vysoká okna nelze bezpečně dělit společnými vodorovnými řadami bez velkých nevhodných pásů výplně. Nová `5ZOKNA03` používá celé čtvrtiny atlasu, které neřežou její různě rozmístěná okna. Pět dalších prohlédnutých BMP aktuální validátor odmítá kvůli indexům mimo deklarovanou paletu; nejsou součástí nového katalogu. Parser ani původní herní soubory se kvůli rozšíření nemění.

Produkční formulář ověřil všech 104 náhledů, export, byteově přesný opakovaný import, kolize, undo a odmítnutí změněných hashů. Všech osm nových sad se načetlo v produkčním WebGL i v izolované Mafii. Uložené katalogy 24, 30 a 44 stylů zachovávají své výběry; čtyři starší varianty importu zůstaly byteově shodné proti předchozí verzi. Další katalog načíst výslovně přes **Budovy a uliční zástavba → Načíst modely / styly** po novém spuštění aplikace. Rozšíření stále nepokrývá všechny stavební textury a nenahrazuje členění architektury nebo optimalizaci celého města.


### Zápis více nativních úrovní detailu (18. října 2026)

`writeSurfaceModel` nyní zapisuje všechny dodané úrovně standardního generovaného visualu (1–10), místo dosavadního tichého zahození všeho za první úrovní. Pro více úrovní kontroluje počty, úplné float32 buffery, indexy a materiály. Hodnota `distance` zůstává v raw nativních jednotkách, bez převodu na metry; LOD0 se nepřesouvá a dál je zdrojem přesných KLZ indexů. Nejde o serializer původních modelů: jejich existující editory nadále zachovávají neznámé části souboru.

Nativní GOG/Wine test `local/osm-lod-probe-CWiJws` ukázal dva detaily z fixních kamer ve vzdálenostech 10/30/110 při prvním raw prahu 400. Navazující `local/osm-lod-three-z26oTR` načetl tři varianty s prahy 400/2500/0: červená plocha ±4 m, zelená ±2 m a modrá ±1 m. Fixní kamery ve vzdálenostech 10/30/110 zobrazily správné barvy a velikosti; snímky byly vizuálně zkontrolované i ověřené podle dominantní barvy středu. Čerstvé checkpointy 5492–5494/sloty 492–494 doložily v každé fázi zásah do středu i do bodu `[3,10,0]` původního LOD0, zatímco paprsek v X=5 minul. To potvrzuje zachování povrchu i mimo zobrazenou nižší variantu. Platí pro tuto konfiguraci hry; škálování a další nastavení kvality vyžadují samostatné ověření. Samotný syntetický test nesnižuje náročnost města ani nedokládá jeho výkon.

První pohyblivá testovací kamera zůstávala na původní pozici, proto byla nahrazená samostatnými pevnými framy. První doplňující kolizní test nesprávně rezervoval méně float proměnných, než potřeboval druhý výstup `coll_testline` od indexu 85. Stejně selhal i kontrolní model s jediným LOD; po opravě rezervace na 90 prošlo všech šest pozitivních a tři negativní měření. Produkční kolizní kód se kvůli měřicímu skriptu neměnil. Každý běh ukončil vlastní hru, vrátil testovací historii na 38, obnovil save soubory a hashově zachoval chráněné projekty i původní EXE.

Čtyři nové datové testy pokrývají více materialových skupin, návaznost dalších visualů, zachování LOD0 kolizí, editaci nižší geometrie a odmítnutí neúplných/přetékajících bufferů. Bajty 156 dosavadních domů (52 stylů × tři výšky) souhlasí s `d81f052`. Cílená sada 39/39, celá finální sada 935/936; jediné selhání je známý nesouvisející regex dialogové transakce (`test/mission-dialogue.test.js:27`). Check, build a diff check prošly. Konkrétní logy v ignorovaném `local/lod-writer-*`.

Další nezbytný krok je vytvořit a uložit smysluplnou zjednodušenou geometrii pro generované části města, napojit ji na náhled/export a změřit přechody ve hře. Tímto blokem se automatické LOD v importu OSM nezapíná, limity oblasti ani počty objektů se nemění. Celoměstské sektorování, kapacita a měřený výkon zůstávají otevřené.

### Volitelný vzdálený detail půdorysných domů (18. října 2026)

V sekci budov je nová výslovná volba „Zjednodušit vzdálené fasády“, dostupná při skládání celých oken v půdorysném i hybridním režimu. Ukládá `buildings.lod={version:1,distance:25..250}`; vzdálenost v metrech se převádí na čtverec nativního prahu LOD0. Výchozí hodnota je 80 m, volba je vypnutá. Nastavení kvality enginu a měřítko objektu mohou skutečnou vzdálenost změnit. Starší podklady bez volby zůstávají bajtově shodné (156 domů všech 52 stylů proti `b7852c1`). Původní modely si ponechávají své vlastní úrovně.

Nižší varianta slučuje pouze svisle navazující koplanární obdélníky stejného materiálu se shodnou afinní UV funkcí, včetně celočíselného opakování atlasu. Nezmenšuje okna, nepřetahuje atlas na jiný počet pater a nemění půdorys, nádvoří, střechu, římsu ani sokl. LOD0 a jeho pořadí vrcholů zůstávají zachované pro editaci i kolize; poslední LOD má práh 0. Dům bez úspory druhou úroveň nedostane a uvede důvod. Náhled/import ukládají počet úrovní a skutečné počty trojúhelníků v `lodPlan`. 3D mise stále ukazuje LOD0; oba detaily lze samostatně zobrazit/editovat v dosavadním editoru geometrie.

Šest nových regresí ověřuje pokrytí, materiál a UV fázi všech stylů na krátkých i dlouhých stěnách, odmítnutí nekompatibilních spojů, serializované UV/normály, tři tvary střech, nádvoří, shodné přesné kolize, sokly na svahu, determinismus a neplatné volby. Produkční Electron dialog `local/building-lod-ui-TRDVnK`: 20 domů (8 původních / 12 půdorysných), 10 nižších variant, celkem půdorysné domy 2 204 → 1 526 trojúhelníků; 104 načtených náhledů. Prošly neplatná vzdálenost, závislost ovládání na celých oknech, uložená volba, byte-exact opakovaný import, export/reopen, posun/smazání/undo modelových kolizí a konflikty hashů bez zápisu.

Dosavadní produkční dialog geometrie také ověřen v odděleném Electron okně `local/building-lod-preview-3sCDrG`: obě úrovně 270/78 vrcholů se zobrazily s původními texturami a přepínáním; zavření nic nezapsalo. První měřicí skript měl chybně escapovaný CSS selektor, opraven pouze soukromý ovladač.

GOG/Wine `local/osm-house-lod-native-XAOC7c` načetl dvě identické 45m zdobené budovy s nádvořím a prahy 250/25 m ze stejně orientovaných kamer ve vzdálenosti 65 m. Produkční geometrie má 256 → 64 trojúhelníků. Oba snímky vizuálně ověřené; v pevně vyříznuté fasádě je průměrný rozdíl RGB <0,01 a maximální rozdíl 1/255. Čerstvé checkpointy 5492/5493 potvrdily zásahy stěn i střech a volné nádvoří v obou případech. Hashe modelů v testovací hře odpovídají připraveným souborům. Vlastní proces ukončený, historie vrácená na 38, save soubory obnovené a oba chráněné projekty i původní EXE hashově zachované.

Celá sada 941/942; jediný neúspěch zůstává dosavadní regex `test/mission-dialogue.test.js:27` (`/současně/` proti hlášce o jedné šabloně), bez nesouvisející opravy. Check a build prošly. Jde o snížení počtu trojúhelníků vzdálených domů, nikoli o změřené zrychlení celého města. Limit výřezu 450 m, počty objektů, sektory/portály a celoměstská kapacita zůstávají otevřené; celý goal pokračuje.
