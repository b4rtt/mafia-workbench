# Vývoj Mafia Workbench

Aktualizace: 13. října 2026. Goal zůstává aktivní. Implementace, datové testy, ověření UI a ověření ve hře jsou různé úrovně dokončení; neoznačovat jednu za druhou. Podrobnosti existujících funkcí a jejich omezení jsou v README.md a research/formats.md. Původní hra se nemění, úpravy mají kontrolu verze, zálohu, export a undo. Herní data a soukromé reference nepatří do veřejného repozitáře.

## Současná priorita: ovládání editoru

- Implementováno: společné rozložení prostorových editorů s velkým 3D pohledem, přehledem objektů vlevo a inspektorem vpravo; nastavitelné šířky, skrytí panelů a režim Jen 3D.
- Implementováno: seskupit tvorbu objektů, operace výběru a zobrazení do nabídek; vysvětlení přesunout do nápovědy; přehrávání pod pohled.
- Implementováno: samostatné číselné vstupy XYZ/WXYZ/RGB, skupiny modelových objektů a zaměření objektu ze seznamu. Zachovat existující funkce, kameru a rozepsané změny.
- Dále: zjednodušit celý inspektor na formulář vybraného objektu, zlepšit navigaci mezi soubory mise a souvisejícími editory, ověřit malé rozměry okna a práci klávesnicí. Před dokončením projít běžné pracovní postupy přímo v aplikaci.

## Uzavřené změny této etapy

- Cutscéna record14c / MISE14-PARNIK / dif14c: příkaz door_lock v přípravném bloku již nezahodí doslovné změny viditelnosti. Audit náhledu navázal 33/33 stop, převzal 30 počátečních změn a ověřil skryté původní postavy při seeku tam i zpět. Vizuální kontrola načtené cutscény kolem 5 sekund ukázala animované postavy bez původních kopií v T-póze; všechny záběry ani herní runtime tím nejsou ověřené.
- Časová osa 5DS: vložení, kopie, odstranění a přesun klíčů, délka animace a tvorba/odebrání kanálů; náhled, atomické uložení a přesné undo. Audit 2 715 podporovaných animací a 6 006 případů změn klíčů/kanálů. V okně ověřené načtení 01ChuzeLajd na !TommyHIGH, přehrávání/pauza, kopie klíče a zahození draftu. Uložení přes UI a upravená animace ve hře ještě vyžadují kontrolu.
- Nové rozložení v aplikaci: ověřená mapa, zaměření objektu, zachování hledání, změna XYZ a návrat draftu bez uložení, nabídka Přidat, režim Jen 3D a návrat panelů, model, animace a načtená cutscéna. Změna šířky inspektoru klávesnicí 300 → 280 ověřená. Malá okna a všechny specializované panely ještě vyžadují průchod.
- Celá sada po těchto změnách: 235 testů, syntaktické kontroly a sestavení prošly.

## Další funkce a ověřování

- Tvorba objektů: model, postava, auto, dveřní aktér, fyzikální předmět, pickup, světlo, zvuk, skriptový bod již mají implementaci. Přehled doložených typů a zdrojů: research/object-creation.md. Doplňovat další typy podle referenčních editorů a enginu, nikoli odhadem. Dynamické kolize aut/dveří/předmětů vytváří hra.
- Kolize: generovaný box i přesný povrch modelu, transformace, kopie a odstranění mají datové testy; box ověřen ve hře. Přesný povrch potřebuje dokončit herní test průchodů/kolizí. Původní kolize nezahazovat.
- 4DS: transformace, materiály, vrcholy, UV, topologie a více LOD implementované. Nové panely geometrie a materiálů potřebují UI/runtime ověření. Dále sektory/portály a tvary skin/morph; zachovat instance a neznámá data.
- BMP: kreslení, kapátko, paleta a alpha implementované a datově ověřené; nové ovládání i textura ve hře ještě vyžadují test.
- Mise: rozbalení, kategorie, slučování cest bez rozlišení velikosti písmen a nová prázdná mise implementované. Přímý start přes izolovanou kopii bez videí/menu a inkrementální synchronizace implementované. Ověřovat další starty po úpravách a jednotlivé nové aktéry ve hře.
- Navigace a silnice: pohyb bodů a strukturální editace mezilehlých silničních bodů implementované; doplnit nové křižovatky a odbočky, dokončit herní ověření změn.
- Efekty: umístění, vazby a změna typu implementované; dokončit UI/runtime test a postupně doplnit definice emitorů a simulaci částic.
- Zvuk/světla: tvorba, parametry a náhled dosahů implementované; dokončit herní poslech a účinek nových typů. 3D studio zatím nesimuluje osvětlení mise ani akustiku.
- Tabulky: zbraně/předměty a fyzika aut implementované; ověřit jejich nové formuláře i účinky v runtime. Další tabulky doplňovat podle dokumentace.
- Skripty: globální, detektorové a podporované lidské programy editovatelné; vlastní skriptové body a šablona blízkosti implementované. Dokončit herní test akce. Scripting reference MSDR uložená soukromě, index v research/documentation.json a poznatky v research/scripting.md.
- Cutscény: REP/CHG, modely, kosterní animace, dialogy a zvuky implementované. Dále pohybové TCK, morfování, křivky enginu, prostorový zvuk a hudba řízená skripty. Viditelnost vycházet z doložených příkazů; neskrývat postavy podle podobnosti modelů. Ověřené dřívější opravy: recordi02, record02b a record20d; další cutscény kontrolovat samostatně.
- Renderování: převod rotací/UV, normály, skinning, alpha masky, barevný klíč a skryté pomocné plochy implementované. Nové případy chyb kontrolovat proti skutečným datům a referencím; test jedné scény nepokrývá celou hru.
- Uchovávat všech 16 zdrojových repozitářů a jejich formátové poznatky: research/repositories.json, research/formats.md a research/provenance.md. Průběžně commitovat a pushovat smysluplné změny.

## Rozhodnutí uživatele

WB_DOOR v jeho testovacím projektu již neupravovat ani nepřipojovat aktéra: uživatel si dveře vytvoří a ověří sám. Testy dalších funkcí provádět na oddělených kopiích, uživatelovy změny zachovat. Nastavení macOS nesouvisí s přepracováním editoru a v této etapě se nemění.
