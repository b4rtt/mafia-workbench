# Obnovení úplného checkpointu v odděleném playtestu

## Rozsah a použití

Vedle **Spustit level** je samostatné **Načíst checkpoint…**. Výchozí start dál otevírá novou misi. Úplný checkpoint vytvoří úkolová šablona přes `autosavegamefull ID, 1`; po ukončení testu editor zaeviduje nové či změněné úplné save výchozího testovacího profilu 0. Nabídka není prohlížečem všech původních uložených her.

Editor přiděluje původ každému save: hash, misi, revizi všech synchronizovaných assetů a stav manifestu projektu. Převzatý nezměněný save nezíská evidenci. Výměna souboru, změna projektu či herních assetů zabrání načtení; přesné undo projektovou shodu obnoví. Kontrola se opakuje po synchronizaci před zápisem přesměrované mise a EXE. Evidence běhu v `run.json` umožňuje sběr i při opětovném připojení editoru k běžícímu testu.

## Nativní načtení

Primární podklady: uložená [PC dekompilace](https://github.com/st0rm94/mafia-reverse-engineering-export/blob/main/ghidra/Game-ghidra.exe.annotated.c) a [struktury loadsave](https://github.com/st0rm94/mafia-reverse-engineering-export/blob/main/structs/loadsave.md). Referenční adresy se liší od podporovaného GOG EXE; výsledná místa byla ověřena přímo v jeho instrukcích.

Podporovaný originál má SHA-256 `303eb95ee2de3433511ce0cb518921dcb96b62b0f64ebfcc436723ff5083f298`. Patch se vytváří pouze v odděleném testovacím EXE. V přeskočeném menu nastaví profil 0 a vybraný slot v loadsave singletonu `0x6d4628` (pole +0x28 a +0x7c). Nejprve běžnou cestou otevře přesměrovanou misi `wbtest`, potom místo NewGame volá loader `0x606150` a pokračuje do herní smyčky bez následujícího GameInit. Přímé vyvolání menu větve Load před otevřením scény selhalo, protože loader porovnává živé jméno mise; tuto experimentální cestu finální implementace nepoužívá.

## Čtení save

`src/core/checkpoints.js` pouze kontroluje strukturu a metadata. Těla aktérů a programu zůstávají neprůhledná a loader dostává původní soubor. G_Stream má 24bajtovou vnější hlavičku s magic `0x53617647`, flag 1; vnitřní dešifrovaná hlavička má doslovné `SavG` (`0x47766153` při čtení LE), verzi 16, slot a ID. Tyto dva magic nejsou shodné.

Cipher se počítá po jednotlivých blocích Read: celé dwordy se xorují s klíčem 0x23101976, druhý klíč začíná 0x10072002. Po každém slově se druhý klíč zvýší o plaintext a první o nový druhý klíč; obě hodnoty mají 32 bitů. Nezarovnaný konec každého bloku zůstává prostý. Čtení celé řady jako jednoho souvislého šifrovaného bufferu proto není správné.

Kontroly omezují velikost souboru na 64 MiB, všechny bloky na zbývající délku, slot na 0–599, ID na 5000 + slot a počet aktérů na 100000. Požaduje se úplný herní blok, přesné jméno `wbtest` a uložený lidský hráč `Tommy`. Zápisy a čtení používají projektové kontroly odkazů. Syntetické testovací fixture neobsahují herní data.

## Ověření 14. října 2026

- Produkční start vytvořil save ID 5599 / slot 599 se zdravím 21 a devíti aktéry. Po ukončení testu se automaticky zaevidoval bez dodatečné ruční úpravy indexu.
- Produkční načtení obnovilo zdraví a pozici hráče i rozpracovaný úkol. Nezávislý uložený program pokračoval po zbývajícím čekání, přesunul hráče k cíli a nastavil zdraví 61; úkol zobrazil dokončení. Save při samotném načtení zůstal bajtově stejný.
- Stejný průchod fungoval tlačítkem v okně Audit editoru. Po vrácení změny TextDB přes UI se checkpoint zobrazil jako jiná verze projektu a tlačítko Načíst bylo zakázané.
- Pomocné změny TextDB a scény byly vráceny přes UI na historii 38; pět kontrolovaných assetů odpovídá výchozím hashům. Předchozí soukromý save byl obnoven ze zálohy. Chráněné ostatní projekty a původní EXE se nezměnily; hra i Audit aplikace byly ukončené.
- Prošlo 327 testů, statická kontrola a build. Testy zahrnují per-block cipher, poškozené bloky, provenance, stale/replaced save, odkazy a sběr po opětovném připojení včetně selhání indexu.

Tento průchod neprokazuje obnovení časového limitu, návazných signálů, dialogů, všech stavů AI ani ruční aktivaci hráčem. Pomocný `camera_lock` se po načtení neobnovil; kamera přešla k hráči. Restart přes herní menu a ostatní profily zatím nejsou podporou tohoto tlačítka doložené. Kompletní vlastní mise a celý editor zůstávají otevřeným goalem.
