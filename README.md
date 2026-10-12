# Mafia Workbench

Desktopový editor původní Mafia: The City of Lost Heaven (2002), postavený na Electronu. Cílem je maximální modifikovatelnost celé hry. Vývoj pokračuje; současná verze není dokončený komplexní editor.

## Spuštění

Vyžaduje Node.js 22.12+ a vlastní instalaci původní hry.

```sh
npm ci
npm start
```

V aplikaci zvolte **Rozbalit hru**, složku s DTA archivy a umístění projektu. Vznikne nový adresář; existující projekt ani původní hra se nepřepisují. Projekt lze později znovu otevřít.

Extrakce bez UI:

```sh
npm run extract -- /cesta/ke/hre /existujici/rodic/novy-projekt
```

## Aktuální funkce

- Extrakce ISD0 DTA: XOR hlavičky a bloky, LZ/RLE, mono a stereo DPCM. Kontrola hranic a deklarovaných délek; chyba zastaví extrakci, nevytvoří platný projekt.
- Kategorie v horní vodorovné liště s posunem, hledání uvnitř kategorií a slučování složek bez rozlišení velikosti písmen. Každý archiv má vlastní původní kopie; při překryvu se uchovají všechny varianty. A8 je poslední vrstva patche pro testovanou instalaci. Importují se také volné datové soubory hry, včetně hudby a zvuků.
- Náhled BMP/PNG/JPEG a přehrávač WAV/OGG/MP3 přes omezený místní protokol.
- 4DS verze 29: texturovaný 3D náhled LOD 0, hierarchie, výběr a transformace objektů, editor materiálů a názvů. Převod UV a směru rotací LS3D pro WebGL nemění zdrojová data; rotace z gizma se převádí zpět. Barva tónuje texturu pouze při zapnutém příznaku LS3D COLORED; neplatné nepoužité normály a UV používají náhradu pouze v náhledu. Podporovaný skinning propojuje kosti podle jejich ID a deformuje vrcholy vahami ke kosti a jejímu rodiči. Morfování zatím není podporované.
- Scene2.bin: editor rozpoznaných transformací, světel, zvuků, názvů a zdrojů skriptů. Experimentální 3D mapa propojuje scene.4ds s objekty scene2.bin a dostupnými modely, respektuje pojmenované rodiče a odděluje oblohu přepínačem; cache, navigace a kolize se ještě doplňují.
- V 3D mapě lze **Vložit model…** s vlastním názvem, pozicí, natočením a měřítkem, **Duplikovat…** samostatný model či pomocný bod a **Odstranit…** objekt bez rozpoznaných vazeb. Kopie zachová rodiče, transformace a neznámé bloky. Název se kontroluje bez rozlišení velikosti písmen i proti geometrii scene.4ds; původní geometrie a objekty s aktérem se tím nemažou. Skriptové odkazy a potomci mazání blokují. **Zarámovat objekt** přiblíží vybraný model. Každá operace se ukládá se zálohou a undo. Kolize tree.klz ani herní aktéři se vložením modelu nevytvářejí.
- Cache.bin verze 1: části města, rozmístění statických modelů, jejich pozice, rotace, měřítko a odkazy na modely. Neznámé chunky, příznaky a koncové bajty se zachovávají. Vybranou část s nejvýše 500 modely lze otevřít pro 3D editaci; celý cache zatím není sloučený do pohledu scene2.bin.
- 5DS verze 20: čtení a úprava klíčů rotace, pozice, měřítka a poznámek. Přehrávání na vybraném 4DS modelu, pauza, posuvník, krokování a nastavitelná rychlost náhledu. Uzly se propojují podle názvů; chybějící nebo nejednoznačné názvy se hlásí. Pozice a měřítko se interpolují lineárně, rotace po nejkratším oblouku. Náhled reaguje na rozepsané klíče; samotné přehrávání nic neukládá. Poznámky se editují, ale nespouštějí herní události ani zvuky.
- Editor TextDB včetně češtiny Windows-1250. Změněné řetězce se přidávají na konec; pořadí, ID, neznámé části a sdílené původní řetězce se zachovají. Chybně kódovatelné znaky se odmítnou.
- **Zbraně a předměty** v `tables/predmety.def`: tabulka s hledáním podle ID, názvu a modelu; formulář pro název, model, příznaky, třídu, ID zvuků a nabíjecí animace, kapacity munice, dostřel, poškození, zpětný ráz a přesnost. Tlačítko náhledu zobrazí dostupný model ve 3D. Rozpoznané PC záznamy mají 188 bajtů; writer mění pouze vybraná pole, zachovává neznámé bajty a ID. Změny používají zálohy, kontrolu verze otevřeného souboru, export a undo. Další typy tabulek se doplňují.
- Binární náhled a import náhradního souboru pro ostatní formáty.
- Samostatné modifikace, záloha před každým zápisem, vrácení poslední změny, obnovení originálu a export změněných souborů.
- **Nová mise…** načte vlastní kopii [Empty_Mission.zip](https://github.com/user-attachments/files/16255595/Empty_Mission.zip) s ověřeným SHA-256. Nastavit lze název, model hráče s kostrou, start XYZ a natočení kolem Y, sluneční/okolní světlo a převzetí inicializace policie. Osm souborů vznikne jako jedna vratná změna v projektu; export zahrne všechny nové soubory, i pokud se od vytvoření nezměnily. Doprava, chodci, kolize a vybavení hráče se přebírají ze šablony. Herní data šablony nejsou v tomto repozitáři.
- **Spustit level** u souborů mise: připraví samostatnou testovací kopii, použije uložené modifikace a načte vybraný level bez úvodních videí, výběru profilu a hlavního menu. **Ukončit test** zavře pouze tento test. Herní soubory i uložené hry původní instalace zůstávají zachované.
- Izolovaný Electron renderer bez Node.js; omezené IPC, místní protokol a CSP. Zápisy jsou omezené na projekt a odmítají symbolické i pevné odkazy.

Export vytvoří složku s upravenými soubory a `mafia-mod.json`. Nepodporované varianty formátů zůstávají dostupné jako binární soubory s vysvětlením; specializované editory zatím nepokrývají celou hru.

Přímé spouštění zatím vyžaduje macOS, místní ověřený Wine runtime ve vedlejší složce `../.runtime` a přesnou GOG verzi Game.exe 1.2 (SHA-256 `303eb95ee2de3433511ce0cb518921dcb96b62b0f64ebfcc436723ff5083f298`). Jiná verze se odmítne. Editor upraví pouze kopii EXE v projektu `playtest/game`, vytvoří vlastní Wine prefix a samostatné uložené hry. První příprava kopíruje všechna projektová data; další starty kontrolují seznam souborů a čtou pouze změněné modifikace nebo chybějící data. Starší testovací kopie nejprve projde jedním úplným porovnáním. Příprava opakovaného startu na místním projektu klesla z 23,2 s na 0,83 s; jde o přípravu dat, nikoli dobu načítání enginu. Wine se spouští přes samostatný systémový shell; chyba grafického startu se hlásí i při návratovém kódu 0. Vlastní skriptované scény vybrané mise se přehrávají podle jejího nastavení; celé mise mohou vyžadovat stav z předchozího průchodu kampaní.

## Ověření

```sh
npm test
npm run check
```

43 testů kontroluje dekompresi, chybné archivy, české texty, zachování neznámých bajtů při editaci scén/modelů/animací, zálohy, undo, export, odmítnutí nebezpečných cest a hlídání běžícího testu levelu, převod rotací, interpolaci a deformaci animovaných vrcholů. Na místní instalaci bylo 12. října 2026 rozbaleno všech 13 DTA archivů (27 027 unikátních souborů) a importováno 9 181 volných souborů: celkem 36 208. Podrobný 4DS parser přečetl 3 219 z 3 223 modelů a scén; 5DS parser 2 715 z 2 731 animací. Nepodporované soubory se neinterpretují odhadem. České, německé a anglické TextDB mají při uložení beze změn shodný SHA-256; česká úprava a undo byly ověřené nad skutečnými daty. V běžícím UI byly ověřeny záložky s posunem, texturovaný model a BMP náhled; u modelu Sarah2HIGHnaha také opravený odstín hlavy a nohou. U #rad022.4ds byla v UI ověřena opravená střecha a zábradlí, dále také #rad025.4ds. Čtení všech 553 sad skinningu má platné počty vrcholů i váhy. Tommy.4ds s 01ChuzeLajd.5DS propojuje 21/21 uzlů; přehrávání, pauza, krokování a rozdílné pózy na posuvníku byly ověřeny v UI. Devět modelů používá náhradní normály nebo UV pouze pro náhled. Přímý start byl ověřen v tréninku, na autodromu a v restauraci; opravený start z Electronu také skutečně načetl MISE07B-CHULIGANI s herním HUD. Tlačítka start/stop a ochrana před souběžným startem také v běžícím UI. Všech 25 cache.bin souborů (296 438 instancí) prošlo načtením a uložením beze změn se shodnými bajty; úprava pozice a její vrácení rovněž. Na dočasné kopii reálného cache byly ověřené uložení do modu, export a undo. Ověření cache UI a změn ve hře pokračuje.

Tvorba prázdné mise byla ověřena na oddělené kopii projektu: skutečný dodaný ZIP, vlastní start a natočení, export všech osmi souborů, undo a opětovné vytvoření. V běžícím Electronu průvodce vytvořil WB_UI_TEST; přímý start na kopii ověřeného Wine prostředí i na čerstvé kopii základního prefixu načetl plochu s Tommym a HUD. Vrácení přes UI odstranilo všech osm assetů; další synchronizace odstranila jen jejich sledované testovací kopie. Testy dále ověřují rollback indexu při chybě zápisu a odmítnutí undo při cizích změnách souborů.

Strukturální operace objektů byly ověřené na všech 79 skutečných scene2.bin: vložení a odstranění testovacího modelu obnovilo přesné původní bajty; stejně dopadla duplikace a odstranění kopie jednoho nezávislého objektu v každé scéně. V běžícím Electronu byly ověřené vložení bedna02, uložení posunu, duplikace, odstranění kopie a její vrácení přes undo. Export obsahoval odpovídající scene2.bin. Přímý start WB_OBJECT_TEST z editoru ukázal vloženou bednu s nastaveným měřítkem 3 vedle hráče v reálné hře; původní projekt i Game.exe měly po testu shodný SHA-256.

Editor předmětů byl ověřen nad skutečnými 35 záznamy: uložení bez změn zachovává přesně celý soubor, všech 385 číselných polí lze změnit a vrátit bez změny jiných bajtů. Na odděleném projektu byla ověřena úprava Coltu 1911 na kapacitu zásobníku 9 a zásobu 63, opětovné otevření, export a undo; původní projekt zůstal shodný. Ověření formuláře, 3D náhledu a vlivu upravené tabulky v běžící hře ještě zbývá.

## Reference a rozsah

- [Celé zadání](goal.json)
- [Všech 16 uložených referenčních repozitářů a přesné revize](research/repositories.json)
- [Původ implementace a poznámky k referencím](research/provenance.md)
- [Formáty, nástroje a šablona prázdné mise](research/formats.md)

Herní data, instalátory, Wine, zálohy, místní projekty a soukromé snapshoty referencí se do tohoto repozitáře neukládají. MIT licence editoru nepřelicencovává hru ani kód referenčních projektů.
