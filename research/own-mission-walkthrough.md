# Vlastní mise: doručení klíčů

Pracovní příklad pro současné nástroje editoru, 15. října 2026. Cílem je propojit vlastní texty, dabing, rozhovory, rozhodnutí hráče, předmět a konec mise. Nejde o generátor města ani o nový importní formát. Herní šablona, modely, zvuky a vytvořený projekt se nepublikují.

## Základ a objekty

Pracujte v samostatném projektu. Přes **Nová mise…** vytvořte `WB_DELIVERY_DEMO` z ověřené Empty_Mission.zip. Zvolte hráče `Tommy.4ds`, start `[0, 0, 0]`, natočení 0°, slunce 1, okolní světlo 0,6, hustotu aut i chodců 0 a vypnutou inicializaci policie. Podklad a jeho kolize pocházejí ze šablony.

Ve 3D přidejte následující objekty. Souřadnice jsou příkladem na rovné ploše; po změně mapy je upravte podle povrchu. Pro modely použijte jednotkové měřítko.

| Název | Druh | Model / nastavení | XYZ |
| --- | --- | --- | --- |
| Zadavatel | Postava Human | Paulie.4ds; vlastní prázdný program před vytvořením volby | 2, 0, 3 |
| Prijemce | Postava Human | Sam.4ds; aktivní čekání | 2, 0, 18 |
| Bedna | Statický model | bedna02.4ds; generovaná AABB kolize | −2, 0, 3 |
| Klice | Předmět k sebrání | Door keys, ID 23; zásobník 1, rezerva 0 | −2, 1.1, 3 |
| Cil | Skriptový bod | maska 0, vlastní program `end` | 0, 0, 18 |

ID 23 a uvedené názvy modelů odpovídají zkoušeným místním datům. U jiné verze ověřte skutečný záznam v `tables/predmety.def` a dostupné modely. Výška klíčů se musí ověřit ve hře; model bedny nemusí mít v jiné sadě stejný rozměr. Natočte postavy k místu rozhovoru. Samotné `end` nepoužívejte jako čekání živé NPC: vypíná její aktéra a dynamické kolize. Řadič volby později nahradí prázdný program Zadavatele aktivním programem.

Šablona má vlastní startovní skript. V tomto příkladu se jeho automatická zbraň a původní autosave vědomě nahradily pouhým `end` **jen v nové misi**. Jinak by hráč dostal vybavení šablony. Kontrolu smrti v `energy_meter` ponechte.

## České texty a hlasy

V kategorii **Texty** otevřete český TextDB. Přes **Nový text…** vložte následující položky, pokud jsou ID volná. Při kolizi použijte jiné volné ID a změňte všechny jeho odkazy. Poslední hraniční záznam tabulky není volný text.

| ID | Text |
| --- | --- |
| 91000 | Potřebuji doručit klíče do skladu. Vezmeš to? |
| 91001 | Ano, donesu je. |
| 91002 | Ne, mám jinou práci. |
| 91004 | Seber klíče u bedny a dones je Samovi. |
| 91005 | Klíče jsou doručené. |
| 91006 | Výborně. Zásilka dorazila v pořádku. Díky, Tommy. |
| 91007 | Doručení je hotové. |
| 91008 | Ukázková mise dokončena. |
| 91009 | Sam zemřel. Klíče už nemá kdo převzít. |
| 91012 | Zakázka odmítnuta. |
| 91013 | Rozhodl ses zakázku nepřijmout. |
| 5001 | Doručení klíčů: po přijetí zakázky |

Pro repliky **91000 a 91006** importujte vlastní WAV tlačítkem **Importovat dabing…**. Příklad používá místně syntetizovaný český hlas; není potřeba přebírat nesouvisející původní repliku. Odpovědi 91001/91002 jsou textové volby a tento příklad jim řeč nepřidává. Dabing jednoho ID je společný jazykům; další jazykové texty je nutné připravit samostatně. Pohyb úst se vytváří zvlášť přes **Pohyb úst…** a není součástí tohoto příkladu.

## Sestavení návazností

Nejdřív vytvořte příjemce signálů, teprve potom jejich odesílatele. Díky tomu budou cíle dostupné ve formulářích. Úkol vzniká přes **Přidat → Přidat skriptový bod… → Program → Úkol: převzít zadání a splnit cíl**. Rozhovor a volba mají samostatné položky nabídky Přidat. Hotové body lze měnit přes nabídku **Objekt → Nastavit…**.

V tomto pořadí vytvořte:

1. **WB_COMPLETE**, poloha `[0, 0, 18]`: automatický úkol, čekat na signál, příchozí hráč, cíl `Cil`, poloměr 3, návazné zadání 91007, dokončení 91008. Zaškrtnout přechod do hlavního menu. Žádný další signál dokončení.
2. **WB_REFUSE**, poloha `[0, 0, 0]`: automatický úkol, čekat na signál, příchozí hráč, cíl `start`, poloměr 3, zadání 91012, dokončení 91013 a přechod do menu.
3. **WB_FINAL**, poloha `[0, 0, 18]`: rozhovor po načtení, čekat na signál, kamera zapnutá. Jedna replika: mluvčí `Prijemce`, posluchač `Tommy`, text 91006. Po dokončení poslat signál `WB_COMPLETE`.
4. **WB_DELIVERY**, poloha `[0, 0, 0]`: automatický úkol, čekat na signál, způsob **Přinesení předmětu k cíli**, předmět ID 23, cíl `Cil`, poloměr 3. Po dokončení předmět odebrat. Zadání 91004, dokončení 91005. Úplný checkpoint ID 5001. Neúspěch při smrti `Prijemce`, text 91009, ukončit misi. Po úspěchu signál `WB_FINAL`; bez časového limitu.
5. **WB_CHOICE**, poloha `[0, 0, 1]`: řadič `Zadavatel`, čekat na signál. Odpověď 91001 vede do `WB_DELIVERY`, odpověď 91002 do `WB_REFUSE`. Pomocné body a vzájemné zrušení odpovědí vytváří editor; nekopírujte jednotlivé pomocné skripty ručně.
6. **WB_BRIEFING**, poloha `[0, 0, 0]`: rozhovor při příchodu hráče do oblasti s poloměrem 3, kamera zapnutá. Mluvčí `Zadavatel`, posluchač `Tommy`, replika 91000. Po dokončení signál `WB_CHOICE`. Nečeká na jiný signál: jde o začátek řetězce.

Poloměr cíle zahrnuje výšku. Větev odmítnutí předpokládá, že hráč při výběru zůstává u startu; při změně rozmístění upravte její cíl. Pokud nechcete žádnou prostorovou podmínku ukončení, potřebujete vlastní koncový skript, nikoli předstíraný vzdálený cíl.

## Kontrola a zkouška

Uložte všechny změny. V **Logice mise** zkontrolujte řetězec:

`WB_BRIEFING → WB_CHOICE → WB_DELIVERY → WB_FINAL → WB_COMPLETE`

Druhá odpověď má vést do `WB_REFUSE`. Kontrola **Zkontrolovat misi** má v českém jazyce najít šest rozpoznaných receptů bez chyb a bez upozornění na nedostupné cíle, texty nebo hlasy. Vlastní programy šablony, postav a předmětu zůstávají výslovně neanalyzované; nulový počet chyb není důkazem hratelnosti.

Přes **Spustit level** zkoušejte uloženou misi v oddělené herní kopii. Ověřte obě odpovědi, ruční sebrání klíčů, příchod bez klíčů, odevzdání s odebráním z inventáře, finální rozhovor a konec. Samostatně vyzkoušejte smrt příjemce. Po ukončení testu načtěte checkpoint stejné revize projektu a dokončete doručení znovu. Změna assetů checkpoint zneplatní; neobcházejte tuto kontrolu přejmenováním save.

Exportujte mod do nové složky a porovnejte jeho soubory s uloženými modifikacemi. Pro běžný návrat k projektu použijte **Otevřít projekt** a vyberte jeho adresář, potom `missions/WB_DELIVERY_DEMO/scene2.bin`; neotvírejte samostatný export jako projekt Workbench.

## Stav ověření

Příklad byl sestaven existujícími produkčními API projektu. Všech šest receptů se z uloženého zdroje obnoví do svých nastavení. Česká kontrola mise našla 0 chyb, 0 varování a jednu informaci o šesti neanalyzovaných vlastních programech. Export i znovuotevřený projekt mají stejné hashe jako uložené modifikace.

Tři integrační běhy v původní GOG 1.2 přes produkční Playtest doložily stav úplnými uloženými soubory. Soubory scény, českých textů a obou vlastních hlasů v oddělené hře byly před testem porovnané s projektem.

| Běh | Doložený stav |
| --- | --- |
| Přijetí zakázky | Volba má potvrzený claim. V čase 17 807 ms hráč ještě nemá klíče a závěrečný rozhovor nemá signál. Později měřicí program zaznamenal vlastnictví klíčů; po předání v 39 963 ms je už hráč nemá a `WB_FINAL` dostal signál. V 44 509 ms prošel závěrečný rozhovor a signál dostal `WB_COMPLETE`; odmítnutí zůstalo 0. |
| Načtení checkpointu 5001 | Produkční nabídka označila checkpoint stejné revize za kompatibilní. Nový proces pokračoval až k předání, odebrání klíčů a signálu `WB_COMPLETE` v 44 525 ms. Uložený monitor obnovil své proměnné a znovu zaznamenal pořadí inventáře 0 → 1 → 0. Hash načítaného checkpointu se nezměnil. |
| Odmítnutí | V čase 13 725 ms má volba claim a `WB_REFUSE` signál 1. `WB_DELIVERY`, `WB_FINAL` a `WB_COMPLETE` mají signál 0. |

Časy jsou herní údaje ze save, nikoli čas stopovaný na Macu. Výběr odpovědi provedl diagnostický NPC přes `enemy_use_detector`. Klíče přidal a hráče k cíli přemístil jeho testovací program. Ruční sebrání fyzického předmětu, tlačítko akce, slyšitelná podoba vlastního hlasu, smrt příjemce, výsledná koncová obrazovka a restart přes herní menu tímto průchodem doložené nejsou. Mac byl zamčený, takže se nepodařilo získat použitelný snímek a ověřit tento projekt v okně editoru. Oba dialogové programy navazující signály skutečně vykonaly; vizuální střih a zvuk vyžadují samostatnou kontrolu.

První pomocný průchod chybně přesouval rám modelu hráče příkazem `frm_setpos`. Měření bylo opraveno na `actor_setpos` a finální průchody opakované. Produkční šablony kvůli tomu nebylo potřeba měnit.

Po každém běhu se diagnostické změny vrátily přes undo, soukromé save i index checkpointů se obnovily. Zůstává samostatný projekt s ukázkovou misí bez diagnostických řídicích programů; jeho soukromý index je `local/delivery-demo.json`. Kontrolované původní EXE, uživatelský projekt a předchozí auditní projekty mají shodné hashe. Nový integrační blok nevyžadoval změnu implementace editoru. Dokončení celého editoru a podmínka zahájení městského pluginu zůstávají otevřené do ověření skutečného hráčského průchodu.
