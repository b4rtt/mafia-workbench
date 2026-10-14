# Skriptování a další uložené zdroje

## MSDR CZ

Uživatel dodal českou příručku **Mafia script & data reference** od Tomáše Růžičky (djbozkosz), verze uvedená v dokumentu **2012.11.03**, 64 stran. Přesná kopie, text pro hledání a pomocný index jsou uložené vedle ostatních místních referencí:

- `../.editor-references/documentation/MSDR.CZ.pdf`
- `../.editor-references/documentation/MSDR.CZ.txt`
- `../.editor-references/documentation/MSDR.CZ.command-index.json`
- `../.editor-references/documentation/MSDR.CZ.metadata.json`

SHA-256 PDF: `fcf419f2d2beec2b16139eccdcd9e60e8fd8c9cc769b8dd59ad9a398eb49e89b`; velikost 328 300 bajtů. Soubor byl uložen 12. října 2026 a bajtově porovnán s dodaným originálem. Náhled první stránky potvrzuje titul, autora a verzi. Dokument a jeho úplný text zůstávají místními referencemi mimo veřejné repo.

| Téma | Strany PDF |
| --- | --- |
| Abecední přehled skriptových příkazů a parametrů | 1–44 |
| Zbraně, vlastnosti a chování postav | 44 |
| Stavy chování, hlasy postav a titulky | 45–46 |
| Ovládání a materiály | 46 |
| Efekty | 46–48 |
| Float32, soundtrack | 48 |
| Auta a názvy modelů | 48–51 |
| Animace a pohybové stopy | 51–64 |

Strany jsou číslované od jedné, shodně s tištěným číslem dokumentu. JSON index obsahuje automaticky nalezené kandidáty názvů příkazů a stránky; není validovanou gramatikou skriptovacího jazyka. Hledání v úplném textu z kořene editoru:

```sh
rg -n -i 'camera_setfov|actor_setpos|human_set' ../.editor-references/documentation/MSDR.CZ.txt
```

Při rozšiřování editoru skriptů používat příručku jako referenci pro nápovědu k příkazům, orientaci v parametrech a výběr herních ID. Nejistoty označené v dokumentu `???` nejsou ověřená specifikace. Význam a dostupnost příkazu porovnat se skutečnými skripty a enginem dané verze; hodnoty příručky nejsou automatickým podkladem pro přepsání binárních dat. Samotné uložení dokumentace nepřidává nové příkazy do hry.

## Awesome Mafia

[Rozcestník](https://github.com/MafiaHub/awesome-mafia/blob/main/README.md) je už uložený v `../.editor-references/MafiaHub__awesome-mafia`; přesná revize je v `repositories.json`. Obsah aktuální stránky byl znovu přečten 12. října 2026. Místní `../.editor-references/documentation/awesome-mafia.resources.json` třídí 115 odkazů uloženého snapshotu podle původních sekcí. Je to index odkazů, nikoli tvrzení, že byly stažené všechny archivy. Konkrétní stažené MSDR a Empty Mission mají vlastní evidenci.

| Další využití | Odkazy v rozcestníku |
| --- | --- |
| Skriptování | [MSDR CZ](https://github.com/user-attachments/files/16228218/MSDR.CZ.pdf), [Mafia Script Helper 2](https://github.com/user-attachments/files/16315706/Mafia.Script.Helper.v2.0.zip), [BScriptView guide](https://github.com/user-attachments/files/16255436/BScriptView.6.0.pdf) |
| Cutscény | [Český návod](https://github.com/user-attachments/files/16238732/navod_cutsceny.pdf) |
| Vlastní mapy a modely | [Model Implementation Guide](https://github.com/user-attachments/files/16255438/Mr.Robville.s.Model.Implementation.Guide.2015.pdf), [Empty Mission](https://github.com/user-attachments/files/16255595/Empty_Mission.zip), [3D Model List](https://github.com/user-attachments/files/16238692/3D.Model.List.zip) |
| Kolize a osvětlení | TreeRE, LS3D Lightmapper |
| Ostatní formáty | Přehled v [formats.md](formats.md) a úplný místní katalog odkazů |

Odkazované MSDR PDF se zde eviduje jako položka rozcestníku; shoda vzdáleného souboru s uživatelovou kopií nebyla ověřena. Stažená kopie pochází přímo od uživatele. Archivované odkazy a popisy nástrojů slouží pro další průzkum; instalace nástroje, kompatibilita a licence se ověřují až při jeho skutečném použití.


## Lineární úkol z interaktivního bodu

`src/shared/mission-task.js` sestavuje program aktéra typu detector. Opírá se o uloženou MSDR (příkazy `detector_waitforuse`, `mission_objectives`, `mission_objectivesremove`, `frm_getworldpos`, `vect_sub_vect`, `vect_magnitude` a `endofmission`) a [rozbor detektoru v enginu](https://github.com/st0rm94/mafia-reverse-engineering-export/blob/main/structs/detector.md). Konkrétní lokální kopie a revize jsou v evidenci referenčních repozitářů.

První zadání a titulek se nastaví po krátkém čekání; `detector_waitforuse` blokuje program do použití bodu. Potom se odstraní jen první zadání a přidá návazné. Smyčka porovnává světovou pozici cílového frame a hráče Tommy v intervalu 100 ms. Uvnitř poloměru se odstraní návazné zadání a zobrazí dokončení. Výchozí program poté skončí, svět mise běží dál. Explicitní návrat do menu používá typ 1; nejde o obecný přechod do další mise kampaně. Šablona neprovádí globální mazání zadání. Výchozí varianta neukládá; volitelný úplný checkpoint je popsaný níže.

Projekt před zápisem znovu sestaví program a kontroluje existenci všech ID ve zvolené jazykové tabulce, její hash a jednoznačný cílový frame ve scéně/geometrii. Textová tabulka a geometrie jsou závislosti transakce: jejich souběžná změna zabrání zveřejnění nové scény. Vlastní program ostatních aktérů a jejich neznámá data se nemění.

Ověření 13. října 2026: v odděleném Electronu vytvořen bod se čtyřmi novými českými texty a cílem u modelu bedny. Přesný program, maska 1, pozice, export a UI undo byly ověřené. V izolované Wine hře se zobrazily všechny tři fáze. Kontrolní NPC použil `enemy_use_detector`, hráč byl později přesunut skriptem do cíle; ruční Action Button a běžná chůze v tomto testu nebyly ověřené. Herní kontrolní změny a čtyři texty byly vrácené, historie a text/scéna/model/KLZ mají původní bajty. Hra byla ukončená.

Zbývá ověřit ruční interakci, volitelný návrat do menu a stav při restartu/načtení save. Šablona není hotový generátor kompletní mise ani větveného questu; návazná práce zahrnuje vlastní hlas a jeho vazbu, podmínky/failure a spolehlivý postup celou misí.

## Vlastní dabing navázaný na TextDB

PC engine `speech_channel_speak_line` (VA 005473b0) načítá `sounds/%08d.wav` podle stejného ID jako text a volitelný `tables/dat/%08d.dat` pro synchronizaci rtů. Podklad je [rozbor řečového kanálu](https://github.com/st0rm94/mafia-reverse-engineering-export/blob/main/structs/speech.md) a uložená anotovaná dekompilace. Formátování v této PC verzi používá signed int32; import dovoluje nezáporná ID do 2147483647. Chybějící DAT nebrání otevření WAV, import jej zatím nevytváří.

V Texty vyberte existující běžné ID a **Importovat dabing…**. Dialog nabízí přehrání převedené nahrávky před uložením. Nový WAV nebo náhrada stávajícího je jediná vratná změna modu, s kontrolou verze TextDB i existujícího zvuku. Texty se tím nepřepisují. WAV stejného ID je společný všem jazykům; vytvoření jazykového textu samo o sobě nevytváří další hlasovou variantu.

Příklad programu pro existujícího mluvčího:

```text
dim_act 1
findactor 0, "Tommy"
human_talk 0, 90000
end
```

Pozor na rozdíl vůči MSDR: implementace PC příkazu 0x83 v `C_program` zahájí řečový kanál a opakovaně čeká, dokud mluví. Další instrukce pokračuje po jeho uvolnění. Jde o závěr z konkrétní dekompilace a omezeného lokálního herního testu, nikoli tvrzení o všech variantách příkazu či verzích hry. Import nedoplňuje skript automaticky ani nepředstavuje editor celé dialogové větve. LIP DAT lze samostatně vytvořit přes **Pohyb úst…**; samotný import WAV ho nevytváří.

Lokální ověření: nový float stereo WAV byl přes UI importovaný jako mono PCM16 44,1 kHz, náhled doběhl do konce. Přesný export, nahrazení kratší nahrávkou a UI undo obnovily bajty i historii. V izolované hře stejný kontrolní skript čekal déle s importovaným WAV než bez něj a následně změnil HUD; text a WAV byly v testovací kopii ověřené hashem. Fyzický zvukový výstup nebyl samostatně zachycený/poslechnutý. Všechny pomocné změny vrácené, testovací hry ukončené. Tento test nepotvrzuje lip synchronizaci, všechny vstupní sample rate ani dialogové větve.


## Průvodce rozhovorem a dialogová kamera

`src/shared/mission-dialogue.js` sestavuje lineární rozhovor 1–32 replik s unikátními sloty lidských aktérů (PC typ 2 nebo 27). Varianta použití bodu čeká na `detector_waitforuse ID`; varianta po načtení tento příkaz vynechá. `human_talk` blokuje do dokončení řeči, takže se nepřidávají odhadované prodlevy podle délky textu.

PC dispatcher 0x4d (`dialog_begin`) přijímá první slot aktéra a počet účastníků v souvislém seznamu. To se liší od nejistého popisu parametrů v MSDR. Dispatcher 0x4f (`dialog_camswitch`) používá první osobu pro pohled přes rameno a druhou jako cíl záběru: šablona předává posluchače, mluvčího. `dialog_end` zastaví dialogovou kameru a znovu povolí idle animaci hráče. Podklad je uložená [anotovaná PC dekompilace](https://github.com/st0rm94/mafia-reverse-engineering-export/blob/main/ghidra/Game-ghidra.exe.annotated.c), případy 0x4d–0x4f a 0x83. Jde o interpretaci konkrétní implementace, nikoli záruku jiných verzí hry. Šablona neotáčí aktéry, nepozastavuje jejich ostatní programy a nepřidává lip DAT. Pro vlastní dabing použijte u stejného TextDB ID samostatné **Pohyb úst…**; hra načte `tables/dat/%08d.dat` při řeči. Formát, ruční editace a amplitudový návrh jsou popsané v [poznámkách k LIP DAT](formats.md#pohyb-úst-lip-dat). Titulky řeči řídí herní HUD/nastavení a vzdálenost; tento průvodce je nevynucuje přes `subtitle_add`.

Před zápisem se ověří jednoznačné lidské postavy a jejich framy, existence ID v TextDB mimo hraniční záznam, odpovídající WAV hlavička a hash každé použité nahrávky. TextDB, hlasy a geometrie jsou závislosti transakce; souběžná změna přeruší publikaci scény. Kód a masku 1 znovu sestaví core, nedůvěřuje náhledu ani dodanému kódu. Vznikne jeden nový skriptový bod; vlastní programy jiných postav se nemění.

Ověření 13. října 2026: přes okno Electronu vytvořeny dvě repliky s vlastními českými texty a dvěma WAV, mluvčími NPC/Tommy a opačnými posluchači. Chybějící ID blokovalo vytvoření, změna pořadí a návrat změnily správně celý náhled. Export odpovídal uložené scéně a hlasům; UI undo přesně odstranilo rozhovor a ponechalo texty/hlasy. V izolované Wine hře bod aktivoval kontrolní NPC příkazem `enemy_use_detector`; kamera přešla přes rameno obou osob a vrátila se k hráči. Soukromý příkaz až za `dialog_end` změnil HUD z 21 na 61, což potvrzuje průchod celým programem. Texty v těchto dialogových snímcích nebyly viditelné; jejich zobrazení není tímto testem doložené. Fyzický výstup zvuku nebyl samostatně zachycený ani poslechnutý. Ruční Action Button, spuštění po načtení bez aktivace, opakování, restart a save/load zbývají. Kontrolní skripty i šest přípravných operací byly vrácené, historie 38 a zdrojové bajty obnovené, hry a testovací editor ukončené. V dřívějším pomocném JSON byl zastaralý hash geometrie; konečný stav se navíc ověřil vůči immutable původnímu souboru a jeho manifestovému hash.


## Pojmenovaný úplný checkpoint úkolu

Šablona úkolu podporuje nepovinné `checkpointId` (výchozí `null`). Po použití bodu, odstranění původního zadání a vložení návazného cíle zapíše `autosavegamefull ID, 1`. Příkaz je před značkou vzdálenostní smyčky, takže běžné opakování smyčky znovu neukládá. Není přidané ukládání při dokončení ani automatické načítání save.

Podklad: uložená [PC dekompilace](https://github.com/st0rm94/mafia-reverse-engineering-export/blob/main/ghidra/Game-ghidra.exe.annotated.c), dispatcher 0x80/0x81, `loadsave_savegame_from_script` (00559320), `loadsave_savegame_save` (00558ed0), `game_save_game_save` (005f05a0) a `program_save_game_save` (005bae90); [struktury savegame](https://github.com/st0rm94/mafia-reverse-engineering-export/blob/main/structs/loadsave.md). `autosavegame` a `autosavegamefull` mají společný writer, ale jiný full flag. Běžné autosave nelze popisovat jako ukládání pouze polohy hráče: full varianta zahrnuje širší globální seznam aktérů a další stav médií. Programové runtime údaje se zapisují přes vlastní writer aktéra. Načtení nastavuje potlačení následujícího ukládání jednou; jde o rozbor zdrojové implementace, nikoli zde ověřený průchod načtením.

Save slot má index `ID − 5000`. Enumerátor hledá 600 slotů a vynechá ty bez názvu v TextDB; průvodce proto přijímá pouze 5000–5599 a existující neprázdný běžný text mimo hraniční záznam. Kontrola probíhá v UI i core a používá tutéž hashově chráněnou tabulku jako ostatní ID úkolu. Ukládání je výchozí vypnuté, zvolené ID má náhled názvu. Každé použití téhož ID ve hře přepisuje tentýž slot aktivního profilu. Projektové undo ruší změnu skriptu, nedotýká se již vzniklého herního save. Rychlý start levelu stále načítá novou misi; samostatné načtení checkpointu bylo doplněno a ověřeno v [návazném bloku](checkpoint-load.md).

Ověření 13.–14. října 2026: v odděleném Electronu výchozí vypnutí, zapnutí, náhled názvu 5599, odmítnutí neexistujícího 5598 bez zápisu a opětovné vypnutí (příkaz zmizel). Vytvořený bod měl přesný program, XYZ, jediný krok historie a přesný export; UI undo obnovilo scénu a historii. V izolované GOG 1.2 Wine hře aktivoval bod kontrolní NPC přes `enemy_use_detector`, hráč byl později přesunut skriptem k cíli. Nový `savegame/mafia000.599` měl 5 242 bajtů. Nezávislé místní čtení streamu podle doložené šifry ověřilo verzi, index 599, ID 5599, misi `wbtest`, energii 21 před přesunem a devět úplně přečtených záznamů aktérů. Úkolový aktér obsahoval program counter 11, sedm float slotů a vazby na dva framy (bedna/Tommy). Herní snímek po přesunu zobrazil „Úkol dokončen.“ a HUD 61. Toto prokazuje zápis slotu a následný průchod programem, nikoli obnovení stavu po načtení.

Automatické poslání klávesy akce přes dříve povolený System Events odmítlo macOS kvůli odebranému oprávnění (1002); zabezpečení nebylo měněné. Ruční průchod, restart, načtení úplného checkpointu a návrat do menu stále čekají na ověření. Obě testovací hry i Electron byly ukončené, všechny pomocné změny vrácené na historii 38. Původní scéna, TextDB, model, immutable geometrie, KLZ, zdrojový WAV a chráněné projekty/EXE mají původní hash.


## Podmínky neúspěchu lineárního úkolu

Nepovinné `failure` obsahuje `timeoutSeconds` (0,1–86400, jinak null), `humanName` (jinak null), `textId` a `endMission` (výchozí false). Musí být zvolený alespoň čas nebo postava. Text je běžný neprázdný záznam TextDB mimo sentinel, ID 0–2147483647. Projekt hlídá hash tabulky/geometrie a vlastní scény, typ 2/27 a jednoznačnou vazbu postavy na frame; kód sestavuje znovu s kanonickým jménem. Výchozí šablona bez neúspěchu zůstává bajtově shodná.

Po převzetí bodu se naváže postava a uloží počáteční herní čas. Teprve potom případně vznikne úplný checkpoint. Poll každých 100 ms nejdřív kontroluje energii postavy, pak uplynulý čas a až pak vzdálenost k cíli. Jeden neúspěch stačí, v téže iteraci má přednost před dokončením. Obě větve odstraní pouze vlastní návazné zadání; úspěšná větev končí před značkou neúspěchu. Bez `endMission` po textu skončí program a svět mise pokračuje. Se zapnutou volbou po čtyřsekundovém čekání následuje `endofmission 0, textId`, tedy obrazovka Konec hry.

Primární podklady: uložený PC export `program_process_command` v `Game-ghidra.exe.annotated.c`, case **0x66 HUMAN_GETPROPERTY**, **0xd1 GETGAMETIME** a **0x24 ENDOFMISSION**, doplněný místním MSDR.CZ. `human_getproperty ACT, FLOAT, Energy` vrací procenta a při `actor_is_alive == false` vrací nulu; nejde o neexistující příkaz `human_isdead`. Jméno vlastnosti je holý token `Energy`, bez uvozovek: dekodér obou property příkazů porovnává třetí parametr přímo s tabulkou jmen. Komentář exportu s ukázkou v uvozovkách zde není spolehlivý. `getgametime FLOAT` vrací milisekundy do float slotu. Elapsed se sestaví `getgametime 9` a `let flt[9] = flt[9] - flt[8]`, bez přebírání jediného globálního HUD timeru. Dimenzování rezervuje 0–6 pro vzdálenost, 7 pro zdraví, 8/9 pro čas. Čas má přesnost floatů enginu; limit není systémový čas ani samostatné odpočítávadlo na HUD. Automatické odstranění hlídaného aktéra jiným skriptem není tato šablona pro smrt; jiné změny světa kontrolujte vlastním programem.

Časový limit po načtení save, ruční aktivace, volby opakování/menu obrazovky Konec hry a další dialogové/úkolové větve zůstávají k ověření. Zápis floatů ve full-save sám neprokazuje navázání herního času po load; tento blok tuto hranici neuzavírá.

Herní ověření 14. října 2026 odhalilo rozdíl mezi komentářem exportu a skutečným parserem: uvozovky kolem `Energy` vedly k odmítnutému příkazu a nulové hodnotě rezervovaného floatu, tedy k chybnému neúspěchu živé postavy. Finální generátor používá holý token, zachycený v testu. Opravený program s oběma podmínkami následně zobrazil „Úkol dokončen.“ při skriptovaném přesunu, HUD 61 a zůstal v běžící misi i v pozdějším snímku. Varianta pouze s časem a bez konce mise zobrazila neúspěch a potom pokračoval nezávislý skript (HUD 21 → 61). Časový limit je tedy doložen bez falešného selhání přes zdraví. Aktivaci bodu vyvolal kontrolní NPC příkazem `enemy_use_detector`; nejde o ruční průchod tlačítkem akce.

Finální kontrola smrti bez časového limitu: po převzetí kontrolní NPC snížil vlastní energii na nulu; snímek zachytil ležící postavu, text „Úkol selhal.“ a následně obrazovku Konec hry se stejným textem. Kombinovaný program s osmivteřinovým limitem a živým NPC nejprve zobrazil návazný cíl, později neúspěch a Konec hry. V aktuálním Electronu byl znovu vytvořen celý bod: přesný program s holým `Energy`, XYZ, jediný krok historie, přesný export a UI undo. Všechny testovací hry a aplikace ukončené; kontrolní NPC, skripty a pět pomocných textů vrácené na historii 38. Scéna, TextDB, model, geometrie a KLZ i chráněné projekty/původní EXE mají původní hashe. 319 testů, check a build prošly.


## Návaznosti úkolů a rozhovorů přes detektorové signály

`mission-flow.js` je společný generátor pro nepovinné `flow`: `waitForSignal`, `onComplete`, a u úkolu s podmínkou neúspěchu také `onFailure`. Bez konfigurace zůstává dosavadní program přesně shodný. Příjemce po úvodním čekání čte vlastní detektor přes `detector_issignal -1, 2, -1`, při nule čeká 100 ms a opakuje značku 1, při jedničce pokračuje za značkou 2. Před čekáním se nezapisuje nula: jinak by se ztratil signál odeslaný dříve. Zdroj přes `findactor SLOT, "NAME"` naváže cíl a na konci příslušné větve zapíše `detector_setsignal SLOT, 1`. Úspěšná větev končí před značkou neúspěchu; neodesílají se obě větve. U rozhovoru signál následuje za poslední blokující řečí a případným `dialog_end`. Obsazené sloty mluvčích a hlídané postavy se nepřepisují, společný cíl obou větví zabere jen jeden další slot.

Primární podklad: místní `st0rm94__mafia-reverse-engineering-export/ghidra/Game-ghidra.exe.annotated.c`, dispatcher `case 0x1a` / `0x1b` (`DETECTOR_ISSIGNAL` / `DETECTOR_SETSIGNAL`, kolem řádků 350535 a 350578). Neplatný index aktéra začíná výběrem vlastníka programu z `param_1[0x11]` (+0x44); pouze platný index jej přepíše. Oba příkazy vyžadují kind 5. Prázdná značka `-1` znamená pokračování bez skoku. Těla `detector_get_signal` (VA 0x005c8d00) a `detector_set_signal` (VA 0x005c8d10) čtou/píšou skutečný byte +0xdc; starší popis struct uvádí nesprávně +0xd8. Setter navíc nuluje byte +0x65. MSDR popisuje signál jako prostředek synchronizace, nikoli samostatnou akci. Nativní dispatcher a skutečný průchod jsou rozhodující pro použití vlastního detektoru přes index -1.

UI nabízí pouze jednoznačné kind-5 aktéry se scene/geometrickým frame, s názvem bez uvozovek a řídicích znaků. Core znovu kontroluje vazby nad aktuální scénou, kanonizuje velikost písmen/NFC a nepřebírá libovolný program dodaný vedle šablony. Změna scény/geometrie/TextDB/WAV od otevření formuláře blokuje publikaci přes stávající ochranu verzí. Vlastní cíl, lidský aktér, chybějící nebo nejednoznačný bod se odmítne. Větev neúspěchu potřebuje aktivní podmínku; signál pokračování nelze kombinovat s návratem do menu či Konec hry v téže větvi. Každý vytvořený bod má jeden krok undo.

Signál je boolean; není to fronta více událostí. Cíl musí mít čekající program, ukončený program se samotným signálem znovu nespustí. Návazný úkol stále potřebuje použití bodu; rozhovor se spuštěním po načtení začne po signálu bez dalšího použití. Přepínání mezi misemi kampaně, dialogové volby, opakování, libovolný graf s cykly a pokračování po load nejsou tímto blokem implementované či ověřené.

Ověření 14. října 2026: v aktuálním Electronu vytvořen čekající rozhovor `WB_FLOW_NEXT` s návazností na `WB_FLOW_FINISH`, potom čekající úkol `WB_FLOW_UI` s osmivteřinovým limitem, úspěchem směrovaným na rozhovor a neúspěchem na `WB_FLOW_FAIL`. Konfliktní návrat do menu zablokoval formulář a historie se nezměnila. Uložené programy odpovídaly generátorům, export scény/TextDB/WAV měl stejné hashe. Každý bod byl později vrácen přes UI jedním undo s přesnými mezistavy.

Izolovaná GOG 1.2/Wine hra: kontrolní NPC odeslal signál úkolu v šesté herní sekundě a o dvě sekundy později jej převzal pomocí `enemy_use_detector`. Skriptovaný přesun hráče k bedně dokončil první úkol; snímky zachytily návazný cíl, dokončení a později „Celý řetězec dokončen.“ s HUD 31. Ten nastavuje pouze čekající koncový bod; cesta k němu vede přes blokující `human_talk` v rozhovoru. Samostatný běh bez přesunu ukázal „Úkol selhal.“, následně pouze „Spuštěna větev neúspěchu.“ s HUD 81, který zůstal i v pozdním snímku. Třetí běh odeslal signál hned na začátku, před dvousekundovým čekáním úkolu; řetězec přesto došel ke koncovému HUD 31. Tím je ověřená i absence ztráty časného signálu.

Rozhovor tohoto testu používá soukromý 100ms tichý PCM WAV, nikoli skutečný namluvený hlas. Průchod za `human_talk` je doložený, fyzický zvuk ani zobrazení textu této krátké repliky tím ověřené nejsou. Ruční použití, restart a obnovení checkpointu/signálů po load zůstávají samostatně neověřené. Tři hry i Audit editor ukončeny; pomocné skripty, postava, body, osm textů a WAV vráceny na historii 38. Scéna, geometrie, KLZ, model a TextDB mají výchozí hashe, ostatní chráněné projekty i původní EXE zůstaly stejné. 323 testů, check a build prošly; herní data a soukromé auditní podklady se nepublikují.


## Návazné ověření po obnovení checkpointu

[Audit načtení checkpointu](checkpoint-load.md#časový-limit-a-signály-po-načtení) dokládá v GOG 1.2 osmivteřinový limit i obě návazné úkolové větve po load, navíc signál odeslaný před save a převzatý až po zbývajícím čekání příjemce. Starší odstavce výše popisují hranice svých tehdejších testů. Obnovení dialogového kanálu, smrt hlídané postavy po load, ruční použití a restart přes menu dál vyžadují ověření.

Pro měřicí a vlastní skripty: let připouští jen `let flt[N] = A OP B`, případně prosté přiřazení. Dělení a další přičtení napište jako dva příkazy. Dispatcher case 8 a program_decode_let mají vlastní pořadí hledání operátoru, bez precedence a bez závorek; výraz se dvěma operátory může projít bez hlášení a provést jiný výpočet. Produkční úkolový časovač používá jediné odečtení a tohoto omezení se drží.


## Dokončení úkolu a načtení další mise

Generátor má nepovinné `nextMission`. Po úspěchu a čtyřsekundové prodlevě emituje `change_mission "NAME", "", -1`; neúspěšná větev přechod neobsahuje. Výchozí program bez další mise má původní bajty. Prázdný entry-frame záměrně inicializuje nového hráče a startovní skripty cílové mise, bez přenosu inventáře, zdraví či auta. Přenos a přemístění stávajícího hráče vyžadují další pravidla a tento průvodce je nenabízí.

Podklad: dispatcher case 0x33 CHANGE_MISSION a návazné zpracování konce mise v místním snapshotu [reverse-engineering exportu](https://github.com/st0rm94/mafia-reverse-engineering-export). Payload 0x88 obsahuje dvě 64bajtová pole názvů a rychlost float; větev přenosu hráče/vozidla závisí na neprázdném entry-frame. Proto je název omezen na 63 ASCII znaků bez cesty/uvozovek/řídicích znaků a rezervovaných Windows názvů. `WBTEST` je vyhrazen izolovanému launcheru. MSDR příkaz rovněž dokumentuje složku mise, vstupní frame a rychlost vozidla.

Výběr nabízí pouze jiné projektové složky se scene2.bin, scene.4ds a tree.klz, bez rozlišení velikosti písmen. Core znovu parsuje všechny tři soubory, vyžaduje jednoznačného aktéra Tommy typu Player (2) navázaného na frame a kanonizuje skutečný název. Hash všech tří dat je závislostí před stagingem i publikací: změna od výběru nebo během zápisu odmítne vytvoření. Cílové soubory se nepřepisují. Přechod nelze kombinovat s návratem do menu ani signálem dokončení; neúspěšná větev může dál použít vlastní signál.

Ověření 14. října 2026: v aktuálním Electronu vyplněn úkol s vlastními XYZ, čtyřmi existujícími texty a cílovou bednou. Výběr nové cílové mise dokončil kontrolu dat a zobrazil vysvětlení nového hráče. Konfliktní návrat do menu formulář odmítl bez vytvoření. Potom vznikl jeden bod s přesným programem a maskou, jedním krokem historie, přesným exportem a reopen. UI undo obnovilo připravený soubor a délku historie.

Produkční izolovaný Playtest dostal přesné hashe aktuální scény, všech osmi souborů cílové mise a TextDB. V GOG 1.2/Wine kontrolní NPC převzal bod pomocí enemy_use_detector a přesunul hráče k bedně. Snímky zachytily návazný cíl, text dokončení, původní zdraví 71, nový startovní stav 100 a poté zdraví 31, které nastavuje pouze skript cílové mise. Po přechodu běh pokračoval i v pozdním snímku. To prokazuje vykonání cílové inicializace; krátký text jejího startovního skriptu samotné snímky nezachytily. Ruční použití, hranice checkpointů/načítání mezi misemi a přenos hráče či vozidla zůstávají neověřené.

Hra a Audit aplikace ukončené. UI bod i čtyři přípravné operace vráceny na historii 38; původní scéna, model, geometrie, KLZ a TextDB mají výchozí hashe, cílová testovací mise není v indexu. Původní save aktivního profilu obnovený a ostatní chráněné projekty/EXE přesné. Herní soubory, snímky a pomocné skripty zůstávají v ignorovaném local/. 336 testů, check a build prošly.

## Bojový úkol a aktivní NPC

`Přidat bojový úkol…` vytvoří detektor typu 5 s maskou 1 a vlastním programem. Sleduje 1–16 jednoznačných NPC typu 27 navázaných na existující framy, kromě hráče. Po volitelném signálu a aktivaci získá aktéry přes `findactor`; `human_getproperty actor, 0, Energy` vrací procenta energie a u mrtvého aktéra nulu. V cyklu po 100 ms čeká na všechny cíle. Časový limit používá místní `getgametime` registry, začíná při aktivaci. Smrt jiné chráněné NPC a časový limit mají přednost před dokončením. Úspěch/neúspěch odstraní pouze vlastní zadání a mohou odeslat signál jinému bodu nebo ukončit misi. Checkpoint je volitelný, ukládá až po inicializaci vazeb/času a přepisuje profil 0, slot ID − 5000; editorským undo nelze vrátit herní save.

Core sestaví zdroj znovu a ověří skutečnou scénu, geometrii a neprázdné jednoznačné TextDB ID včetně případného názvu checkpointu. Ostatní NPC programy nepřepisuje, zdraví nenastavuje a aktéry nemaže. Proto samotná šablona nevytvoří nepřítele: výzbroj, chování a aktivní program cíle musí připravit autor mise.

**Pozor na `end` v programu NPC.** V PC enginu příkaz volá `program_clear_after_end` (VA 0x005bac10), který nastaví vlastnímu aktérovi stav 2 přes `actor_set_act_state` (0x0044c750). `human_change_state` (0x00494d60) pro jiný stav než 0 odregistruje dynamické kolize; pro živou postavu odstraní všechny. Model může zůstat stát, ale aktér už není aktivní. Typ 27 ani správná kostra tomu nezabrání. Pro stojící živou NPC použijte výchozí program editoru:

```text
label 1
wait 1000
goto 1
```

Při skutečné smrti `human_death` (0x00490a20) odstraní pohybový collider a ponechá objem s příznakem 2 pro tělo; to je odlišný stav od vypnutí živé NPC. `human_create_dyn_colls` (0x00496110) vytváří dva objemy a vyžaduje podframe `base`. Primární podklad: uložený [PC/PS2 reverse engineering export](https://github.com/st0rm94/mafia-reverse-engineering-export), `Game-ghidra.exe.annotated.c`, a místní MSDR.CZ dokumentace. Toto není požadavek vytvářet statickou KLZ kolizi postavy.

Ověření: testy rozhodnutí pokrývají všechny kombinace dvou živých/mrtvých cílů, prioritu smrti ochránce, hranici času, aktivaci, registry návazností a checkpointu; projektové testy kontrolují stale texty/geometrii, neplatné NPC/ID, zachování ostatních programů/opaque dat, export/reopen a přesné undo. V odděleném Electronu vznikl úkol s dvěma cíli, ochranou třetí NPC, 60s limitem, checkpointem 5050 a následným bodem. Chybná ochrana stejného cíle byla odmítnutá, platný zdroj/maska/export přesné a uložení mělo jeden krok historie.

V izolované GOG 1.2/Wine hře kontrolní program aktivoval úkol, skriptovaně snížil energii obou cílů a následný bod změnil HUD na 85. Srovnávací běh se stejnými modely a parametry ukázal NPC s `end` po smrti stále stojící a NPC s čekací smyčkou ležící; tento rozdíl odpovídá uvedenému přechodu stavu. Chyba byla v mém pomocném testovacím programu, nikoli ve výchozí smyčce dialogu Přidat postavu. Tři NPC oddělené testovací mise dostaly čekací smyčku. Opakované závěrečné testy všech aktivních NPC a dotazů na kolize se nedostaly do hry kvůli `nodrv_CreateWindow / explorer process failed to start`; nejde o důkaz jejich runtime výsledku. Ruční průchod kolem živé NPC, běžná střelba, větve neúspěchu a načtení tohoto checkpointu zůstávají neověřené. Testovací procesy ukončené, dočasné diagnostické programy vrácené a chráněný uživatelský projekt/původní EXE mají shodné hashe.
