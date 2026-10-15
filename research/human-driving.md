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

Při uložení se načte `road.bin` odvozený ze stejné mise a kontroluje jeho hash i při publikaci. Cesta z klienta nemůže přesměrovat kontrolu na jinou misi. Síť musí obsahovat fyzicky propojenou cestu; dostupnost jednotlivých cílů, obsazení sedadla a kolizní překážky ověří až hra. Generátor nepřidává silnice, pěší navigaci ani dopravní provoz. Vystoupení lze zapnout po poslední zastávce jednorázové trasy (viz níže). Jiné skripty mohou řízení auta přerušit.

Existující NPC se mění pouze program. Model, parametry postavy i auta, silniční síť a neznámá data se zachovají. Přidání nové postavy zahrne program do stejné transakce. Změna má zálohu a jedno undo.

## Ověření

- Datové testy: obě varianty nástupu, jednorázová i opakovaná trasa, pořadí zastávek, obnova šablony, kanonické názvy, přidání NPC, export/reopen/undo, odmítnutí chybějících nebo pohyblivých cílů a statických aut. Konflikt silniční sítě i chyba publikace nesmí částečně přepsat program.
- Samostatný Electron a vlastní kopie projektu: dvě zastávky, čekání 2 a 1 sekundu, opakování, neplatný cíl se zakázaným uložením, náhled kódu, uložení a znovuotevření formuláře. Export zachoval přesný uložený program.
- GOG 1.2 / Wine v oddělené kopii: `WB_ROAD_DRIVER` došel k `WB_ROAD_CAR`, nastoupil na místo řidiče a jel mezi cíli `WB_ROAD_TARGET` a `WB_DRIVE_RETURN`. Nezávislý diagnostický program četl vlastníka/sedadlo NPC a polohu auta, pouze zdravím hráče zobrazoval dosažené stavy: 50 nástup, 70 příjezd, 90 návrat, 95 další odjezd. Konečný snímek opakované varianty ukázal 95. Varianta začátku na sedadle s jedním cílem ukázala 70.
- Do hry byly načteny přesné hashe produkčního programu a silniční sítě. Diagnostika nezadala autu pohyb. Oba běhy ukončené, diagnostické změny a lokální save vrácené. První pokus o snímek byl před vytvořením okna; druhý běh čekal na jeho skutečné vytvoření.

To potvrzuje základní nástup a jízdu v této misi. Ruční interakce hráče, obsazené auto, složité křižovatky a obnovení jízdy z checkpointu zatím potvrzené nejsou. Pozdější ověření čekání a signálů je uvedené níže.

## Návaznosti jízdy na děj mise (15. října 2026)

Ve formuláři jsou volitelné **Spustit jízdu po signálu bodu** a **Po dokončení jízdy poslat signál bodu**. Nástup obou variant začne až po inicializaci, případném signálu a prodlevě. Skript čte stav detektoru, nenuluje jej; časný signál se zachová. Příjemcem i zdrojem musí být jednoznačný detektor této mise. Jednorázová jízda vyšle dokončení po posledním cíli a jeho čekání, potom nechá řidiče aktivního v autě. Další signál ji znovu nespustí. Dokončení nelze kombinovat s opakováním. Přerušení jiným programem, smrt řidiče nebo neprůjezdná cesta nejsou automatické větve neúspěchu.

Bez signálů vzniká přesně původní zdroj v1. Nová varianta v2 se obnoví jen při přesné shodě celého programu; ruční změny zůstávají vlastními programy. Uložení používá stejné kontroly scény, geometrie a verze silniční sítě, zálohu a jedno undo. Logika mise ukazuje auto, nástup a zastávky i čtecí a dokončovací hrany. Zkontrolovat misi čte aktuální road.bin a ověří jeho propojení, vozidlo, statické cíle a detektory. Neověřuje geometrickou průchodnost trasy.

Ověření tohoto rozšíření: čtyři nové testy, 42/42 cílených kontrol chování/logiky/kontroly mise, check/build. Obě varianty nástupu, volitelné signály, legacy hash, pořadí dokončení, přesná obnova, vlastní změněný zdroj, typy a jednoznačnost vazeb, stale čtení silnic, nová i existující NPC, přesný export/reopen a jedno undo. Produkční rozhraní v místním prohlížeči nad samostatným skutečným ModProject: obnova původního v1, oba signály, blokace dokončení opakované jízdy, jedna scénová transakce, dvě návaznosti a zachovaný diagram/výběr, obnova v2 s disabled nezměněným uložením, kontrola 0 chyb a očekávané upozornění na neznámého odesílatele. Export a skutečné UI undo přesné; přípravy vrácené na historii 34, chráněné projekty a původní EXE shodné. Soukromý index local/driving-flow.json. Následné ověření v původním enginu je uvedené níže; nové okno Electronu tímto prohlížečovým testem doložené není.


## Vystoupení po příjezdu a herní ověření (15. října 2026)

**Po poslední zastávce vystoupit** je volitelná součást Jízdy vozidlem při přidávání i úpravě NPC. Po posledním zastavení a čekání NPC přirozeně vystoupí. Teprve pak program pošle volitelný signál dokončení; můžete na něj navázat rozhovor nebo další úkol. Opakovaná trasa s vystoupením se odmítá. Výchozí chování stále nechává řidiče v autě. U dveří potřebuje NPC volný průchozí prostor; kolize, jiné skripty nebo smrt mohou akci přerušit. Nejde o automatické vystupování spolujezdců ani o novou větev neúspěchu.

Podklad: místní PC rozbor enginu, parser a vykonání entity příkazu `0x1008` v `Game-ghidra.exe.annotated.c`. `enemy_usecar` bez argumentů používá aktuální vozidlo a zahájí vystoupení; dvojice argumentů zadává nástup. Obecný `human_fromcar` má v enginu druhý parametr typu frame a přesouvá k němu postavu, proto jej tento recept nepoužívá. Po návratu z akce se navíc kontroluje vlastník NPC přes `human_getowner`/`compareactors`. Vlastní dočasný slot se nekříží se sloty signálů. NPC zůstává aktivní, bez `end`.

Pouze zapnuté vystoupení vytváří přesně rozpoznávaný program v3. Bez něj zůstávají zdroje v1/v2 stejné; 18 kombinací bylo přímo porovnáno s předchozím commitem. Upravený zdroj zůstává vlastním programem. Karta Logiky mise uvádí stav po příjezdu, stejná kontrola mise ověřuje vazby a aktuální síť. Uložení mění pouze program vybrané NPC s jedním undo; žádné změny auta, navigace, geometrie nebo dalších aktérů.

Dva nové testy a rozšíření kontrol logiky/mise: obě varianty nástupu, signály i bez návaznosti, sdílený signálový slot, izolovaný scratch slot, blokace opakování, vlastní odchylky, zachování sourozenců/opaque dat, nová i existující NPC, přesný export/reopen/undo. 44/44 cílených testů, check/build.

Produkční renderer v místním prohlížeči nad odděleným skutečným ModProject: v2 otevření s vypnutou volbou, zapnutí/preview v3/save, zachovaná karta a návaznosti, správný detail, obnovená zaškrtnutá volba a disabled nezměněné uložení. Dva různé cíle, vypnuté dokončení a zapnuté opakování s vystoupením ukázaly konkrétní důvod a zakázaly save. Zrušení nezapsalo změny. Kontrola uložené mise: 0 chyb a očekávané upozornění na neznámého odesílatele startu. Přesný export/reopen a skutečné UI undo ověřené; příprava navrácená na historii 34, baseline a chráněné hashe shodné. Soukromý index `local/driving-exit-ui.json`.

Čtyři skutečné GOG 1.2/Wine běhy v oddělené kopii, vždy se shodným hashem načtené scény a produkčního programu:

- v2 s příchodem k autu: před pokynem v 6,3 s auto na Z≈0 a NPC mimo auto; pokyn v 8,4 s. U prahu Z>35 dokončení stále 0; po zastavení a nastavených 4 s čekání dokončení 1, NPC na sedadle 0.
- v2 se začátkem na sedadle: pokyn v 0,733 s před inicializací se neztratil, v 1,9 s NPC ještě mimo auto. Pozdější příjezd a dokončení potvrzené.
- v3 s příchodem k autu: při dokončení v 35,6 s je vlastník odlišný od auta, sedadlo −1 a NPC vedle auta (X≈−67,08/Z≈35,66 při autě X≈−65,68/Z≈36,69).
- v3 se začátkem na sedadle a časným pokynem: dokončení v 24,0 s, opět NPC mimo auto a sedadlo −1.

Nezávislý monitor pouze četl polohy/vlastníka/sedadlo a řídil signály; pohyb ani vystoupení nezadával. Čtyři úplné checkpointy každého běhu dokládají předstartovní stav, práh příjezdu, dokončení a stav po opakovaném pokynu. Práh Z>35 není přesný okamžik zastavení; rozdíl k dokončení nepoužíváme jako přesné měření brzdění ani délky animace. Po vynulování dokončení a opakovaném startovním signálu zůstalo auto stát a dokončení se znovu neodeslalo. Soukromé důkazy `local/driving-flow-Ilewb5/native-flow` a `native-exit`. První Node pokus nevytvořil grafické okno Wine; úspěšné běhy použily zavedený spouštěč Audit Electron. Všechny procesy ukončené, diagnostiky undo, save/index obnovené a chráněné soubory shodné. Obnovení této jízdy z checkpointu, ruční vstupy ani celé vlastní mise tím nejsou prohlášené za ověřené.
