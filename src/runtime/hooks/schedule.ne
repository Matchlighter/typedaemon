
DateTime -> Date:? _ Time {% d => ({ date: d[0], time: d[2] }) %}

Date -> Value DComponent DComponent {% d => ({ year: d[0], month: d[1], day: d[2] }) %}
DComponent -> "/" Value {% d => d[1] %}

Time -> Value TComponent TComponent:? _ ("AM"i {% id %} | "PM"i {% id %}):? {% d => ({ hour: d[0], minute: d[1], second: d[2], meridian: d[4] }) %}
TComponent -> ":" Value {% d => d[1] %}

Value ->
  int {% id %}
  | Star {% id %}
  | "{" _ Pattern _ "}" {% d => d[2] %}

Pattern ->
  Star {% id %}
  | Range {% id %}
  | List {% id %}
  | ModuloLeft "/" int {% d => ({ type: "modulo", left: d[0], right: d[2] }) %}

ModuloLeft ->
  Range {% id %}
  | Star {% id %}

Range -> int "-" int {% d => ({ type: "range", left: d[0], right: d[2] }) %}

List -> int ListItem:* {% d => [d[0], ...d[1]] %}
ListItem -> "," int {% d => d[1] %}

Star -> "*" {% id %}

int -> [0-9]:+        {% d => parseInt(d[0].join(""), 10) %}

_ -> [\s]:*     {% d => null %}
