// HTML pattern uses Unicode sets (v); hex-escape the literal hyphen so this
// same source also works in the host's regular expression.
export const missionNamePattern=String.raw`(?!(?:[wW][bB][tT][eE][sS][tT]|[cC][oO][nN]|[pP][rR][nN]|[aA][uU][xX]|[nN][uU][lL]|[cC][oO][mM][1-9]|[lL][pP][tT][1-9])$)[a-zA-Z0-9][a-zA-Z0-9_\x2d]{0,47}`;
export const missionNameHint='Název mise: 1–48 znaků, písmena bez diakritiky, číslice, pomlčka nebo podtržítko.';
