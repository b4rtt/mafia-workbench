# Úkol: příchod vybrané NPC do cíle

Stav: 15. října 2026.

## Postup

Ve 3D vytvořte úkol nebo vyberte existující nezměněnou šablonu a **Objekt → Nastavit úkol…**. **Způsob splnění cíle → Příchod vybrané NPC** nabídne jednoznačné aktéry typu Human (27), kteří mají jediný frame. Vyberte postavu, stálý cílový frame a kladný poloměr. Samotný model nebo Player nejsou platné NPC; pohybliví aktéři a nejednoznačné cíle se odmítají.

Úkol kontroluje vlastní světovou polohu NPC, nikoli hráče. Postava musí mít energii větší než nula a být uvnitř koule kolem cíle se započtením výšky. Hráč nemusí být u cíle. Program nemění chování, výzbroj nebo navigaci postavy: [pěší doprovod](human-following.md), trasu či jiné chování nastavte odděleně. Tím lze úkol použít i pro autonomní příchod NPC. Nevyžaduje automaticky doprovod hráčem ani jeho přítomnost a nesimuluje AI v editoru.

Stejné use/load/area aktivace, TextDB, checkpoint, timeout, volitelná ochrana jiné postavy, návazné body a konec/přechod mise zůstávají dostupné. Aby smrt doprovázené NPC ukončila úkol, zapněte **Neúspěch při smrti postavy** a vyberte ji. Bez této podmínky mrtvá NPC nesplní cíl; úkol bude čekat nebo později selže podle výslovného časového limitu. Odstranění aktéra jiným skriptem není totožné s běžnou smrtí. Změny platí po novém spuštění mise.

## Zapisování a návaznosti

mission-task.js přidává volitelné `escort: { humanName }`. Stávající pěší, automobilové i inventářové zdroje bez této volby zůstávají stejné. Nová varianta rezervuje aktéra pro NPC za případnou hlídanou postavou, samostatné sloty pro signály a flt[7] pro energii. Kontroly neúspěchu předcházejí zdraví doprovázené NPC a vzdálenosti. Nulová energie skáče na label 15 (čekání), nikoli na úspěch. Prostorová kontrola se opakuje každých 100 ms.

Metadata ve zdroji určí variantu jen při shodě celého znovu generovaného programu. Ručně pozměněný zdroj zůstává ve vlastním editoru; CRLF/LF jsou podporované. Logika mise obnoví úkol a inspektor uvádí vybranou NPC. Nejde o analýzu libovolných původních misních programů.

Core při zveřejnění kontroluje NPC i statický cíl v aktuální scéně a geometrii, TextDB a ostatní potřebné závislosti. Kanonizuje velikost písmen odkazů a mění jen program úkolového detektoru. Ostatní programy, neznámé bajty, texty a geometrie se nezapisují. Změna má jednu transakci, zálohu, export a přesné undo.

## Ověření

487/487 testů, check/build. Nové testy kombinují aktivace, chráněnou NPC odlišnou či shodnou s doprovázenou, časový limit a oba signály; sloty a zdroje obnovitelné bez kolizí. Ověřují také živou postavu před prostorem, vlastní odchylky, neplatné vazby, duplicity, hráče/pohyblivý cíl, přidání/configure, přesný export/reopen/dvě undo, zachování NPC a raw sourozenců, souběžnou změnu geometrie a rollback selhaného zveřejnění. Existující testy kontrolují nezměněné původní programy.

Oddělený Electron projekt: existující pěší úkol přepnut na příchod NPC First, cíl a poloměr 3 zachované, ochrana First a limit 60 s, oba navazující body. Prázdná NPC blokuje Save. Uložený formulář znovu otevřel NPC i podmínky a nezměněný Save byl disabled. Vznikla jediná historie; export má hash UI scény.

GOG 1.2/Wine: tři potvrzené varianty s plnými save po 6/11/22 sekundách programového čekání. První použila přesný UI úkol a samostatný doprovod First. Diagnostický NPC ve 3 s přesunul hráče do cíle a v 8 s pustil doprovod; First zůstala před spuštěním 25 jednotek od cíle, zatímco hráč byl uvnitř. Následně skutečně došla na Z≈18,64, vzdálenost od cíle ≈1,82, energie 100. Příznaky úspěch/neúspěch byly 0/0, 0/0, 1/0.

Druhá použila opět přesný UI úkol. First byla předem umístěná v cíli a diagnosticky zabitá před aktivací úkolu. Save mají energii 0 a vzdálenost ≈1,44, tedy uvnitř koule; příznaky 0/0, 0/1, 0/1. Neúspěch kvůli smrti tak předchází prostorovému splnění. Třetí varianta vypnula sledování smrti a nastavila limit 12 s. Mrtvá First ve vzdálenosti ≈1,51 měla příznaky 0/0, 0/0, 0/1; nezapočítala se jako úspěch a úkol selhal až časem. Tato varianta je označená jako diagnostická konfigurace, nikoli přesný UI recept.

Časování a přesun hráče řídil pomocný NPC, nejde o ruční průchod nebo ruční střelbu. Načtené scene2.bin měly přesné hashe a recepty. Ruční eskortní mise, její checkpoint/load, další mise po této variantě, libovolně dlouhá AI trasa a odstranění aktéra během úkolu nejsou těmito zkouškami ověřené.

První pomocná kontrola četla poslední save příliš brzy; další běh čekal na nový soubor za běžícího stejného procesu. Původní test smrti zkusil přesun už mrtvé NPC, který engine neprovedl; potvrzené zkoušky proto umístily NPC do cíle před smrtí. Tyto nedokončené pokusy se nevydávají za hotové prostorové ověření. Vlastní aplikace/hry ukončené, diagnostiky a soukromé save/index obnovené; příprava a UI změna vráceny přes undo na historii 12, všechny části mise/TextDB a chráněné hashe stejné.
