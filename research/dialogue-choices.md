# Výběr odpovědi v původním enginu

Rozpracovaná rešerše, 14. října 2026. Dosavadní průvodce generuje lineární rozhovor s návazným signálem. Tento zápis nepřidává ani neprokazuje funkční výběr odpovědi hráčem.

## Doložené možnosti

MSDR popisuje souběžné `detector_waitforuse` jako několik akcí v nabídce Sebrat / použít. PC implementace tomu odpovídá: každý detektor registruje vlastní `S_using_object` a ID textu. Výběr blízkých položek filtruje vertikální vzdálenost, horizontální poloměr a případný rodičovský frame; položky třídí podle vzdálenosti. Detektor používá poloměr 1,5 herní jednotky. To umožňuje uvažovat o odpovědích prostřednictvím původní nabídky akcí, ale samo o sobě nedokládá celý životní cyklus rozhovoru.

PC `detector_use` odstraní registraci a posune čekající program pouze u skutečně použitého detektoru. Ostatní nabídky tím nezmizí. Podklad: [PC dekompilace](https://github.com/st0rm94/mafia-reverse-engineering-export/blob/main/ghidra/Game-ghidra.exe.annotated.c), `detector_create_using_object` 0x0047a6b0, `detector_use` 0x0047a790, `detector_program_process` 0x0047a840 a `using_object_find_near_objects` 0x0061bf50; [popis C_detector](https://github.com/st0rm94/mafia-reverse-engineering-export/blob/main/structs/detector.md).

## Zrušení nezvolených odpovědí není vyřešené

`act_setstate …, off` zapisuje stav aktéra. V samotném setteru není odstranění `S_using_object`; ani vyhledání blízkých akcí přímo nekontroluje tento stav. Přechod seznamů aktérů volá virtuální změnu stavu, jejíž konkrétní účinek na registraci detektoru ještě potřebuje ověření. Proto zatím nelze tento příkaz vydávat za ověřené zrušení odpovědi. Stejně tak `end` ukončuje program; jeho vlastní úklid nastavuje stav aktéra a není doloženým voláním `detector_use`.

`detector_game_done` registraci odstraní, ale jde o teardown enginu, nikoli nalezený obecný skriptový příkaz. `actor_delete` má cestu přes odstranění dočasného aktéra. Není doložen jako řešení pro běžný detektor uložený ve scéně. `actor_duplicate` navíc vyžaduje modelový frame typu 9, takže jej nelze bez další implementace použít na dnešní skriptové body s frame typu 6.

Podklad: stejná [PC dekompilace](https://github.com/st0rm94/mafia-reverse-engineering-export/blob/main/ghidra/Game-ghidra.exe.annotated.c), `actor_set_act_state` 0x0044c750, `game_change_act_state` 0x005e0ad0, `program_clear_after_end` 0x005bac10, `detector_game_done` 0x004795b0 a dispatcher 0xda/0xdb. Jde o interpretaci uloženého zdrojového exportu; herní experiment zatím neproběhl.

## Další ověření před přidáním průvodce

- V izolované misi zobrazit dvě skutečné odpovědi a zvolit každou v samostatném běhu.
- Doložit odstranění ostatních akcí, právě jednu výslednou větev a uvolnění dialogové kamery.
- Ověřit odchod hráče od bodu, předčasný signál, přerušení rozhovoru a opakované stisknutí akce.
- Uložit a načíst checkpoint před volbou i po ní; nezvolená odpověď se nesmí znovu objevit.
- Teprve poté doplnit generátor, kontrolu všech textů/hlasů/cílů, atomický zápis celé sady bodů a jedno společné undo. Nezavádět volby pouze jako neověřenou editorskou maketu.

`ctrl_read` a `ctrl_readex` jsou další možná cesta, ale PC používá dvě rozdílná pole ovládacích akcí. Dispatcher nekontroluje horní mez ID. Bez ověření konkrétního mapování a chování při zamčeném ovládání je nelze bezpečně nabízet s libovolným ID klávesy. Podklad: dispatcher 0x123/0x124 ve stejné dekompilaci.
