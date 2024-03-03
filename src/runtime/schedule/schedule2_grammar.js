// Generated automatically by nearley, version 2.20.1
// http://github.com/Hardmath123/nearley
(function () {
function id(x) { return x[0]; }

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
var grammar = {
    Lexer: lexer,
    ParserRules: [
    {"name": "DateTime$ebnf$1$macrocall$2", "symbols": ["Date"]},
    {"name": "DateTime$ebnf$1$macrocall$1", "symbols": ["DateTime$ebnf$1$macrocall$2", "__"], "postprocess": d => d[0][0]},
    {"name": "DateTime$ebnf$1", "symbols": ["DateTime$ebnf$1$macrocall$1"], "postprocess": id},
    {"name": "DateTime$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "DateTime$ebnf$2$macrocall$2", "symbols": ["WeekdayValue"]},
    {"name": "DateTime$ebnf$2$macrocall$1", "symbols": ["DateTime$ebnf$2$macrocall$2", "__"], "postprocess": d => d[0][0]},
    {"name": "DateTime$ebnf$2", "symbols": ["DateTime$ebnf$2$macrocall$1"], "postprocess": id},
    {"name": "DateTime$ebnf$2", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "DateTime", "symbols": ["DateTime$ebnf$1", "DateTime$ebnf$2", "Time"], "postprocess": d => ({ date: d[0], time: d[2], day_of_week: d[1] })},
    {"name": "Date$macrocall$2", "symbols": [{"literal":"/"}]},
    {"name": "Date$macrocall$3", "symbols": ["DayValue"]},
    {"name": "Date$macrocall$1", "symbols": ["Date$macrocall$2", "Date$macrocall$3"], "postprocess": d => d[1][0]},
    {"name": "Date", "symbols": ["Value", "DComponent", "Date$macrocall$1"], "postprocess": d => ({ year: d[0], month: d[1], day: d[2] })},
    {"name": "Time", "symbols": ["NormalTime"], "postprocess": id},
    {"name": "Time", "symbols": ["SunTime"], "postprocess": id},
    {"name": "SunTime$ebnf$1", "symbols": ["TimeMod"], "postprocess": id},
    {"name": "SunTime$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "SunTime", "symbols": ["SunTimeRef", "SunTime$ebnf$1"], "postprocess": d => ({ ref: d[0], offset: d[1] })},
    {"name": "NormalTime$ebnf$1$macrocall$2", "symbols": ["Meridian"]},
    {"name": "NormalTime$ebnf$1$macrocall$1", "symbols": ["__", "NormalTime$ebnf$1$macrocall$2"], "postprocess": d => d[1][0]},
    {"name": "NormalTime$ebnf$1", "symbols": ["NormalTime$ebnf$1$macrocall$1"], "postprocess": id},
    {"name": "NormalTime$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "NormalTime$ebnf$2$macrocall$2", "symbols": ["Timezone"]},
    {"name": "NormalTime$ebnf$2$macrocall$1", "symbols": ["__", "NormalTime$ebnf$2$macrocall$2"], "postprocess": d => d[1][0]},
    {"name": "NormalTime$ebnf$2", "symbols": ["NormalTime$ebnf$2$macrocall$1"], "postprocess": id},
    {"name": "NormalTime$ebnf$2", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "NormalTime", "symbols": ["SimpleTime", "NormalTime$ebnf$1", "NormalTime$ebnf$2"], "postprocess": d => ({ ...d[0], meridian: d[1], tz: d[2] })},
    {"name": "Timezone", "symbols": [(lexer.has("word") ? {type: "word"} : word), {"literal":"/"}, (lexer.has("word") ? {type: "word"} : word)], "postprocess": d => d.map(t => t.value).join("")},
    {"name": "Timezone", "symbols": [(lexer.has("word") ? {type: "word"} : word)], "postprocess": tval},
    {"name": "Timezone", "symbols": ["TimeMod"], "postprocess": id},
    {"name": "TimeMod", "symbols": [/[+-]/, "SimpleTime"], "postprocess": d => ({ dir: d[0].value, ...d[1] })},
    {"name": "SimpleTime$ebnf$1", "symbols": ["TComponent"], "postprocess": id},
    {"name": "SimpleTime$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "SimpleTime", "symbols": ["Value", "TComponent", "SimpleTime$ebnf$1"], "postprocess": d => ({ hour: d[0], minute: d[1], second: d[2] })},
    {"name": "DComponent$macrocall$2", "symbols": [{"literal":"/"}]},
    {"name": "DComponent$macrocall$3", "symbols": ["Value"]},
    {"name": "DComponent$macrocall$1", "symbols": ["DComponent$macrocall$2", "DComponent$macrocall$3"], "postprocess": d => d[1][0]},
    {"name": "DComponent", "symbols": ["DComponent$macrocall$1"], "postprocess": d => d[0]},
    {"name": "TComponent$macrocall$2", "symbols": [{"literal":":"}]},
    {"name": "TComponent$macrocall$3", "symbols": ["Value"]},
    {"name": "TComponent$macrocall$1", "symbols": ["TComponent$macrocall$2", "TComponent$macrocall$3"], "postprocess": d => d[1][0]},
    {"name": "TComponent", "symbols": ["TComponent$macrocall$1"], "postprocess": d => d[0]},
    {"name": "DayValue", "symbols": ["Value"], "postprocess": id},
    {"name": "DayValue", "symbols": [{"literal":"L"}], "postprocess": tval},
    {"name": "WeekdayValue$macrocall$2", "symbols": ["Weekday"]},
    {"name": "WeekdayValue$macrocall$1", "symbols": ["WeekdayValue$macrocall$2", {"literal":"-"}, "WeekdayValue$macrocall$2"], "postprocess": d => ({ type: "range", left: d[0][0], right: d[2][0] })},
    {"name": "WeekdayValue", "symbols": ["WeekdayValue$macrocall$1"], "postprocess": id},
    {"name": "WeekdayValue$macrocall$4", "symbols": ["Weekday"]},
    {"name": "WeekdayValue$macrocall$3$ebnf$1", "symbols": []},
    {"name": "WeekdayValue$macrocall$3$ebnf$1$macrocall$2", "symbols": ["_"]},
    {"name": "WeekdayValue$macrocall$3$ebnf$1$macrocall$1", "symbols": [{"literal":","}, "WeekdayValue$macrocall$4"], "postprocess": d => d[1][0]},
    {"name": "WeekdayValue$macrocall$3$ebnf$1", "symbols": ["WeekdayValue$macrocall$3$ebnf$1", "WeekdayValue$macrocall$3$ebnf$1$macrocall$1"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "WeekdayValue$macrocall$3", "symbols": ["WeekdayValue$macrocall$4", "WeekdayValue$macrocall$3$ebnf$1"], "postprocess": d => [d[0][0], ...d[1]]},
    {"name": "WeekdayValue", "symbols": ["WeekdayValue$macrocall$3"], "postprocess": id},
    {"name": "Value", "symbols": ["int"], "postprocess": id},
    {"name": "Value", "symbols": ["Star"], "postprocess": id},
    {"name": "Value", "symbols": [{"literal":"{"}, "_", "Pattern", "_", {"literal":"}"}], "postprocess": d => d[2]},
    {"name": "Pattern", "symbols": ["Star"], "postprocess": id},
    {"name": "Pattern", "symbols": ["Range"], "postprocess": id},
    {"name": "Pattern", "symbols": ["List"], "postprocess": id},
    {"name": "Pattern", "symbols": ["ModuloPattern"], "postprocess": id},
    {"name": "ModuloPattern", "symbols": ["ModuloLeft", {"literal":"/"}, "int"], "postprocess": d => ({ type: "modulo", left: d[0], right: d[2] })},
    {"name": "ModuloLeft", "symbols": ["Range"], "postprocess": id},
    {"name": "ModuloLeft", "symbols": ["Star"], "postprocess": id},
    {"name": "Range$macrocall$2", "symbols": ["int"]},
    {"name": "Range$macrocall$1", "symbols": ["Range$macrocall$2", {"literal":"-"}, "Range$macrocall$2"], "postprocess": d => ({ type: "range", left: d[0][0], right: d[2][0] })},
    {"name": "Range", "symbols": ["Range$macrocall$1"], "postprocess": d => d[0]},
    {"name": "List$macrocall$2", "symbols": ["int"]},
    {"name": "List$macrocall$1$ebnf$1", "symbols": []},
    {"name": "List$macrocall$1$ebnf$1$macrocall$2", "symbols": ["_"]},
    {"name": "List$macrocall$1$ebnf$1$macrocall$1", "symbols": [{"literal":","}, "List$macrocall$2"], "postprocess": d => d[1][0]},
    {"name": "List$macrocall$1$ebnf$1", "symbols": ["List$macrocall$1$ebnf$1", "List$macrocall$1$ebnf$1$macrocall$1"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "List$macrocall$1", "symbols": ["List$macrocall$2", "List$macrocall$1$ebnf$1"], "postprocess": d => [d[0][0], ...d[1]]},
    {"name": "List", "symbols": ["List$macrocall$1"], "postprocess": d => d[0]},
    {"name": "int", "symbols": [(lexer.has("number") ? {type: "number"} : number)], "postprocess": d => parseInt(d[0].value, 10)},
    {"name": "Star", "symbols": [{"literal":"*"}], "postprocess": tval},
    {"name": "Meridian", "symbols": [(lexer.has("meridian") ? {type: "meridian"} : meridian)], "postprocess": tval},
    {"name": "Weekday", "symbols": [(lexer.has("weekday") ? {type: "weekday"} : weekday)], "postprocess": day_of_week},
    {"name": "SunTimeRef", "symbols": [{"literal":"sunrise"}], "postprocess": tval},
    {"name": "SunTimeRef", "symbols": [{"literal":"sunset"}], "postprocess": tval},
    {"name": "_$ebnf$1", "symbols": [(lexer.has("ws") ? {type: "ws"} : ws)], "postprocess": id},
    {"name": "_$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "_", "symbols": ["_$ebnf$1"], "postprocess": d => null},
    {"name": "__", "symbols": [(lexer.has("ws") ? {type: "ws"} : ws)], "postprocess": d => null}
]
  , ParserStart: "DateTime"
}
if (typeof module !== 'undefined'&& typeof module.exports !== 'undefined') {
   module.exports = grammar;
} else {
   window.grammar = grammar;
}
})();
