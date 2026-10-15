# Kontrola uložené mise

V libovolné části mise zvolte **Zkontrolovat misi**. Přehled rozlišuje chyby, upozornění a rozsah kontroly. Odkaz otevře příslušný zdrojový skript nebo soubor; u neexistujícího textu otevře jazykovou tabulku a ponechá ID v hlášení. Jazyk lze změnit v přehledu a kontrolu zopakovat. Výchozí je dostupná čeština, jinak první tabulka; skript sám jazyk neukládá. Volba jazyka nic v projektu nenastavuje. Kontrola je při rozepsané změně zakázaná, protože čte pouze uložená data.

## Rozsah

- Čitelnost `scene2.bin`, `scene.4ds` a `tree.klz` existujícími parsery a vazba hráče Tommy typu Player. Absence volitelných částí, například silniční sítě, sama o sobě není chybou.
- Přesně rozpoznané úkoly, rozhovory, bojové úkoly a skupiny voleb z přehledu Logika mise. Kontrolují se známé cílové objekty, postavy, auta, předměty, doprovázené NPC a příjemci signálů. Používají se stávající pravidla editoru pro jejich vazby, nikoli podobnost názvů/modelů.
- ID zadání, akce, dokončení, checkpointů, neúspěchu, odpovědí a replik v právě zvoleném TextDB. Hraniční záznam se nezapočítává, duplicitní ID je chyba, prázdný text upozornění. Stejné ID používané více body je jeden nález s výčtem použití.
- Přítomnost a základní RIFF/WAVE hlavička dabingu rozpoznaných replik podle doloženého `sounds/%08d.wav`. Zvuk je společný jazykům. Toto není dekódování ani poslech celého souboru; LIP není povinná závislost.
- Přechod šablony do další mise: tři základní soubory, jejich čitelnost, hráč cílové mise a odmítnutí přechodu do stejné mise. Nejde o rekurzivní kontrolu celé kampaně.
- Cykly, čekání bez známého odesílatele a signál pomocnému bodu volby jsou upozornění. Mohou být záměrné nebo doplněné vlastním skriptem. Chybějící/nejednoznačný příjemce přesně známé návaznosti je chyba.
- Přesné útoky NPC v1/v2: jednoznačná cílová lidská postava a případný signálový bod, aktuální definice střelné zbraně a kapacita zásobníku, čitelnost jejího modelu a přítomnost přímo uvedených textur. Jde pouze o výzbroj přesně rozpoznaného receptu, nikoli obecné vyhodnocení programů.
- Přesné pěší trasy NPC: čte se aktuální `check.bin`, prověřují uložená ID a jejich jednoznačnost/kategorie chodců, spojení mezi zastávkami a návrat opakování. Chybějící nebo nečitelná navigace je u takové trasy chyba. U přesného doprovodu se ověří hráč, cílový nepohyblivý objekt a signálové body. U přesné jízdy v1/v2 se čte aktuální road.bin, prověří alespoň jedna propojená cesta, jednoznačné vozidlo, statické cíle a signálové body; geometrickou dostupnost každé zastávky neověřuje. Čtení signálu v diagramu neplatí jako jeho odeslání. Nález otevře program příslušné NPC; neslibuje dosažitelnost počátku sítě ani geometrickou průchodnost.

Vlastní programy jsou výslovně neanalyzované. Upravená šablona či neplatná vazba jejího vlastníka se může stát vlastním programem; report neodhaduje její záměr. Kontrola neověřuje syntaxi a běh všech LS3D skriptů, dynamické modelové/texturové závislosti skriptů, obsah obrázků, snímky animovaných textur, animace, dosažitelnost, AI, průchodnost, checkpoint za běhu ani kompletní hratelnost. Absence chyb tedy není důkaz hotové mise. Nálezy automaticky nemění data ani nezakazují test vlastní logiky.

## Čtení a ověření

Čtou se aktuální projektové vrstvy přes `ModProject.read`, s normalizací cest bez rozlišení velikosti písmen. Čtení se v rámci jednoho běhu sdílí; načtené soubory jsou znovu porovnané hashem a manifest verzí před vydáním výsledku. Při změně během kontroly se celý výsledek odmítne. Report obsahuje cesty a SHA-256 skutečně přečtených souborů, nikoli jejich herní obsah. Nevytváří historii, zálohy, export ani herní staging.

Šest integračních testů používá skutečné parsovatelné projektové vrstvy: platná mise a jazyky; hraniční text/poškozený hlas/reopen/undo; chybějící vazby a vlastní zdroj; chybějící části a přechod; souběžná změna dat; volby, boj a příchod NPC. Ověřují i nezměněný manifest, bajty a historii. Celá sada 493 testů, syntaktické kontroly a build prošly.

V odděleném Electronu a kopii skutečného projektu byly záměrně připravené tři chyby: chybějící příjemce, text a hlas. Report je našel a otevřel přímo program odesílatele. Při draftu kontroly i spuštění disabled, po návratu přesného zdroje opět dostupné. Přepnutí češtiny na angličtinu našlo další čtyři chybějící překlady, opakovaná kontrola zachovala jazyk a odkaz otevřel správnou anglickou tabulku s ID v hlášení. Bez zápisu do projektových dat. Nový herní běh není pro tuto čtecí funkci testovaný a žádná herní kompilace se nemění.

## Přímé modelové a texturové závislosti (15. října 2026)

Kontrola čte 4DS modely uvedené ve framech typu 9 scény. Přípona I3D se převádí na 4DS, jména a složky se hledají bez rozlišení velikosti písmen. Sdílené soubory se čtou jednou. Chybějící či nečitelný model má nález u vlastnící scény se jmény objektů; chybějící textura odkazuje na model a čísla materiálů. Kontrolují se neprázdné odkazy `texture`, `alphaTexture` a `environmentTexture` všech uložených materiálů, včetně `scene.4ds`. Unsafe cesty se odmítají před čtením, modely a textury mají stejnou kontrolu konzistence revize jako ostatní čtené soubory.

Jde o přítomnost a čitelnost souboru textury, nikoli dekódování pixelů nebo důkaz správného renderování. Animovaná textura má informaci, že se kontroluje pouze uložený základní název; další snímky sekvence se neodhadují. Kromě výzbroje přesných útoků NPC nezahrnuje modely dodatečně načítané skripty, zbraňovými tabulkami, cutscénami a generátory, ani rekurzivní kontrolu assetů další mise. Počty v dialogu jsou jedinečné bezpečné modelové/texturové cesty, včetně chybějících odkazů.

Dva nové testy pokrývají materiály scény i modelů, sdílené odkazy, case-insensitive cesty, diffuse/alpha/reflection, chybějící a poškozené modely, unsafe cesty, animované omezení, znovuotevření a nemutaci i změnu textury během kontroly. Existující testové projekty dostaly svůj dříve chybějící explicitně odkazovaný model. Cíleně 17/17 testů, check/build.

Produkční renderer v místním prohlížeči nad oddělenou kopií ukázky našel záměrně nedostupnou texturu bedny; Otevřít soubor otevřelo správný model a jeho uložený materiál. Skutečné UI undo obnovilo texturu a historii 42. Nová a opakovaná kontrola ukázaly 0 chyb / 0 upozornění, 6 modelů, 30 textur a 43 přečtených souborů. Konzole bez chyb, všechny baseline/protected hashe shodné. Původní MISE02-ULICKA (207 modelů / 469 textur) a MISE06-AUTODROM (74 / 137) neměly modelové/texturové nálezy; u druhé se přiznalo omezení animované textury. Nejde o nové ověření hry ani Electron okna. Soukromé indexy `local/mission-assets-audit.json`, `local/mission-assets-ui.json`.
