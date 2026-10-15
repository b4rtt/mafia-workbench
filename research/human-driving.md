# Jízda NPC

Implementace a ověření: 14. října 2026. Chování je dostupné při přidání NPC a přes **Objekt → Chování postavy… → Jízda vozidlem**. Je to autorování programu postavy pro původní engine; 3D pohled pohyb auta nesimuluje.

## Program a podklady

- Místně uložená uživatelská dokumentace MSDR.CZ, příkazy `enemy_move_to_car`, `enemy_usecar`, `enemy_car_moveto` a `human_force_settocar`; reference evidované v [dokumentaci skriptování](scripting.md).
- Rozbor PC enginu v místním referenčním repozitáři st0rm94/mafia-reverse-engineering-export, EntityCarMoveTo a EnemyUseCar; předchozí ověření navigace aut v [přehledu formátů](formats.md).
- Přirozený nástup používá příchod k sedadlu 0 a jeho následné použití. Varianta začátku na sedadle přesune postavu přímo do zvoleného auta na místo řidiče.
- Každá zastávka vyhledá cílový frame, použije `enemy_car_moveto` se zastavením a potom čeká. Po posledním cíli následuje opakování nebo aktivní čekání bez `end`.
- Rozpoznávají se jen přesné programy vlastní šablony. Ručně změněné zdroje zůstávají vlastními programy; změna chování je nahradí až po uložení.

## Zápis a omezení

Jeden program obsluhuje jedno auto a 1–32 zastávek. Cíle jsou jednoznačné nepohyblivé modely, geometrické objekty nebo dummy/skriptové body; lidské a automobilové aktéry nelze použít. Auto musí mít podporovaného aktéra typu Vozidlo, statický model nestačí. Pro opakování jsou nutné alespoň dva různé cíle. Prodlevy přijímají 0–86400 sekund.

Při uložení se načte `road.bin` odvozený ze stejné mise a kontroluje jeho hash i při publikaci. Cesta z klienta nemůže přesměrovat kontrolu na jinou misi. Síť musí obsahovat fyzicky propojenou cestu; dostupnost jednotlivých cílů, obsazení sedadla a kolizní překážky ověří až hra. Generátor nepřidává silnice, pěší navigaci, dopravní provoz ani vystupování. Jiné skripty mohou řízení auta přerušit.

Existující NPC se mění pouze program. Model, parametry postavy i auta, silniční síť a neznámá data se zachovají. Přidání nové postavy zahrne program do stejné transakce. Změna má zálohu a jedno undo.

## Ověření

- Datové testy: obě varianty nástupu, jednorázová i opakovaná trasa, pořadí zastávek, obnova šablony, kanonické názvy, přidání NPC, export/reopen/undo, odmítnutí chybějících nebo pohyblivých cílů a statických aut. Konflikt silniční sítě i chyba publikace nesmí částečně přepsat program.
- Samostatný Electron a vlastní kopie projektu: dvě zastávky, čekání 2 a 1 sekundu, opakování, neplatný cíl se zakázaným uložením, náhled kódu, uložení a znovuotevření formuláře. Export zachoval přesný uložený program.
- GOG 1.2 / Wine v oddělené kopii: `WB_ROAD_DRIVER` došel k `WB_ROAD_CAR`, nastoupil na místo řidiče a jel mezi cíli `WB_ROAD_TARGET` a `WB_DRIVE_RETURN`. Nezávislý diagnostický program četl vlastníka/sedadlo NPC a polohu auta, pouze zdravím hráče zobrazoval dosažené stavy: 50 nástup, 70 příjezd, 90 návrat, 95 další odjezd. Konečný snímek opakované varianty ukázal 95. Varianta začátku na sedadle s jedním cílem ukázala 70.
- Do hry byly načteny přesné hashe produkčního programu a silniční sítě. Diagnostika nezadala autu pohyb. Oba běhy ukončené, diagnostické změny a lokální save vrácené. První pokus o snímek byl před vytvořením okna; druhý běh čekal na jeho skutečné vytvoření.

To potvrzuje základní nástup a jízdu v této misi. Přesné trvání zastávek, ruční interakce hráče, obsazené auto, složité křižovatky a obnovení jízdy z checkpointu zatím potvrzené nejsou.

## Návaznosti jízdy na děj mise (15. října 2026)

Ve formuláři jsou volitelné **Spustit jízdu po signálu bodu** a **Po dokončení jízdy poslat signál bodu**. Nástup obou variant začne až po inicializaci, případném signálu a prodlevě. Skript čte stav detektoru, nenuluje jej; časný signál se zachová. Příjemcem i zdrojem musí být jednoznačný detektor této mise. Jednorázová jízda vyšle dokončení po posledním cíli a jeho čekání, potom nechá řidiče aktivního v autě. Další signál ji znovu nespustí. Dokončení nelze kombinovat s opakováním. Přerušení jiným programem, smrt řidiče nebo neprůjezdná cesta nejsou automatické větve neúspěchu.

Bez signálů vzniká přesně původní zdroj v1. Nová varianta v2 se obnoví jen při přesné shodě celého programu; ruční změny zůstávají vlastními programy. Uložení používá stejné kontroly scény, geometrie a verze silniční sítě, zálohu a jedno undo. Logika mise ukazuje auto, nástup a zastávky i čtecí a dokončovací hrany. Zkontrolovat misi čte aktuální road.bin a ověří jeho propojení, vozidlo, statické cíle a detektory. Neověřuje geometrickou průchodnost trasy.

Ověření tohoto rozšíření: čtyři nové testy, 42/42 cílených kontrol chování/logiky/kontroly mise, check/build. Obě varianty nástupu, volitelné signály, legacy hash, pořadí dokončení, přesná obnova, vlastní změněný zdroj, typy a jednoznačnost vazeb, stale čtení silnic, nová i existující NPC, přesný export/reopen a jedno undo. Produkční rozhraní v místním prohlížeči nad samostatným skutečným ModProject: obnova původního v1, oba signály, blokace dokončení opakované jízdy, jedna scénová transakce, dvě návaznosti a zachovaný diagram/výběr, obnova v2 s disabled nezměněným uložením, kontrola 0 chyb a očekávané upozornění na neznámého odesílatele. Export a skutečné UI undo přesné; přípravy vrácené na historii 34, chráněné projekty a původní EXE shodné. Soukromý index local/driving-flow.json. Nová kombinace signálů a jízdy zatím nebyla spuštěna v původním enginu ani nově ověřena v okně Electronu; běžící hráčský test ukázky zůstal pro natáčení nedotčený.
