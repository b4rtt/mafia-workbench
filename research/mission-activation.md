# Aktivace úkolů, rozhovorů a boje

Stav: 15. října 2026.

## Použití

Při vytváření bodu ve 3D scéně nebo přes jeho **Nastavit…** v logice mise vyberte **Spuštění**:

- **Použití bodu tlačítkem akce** zachovává dosavadní program a text akce.
- **Automaticky po načtení / signálu** spustí recept po počáteční inicializaci a případném čekání na signál.
- **Při přiblížení hráče k bodu** čeká po inicializaci a případném signálu na hráče uvnitř kladného poloměru kolem světové polohy bodu. Je to koule se započítanou výškou, nikoli kruh na zemi ani libovolný trigger mesh. Už přítomný hráč se započítá. Jednou spuštěný program se návratem hráče neopakuje.

Úkol s automatickou aktivací vynechá první zadání a text nabídky akce; začne rovnou návazným cílem. Způsob dokončení (pěšky, konkrétní auto, inventář), neúspěch, checkpoint, přechod mise a signály se zachovají. Maska detektoru je 1: pouze hráč. Při převozu je aktivační oblast stále podmínkou přítomnosti hráče; samotné splnění cíle nadále vyžaduje vybrané auto a případně sedadlo řidiče.

Limit neúspěchu, checkpoint, rozhovorová kamera a řeč jsou až za aktivací. Diagram ukazuje způsob a poloměr. Vlastní pozměněný program se nikdy neobnoví do formuláře pouhou shodou jedné instrukce: musí odpovídat celému generovanému receptu.

## Implementace a podklady

Sdílené `mission-activation.js` rezervuje label 3/4 a flt[0] před inicializací stavu receptu. `detector_inrange 0, radius` počítá zvolené lidské typy uvnitř koule; `if flt[0] > 0` pokračuje, jinak `wait 100` a opakování. Dialogová varianta přidá vlastní flt registr. Čekání na signál má jiné labely 1/2. Ostatní podmínky se nezaměňují za aktivaci.

Podklady: uživatelem dodaná MSDR.CZ, uložená v soukromých referencích, příkaz `detector_inrange`; [výzkum detektoru](https://github.com/st0rm94/mafia-reverse-engineering-export/blob/main/structs/detector.md), části 4b/9. Podpora používá již doložený engine příkaz a nepatchuje původní hru.

## Ověření

478/478 testů, check a build: původní use/load zdroje zachované, nové přesné zdroje/CRLF, vlastní odchylky odmítnuté, oblasti a signály v diagramu, konfigurace všech tří receptů, neplatný poloměr, TextDB závislosti včetně výchozího combat use, jediná transakce, přesný export a undo.

Oddělený Electron projekt: úkol use → oblast 2,5; rozhovor load → oblast 3 s čekáním na signál; boj use → oblast 3. Nulový/nezadaný poloměr má disabled Save. Po uložení diagram obnoví oblasti a poloměry; vznikly přesně tři kroky historie a export měl hash UI scény. Původní scéna/TextDB a všechny ostatní části se následně obnovily přes undo.

GOG 1.2/Wine: diagnostické varianty úkolu a boje měly osmivteřinový limit, čekání na signál a oddělené příjemce neúspěchu; jejich UI poloměry zůstaly zachované. Rozhovor použil přesný UI program. Pomocný skript přesunul NPC do oblasti ve 3 s, odeslal signály v 8 s a hráče přesunul do oblasti ve 14 s. Úplné save z 11/21/32 s měly příznaky rozhovor/dokončení úkolového neúspěchu/bojového neúspěchu postupně `[0,0,0]`, `[1,0,0]`, `[1,1,1]`. V prvním save byl hráč přes 10 jednotek od bodu a NPC přímo uvnitř; ve druhém byl hráč uvnitř, ale osmivteřinové limity ještě nedoběhly. Pokud by je spustil NPC nebo signál v 8 s, jejich následný neúspěch by byl signalizovaný nejpozději ve 20 s. Tím je doložené čekání na hráče, podmínka signálu, řeč a časování od vstupu. Nešlo o ruční chůzi nebo ruční tlačítko akce.

První pokus startu bezpečně odmítl index zděděný z kopírovaného jiného projektu; opravený byl pouze index vlastní auditní kopie. První úspěšná zkouška měla mezilehlý save příliš brzo pro rozlišení času aktivace; rozhodující opakovaný běh jej posunul na 21 s. Vlastní hry ukončené, diagnostické programy a save/index obnovené, ochranné hashe jiných projektů a původního Game.exe shodné. Obnovení checkpointu oblasti, ruční vstup, jízda do oblasti a opakovaně spouštěné triggery nejsou tímto testem doložené. 3D vizualizace koule se zatím nepřidává.
