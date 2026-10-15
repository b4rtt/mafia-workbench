# Kontrola uložené mise

V libovolné části mise zvolte **Zkontrolovat misi**. Přehled rozlišuje chyby, upozornění a rozsah kontroly. Odkaz otevře příslušný zdrojový skript nebo soubor; u neexistujícího textu otevře jazykovou tabulku a ponechá ID v hlášení. Jazyk lze změnit v přehledu a kontrolu zopakovat. Výchozí je dostupná čeština, jinak první tabulka; skript sám jazyk neukládá. Volba jazyka nic v projektu nenastavuje. Kontrola je při rozepsané změně zakázaná, protože čte pouze uložená data.

## Rozsah

- Čitelnost `scene2.bin`, `scene.4ds` a `tree.klz` existujícími parsery a vazba hráče Tommy typu Player. Absence volitelných částí, například silniční sítě, sama o sobě není chybou.
- Přesně rozpoznané úkoly, rozhovory, bojové úkoly a skupiny voleb z přehledu Logika mise. Kontrolují se známé cílové objekty, postavy, auta, předměty, doprovázené NPC a příjemci signálů. Používají se stávající pravidla editoru pro jejich vazby, nikoli podobnost názvů/modelů.
- ID zadání, akce, dokončení, checkpointů, neúspěchu, odpovědí a replik v právě zvoleném TextDB. Hraniční záznam se nezapočítává, duplicitní ID je chyba, prázdný text upozornění. Stejné ID používané více body je jeden nález s výčtem použití.
- Přítomnost a základní RIFF/WAVE hlavička dabingu rozpoznaných replik podle doloženého `sounds/%08d.wav`. Zvuk je společný jazykům. Toto není dekódování ani poslech celého souboru; LIP není povinná závislost.
- Přechod šablony do další mise: tři základní soubory, jejich čitelnost, hráč cílové mise a odmítnutí přechodu do stejné mise. Nejde o rekurzivní kontrolu celé kampaně.
- Cykly, čekání bez známého odesílatele a signál pomocnému bodu volby jsou upozornění. Mohou být záměrné nebo doplněné vlastním skriptem. Chybějící/nejednoznačný příjemce přesně známé návaznosti je chyba.
- Přesné pěší trasy NPC: čte se aktuální `check.bin`, prověřují uložená ID a jejich jednoznačnost/kategorie chodců, spojení mezi zastávkami a návrat opakování. Chybějící nebo nečitelná navigace je u takové trasy chyba. U přesného doprovodu se ověří hráč, cílový nepohyblivý objekt a signálové body. Čtení signálu v diagramu neplatí jako jeho odeslání. Nález otevře program příslušné NPC; neslibuje dosažitelnost počátku sítě ani geometrickou průchodnost.

Vlastní programy jsou výslovně neanalyzované. Upravená šablona či neplatná vazba jejího vlastníka se může stát vlastním programem; report neodhaduje její záměr. Kontrola neověřuje syntaxi a běh všech LS3D skriptů, modelové/texturové závislosti, animace, dosažitelnost, AI, průchodnost, checkpoint za běhu ani kompletní hratelnost. Absence chyb tedy není důkaz hotové mise. Nálezy automaticky nemění data ani nezakazují test vlastní logiky.

## Čtení a ověření

Čtou se aktuální projektové vrstvy přes `ModProject.read`, s normalizací cest bez rozlišení velikosti písmen. Čtení se v rámci jednoho běhu sdílí; načtené soubory jsou znovu porovnané hashem a manifest verzí před vydáním výsledku. Při změně během kontroly se celý výsledek odmítne. Report obsahuje cesty a SHA-256 skutečně přečtených souborů, nikoli jejich herní obsah. Nevytváří historii, zálohy, export ani herní staging.

Šest integračních testů používá skutečné parsovatelné projektové vrstvy: platná mise a jazyky; hraniční text/poškozený hlas/reopen/undo; chybějící vazby a vlastní zdroj; chybějící části a přechod; souběžná změna dat; volby, boj a příchod NPC. Ověřují i nezměněný manifest, bajty a historii. Celá sada 493 testů, syntaktické kontroly a build prošly.

V odděleném Electronu a kopii skutečného projektu byly záměrně připravené tři chyby: chybějící příjemce, text a hlas. Report je našel a otevřel přímo program odesílatele. Při draftu kontroly i spuštění disabled, po návratu přesného zdroje opět dostupné. Přepnutí češtiny na angličtinu našlo další čtyři chybějící překlady, opakovaná kontrola zachovala jazyk a odkaz otevřel správnou anglickou tabulku s ID v hlášení. Bez zápisu do projektových dat. Nový herní běh není pro tuto čtecí funkci testovaný a žádná herní kompilace se nemění.
