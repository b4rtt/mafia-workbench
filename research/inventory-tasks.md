# Inventářové úkoly

Ve formuláři lineárního úkolu jsou dostupné **Získání předmětu** a **Přinesení předmětu k cíli**. Výběr se načítá z aktuální `tables/predmety.def`: pojmenované definice ID 2–65535, bez automatického výběru. ID 0 je prázdný slot, ID 1 zvláštní akce. Formulář nevyžaduje vizuální model, protože kontroluje inventář a nevytváří pickup.

Získání vyžaduje existenci konkrétního ID u hráče Tommy typu Player. Přinesení přidává vzdálenost hráče od jiného jednoznačného cílového objektu. Volitelné odebrání je výchozí vypnuté a provede se pouze při úspěchu. Již vlastněný předmět se započítá; jiné ID nestačí. Počet kusů a munice se nekontrolují. Předmět v mapě lze přidat samostatně přes existující editor pickupů. Získání nevyžaduje cíl ani poloměr; převoz autem se s inventářovou podmínkou nekombinuje.

## Podklady enginu

- Uložená MSDR.CZ dokumentace: `human_isweapon actor, output_float, item_id` vrací 0 nebo 1; `human_delweapon actor, item_id` odebere předmět.
- [Primární export reverzního rozboru](https://github.com/st0rm94/mafia-reverse-engineering-export): `ghidra/Game-ghidra.exe.annotated.c`, case 0x3d / HUMAN_ISWEAPON a case 0x3c / HUMAN_DELWEAPON. První volá `inventory_contains_item(id, 0)` a výsledek uloží do float registru; druhý `inventory_remove_item_by_id(id, 0)` a aktualizuje držený model.
- [Struktura inventáře](https://github.com/st0rm94/mafia-reverse-engineering-export/blob/main/structs/inventory.md) popisuje inventář v C_human a položky S_GameItem s 16bitovým ID. Konkrétní chování zde opíráme také o výše uvedené funkce: membership prochází ruku, opasek, velký slot a extra položky; neprochází zvláštní slot odložený při jízdě. UI proto tuto hranici uvádí. Nejde o obecné prohledání auta nebo celého světa.

Generátor nejprve kontroluje podmínky neúspěchu, poté členství konkrétního ID a případně vzdálenost. Poll má 100 ms. Odebrání následuje na úspěšné větvi před dokončením a signálem/přechodem; neúspěšná větev předmět neodebírá. Návaznosti, časový limit, ochrana postavy, checkpoint a konce mají zachované registry. Výchozí pěší a automobilové programy zůstávají stejné.

## Zachování dat

Vytvoření zapíše bod a jeho program společně. `configure-task` mění pouze program rozpoznaného existujícího úkolu. Přesná shoda celého zdroje s generátorem (také CRLF) chrání vlastní skripty před přepsáním. Jméno, poloha, maska, parametry a ostatní aktéři se nemění. Každý zápis má jedno undo; export obsahuje přesné uložené bajty. Core kontroluje Player, aktuální definici ID a hash skutečné tabulky, TextDB a geometrie při publikaci. Tyto závislosti sám nezapisuje.

## Ověření a limity

- 463/463 datových testů, check a build: správné/jiné ID, kombinace vzdálenosti, přednost neúspěchu, obnova různých větví, CRLF, hranice ID, zachování ostatních programů/raw dat, export/undo, stale tabulka/TextDB/geometrie a rollback.
- Oddělený Electron: změna pěšího úkolu na přinesení Door keys ID 23 k Next, poloměr 2,5, odebrání a limit 20 s. Prázdný výběr blokoval uložení; save/reopen obnovilo recept a nezměněný formulář měl disabled Save. Jedna změna scény a přesný export ověřené.
- GOG 1.2/Wine: tři izolované běhy přes produkční generátor. U přinesení použila hra přesně recept uložený UI; získání změnilo jen způsob splnění přes produkční API. Nezávislý monitor v úplných save četl konkrétní ID, vzdálenost a signály. Dokumenty ID 19 → bez úspěchu; klíče ID 23 ve vzdálenosti 20,02 → přinesení stále bez úspěchu; cíl ve vzdálenosti 0 → klíče odebrány, dokumenty zachovány, signál úspěchu 1 / neúspěchu 0. Získání ve vzdálenosti 20,02 → obě ID zachována, úspěch 1. Bez klíčů po limitu 20 s → úspěch 0 / neúspěch 1, dokumenty zachovány. Uložená scéna, TextDB a tabulka předmětů měly očekávané hashe. Převzetí a předání inventáře řídil pomocný NPC; diagnostika přiblížila cílový frame místo ručního pohybu hráče. Nejde o ruční sebrání ani průchod.
- První pomocná diagnostika opakovala čísla labelů a přeskočila mezisavy; po opravě byl původní cíl příliš blízko a přesun hráče se neudržel. Tyto pokusy nejsou pozitivním důkazem vzdálenosti. Potvrzené tři běhy používají samostatná čísla labelů a vzdálený cíl. Produkční programy nevyžadovaly opravu.
- Ruční sebrání pickupu, použití tlačítka akce, odložení při jízdě a obnovení checkpointu nové varianty zatím nejsou ověřené.
