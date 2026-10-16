# Povrch ulice podle road.bin

Implementováno 14. října 2026 jako další nástroj pro vlastní misi a budoucí městský generátor. Plugin ani import OSM se tím nezahajují.

## Podklady z původního města

Lokální read-only rozbor `missions/MISE04-MESTO/scene.4ds` doložil oddělené materiály `^SL_6M02`, `^CHDNK01` a `^OBRUB01`. V tomto modelu mají 3957, 11221 a 3848 trojúhelníků. Dřívější zkušební `0LASFALT` je také herní textura, ale neodpovídá základnímu povrchu běžné ulice; použití na celé cestě vedlo k přehnaně popraskanému vzhledu.

U ukázkové geometrie Object98 má silnice přibližně 12 m na U a 6 m na V. Chodník má přibližně 2 m podél trasy na opakování, příčný rozměr přibližně 2,19 m. Obrubník má celou výšku asi 0,15 m přes U = 0…1 a přibližně 1 m podél trasy na V. Formulář proto nabízí vozovku 6 m, opakování 12 × 6 m, chodník 2 m s dlaždicí 2 m a obrubník 0,15 m s opakováním 1 m. Jde o volitelné výchozí rozměry, nikoli úplný profil všech původních ulic. Herní textury zůstávají jen v uživatelově místním projektu.

## Geometrie a mapování

- Zdroj je jedno vzájemně propojené crossing-to-crossing spojení road.bin v2 včetně mezilehlých bodů. Cesta zůstává beze změny. Směry/pruhy sítě neurčují automaticky šířku povrchu.
- Model má jednu standardní geometrii 4DS v29, první LOD a tři skupiny materiálů: vozovku, oba chodníky a svislé hrany se zakončením. Y je nahoru; vrcholy už obsahují světové souřadnice trasy. Při vložení ponechat identity transformaci.
- Zatáčka používá průsečík odsazených hran; příliš ostré, krátké a široké zatáčky, překryvy a neplatné souřadnice se před vytvořením odmítnou. Nejvýše 1024 bodů; model nemá spodní plochu.
- Každá dvojice trojúhelníků se rozvine kolem společné diagonály. UV zachová fyzické délky hran i u neplanárního spojení svahu a zatáčky. Hustota textury závisí na zadaných metrech; podélná fáze navazuje na vzdálenost po středové trase. Normály jsou oddělené na hranách povrchů.
- U prostorově neplanárního úseku se výška mezi stanicemi řídí výslednými trojúhelníky. Přesná kolize používá tyto stejné vrcholy, nikoli odhad podlahy z výšky osy road.bin.
- Na spojích segmentů může být texturový šev. Značení vložené v původní silniční textuře zatím není přestavěné na oboustranné krajnice ani napojené kolem zatáček. Pro finální město zbývají profily ulic, přechody šířek, obecné napojování celé sítě (nové tří/čtyřramenné středy viz níže), speciální zatáčkové materiály a napojení na terén; uživatel chce přesnější ladění podle OSM.

## Zápis a ověření

Nový soubor má kontrolu hashů zdrojové sítě a všech tří textur, kontrolu existujícího názvu bez ohledu na velikost písmen, kontrolu BMP a atomické vytvoření s jedním undo. Během publikace se závislosti znovu kontrolují. Sdílený writer slouží výhradně novým standardním povrchům; existující 4DS nepřestavuje. Golden test zachoval předchozí terrain output přesně po bajtech.

Šest nových testů pokrývá tvar, normály, skutečnou hustotu UV na všech hranách silnice/chodníků ve svahu se zatáčkou, obrácenou trasu, nativní čtení a další editaci, přesný kolizní povrch, odmítnuté vstupy, export/reopen, concurrent dependencies, rollback a undo. Celá sada 433/433 testů, check a build prošly.

Vlastní oddělený Electron: výběr propojení, původní textury, živý náhled, odmítnutí neplatného rozměru, vytvoření, otevření 4DS a odstranění přes skutečné UI undo. Vlastní cesta se dvěma úseky, 90° zatáčkou a stoupáním vytvořila 100 vrcholů a 36 trojúhelníků. Export přesně odpovídal vytvořeným bajtům.

Native GOG 1.2/Wine: tento model vložený s přesnou oboustrannou kolizí, 72 KLZ trojúhelníků. Samostatný diagnostický program testoval dva svislé a jeden vodorovný paprsek. Zásahy vozovky Y ≈ 2,869565, chodníku Y ≈ 2,950000 a obrubníku X = −63 odpovídaly trojúhelníkům modelu s tolerancí 2 cm; jejich tři různé váhy daly HUD 77. Druhý běh ponechal stejný viditelný model a odebral jeho kolizi: HUD 70, žádný kontrolní zásah. Snímky ve 14 a 22 sekundách doložily obě varianty a herní vykreslení všech tří materiálů. Nejde o přímý test chůze hráče, průjezdu auta nebo AI provozu na novém povrchu.

Testovací hry a okno ukončené, dočasná scéna/KLZ/programy a nový model/cesta přesným undo vrácené. Izolovaná herní kopie připravená zpět z výchozí scény. Původní EXE i chráněné uživatelovy projekty mají stejné hashe. Soukromá data a snímky se nepublikují.


## Společný střed křižovatky a zkrácené ulice — 16. října 2026

Ve stejném formuláři je nová volba části povrchu: ulice, nebo střed tří/čtyřramenné křižovatky. Výchozí zapnuté napojení ulice zkrátí její konce u těchto křižovatek a vynechá příčná čela chodníků na spojích. Střed i každá ulice jsou vlastní 4DS; vytvořit a vložit je je nutné samostatně. Existující modely se nepřepisují. Při napojování musí být shodné šířky vozovky/chodníků, výška obrubníku a výškový posun. Vypnutí napojení ponechá dosavadní celou trasu; kombinace takové ulice se středem by se překrývala.

Sdílený plán seřadí fyzické výjezdy kolem středu nezávisle na zapnutí dopravního směru. Vyžaduje tři nebo čtyři reciproční cesty k různým křižovatkám, bez sdílených bodů; úhlové mezery 30–180°. Střed je vodorovný ve výšce crossing + posun. Nároží vznikají průsečíky odsazených hran, včetně přímé strany T křižovatky. Společný odstup od středu vychází z nejdelšího vnějšího nároží a metrové rezervy. Každý první silniční bod musí být o dalších alespoň 10 cm dál; svah a další zatáčka začínají mimo střed. Krátká/neúplná síť, ostré či jednostranné rozložení, překrývající se protější středy a degenerace po float32 se odmítnou. Výstupní rozhraní používá přesně stejné float32 souřadnice v obou směrech ulice, nikoli znovu odhadnuté hrany.

Vozovka je hvězdicový polygon triangulovaný od středu, každý rohový chodník tvoří dvě navazující plochy se svislými vnitřními i vnějšími obrubníky. Horní normály míří vzhůru, kolize se odvozuje ze stejných trojúhelníků. Střed má plošné UV v metrech a tvrdé hrany. Materiál vozovky se zatím používá celý: čáry vložené do BMP proto mohou přecházet i přes střed. Jde o geometrické napojení, nikoli hotové dopravní značení, zaoblené rohy nebo změny profilu. Dvou výjezdů se ořez netýká; obecné spojování celé sítě, různé šířky a napojení na terén zůstávají další práce.

Šest testů ověřuje přesné plochy T/X, normály, pokrytí bez děr a překryvů i přes hranice čtyř navazujících ulic, obousměrné spoje při šikmých výjezdech, velkých souřadnicích a stoupání, UV, čtení 4DS a kolize, odmítání chybných vstupů, ochranu závislostí, export/reopen a undo. Dosavadní testy ulice a terénu dále procházejí.

Produkční renderer v odděleném Electron okně vytvořil střed a čtyři napojené ulice, zablokoval nulovou šířku i 20° výjezd, vyexportoval přesné bajty a provedl pět skutečných UI undo. Testovací IPC dodalo vlastní projekt; nebylo potřeba ovládat systémové dialogy. Native GOG 1.2/Wine následně načetl právě těchto pět vyexportovaných modelů s jednostrannou přesnou kolizí. Čerstvý úplný checkpoint doložil čtyři zásahy: střed vozovky Y = 2, chodník Y ≈ 2,150001, spoj ulice Y = 2 a vnitřní obrubník X = −47 s normálou (−1, 0, 0). Kontrolní běh se stejnými modely bez jejich kolize zasáhl třemi svislými paprsky původní podlahu Y = 0; vodorovný paprsek minul. Snímky doložily načtení textur a propojené povrchy. Nejde o důkaz průjezdu hráče nebo AI autem po této nové vozovce.

Oba běhy ukončené, vlastní klon vrácen na 38 výchozích transakcí, scéna/KLZ i chráněné projekty a původní EXE hashově shodné. Herní data, soukromé testovací skripty, checkpointy a snímky zůstávají v ignorovaném local.
