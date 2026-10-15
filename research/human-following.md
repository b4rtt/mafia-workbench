# Pěší doprovod hráče pomocí NPC

Stav: 15. října 2026.

## Použití a hranice

Při přidání postavy nebo přes **Objekt → Chování postavy… → Doprovod hráče** nastavte volitelný startovní signál, prodlevu, nepohyblivý cílový objekt s poloměrem a signál po příchodu. Mise musí mít jednoznačného aktéra Tommy typu Player. Signály jsou pojmenované detektory typu 5; odkazy se ověřují při publikaci a řeší bez ohledu na velikost písmen. Pohyblivý aktér, hráč, vlastní NPC a nejednoznačný frame nejsou platné cíle.

NPC sleduje hráče pěšky s odstupem dvou jednotek. Cílová koule používá světovou polohu NPC včetně výšky a kontroluje se po dojití k hráči; není to nepřetržitý prostorový trigger během AI akce. Hráč musí u cíle počkat. Doporučený poloměr je větší než dvě jednotky se započítáním rozdílu výšky. Po příchodu se následování vypne, odešle se případný signál a program zůstane aktivní. Bez cíle se akce opakuje a neodesílá dokončení. Je to chování postavy, nikoli kompletní průvodce eskortním questem; ochranu NPC nebo neúspěch lze řešit samostatným úkolem.

Šablona nemění výzbroj, ostatní programy ani navigaci. Potřebuje průchozí povrch a vhodnou síť. Smrt NPC neodesílá dokončení. Nenastupuje automaticky do auta a neposkytuje časový limit ani obnovení mrtvého NPC. Jiný herní program může akci přerušit. Ruční chůze hráče, automobilový doprovod, boj za doprovodu a obnovení tohoto receptu z checkpointu nejsou doložené.

## Podklady a implementace

MSDR.CZ dodaná uživatelem: `enemy_followplayer`, `enemy_action_follow` a volby návratu po přiblížení a vynechání nástupu. Původní scene2.bin misí 15, 16, 18 a 19 obsahují kombinaci následování a AI akce v programech Paulie/Sam; neobsahuje se veřejně herní zdroj ani data. [Primární rozbor správy doprovodu](https://github.com/st0rm94/mafia-reverse-engineering-export/blob/main/structs/ai_follow_manager.md) popisuje propojení skupin a AI akcí, nikoli záruku pěší trasy v libovolné nové geometrii.

Sdílené human-following.js generuje přesný recept. `enemy_followplayer yes` doplňuje `enemy_action_follow 0, 2, nolink, return`; druhý příkaz vykonává AI pohyb a vrací program po přiblížení k hráči. Teprve potom se měří vzdálenost NPC od cíle. Nedokončená varianta opakuje akci po 100 ms; konec ponechá aktivní wait/goto smyčku místo vypnutí aktéra příkazem end. Počáteční signál se před čekáním nemaže. Obnovení formuláře vyžaduje shodu celého regenerovaného zdroje, včetně CRLF nebo LF. Pozměněná varianta zůstává vlastním programem.

Core zapisuje jen program vybrané NPC, s kontrolou scény a geometrie při zveřejnění, zálohou, exportem a jedním undo. Stejný formulář funguje při vytvoření i nastavení postavy.

## Ověření

483/483 testů, check a build. Datové kontroly: recepty s/bez startu, cíle a pokračování, jediná sada labelů, CRLF/LF, odchylky jako vlastní program, neplatný poloměr a prodleva, jednoznačný Player, živé vazby a statické cíle; přidání/configure NPC, jediná transakce, zachování ostatních aktérů a neznámých bajtů, přesný export/reopen/undo, souběžná změna geometrie a rollback selhaného manifestu.

Oddělený Electron projekt: nastavení startovního bodu, cíle, poloměru 3 a navazujícího bodu, neplatný poloměr blokuje Save, obnovení přesného formuláře a nezměněné nastavení disabled. Po opravě AI akce byla v UI změněna prodleva na dvě sekundy a výsledný program uložen; export se shodoval s uloženou scénou.

GOG 1.2/Wine použilo přesný opravený UI program s dvousekundovou prodlevou, startovním signálem, cílem a navazujícím bodem. Pomocný NPC přesunul hráče ve 3 s na Z=12, v 8 s odeslal start, v 15 s přesunul hráče na Z=23 a v 38 s zpět na Z=−10. Čtyři úplné save z 6/18/35/54 s mají příznaky dokončení 0/0/1/1; NPC zůstala před aktivací na Z=−5 a potom došla na Z≈21,61. Ve třetím save byla uvnitř cílové koule 3 kolem [0,1,20]. Po odchodu hráče měla ve čtvrtém save přesně stejnou polohu a vzdálenost přes 31 jednotek od něj. Tím je doložený pohyb, gate, skutečný příchod NPC i zastavení. Hráče přesouval diagnostický program; není to ruční chůze ani ověření save/load.

První zkouška samotného enemy_followplayer NPC nerozpohybovala. Doplňující čtení původních misí a MSDR doložilo nutnou AI akci; produkční recept byl opraven a znovu uložen přes UI. První neúspěšný pokus se nevydává za fungující doprovod. Druhý běh použil opravený recept a prošel všemi prostorovými a signálovými kontrolami. Soukromé save/index i diagnostické změny byly vráceny, cizí projekty a původní Game.exe mají shodné hashe.
