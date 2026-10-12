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
- 4DS verze 29: texturovaný 3D náhled LOD 0, hierarchie, výběr a transformace objektů, editor materiálů a názvů. UV převod pro WebGL nemění uložené souřadnice. Skinning a morfování zatím nejsou animované.
- Scene2.bin: editor rozpoznaných transformací, světel, zvuků, názvů a zdrojů skriptů. Experimentální 3D mapa propojuje scene.4ds s objekty scene2.bin a dostupnými modely; cache, navigace a kolize se ještě doplňují.
- 5DS verze 20: čtení a úprava klíčů rotace, pozice, měřítka a poznámek. Časová osa a přehrávání se ještě doplňují.
- Editor TextDB včetně češtiny Windows-1250. Změněné řetězce se přidávají na konec; pořadí, ID, neznámé části a sdílené původní řetězce se zachovají. Chybně kódovatelné znaky se odmítnou.
- Binární náhled a import náhradního souboru pro ostatní formáty.
- Samostatné modifikace, záloha před každým zápisem, vrácení poslední změny, obnovení originálu a export změněných souborů.
- Izolovaný Electron renderer bez Node.js; omezené IPC, místní protokol a CSP. Zápisy jsou omezené na projekt a odmítají symbolické i pevné odkazy.

Export vytvoří složku s upravenými soubory a `mafia-mod.json`. Spuštění konkrétní mise v izolované testovací kopii se ještě doplňuje. Nepodporované varianty formátů zůstávají dostupné jako binární soubory s vysvětlením; specializované editory zatím nepokrývají celou hru.

## Ověření

```sh
npm test
npm run check
```

16 testů kontroluje dekompresi, chybné archivy, české texty, zachování neznámých bajtů při editaci scén/modelů/animací, zálohy, undo, export a odmítnutí nebezpečných cest. Na místní instalaci bylo 12. října 2026 rozbaleno všech 13 DTA archivů (27 027 unikátních souborů) a importováno 9 181 volných souborů: celkem 36 208. Podrobný 4DS parser přečetl 3 210 z 3 223 modelů a scén; 5DS parser 2 715 z 2 731 animací. Nepodporované soubory se neinterpretují odhadem. České, německé a anglické TextDB mají při uložení beze změn shodný SHA-256; česká úprava a undo byly ověřené nad skutečnými daty. V běžícím UI byly ověřeny záložky s posunem, texturovaný model a BMP náhled. Ověření dalších editorů a změn ve hře pokračuje.

## Reference a rozsah

- [Celé zadání](goal.json)
- [Všech 16 uložených referenčních repozitářů a přesné revize](research/repositories.json)
- [Původ implementace a poznámky k referencím](research/provenance.md)
- [Formáty, nástroje a šablona prázdné mise](research/formats.md)

Herní data, instalátory, Wine, zálohy, místní projekty a soukromé snapshoty referencí se do tohoto repozitáře neukládají. MIT licence editoru nepřelicencovává hru ani kód referenčních projektů.
