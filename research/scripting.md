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

První zadání a titulek se nastaví po krátkém čekání; `detector_waitforuse` blokuje program do použití bodu. Potom se odstraní jen první zadání a přidá návazné. Smyčka porovnává světovou pozici cílového frame a hráče Tommy v intervalu 100 ms. Uvnitř poloměru se odstraní návazné zadání a zobrazí dokončení. Výchozí program poté skončí, svět mise běží dál. Explicitní návrat do menu používá typ 1; nejde o obecný přechod do další mise kampaně. Šablona neprovádí globální mazání zadání ani nové autosave.

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

Pozor na rozdíl vůči MSDR: implementace PC příkazu 0x83 v `C_program` zahájí řečový kanál a opakovaně čeká, dokud mluví. Další instrukce pokračuje po jeho uvolnění. Jde o závěr z konkrétní dekompilace a omezeného lokálního herního testu, nikoli tvrzení o všech variantách příkazu či verzích hry. Import nedoplňuje skript automaticky, negeneruje lip DAT a nepředstavuje editor celé dialogové větve.

Lokální ověření: nový float stereo WAV byl přes UI importovaný jako mono PCM16 44,1 kHz, náhled doběhl do konce. Přesný export, nahrazení kratší nahrávkou a UI undo obnovily bajty i historii. V izolované hře stejný kontrolní skript čekal déle s importovaným WAV než bez něj a následně změnil HUD; text a WAV byly v testovací kopii ověřené hashem. Fyzický zvukový výstup nebyl samostatně zachycený/poslechnutý. Všechny pomocné změny vrácené, testovací hry ukončené. Tento test nepotvrzuje lip synchronizaci, všechny vstupní sample rate ani dialogové větve.


## Průvodce rozhovorem a dialogová kamera

`src/shared/mission-dialogue.js` sestavuje lineární rozhovor 1–32 replik s unikátními sloty lidských aktérů (PC typ 2 nebo 27). Varianta použití bodu čeká na `detector_waitforuse ID`; varianta po načtení tento příkaz vynechá. `human_talk` blokuje do dokončení řeči, takže se nepřidávají odhadované prodlevy podle délky textu.

PC dispatcher 0x4d (`dialog_begin`) přijímá první slot aktéra a počet účastníků v souvislém seznamu. To se liší od nejistého popisu parametrů v MSDR. Dispatcher 0x4f (`dialog_camswitch`) používá první osobu pro pohled přes rameno a druhou jako cíl záběru: šablona předává posluchače, mluvčího. `dialog_end` zastaví dialogovou kameru a znovu povolí idle animaci hráče. Podklad je uložená [anotovaná PC dekompilace](https://github.com/st0rm94/mafia-reverse-engineering-export/blob/main/ghidra/Game-ghidra.exe.annotated.c), případy 0x4d–0x4f a 0x83. Jde o interpretaci konkrétní implementace, nikoli záruku jiných verzí hry. Šablona neotáčí aktéry, nepozastavuje jejich ostatní programy a nepřidává lip DAT. Titulky řeči řídí herní HUD/nastavení a vzdálenost; tento průvodce je nevynucuje přes `subtitle_add`.

Před zápisem se ověří jednoznačné lidské postavy a jejich framy, existence ID v TextDB mimo hraniční záznam, odpovídající WAV hlavička a hash každé použité nahrávky. TextDB, hlasy a geometrie jsou závislosti transakce; souběžná změna přeruší publikaci scény. Kód a masku 1 znovu sestaví core, nedůvěřuje náhledu ani dodanému kódu. Vznikne jeden nový skriptový bod; vlastní programy jiných postav se nemění.

Ověření 13. října 2026: přes okno Electronu vytvořeny dvě repliky s vlastními českými texty a dvěma WAV, mluvčími NPC/Tommy a opačnými posluchači. Chybějící ID blokovalo vytvoření, změna pořadí a návrat změnily správně celý náhled. Export odpovídal uložené scéně a hlasům; UI undo přesně odstranilo rozhovor a ponechalo texty/hlasy. V izolované Wine hře bod aktivoval kontrolní NPC příkazem `enemy_use_detector`; kamera přešla přes rameno obou osob a vrátila se k hráči. Soukromý příkaz až za `dialog_end` změnil HUD z 21 na 61, což potvrzuje průchod celým programem. Texty v těchto dialogových snímcích nebyly viditelné; jejich zobrazení není tímto testem doložené. Fyzický výstup zvuku nebyl samostatně zachycený ani poslechnutý. Ruční Action Button, spuštění po načtení bez aktivace, opakování, restart a save/load zbývají. Kontrolní skripty i šest přípravných operací byly vrácené, historie 38 a zdrojové bajty obnovené, hry a testovací editor ukončené. V dřívějším pomocném JSON byl zastaralý hash geometrie; konečný stav se navíc ověřil vůči immutable původnímu souboru a jeho manifestovému hash.
