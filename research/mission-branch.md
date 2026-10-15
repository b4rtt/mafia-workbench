# Podmínky a větvení mise

Stav: 16. října 2026.

## Použití

V **Logika mise → Přidat → Přidat podmínku mise…** nebo ve stejné nabídce 3D scény vytvořte pojmenovaný rozhodovací bod. Přidejte 1–8 podmínek a zvolte, zda musí platit všechny, nebo alespoň jedna. Každou podmínku lze obrátit:

- hráč má / nemá konkrétní předmět z `tables/predmety.def`;
- vybraná lidská postava žije / nežije (`Energy > 0`);
- vybraný skriptový bod má / nemá zapnutý signál;
- hráč je / není v dosahu pojmenovaného objektu, včetně pohybující se NPC nebo auta;
- hráč je / není ve vybraném automobilu, případně pouze na místě řidiče.

Vyberte oba výstupy **Ano** a **Ne**. Výchozí režim čeká na signál z úkolu, rozhovoru, volby nebo jiného programu. Bez něj rozhodne dvě sekundy po načtení mise. Rozhodnutí proběhne jednou: nečeká na budoucí splnění podmínek a pozdější změna stavu jej znovu nespustí. Například dokončení úkolu může aktivovat podmínku „hráč má klíče a Sam žije“ a teprve její výstup zahájí další rozhovor nebo větev neúspěchu.

Uložený uzel znovu otevřete přes **Nastavit…** v diagramu nebo **Objekt → Nastavit podmínku…** ve 3D. Nezměněné nastavení nelze zbytečně uložit. Každé skutečné uložení má jeden krok undo. Zdroj programu je před uložením vidět.

## Chování a ochrana dat

Podmínka neodebírá předměty a nenuluje čtené signály. Právě jeden výstup dostane signál 1; druhý se nemění. Signál je příznak bodu, nikoli zpráva, že jeho vlastní program doběhl. Fialová přerušovaná hrana označuje čtení příznaku; nezapočítává se jako aktivace ani jako cyklus návazností. Výstupy rozhodnutí mají samostatné porty Ano / Ne.

Inventář vyžaduje jednoznačného hráče Tommy typu Player. Kontroluje přítomnost ID, nikoli počet kusů či munice; zbraň odložená při jízdě se nemusí započítat. Život odpovídá hodnotě Energy, nikoli přítomnosti libovolného modelu. Zmizelý či nenalezený aktér nemůže převzít kladný výsledek předchozí inventářové podmínky. Odstranění NPC vlastním skriptem a všechny možné situace save/load vyžadují samostatné ověření.

Vzdálenost a automobil také vyžadují Tommyho typu Player. **Dosah** je koule o poloměru 0,1–10 000 m mezi počátkem hráčova frame a aktuálním počátkem cíle ve světě, včetně výšky. Platí přísné `vzdálenost < poloměr`; rozměry modelu, stěny, průchodnost a natočení se neposuzují. Cílem může být frame ze scény nebo geometrie; jedna geometrická základna a jedno scénové přepsání téhož jména se slučují. Duplicity v kterémkoli zdroji, Tommy a vlastní podmínkový bod se nenabízejí. Nejbližší objekt se nevyhledává.

**Automobil** musí být skutečný jednoznačný aktér typu Car s modelovým frame; samotný model auta nestačí. Bez omezení na řidiče stačí libovolné sedadlo vybraného auta. S omezením musí hráč sedět právě na sedadle 0. Negace obrací celou tuto podmínku: „není v automobilu“ s omezením na řidiče tedy platí také pro jeho spolujezdce, nejen pro hráče venku. Pobyt v jiném autě podmínku přítomnosti ve vybraném autě nesplní. Nastupování/vystupování není samostatně modelovaná fáze; čte se aktuální stav enginu.

Za běhu chybějící frame znamená nepravdivé „je v dosahu“ a chybějící auto či hráč nepravdivé „je v automobilu“; negace tento výsledek běžně obrátí. Kontrola mise chybějící uložené vazby předem hlásí jako chyby. Registry se před čtením nulují a chybějící vazba nepřevezme výsledek předchozí podmínky. Srovnání dvou prázdných registrů se nikdy nepoužije jako důkaz přítomnosti v autě.

Výstupy a čtené body musí být jednoznační skriptoví aktéři s frame, postavy jednoznační lidští aktéři s frame. Vlastní bod nelze zvolit za výstup ani čtený signál. Kontrola mise hlásí chybějící vazby a neplatné předměty. Před zápisem se ověřují verze scény, geometrie a případně tabulky předmětů; souběžná změna operaci odmítne.

Rozpoznání vyžaduje přesný celý program včetně metadat, jednoznačného detektoru a masky 1. Ručně pozměněný program zůstane vlastním skriptem a formulář jej nepřepíše. Změna upravuje pouze scénu; geometrie, ostatní programy, texty, tabulky a neznámé binární bloky zůstávají zachované. Po změně spusťte misi znovu.

## Ověření

Deset datových testů pokrývá původních 128 kombinací inventáře/života/signálů a dalších 1 200 kombinací dosahu, výšky, auta, sedadla, negací a všechno / alespoň jednu. Dále ověřují přesnou hranici dosahu, chybějící a opakované vazby, nulové registry, neplatné poloměry, čekání na signál, časný signál, neplatné závislosti a vlastní změněný zdroj. Zachování starého programu dokládá hash pořízený před rozšířením. Produkční projektové operace ověřují vytvoření, změnu, no-op, export/reopen, undo, souběžnou změnu závislostí a rollback selhaného zápisu.

Rozšíření 16. října: produkční renderer nad oddělenou kopií mise vytvořil dosah k Prijemce 5 m a pobyt za volantem UI_DELIVERY_CAR, odmítl nulový poloměr a obnovil obě pole s disabled no-op uložením. Poté změnil dosah na 7,5 m, libovolné sedadlo a alespoň jednu podmínku. Diagram ukázal správné popisky i dvě výstupní hrany bez falešné hrany čtení signálu. Export měl přesný hash. Stejný uložený formulář a zablokované nezměněné uložení byly přečteny také v nativním Electron okně přes produkční IPC. Testovací změny se vracejí přes undo; uživatelská mise se nemění.

GOG 1.2 / Wine, rozšíření 16. října: 28 přesných generovaných bodů, sedm pro každý stav pěšky / v jiném autě / na sedadle spolujezdce vybraného auta / na sedadle řidiče. Čtyři čerstvé úplné checkpointy v 4 725, 8 399, 12 070 a 15 740 ms potvrdily obě výstupní větve, negaci řidiče, libovolné sedadlo, dosah pohybujícího se auta, výškově vzdálený bod a kombinace všechno / alespoň jednu. Testovací program měnil sedadla pomocí human_force_settocar; nejde o ruční nastupování ani hráčský průchod. Hash připravené scény byl shodný se zdrojem. Studený první pokus skončil před oknem Wine; opakování s explicitním Explorerem prošlo. Produkční spouštěč se tímto blokem nemění. Soukromé procesy ukončené, uložené hry obnovené a chráněné původní soubory beze změny.

Primární podklad: lokální export původního dispatcheru ve `st0rm94/mafia-reverse-engineering-export`, opcode FINDFRAME 0x0d, FRM_GETWORLDPOS 0xfc, HUMAN_GETOWNER 0x68, HUMAN_GETSEATIDX 0x14b, COMPAREACTORS/SETNULLACTOR 0x12e/0x12f a COMPAREFRAMES/SETNULLFRAME 0x130/0x131. Dva NULL registry se porovnají jako shodné, proto je před čtením vlastníka zvlášť ověřené existující auto a před měřením oba existující framy.

Produkční renderer v místním prohlížeči nad skutečným `ModProject` a oddělenou kopií mise: vytvořeny tři podmínky (Zadavatel žije, klíče ID 23, vypnutý signál WB_DELIVERY), výstupy WB_COMPLETE/WB_REFUSE, změna všech podmínek na alespoň jednu, opětovné otevření s disabled nezměněným uložením. Diagram zobrazil tři nové hrany včetně rozlišení čtení. Neúplná pravidla blokovala uložení. Export měl přesný hash, změněná byla pouze scéna a dvě UI undo obnovila výchozí data. Jde o kontrolu rendereru a produkčního ukládání, nikoli nové ověření Electron okna.

GOG 1.2 / Wine: osm přesných vygenerovaných rozhodovacích bodů, čtyři aktivované v 0,5 s před dokončením inicializační prodlevy a čtyři po změně stavu. Úplné herní checkpointy v 5,702 / 10,906 / 15,242 s potvrdily obě větve všechno / alespoň jednu a negace při stavech inventář/energie/signál `[0,100,0]` a `[1,0,1]`. Předmět i čtený signál zůstaly zachované. Po vynulování výstupů třetí checkpoint doložil, že se uzly znovu nespustily. Export a skutečně načtená scéna měly shodný hash. Samostatná testovací hra byla ukončená a přípravné změny vrácené; původní uživatelská mise a běžící hra zůstaly nedotčené. Nejde o ruční hráčský průchod celé mise.
