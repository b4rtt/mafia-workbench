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
- Procházení a hledání herních souborů. Každý archiv má vlastní původní kopie; při překryvu se uchovají všechny varianty. A8 je použitý jako poslední vrstva patche pro testovanou instalaci.
- Editor TextDB včetně češtiny Windows-1250. Změněné řetězce se přidávají na konec; pořadí, ID, neznámé části a sdílené původní řetězce se zachovají. Chybně kódovatelné znaky se odmítnou.
- Binární náhled a import náhradního souboru pro ostatní formáty.
- Samostatné modifikace, záloha před každým zápisem, vrácení poslední změny, obnovení originálu a export změněných souborů.
- Izolovaný Electron renderer bez Node.js; omezené IPC, místní protokol a CSP. Zápisy jsou omezené na projekt a odmítají symbolické i pevné odkazy.

Export vytvoří složku s upravenými soubory a `mafia-mod.json`. Automatická instalace a ověření exportu ve hře se ještě doplňují. Scény, modely 4DS, animace 5DS, mise, skripty, vozidla, textury a cutscény zatím nemají kompletní specializované editory.

## Ověření

```sh
npm test
npm run check
```

Testy kontrolují dekompresi, chybné archivy, české texty, zachování neznámých bajtů, zálohy, undo, export a odmítnutí nebezpečných cest. Na místní instalaci bylo 12. října 2026 úspěšně rozbaleno všech 13 DTA archivů (27 027 unikátních souborů). České, německé a anglické TextDB mají při uložení beze změn shodný SHA-256; česká úprava a undo byly ověřené nad skutečnými daty. Interaktivní test UI a načtení modu ve hře zatím čekají na odemčený Mac.

## Reference a rozsah

- [Celé zadání](goal.json)
- [Všech 16 uložených referenčních repozitářů a přesné revize](research/repositories.json)
- [Původ implementace a poznámky k referencím](research/provenance.md)

Herní data, instalátory, Wine, zálohy, místní projekty a soukromé snapshoty referencí se do tohoto repozitáře neukládají. MIT licence editoru nepřelicencovává hru ani kód referenčních projektů.
