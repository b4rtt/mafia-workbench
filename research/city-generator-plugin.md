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
