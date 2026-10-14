# Navazující projekt: AI plugin pro generování města

Požadavek uživatele, uložený 13. října 2026. Jde o budoucí samostatný modul; tento zápis nezahajuje implementaci ani nenahrazuje aktivní goal editoru.

## Podmínka zahájení

Nejdříve dokončit schopnost editoru vytvořit a spustit celou vlastní hratelnou misi. Potom založit další samostatný goal podle tohoto zadání. Uživatel výslovně požaduje oddělení od editoru jako plugin či samostatný modul.

## Požadovaný výsledek

Uživatel vybere část skutečného města na mapě. Modul z mapových podkladů a dostupných herních modelů vytvoří plnohodnotné, vizuálně propracované město pro původní Mafii, srovnatelné s prostředím skutečné hry. Nestačí hrubé bloky domů nebo orientační vizualizace ulic.

- Podklady: uživatel navrhuje OpenMaps a Google Maps, případně jiný vhodný zdroj. Přesný poskytovatel, přístup, licenční možnosti a dostupnost potřebných dat se teprve vyhodnotí; žádné placené služby ani účty zatím nejsou zadané.
- Terén: skutečné výškové rozdíly, návaznost svahů, komunikací a budov.
- Město: silnice, chodníky, domy a další stavby, parky a zeleň; použití existujících herních assetů s věrohodným umístěním a měřítkem.
- Vybavení: lampy, koše a další městské rekvizity, osvětlení a zvukové prostředí.
- Živý svět: automobilový provoz, chodci, jejich navigace a vazby na prostředí.
- Herní funkčnost: kolize, silniční i pěší sítě, sektory/portály a potřebné soubory mise; export a ověřené spuštění v enginu, ne pouze náhled v editoru.
- Kvalita: souvislé ulice, přirozené křižovatky, chodníky, osazení rekvizit a výškové napojení; výsledky musí být kontrolovatelné a ručně opravitelné v editoru.
- AI: více zapojit Codex, případně Claude; uživatel uvedl konkrétně „Claude opus 5.5“. Dostupný model, integrační rozhraní, autorizace a cena se ověří až při návrhu modulu. Záznam není tvrzením, že uvedená verze existuje či je dostupná.

## Oddělení modulu

### Upřesnění vzhledu ulic a aktuální základ (14. října 2026)

Uživatel požaduje silnice a chodníky vzhledem odpovídající původní hře. Editor nově umí samostatný povrch z jednoho propojení road.bin: vozovku, dva zvýšené chodníky a obrubníky, původní městské materiály, UV v metrech a přesné kolize. Podklady a ověření jsou v [road-surfaces.md](road-surfaces.md). Tento nástroj je základ authoringu, nikoli hotový generátor města.

Po posledním náhledu uživatel současný vzhled přijal; asymetrické krajnice a přesnější tvar skutečné silnice chce ladit podle OSM. Při návrhu pluginu řešit šířku/pruhy/profil ulice, napojení chodníků a křižovatek, značení na obou stranách a návaznost textur bez deformace, spolu s reálnými výškami. Současné texturové švy a chybějící spojení křižovatek zůstávají explicitní mezerou.

Při zahájení navrhnout úzké verzované rozhraní pro katalog assetů, tvorbu mise a transakční zápis změn. Generátor má mít vlastní vstupy, plán a kontroly; editor dál spravuje otevření, vizuální úpravy, export a playtest. Konkrétní architektura zůstává rozhodnutím příštího goalu.

## Zadání příštího goalu

Vytvořit oddělený AI plugin/modul pro Mafia Workbench, který z uživatelem vybrané reálné oblasti města a vhodných dostupných mapových/výškových dat sestaví vizuálně propracované, hratelné město z herních assetů: terén, budovy, silnice a chodníky, parky, lampy a vybavení, zvuky, kolize, dopravu i chodce a jejich navigaci. Výsledek musí jít dále editovat, exportovat a ověřit v původní hře. Vyhodnotit zapojení Codexu/Claude a vhodné poskytovatele dat. Zahájit po dokončení schopnosti editoru tvořit celou vlastní misi; neoznačovat hrubou generovanou mapu za hotový plugin.
