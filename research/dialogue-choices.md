# Výběr odpovědi v původním enginu

Rešerše, nativní experimenty a první průvodce volbou odpovědi, 14. října 2026. Lineární rozhovor zůstává samostatnou funkcí. Nová volba propojuje nativní nabídku akcí s existujícími cílovými úkoly či rozhovory; skriptový životní cyklus a formulář jsou ověřené, ruční výběr hráčem zůstává otevřenou kontrolou.

## Doložené možnosti

MSDR popisuje souběžné `detector_waitforuse` jako několik akcí v nabídce Sebrat / použít. PC implementace tomu odpovídá: každý detektor registruje vlastní `S_using_object` a ID textu. Výběr blízkých položek filtruje vertikální vzdálenost, horizontální poloměr a případný rodičovský frame; položky třídí podle vzdálenosti. Detektor používá poloměr 1,5 herní jednotky. To umožňuje uvažovat o odpovědích prostřednictvím původní nabídky akcí, ale samo o sobě nedokládá celý životní cyklus rozhovoru.

PC `detector_use` odstraní registraci a posune čekající program pouze u skutečně použitého detektoru. Ostatní nabídky tím nezmizí. Podklad: [PC dekompilace](https://github.com/st0rm94/mafia-reverse-engineering-export/blob/main/ghidra/Game-ghidra.exe.annotated.c), `detector_create_using_object` 0x0047a6b0, `detector_use` 0x0047a790, `detector_program_process` 0x0047a840 a `using_object_find_near_objects` 0x0061bf50; [popis C_detector](https://github.com/st0rm94/mafia-reverse-engineering-export/blob/main/structs/detector.md).

## Samotné vypnutí odpověď nezruší

`act_setstate …, off` zapisuje stav aktéra. V samotném setteru není odstranění `S_using_object`; ani vyhledání blízkých akcí přímo nekontroluje tento stav. Přechod seznamů aktérů volá virtuální změnu stavu, jejíž konkrétní účinek na registraci detektoru ještě potřebuje ověření. Proto zatím nelze tento příkaz vydávat za ověřené zrušení odpovědi. Stejně tak `end` ukončuje program; jeho vlastní úklid nastavuje stav aktéra a není doloženým voláním `detector_use`.

`detector_game_done` registraci odstraní, ale jde o teardown enginu, nikoli nalezený obecný skriptový příkaz. `actor_delete` má cestu přes odstranění dočasného aktéra. Není doložen jako řešení pro běžný detektor uložený ve scéně. `actor_duplicate` navíc vyžaduje modelový frame typu 9, takže jej nelze bez další implementace použít na dnešní skriptové body s frame typu 6.

Podklad: stejná [PC dekompilace](https://github.com/st0rm94/mafia-reverse-engineering-export/blob/main/ghidra/Game-ghidra.exe.annotated.c), `actor_set_act_state` 0x0044c750, `game_change_act_state` 0x005e0ad0, `program_clear_after_end` 0x005bac10, `detector_game_done` 0x004795b0 a dispatcher 0xda/0xdb.

Nativní negativní kontrola: dvě nabídky na stejném místě, volba A přes NPC a `act_setstate` druhé odpovědi na `off`. V úplném save v 12 216 ms zůstala čekací hodnota B rovna 1, A již 0 a společný signál 1. Vypnutí tedy není dostačující úklid serializovaného čekání. Pozdější použití B kontrolním NPC tento stav mění, a proto se pro negativní kontrolu používá pouze checkpoint před tímto druhým použitím. První krátký běh nestačil vytvořit poslední checkpoint; jeho starý save se nepoužívá jako důkaz.

## Úklid přes NPC a pojistka jediné větve

`enemy_use_detector` v programu lidského NPC volá nativní `detector_use`, tedy odstraní registraci i čekací flag a posune čekající program. Příkaz patří do dispatcheru `C_entity` (0x1024); není obecným příkazem programu detektoru. Podklad: stejná PC dekompilace a MSDR, kapitoly `enemy_use_detector`, `setevent` a `event`.

Pouhé nucené použití ostatních detektorů by spustilo jejich větve. Experiment proto po každém `detector_waitforuse` nejprve kontroluje společný signál: první použitá odpověď nastaví signál na 1 před událostí úklidu a vlastní akcí. Všechny následně použité odpovědi při signálu 1 skončí. Kontrola a nastavení neobsahují čekání. V prvním experimentu mělo vlastní NPC událost zapsanou jako `choice_clear`, která použila oba detektory a vrátila se do kontrolního programu. Pozdější zjištění níže ukazuje, že engine tuto textovou hodnotu ve skutečnosti převedl na číslo 0; není to důkaz podpory pojmenovaných vlastních událostí.

Testovací programy jsou vlastní syntetické skripty. První odpověď nastaví zdraví na 31, druhá na 81, počáteční stav je 21. NPC v samostatných bězích použije A nebo B přibližně v deváté sekundě herního času a druhou odpověď znovu přibližně ve čtrnácté. Úplné save se vytvářejí kolem 5, 12 a 22 sekund. Kontrolní detektor i obě odpovědi se před čekáním zahrnou do save nulovým `detector_setsignal`; tím se netestují pouze položky náhodou přítomné v paměti.

| Běh | Save před volbou | Save po volbě | Po opakovaném použití |
| --- | --- | --- | --- |
| A | zdraví 21, A/B čekají, signál 0 | zdraví 31, A/B nečekají, signál 1 | zdraví 31, A/B nečekají |
| B | zdraví 21, A/B čekají, signál 0 | zdraví 81, A/B nečekají, signál 1 | zdraví 81, A/B nečekají |

Jde o GOG 1.2 spuštěný produkční cestou izolovaného `Playtest.start`. Synchronizovaná scéna a TextDB mají přesné očekávané hashe; čtení save používá původní per-block `G_Stream` dešifrování, nikoli změnu jeho bajtů. V koncovém 12bajtovém záznamu detektoru je byte 5 signál a byte 6 čekání na použití. Writer a loader potvrzují, že nenulový byte 6 při načtení znovu registruje akci. Tyto offsety vycházejí z těl funkcí a experimentu, ne pouze z komentářů exportu.

Výsledek prokazuje právě jednu výslednou větev a odstranění čekání při nativním skriptovém použití. Neprokazuje zatím skutečný hráčův výběr klávesou v nabídce ani dialogovou kameru, hlasy či smrt řídicího NPC. Průvodce nesmí automaticky přepsat program libovolné postavy: úklid potřebuje připravený program a žijícího aktéra, jehož událost je dostupná. Produktová integrace níže přijímá pouze postavu s prázdným nebo celým nezměněným vygenerovaným řídicím programem.

## Načtení před volbou a po ní

Ve scénáři B byly po ukončení prvního běhu zaevidovány úplné checkpointy stejnou produkční cestou, kterou používá editor. Nový proces postupně načetl slot 597 před volbou a slot 598 po volbě. Hash načítaného save se při startu nezměnil. V obou procesech pokračoval uložený měřicí program a vytvořil nový slot 599: zdraví 81, signál 1, obě čekací hodnoty 0. U načtení slotu 597 šlo o dokončení dosud nevybrané větve; u 598 se už dokončená volba neopakovala ani při pozdějším nuceném použití druhé odpovědi.

Pomocný test nejprve vracel soubory checkpointů mezi těmito dvěma běhy bez současného vrácení jejich evidence. Produkční kontrola odmítla druhý start kvůli rozdílnému hashi save. Opravený test obnovuje společně soubory i jejich index z první zaznamenané verze; teprve opakovaný pár je důkazem obou načtení. Editor nevyžadoval změnu a žádná kontrola kompatibility nebyla vypnuta.

Všechny vlastní procesy hry byly ukončeny. Scéna a TextDB byly vráceny přes undo na původní historii 38. Pět výchozích assetů testovacího projektu, ostatní kontrolované projekty a původní EXE jsou hashově stejné. Před experimenty vznikla trvalá místní záloha všech save profilu 0 i indexu; všechny byly obnoveny, nově vytvořené save odstraněny. Toto ověření neodvolává starší samostatně zdokumentovanou ztrátu automatického save 570 při prvním testu terénního štětce. Pomocné programy, snímky a save zůstávají v ignorovaném `local/`, nikoli ve veřejném repozitáři.

## Průvodce a číselné události

`event` (dispatcher 0x48) a `setevent` (0x49) převádějí vlastní identifikátor přes `atoi`. Dva různé textové názvy se tak mohou oba změnit na událost 0. Výjimkou jsou explicitní rezervované názvy v kompilátoru. Generátor proto používá oddělená čísla 1000–1015, pod rezervovaným rozsahem 60000+. První běh generovaných dvou sad s textovými názvy ponechal nezvolenou odpověď čekající; teprve opravené číselné události mají níže doložený výsledek. Podklad: stejná PC dekompilace, kompilace 0x48/0x49 a dispatcher `setevent`.

Ve 3D scéně je **Přidat → Přidat volbu odpovědi…**. Vznikne aktivace, společná pojistka a 2–4 odpovědi na stejné pozici. Aktivace čeká dvě sekundy na inicializaci, zachová i časný příchozí signál a volitelně čeká na jeho přijetí. Jedna živá NPC obsluhuje nejvýše 16 sad; program se rozšíří pouze při úplné shodě zdroje s generátorem a existenci všech dřívějších bodů. Libovolný vlastní program se nepřepisuje. Vybraná větev musí mít vlastní čekání na signál. Šablona je jednorázová; sama nezajišťuje hlasy, natočení ani dialogovou kameru.

Core ověřuje jednoznačného lidského NPC, názvy, 2–4 různá ID neprázdných skutečných textů a cílové detektory. Znovu sestavuje zdroj bez důvěry v klientský kód či masku, chrání snapshoty scény, TextDB a geometrie. Celá scéna se publikuje jednou transakcí s přesným undo; geometrii, texty, parametry postav a neznámé bloky zachovává.

Produkční generátor byl spuštěn v oddělené GOG 1.2 misi se dvěma sadami a stejným NPC. V první sadě volba B změnila zdraví 21 → 81 a odstranila čekání obou odpovědí. Načtení checkpointu před volbou i po ní skončilo na 81, bez znovuspuštění nezvolené větve. Druhá sada používala událost 1001: volba A změnila zdraví 21 → 31, oba její čekací příznaky byly 0, neaktivovaná první sada zůstala neaktivovaná. Opětovné použití druhé odpovědi výsledek nezměnilo. Předběžná kontrola je z úplného save kolem 5 s, následné kolem 12 a 22 s. Vstupy provedl kontrolní NPC; ruční hráčův výběr tím není doložený.

Samostatné okno Electronu ověřilo prázdné výchozí cíle, deaktivované potvrzení pro chybějící cíl, neexistující či duplicitní text, přidání/odebrání odpovědi a limit čtyř odpovědí. Vytvořilo tři odpovědi s přesnými pozicemi/zdroji, pět nových bodů a jediný krok historie. Nový formulář nabídl stejného NPC s evidencí jedné sady; zrušení nic nezapsalo. Reopen a export odpovídaly skutečným bajtům, UI undo obnovilo původní scénu a historii 1. Všech ostatních 12 assetů soukromého UI projektu, chráněné projekty a původní EXE zůstaly shodné. Nativní projekt byl vrácen na historii 38, všech pět kontrolovaných assetů a save/index profilu obnovené. Soukromé pomocné programy a data zůstávají v ignorovaném local/.

## Další herní ověření

- V izolované misi zobrazit dvě skutečné odpovědi a zvolit každou v samostatném běhu.
- Doložit odstranění ostatních akcí, právě jednu výslednou větev a uvolnění dialogové kamery.
- Ověřit odchod hráče od bodu, předčasný signál, přerušení rozhovoru a opakované stisknutí akce.
- Zopakovat checkpoint před volbou i po ní s ručním výběrem hráče a dialogem; skriptová varianta B je již ověřená výše.
- Základní generátor s kontrolou textů/cílů, atomickým zápisem a společným undo je doplněný. Mluvené odpovědi se připojují přes cílový rozhovor; rozšířený společný životní cyklus kamery a přerušení zůstává další prací.

`ctrl_read` a `ctrl_readex` jsou další možná cesta, ale PC používá dvě rozdílná pole ovládacích akcí. Dispatcher nekontroluje horní mez ID. Bez ověření konkrétního mapování a chování při zamčeném ovládání je nelze bezpečně nabízet s libovolným ID klávesy. Podklad: dispatcher 0x123/0x124 ve stejné dekompilaci.
