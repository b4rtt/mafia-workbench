# Odložené vytváření pohybových drah TCK

2026-10-16: uživatel výslovně změnil prioritu na snímání mimiky webkamerou. Rozpracovaná tvorba TCK je odložená; není součástí funkčního editoru.

- Záměr: vybrat zdrojovou 5DS, zadat časované relativní body XYZ a natočení, vytvořit pod novým názvem přesnou kopii 5DS a TCK v4 s jedním undo. Resampling po 40 ms, lineární polohy, natočení kratším obloukem. Stávající editor jednotlivých TCK klíčů zůstává beze změny.
- Primární podklad: `anim_machine_load_track` a `anim_machine_set_anim` v uloženém exportu st0rm94. Hlavičkové vektory nových stop mají přebírat krajní pozice uzlu `blnd` zdrojové animace (bez něj nuly), používané enginem při přechodech. Je nutné nativní ověření; nejde zatím o hotový důkaz.
- Nativní tabulka má pro název TCK 32 bajtů včetně přípony a NUL; nový název proto omezit na 27 ASCII znaků. Délka dráhy má odpovídat 5DS, minimálně jeden snímek, maximálně 65535.
- Soukromý rozpracovaný patch a jeho SHA-256 jsou uložené v ignorovaném `local/deferred-track-authoring/`. Vznikl nad commitem `63b70ff`; neprošel dosud testy, UI ani původní hrou. Před obnovou zkontrolovat závislosti a změny hlavní větve, nepoužívat jej jako ověřenou implementaci.

Při návratu doplnit validační/atomické testy, stale hash, konflikt obou názvů, přesný export/undo, skutečné UI a přehrání nové dvojice v původním enginu. Teprve potom funkci publikovat jako podporovanou.
