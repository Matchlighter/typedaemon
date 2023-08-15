// Generated automatically by nearley, version 2.20.1
// http://github.com/Hardmath123/nearley
(function () {
function id(x) { return x[0]; }
var grammar = {
    Lexer: undefined,
    ParserRules: [
    {"name": "DateTime$ebnf$1", "symbols": ["Date"], "postprocess": id},
    {"name": "DateTime$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "DateTime", "symbols": ["DateTime$ebnf$1", "_", "Time"], "postprocess": d => ({ date: d[0], time: d[2] })},
    {"name": "Date", "symbols": ["Value", "DComponent", "DComponent"], "postprocess": d => ({ year: d[0], month: d[1], day: d[2] })},
    {"name": "DComponent", "symbols": [{"literal":"/"}, "Value"], "postprocess": d => d[1]},
    {"name": "Time", "symbols": ["NormalTime"], "postprocess": id},
    {"name": "Time", "symbols": ["SunTime"], "postprocess": id},
    {"name": "SunTime$ebnf$1", "symbols": ["SunTimeMod"], "postprocess": id},
    {"name": "SunTime$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "SunTime", "symbols": ["SunTimeRef", "SunTime$ebnf$1"], "postprocess": d => ({ ref: d[0], offset: d[1] })},
    {"name": "SunTimeRef$string$1", "symbols": [{"literal":"s"}, {"literal":"u"}, {"literal":"n"}, {"literal":"r"}, {"literal":"i"}, {"literal":"s"}, {"literal":"e"}], "postprocess": function joiner(d) {return d.join('');}},
    {"name": "SunTimeRef", "symbols": ["SunTimeRef$string$1"], "postprocess": id},
    {"name": "SunTimeRef$string$2", "symbols": [{"literal":"s"}, {"literal":"u"}, {"literal":"n"}, {"literal":"s"}, {"literal":"e"}, {"literal":"t"}], "postprocess": function joiner(d) {return d.join('');}},
    {"name": "SunTimeRef", "symbols": ["SunTimeRef$string$2"], "postprocess": id},
    {"name": "SunTimeMod$ebnf$1", "symbols": ["TComponent"], "postprocess": id},
    {"name": "SunTimeMod$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "SunTimeMod", "symbols": [/[+-]/, "Value", "TComponent", "SunTimeMod$ebnf$1"], "postprocess": d => ({ dir: d[0], hour: d[1], minute: d[2], second: d[3] })},
    {"name": "NormalTime$ebnf$1", "symbols": ["TComponent"], "postprocess": id},
    {"name": "NormalTime$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "NormalTime$ebnf$2$subexpression$1$string$1", "symbols": [{"literal":"A"}, {"literal":"M"}], "postprocess": function joiner(d) {return d.join('');}},
    {"name": "NormalTime$ebnf$2$subexpression$1", "symbols": ["NormalTime$ebnf$2$subexpression$1$string$1"], "postprocess": id},
    {"name": "NormalTime$ebnf$2$subexpression$1$string$2", "symbols": [{"literal":"P"}, {"literal":"M"}], "postprocess": function joiner(d) {return d.join('');}},
    {"name": "NormalTime$ebnf$2$subexpression$1", "symbols": ["NormalTime$ebnf$2$subexpression$1$string$2"], "postprocess": id},
    {"name": "NormalTime$ebnf$2", "symbols": ["NormalTime$ebnf$2$subexpression$1"], "postprocess": id},
    {"name": "NormalTime$ebnf$2", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "NormalTime", "symbols": ["Value", "TComponent", "NormalTime$ebnf$1", "_", "NormalTime$ebnf$2"], "postprocess": d => ({ hour: d[0], minute: d[1], second: d[2], meridian: d[4]?.toUpperCase() })},
    {"name": "TComponent", "symbols": [{"literal":":"}, "Value"], "postprocess": d => d[1]},
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
    {"name": "Range", "symbols": ["int", {"literal":"-"}, "int"], "postprocess": d => ({ type: "range", left: d[0], right: d[2] })},
    {"name": "List$ebnf$1", "symbols": []},
    {"name": "List$ebnf$1", "symbols": ["List$ebnf$1", "ListItem"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "List", "symbols": ["int", "List$ebnf$1"], "postprocess": d => [d[0], ...d[1]]},
    {"name": "ListItem", "symbols": [{"literal":","}, "int"], "postprocess": d => d[1]},
    {"name": "Star", "symbols": [{"literal":"*"}], "postprocess": id},
    {"name": "int$ebnf$1", "symbols": [/[0-9]/]},
    {"name": "int$ebnf$1", "symbols": ["int$ebnf$1", /[0-9]/], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "int", "symbols": ["int$ebnf$1"], "postprocess": d => parseInt(d[0].join(""), 10)},
    {"name": "_$ebnf$1", "symbols": []},
    {"name": "_$ebnf$1", "symbols": ["_$ebnf$1", /[\s]/], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "_", "symbols": ["_$ebnf$1"], "postprocess": d => null}
]
  , ParserStart: "DateTime"
}
if (typeof module !== 'undefined'&& typeof module.exports !== 'undefined') {
   module.exports = grammar;
} else {
   window.grammar = grammar;
}
})();
