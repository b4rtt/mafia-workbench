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
