# Požadavek: záznam mimiky webkamerou

Uloženo 2026-10-16 podle výslovného zadání uživatele. První implementovaný blok je popsaný níže; původní požadavek zůstává zachovaný pro další rozvoj.

- Webkamera snímá mimiku uživatele; zvolená herní postava ji současně napodobuje v živém 3D náhledu. Inspirací je ovládání mimiky gamepadem v jiných editorech, požadovaným vstupem je ale obličej před kamerou.
- Výsledek lze nahrát, přehrát, upravit a použít při tvorbě vlastní mise nebo cutscény. Má jít o mimiku celého podporovaného obličeje, nikoli pouze automatické otevírání úst podle hlasitosti.
- Nejprve ověřit dostupné deformace konkrétních modelů a formát, který umí přehrát původní hra. Dosavadní podpora LIP DAT sama nedokládá možnost uložit libovolnou mimiku. Rozsah exportu neslibovat před tímto ověřením.
- Prověřit kalibraci neutrálního výrazu, mapování zachycených výrazů na konkrétní model, vyhlazení, časování, záznam a následnou editaci. Nepodporované výrazy viditelně označit.
- Kamera se zapíná výslovnou akcí uživatele, se zřetelným stavem a vypnutím. Během současných autonomních testů se kamera nezapíná. Způsob zpracování a ukládání snímků vyřešit před implementací; zadání nevyžaduje jejich odesílání do služby.

Aktualizace priority téhož dne: uživatel výslovně zvolil „Odložit dráhy TCK, začít mimiku“. Mimika je nynější rozpracovaný blok. Stav drah je v `deferred-track-authoring.md`. Samostatný navazující AI/OSM generátor města zůstává v `city-generator-plugin.md`; tento požadavek jej nenahrazuje.

## Použitelný první blok

V modelu nebo LIP otevřít **Mimika z webkamery…**, vybrat podporovaný model s obličejovým `base` (např. TommyHIGH), zapnout kameru, před kamerou ponechat klidový výraz a kalibrovat. Síla a vyhlazení se nastavují před záznamem. Nahrávání ukládá až deset minut hodnot. Vypnutí kamery ponechá záznam pro přehrání; začátek/konec úseku jsou v sekundách. `.wbface.json` je samostatný autorský soubor se zdrojovými koeficienty, kalibrací, nastavením, časovými vzorky a převedenými šesti bajty; neobsahuje video ani zvuk. Opětovné otevření záznamu kameru nezapíná. Podrobná ruční editace šesti parametrů navazuje v existujícím LIP editoru.

Pro herní dialog otevřít v TextDB příslušnou repliku → **Pohyb úst** → **Mimika z webkamery…** → nahrát nebo otevřít záznam → vybrat úsek → **Přenést do pohybu úst**. Tím vznikne draft, nikoli okamžitý zápis. Teprve **Uložit/Vytvořit pohyb úst** zapíše DAT stejného ID jako dabing; původní ochrany TextDB/WAV/SHA-256, záloha, export a undo se nemění. Přenesený úsek nahradí všechny rozepsané LIP vzorky. Délku lze potom přizpůsobit WAV; jeho nahrávání ani automatické časové zarovnání tento blok neprovádí. Samostatně v modelu se ukládá autorský JSON, export do hry je dostupný přes LIP dané repliky.

## Místní detekce a životní cyklus

Připnutý `@mediapipe/tasks-vision@0.10.32`, FaceLandmarker VIDEO, jeden obličej a `outputFaceBlendshapes`. Detektor běží v samostatném klasickém workeru. Snímky jsou nepřevrácené, pouze video v UI se zrcadlí pomocí CSS. Přenáší se nejvýše jeden ImageBitmap současně, nový nejdříve za 40 ms; bitmapa se zavře po detekci nebo zrušení. Výchozí požadavek 640×480/25 fps je doporučením pro kameru, nikoli zárukou rychlosti inference. Chybějící obličej přepne na neutral; při převodu se mezera nad 200 ms rovněž nezmrazí do posledního výrazu. Vyhlazení má časovou konstantu 0–250 ms, síla .25–3. Bez videa, zvuku, identifikace osoby nebo síťové inference.

`npm run setup:face` stáhne verzi modelu `float16/1` do ignorovaného `local/face-runtime/`; SHA-256 `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`. Build ověří hash a zkopíruje model a WASM do ignorovaného `out/face-runtime/`. Build sám nesahá na internet a bez modelu zachová ostatní funkce. Po přípravě je vše obsluhováno přes přesný seznam souborů vlastního protokolu. CSP dovoluje místní worker a WASM, ne externí spojení ani obecné eval. Test skutečné inference prošel s odmítnutým HTTP/HTTPS provozem a bez takových požadavků.

IPC před výslovným startem otevře na 30 s oprávnění jen pro video, vlastní hlavní frame a přesnou adresu editoru. Mikrofon a jiné origins/framy zůstávají odmítnuté. Po získání streamu se brána opět zavře. Stop, odpojení kamery, chyba workeru, skrytí dokumentu a zavření dialogu zastaví stream a worker. Pozdní přidělení streamu po zavření se ihned zastaví. Neuložený záznam chrání potvrzení zavření/náhrady a beforeunload. JSON se validuje při načtení i uložení; ukládání používá dočasný soubor a atomický rename, limit 64 MiB.

Primární zdroje: [Web API](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js), [přehled modelů](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker), [model card blendshapes](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Blendshape%20V2.pdf), [připnutý model](https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task). Npm balíček i model card uvádějí Apache-2.0. Model/WASM ani herní data se do GitHubu neukládají.

## Převod a hranice věrnosti

`ls3d-three-region-v1` je ručně navržený přibližný převod, nikoli naučený retargeting pro každý model. JawOpen ovládá otevření úst; pucker/funnel a smile/frown ovládají jejich dvě směsi. Průměr obou mrknutí ovládá společná víčka. BrowDown oproti inner/outerUp ovládají obočí. Vše vůči uložené kalibraci; výstup jsou bajty 0–255. Vliv třetího společného cíle horního obličeje zůstává na neutrálním nastavení. Zdrojových 52 hodnot se ukládá, i když se všechny do herního výrazu nevejdou. Asymetrická mrknutí, pohled, tváře, jazyk a pohyb hlavy nejsou v tomto převodu dostupné. Detektor nerozpoznává fonémy. Konkrétní rozsahy mimiky se liší podle modelu; tvorba nových morfovacích cílů v tomto bloku není.

Export převzorkuje vybraný úsek po 40 ms a přidá dva neutrální koncové záznamy pro nativní LIP ukončení. Původní 4DS se nemění. Herní nástup/ukončení řeči může výsledek dále míchat; samotná geometrická shoda náhledu nezaručuje přesné napodobení celé lidské tváře.

## Ověření 2026-10-16

- 16 cílených testů (nová mimika/kamera + existující LIP): převod, kalibrace, ztráta obličeje a dlouhé mezery, vyhlazení podle času, trim/25 Hz/tail, byte-parse původním LIP writerem, neplatné a nadměrné vstupy, expirovaná oprávnění/video-only/main-frame, stop během inicializace a pozdního souhlasu, odmítnutí, odpojení, bitmapa po zavření, jeden rozpracovaný snímek. Existující testy ověřují také transakční save, zastaralé závislosti, přesný export a undo.
- Skutečné sandboxované okno Electronu s produkčními komponentami a CSP: TommyHIGH zepředu s texturami, místní worker/WASM/model, skutečná inference nad vykreslenou herní hlavou vrací 52 koeficientů. Celý UI záznam se syntetickým canvas streamem a řízenými výstupy detektoru prošel nahráním, uložením/načtením JSON, přehráním, přenosem do LIP draftu, uložením do izolovaného projektu, přesným exportem a undo. Fyzická kamera se při auditu nepoužila. Kontrola skrytí aplikace rovněž zastavila syntetický stream.
- Oprávnění ověřené skutečným getUserMedia s přepínačem Chromium `use-fake-device-for-media-stream`, nikoli fyzickou kamerou: explicitně povolen pouze virtuální `fake_device_0`; běžný místní origin vrací Electron s koncovým `/`, brána přijímá obě přesné podoby. Žádný trvalý grant.
- Nativní GOG 1.2 ve vlastní Wine kopii: dvanáctisekundový WAV a DAT s úsekem převedeného UI záznamu `[204,117,135,210,255,61]` mezi neutrálními úseky. Po čerstvém checkpointu 606 zachycená hra v 1.5 / 5.5 / 9.5 s ukazuje zavřená ústa a otevřené oči → otevřená ústa a přivřená víčka → návrat. Čerstvý checkpoint 607 dokládá dokončení human_talk. Dodané DAT/WAV/scene2 shodné po bajtech s projektem. Vlastní prefix zastaven, baseline/historie obnovené, chráněné originály shodné. Nejde o izolované změření každého cíle nebo všech modelů.
- Celá sada: 655/656; jediný známý původní nesoulad v `test/mission-dialogue.test.js:27` očekává slovo „současně“, zatímco validace vrací „vyberte pouze jednu šablonu“. Tento blok jej nemění. Check a build prošly.

Zůstává neověřené skutečné snímání fyzické kamery/TCC na tomto Macu, subjektivní věrnost u různých lidí a všech herních hlav. Tyto testy se provedou až při výslovném použití kamery uživatelem. Další rozvoj: lepší mapování konkrétních modelů a dodatečná editace zdrojových křivek; původní zadání se tím nepovažuje za plně vyčerpané.
