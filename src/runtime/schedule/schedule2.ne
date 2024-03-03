
@{%
function tval(d) {
  return d[0].value
}

function day_of_week(d) {
  let dow = d[0].value;
  return dow.substring(0, 3).toLowerCase();
}

const DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(d => d.toUpperCase());
const DAYS_OF_WEEK_PERMUTATIONS = [
  ...DAYS_OF_WEEK,
  ...DAYS_OF_WEEK.map(d => d.substring(0, 3)),
  ...DAYS_OF_WEEK.map(d => d.replace(/day$/i, "")).filter(d => d.length > 3),
  "THUR",
]

const moo = require('moo');
const lexer = moo.compile({
  ws: /[ \t]+/,
  number: /[0-9]+/,
  word: {
    match: /[a-zA-Z]+/,
    // transform: x => x.toUpCase(),
    type: moo.keywords({
      "meridian": ["AM", "PM"],
      "weekday": DAYS_OF_WEEK_PERMUTATIONS,
    }),
  },
  sym: /[:/+\-*{},]/,
});
%}

@lexer lexer

# Macros
PreWS[T] => __ $T {% d => d[1][0] %}
PostWS[T] => $T __ {% d => d[0][0] %}

TRange[T] -> $T "-" $T {% d => ({ type: "range", left: d[0][0], right: d[2][0] }) %}
TList[T] -> $T TListItem[_]:* {% d => [d[0][0], ...d[1]] %}
TListItem[_] -> "," $T {% d => d[1][0] %}

Component[S, T] -> $S $T {% d => d[1][0] %}

# Main
DateTime -> PostWS[Date]:? PostWS[WeekdayValue]:? Time {% d => ({ date: d[0], time: d[2], day_of_week: d[1] }) %}

# Non-Terminals
Date -> Value DComponent Component["/", DayValue] {% d => ({ year: d[0], month: d[1], day: d[2] }) %}

Time -> NormalTime {% id %} | SunTime {% id %}

SunTime -> SunTimeRef TimeMod:? {% d => ({ ref: d[0], offset: d[1] }) %}

NormalTime -> SimpleTime PreWS[Meridian]:? PreWS[Timezone]:? {% d => ({ ...d[0], meridian: d[1], tz: d[2] }) %}

Timezone ->
  %word "/" %word {% d => d.map(t => t.value).join("") %}
  | %word {% tval %} # TODO Enforce 3 chars?
  | TimeMod {% id %}

# Re-used Non-Terminals
TimeMod -> [+-] SimpleTime {% d => ({ dir: d[0].value, ...d[1] }) %}

SimpleTime -> Value TComponent TComponent:? {% d => ({ hour: d[0], minute: d[1], second: d[2] }) %}

DComponent -> Component["/", Value] {% d => d[0] %}
TComponent -> Component[":", Value] {% d => d[0] %}

DayValue ->
  Value {% id %}
  | "L" {% tval %}

WeekdayValue ->
  TRange[Weekday] {% id %}
  | TList[Weekday] {% id %}

Value ->
  int {% id %}
  | Star {% id %}
  | "{" _ Pattern _ "}" {% d => d[2] %}

Pattern ->
  Star {% id %}
  | Range {% id %}
  | List {% id %}
  | ModuloPattern {% id %}

ModuloPattern -> ModuloLeft "/" int {% d => ({ type: "modulo", left: d[0], right: d[2] }) %}
ModuloLeft ->
  Range {% id %}
  | Star {% id %}

Range -> TRange[int] {% d => d[0] %}
List -> TList[int] {% d => d[0] %}

# Terminals

int -> %number {% d => parseInt(d[0].value, 10) %}

Star -> "*" {% tval %}
Meridian -> %meridian {% tval %}
Weekday -> %weekday {% day_of_week %}
SunTimeRef -> "sunrise" {% tval %} | "sunset" {% tval %}

_ -> %ws:? {% d => null %}
__ -> %ws {% d => null %}
