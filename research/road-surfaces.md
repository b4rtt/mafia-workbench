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
- Na spojích segmentů může být texturový šev. Značení vložené v původní silniční textuře zatím není přestavěné na oboustranné krajnice ani napojené kolem zatáček. Pro finální město zbývají profily ulic, přechody šířek, křižovatky, speciální zatáčkové materiály a napojení na terén; uživatel chce přesnější ladění podle OSM.

## Zápis a ověření

Nový soubor má kontrolu hashů zdrojové sítě a všech tří textur, kontrolu existujícího názvu bez ohledu na velikost písmen, kontrolu BMP a atomické vytvoření s jedním undo. Během publikace se závislosti znovu kontrolují. Sdílený writer slouží výhradně novým standardním povrchům; existující 4DS nepřestavuje. Golden test zachoval předchozí terrain output přesně po bajtech.

Šest nových testů pokrývá tvar, normály, skutečnou hustotu UV na všech hranách silnice/chodníků ve svahu se zatáčkou, obrácenou trasu, nativní čtení a další editaci, přesný kolizní povrch, odmítnuté vstupy, export/reopen, concurrent dependencies, rollback a undo. Celá sada 433/433 testů, check a build prošly.

Vlastní oddělený Electron: výběr propojení, původní textury, živý náhled, odmítnutí neplatného rozměru, vytvoření, otevření 4DS a odstranění přes skutečné UI undo. Vlastní cesta se dvěma úseky, 90° zatáčkou a stoupáním vytvořila 100 vrcholů a 36 trojúhelníků. Export přesně odpovídal vytvořeným bajtům.

Native GOG 1.2/Wine: tento model vložený s přesnou oboustrannou kolizí, 72 KLZ trojúhelníků. Samostatný diagnostický program testoval dva svislé a jeden vodorovný paprsek. Zásahy vozovky Y ≈ 2,869565, chodníku Y ≈ 2,950000 a obrubníku X = −63 odpovídaly trojúhelníkům modelu s tolerancí 2 cm; jejich tři různé váhy daly HUD 77. Druhý běh ponechal stejný viditelný model a odebral jeho kolizi: HUD 70, žádný kontrolní zásah. Snímky ve 14 a 22 sekundách doložily obě varianty a herní vykreslení všech tří materiálů. Nejde o přímý test chůze hráče, průjezdu auta nebo AI provozu na novém povrchu.

Testovací hry a okno ukončené, dočasná scéna/KLZ/programy a nový model/cesta přesným undo vrácené. Izolovaná herní kopie připravená zpět z výchozí scény. Původní EXE i chráněné uživatelovy projekty mají stejné hashe. Soukromá data a snímky se nepublikují.
